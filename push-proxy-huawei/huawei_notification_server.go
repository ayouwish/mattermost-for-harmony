// Copyright (c) 2026 Mattermost HarmonyOS project contributors.
//
// Huawei Push Kit notification provider for mattermost-push-proxy.
//
// Drop this file into the server/ package of your mattermost-push-proxy
// checkout, register the settings + push target (see README.md in this
// directory), rebuild, and configure Mattermost's PushNotificationServer.
//
// The Mattermost server routes a message to this provider when the client
// session's device_id uses the `huawei:<token>` prefix (e.g. reported by the
// HarmonyOS client as `device_id = "huawei:<push_token>"`). The server's
// SetDeviceIdAndPlatform() splits on ":" so Platform="huawei" and the push
// proxy dispatches to the target registered under Type "huawei".

package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
)

const (
	huaweiOAuthURL = "https://oauth-login.cloud.huawei.com/oauth2/v2/token"
	huaweiPushURL  = "https://push-api.cloud.huawei.com/v1/%s/messages:send"
	// Refresh the OAuth token this many seconds before it actually expires.
	huaweiTokenRefreshLead = 300
	// Huawei send API success / token-error codes.
	huaweiCodeSuccess       = "80000000"
	huaweiCodeInvalidToken  = "80100003" // token invalid / no device permission
	huaweiCodeTokenExpired  = "80100004" // token expired
	huaweiCodeBadToken      = "80200001" // token length / format error
	huaweiCodeTooManyTarget = "80200004"
)

// HuaweiPushSettings holds the AGC credentials used to talk to Huawei Push Kit.
type HuaweiPushSettings struct {
	Type      string
	AppID     string `json:"AppId"`
	AppSecret string `json:"AppSecret"`
}

type huaweiOAuthResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

type huaweiSendResponse struct {
	Code string `json:"code"`
	Msg  string `json:"msg"`
}

type huaweiMessage struct {
	ValidateOnly bool                   `json:"validate_only"`
	Message      map[string]interface{} `json:"message"`
}

// HuaweiNotificationServer sends notifications through Huawei Push Kit.
type HuaweiNotificationServer struct {
	appID      string
	appSecret  string
	httpClient *http.Client
	logger     *mlog.Logger
	stats      *stats

	mu          sync.RWMutex
	accessToken string
	tokenExpiry time.Time
}

// NewHuaweiNotificationServer returns a server implementing the
// NotificationServer interface for Huawei Push Kit.
func NewHuaweiNotificationServer(settings HuaweiPushSettings, logger *mlog.Logger, s *stats, sendTimeoutSec, retryTimeoutSec int) *HuaweiNotificationServer {
	return &HuaweiNotificationServer{
		appID:     settings.AppID,
		appSecret: settings.AppSecret,
		httpClient: &http.Client{
			Timeout: time.Duration(sendTimeoutSec) * time.Second,
		},
		logger: logger,
		stats:  s,
	}
}

// Initialize fetches an access token so misconfiguration fails fast at startup.
func (h *HuaweiNotificationServer) Initialize() error {
	_, err := h.getAccessToken()
	if err != nil {
		h.logger.Error("Huawei: failed to initialize Push Kit client", mlog.Err(err))
		return err
	}
	return nil
}

func (h *HuaweiNotificationServer) SendNotification(appVersion int, msg *model.PushNotification) PushResponse {
	if h.stats != nil {
		defer h.stats.incrementAndroidSend()
	}

	token, err := h.getAccessToken()
	if err != nil {
		h.logger.Error("Huawei: failed to get access token", mlog.Err(err))
		return NewErrorPushResponse("huawei oauth failed: " + err.Error())
	}

	payload := huaweiMessage{
		ValidateOnly: false,
		Message:      buildHuaweiMessage(msg),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return NewErrorPushResponse("huawei: failed to encode message: " + err.Error())
	}

	pushURL := fmt.Sprintf(huaweiPushURL, h.appID)
	var lastErr error
	// Simple retry loop for transient network / 5xx failures.
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * time.Second)
		}

		req, err := http.NewRequest(http.MethodPost, pushURL, bytes.NewReader(body))
		if err != nil {
			return NewErrorPushResponse("huawei: request build error: " + err.Error())
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := h.httpClient.Do(req)
		if err != nil {
			lastErr = err
			h.logger.Warn("Huawei: send attempt failed", mlog.Err(err), mlog.Int("attempt", attempt))
			continue
		}

		var result huaweiSendResponse
		decodeErr := json.NewDecoder(resp.Body).Decode(&result)
		resp.Body.Close()
		if decodeErr != nil {
			lastErr = decodeErr
			continue
		}

		switch result.Code {
		case huaweiCodeSuccess, "":
			return NewOkPushResponse()
		case huaweiCodeInvalidToken, huaweiCodeTokenExpired, huaweiCodeBadToken:
			h.logger.Warn("Huawei: invalid/expired token, requesting removal",
				mlog.String("code", result.Code),
				mlog.String("device_id", redactToken(msg.DeviceId)))
			return NewRemovePushResponse()
		case huaweiCodeTooManyTarget:
			// Too many devices in one message; not expected from Mattermost.
			return NewErrorPushResponse(fmt.Sprintf("huawei error %s: %s", result.Code, result.Msg))
		default:
			h.logger.Warn("Huawei: send failed",
				mlog.String("code", result.Code),
				mlog.String("msg", result.Msg),
				mlog.String("device_id", redactToken(msg.DeviceId)))
			return NewErrorPushResponse(fmt.Sprintf("huawei error %s: %s", result.Code, result.Msg))
		}
	}

	h.logger.Warn("Huawei: giving up after retries", mlog.Err(lastErr))
	return NewErrorPushResponse("huawei send failed: " + errString(lastErr))
}

// getAccessToken returns a cached Huawei OAuth2 access token, refreshing it
// when expired or not yet acquired.
func (h *HuaweiNotificationServer) getAccessToken() (string, error) {
	h.mu.RLock()
	if h.accessToken != "" && time.Now().Before(h.tokenExpiry) {
		token := h.accessToken
		h.mu.RUnlock()
		return token, nil
	}
	h.mu.RUnlock()

	h.mu.Lock()
	defer h.mu.Unlock()

	// Double-check under the write lock (another goroutine may have refreshed).
	if h.accessToken != "" && time.Now().Before(h.tokenExpiry) {
		return h.accessToken, nil
	}

	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", h.appID)
	form.Set("client_secret", h.appSecret)

	req, err := http.NewRequest(http.MethodPost, huaweiOAuthURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var oauth huaweiOAuthResponse
	if err := json.NewDecoder(resp.Body).Decode(&oauth); err != nil {
		return "", err
	}
	if oauth.AccessToken == "" {
		return "", fmt.Errorf("huawei oauth returned no access_token")
	}

	expiresIn := oauth.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	h.accessToken = oauth.AccessToken
	h.tokenExpiry = time.Now().Add(time.Duration(expiresIn-huaweiTokenRefreshLead) * time.Second)
	h.logger.Debug("Huawei: OAuth token acquired", mlog.Duration("expires_in", time.Duration(expiresIn)*time.Second))
	return h.accessToken, nil
}

// buildHuaweiMessage converts a Mattermost push notification into the Huawei
// Push Kit send payload.
//
// The `data` field is delivered to the app via pushService.receiveMessage and
// the HarmonyOS client renders it into a local notification. The top-level
// `notification` block is shown by the system when the app is killed/background.
func buildHuaweiMessage(msg *model.PushNotification) map[string]interface{} {
	title := msg.OverrideUsername
	if title == "" {
		title = msg.SenderName
	}
	if title == "" {
		title = "Mattermost"
	}

	message := msg.Message
	if message == "" {
		message = "New message"
	}

	// Strip any leading "@username: " so the system banner is a bit cleaner.
	body := message
	if idx := strings.Index(body, ": "); idx > 0 && idx < 24 {
		body = body[idx+2:]
	}

	data := map[string]interface{}{
		"title":        title,
		"message":      message,
		"body":         message,
		"ack_id":       msg.AckId,
		"type":         msg.Type,
		"post_id":      msg.PostId,
		"channel_id":   msg.ChannelId,
		"team_id":      msg.TeamId,
		"sender_id":    msg.SenderId,
		"sender_name":  msg.SenderName,
		"channel_name": msg.ChannelName,
		"server_id":    msg.ServerId,
		"is_crt":       msg.IsCRTEnabled,
	}
	dataJSON, _ := json.Marshal(data)

	return map[string]interface{}{
		"token": []string{msg.DeviceId},
		"notification": map[string]interface{}{
			"title": title,
			"body":  body,
		},
		"data": string(dataJSON),
	}
}

func errString(err error) string {
	if err == nil {
		return "unknown error"
	}
	return err.Error()
}
