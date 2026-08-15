# Huawei Push Kit provider for mattermost-push-proxy

让 [mattermost-push-proxy](https://github.com/mattermost/mattermost-push-proxy) 支持把 Mattermost 通知通过**华为 Push Kit** 推送到鸿蒙设备。

## 工作原理

Mattermost server 对 `device_id` 用冒号前缀判定平台（`huawei:<token>` → `Platform="huawei"`），
push proxy 按 `Platform` 查表分发到对应的 provider。本 provider 注册为 `Type: "huawei"`，
收到通知后调用华为 Push Kit REST API 下发。

```
HarmonyOS 客户端 (device_id = "huawei:<push_token>")
   │ 登录上报
   ▼
Mattermost Server (PushNotificationServer → push proxy)
   ▼ POST /api/v1/send_push (platform=huawei)
mattermost-push-proxy ──► HuaweiNotificationServer ──► 华为 Push Kit REST API
                                                            │
                                                            ▼
                                                      鸿蒙设备收通知
```

## 文件

| 文件 | 说明 |
|------|------|
| `huawei_notification_server.go` | 华为 provider（放入 push proxy 的 `server/` 包） |
| `config/mattermost-push-proxy.json` | 含 `HuaweiPushSettings` 的配置示例 |

## 部署步骤

### 1. 准备 push proxy 源码

```bash
git clone https://github.com/mattermost/mattermost-push-proxy.git
cd mattermost-push-proxy
```

### 2. 加入华为 provider

复制 `huawei_notification_server.go` 到 `server/` 目录：

```bash
cp /path/to/huawei_notification_server.go server/
```

### 3. 修改 `server/config_push_proxy.go`

在 `ConfigPushProxy` 结构体中新增一个字段（放在 `AndroidPushSettings` 后面即可）：

```go
type ConfigPushProxy struct {
	AndroidPushSettings     []AndroidPushSettings
	HuaweiPushSettings      []HuaweiPushSettings
	ListenAddress           string
	// ... 其余不变
}
```

### 4. 修改 `server/server.go`

在 `Start()` 方法中，AndroidPushSettings 注册循环之后新增华为注册循环：

```go
	for _, settings := range s.cfg.AndroidPushSettings {
		server := NewAndroidNotificationServer(settings, s.logger, m, s.stats, s.cfg.SendTimeoutSec, s.cfg.RetryTimeoutSec)
		err := server.Initialize()
		if err != nil {
			s.logger.Error("Failed to initialize client", mlog.Err(err))
			continue
		}
		s.pushTargets[settings.Type] = server
	}

	// Huawei Push Kit (HarmonyOS)
	for _, settings := range s.cfg.HuaweiPushSettings {
		server := NewHuaweiNotificationServer(settings, s.logger, s.stats, s.cfg.SendTimeoutSec, s.cfg.RetryTimeoutSec)
		err := server.Initialize()
		if err != nil {
			s.logger.Error("Failed to initialize Huawei Push Kit client", mlog.Err(err))
			continue
		}
		s.pushTargets[settings.Type] = server
	}
```

### 5. 配置

复制示例配置并填入 AGC 凭据：

```bash
cp config/mattermost-push-proxy.sample.json config/mattermost-push-proxy.json
```

配置中的华为段（`AppId` / `AppSecret` 来自 AppGallery Connect，见下文）：

```json
{
    "HuaweiPushSettings": [
        {
            "Type": "huawei",
            "AppId": "123456789012345678",
            "AppSecret": "你的_AGC_AppSecret"
        }
    ]
}
```

> 多个华为应用/环境可追加多个条目，`Type` 必须为 `huawei`（与客户端上报的 `huawei:` 前缀一致）。

### 6. 编译与运行

```bash
make build
./bin/mattermost-push-proxy -config ./config/mattermost-push-proxy.json
```

启动后日志出现 `Server is listening on :8066` 即成功；若 AGC 凭据错误会在此阶段报错。

### 7. 配置 Mattermost 服务器

在 Mattermost 系统控制台（或 `config.json`）中设置推送服务器指向 push proxy：

```
Environment → Push Notification Server: http://<push-proxy-host>:8066
Environment → Push Notification Contents: Full message payload（若需完整消息内容）
```

## AppGallery Connect (AGC) 侧准备

1. 登录 [AppGallery Connect](https://appgalleryconnect.huawei.com)，进入你的应用
2. 确保「推送服务」已开通（见仓库根目录 `PUSH_KIT_SETUP.md`）
3. 获取凭据：
   - **App ID**：`我的应用 → 应用信息 → AppID`（数字串）
   - **App Secret**：`项目设置 → 常规 → App secret`（首次点击获取/显示）
4. 若开启了「应用级鉴权」：`项目设置 → API 管理 → 应用级鉴权`，在 OAuth2 客户端列表查看/创建 API 密钥（Client ID / Client Secret）——此时请使用**客户端 ID + 密钥**作为 `AppId`/`AppSecret`（`AppId` 用 API 密钥的 Client ID）

## 验证（不装 App 也能测）

push proxy 运行后，直接 POST 一条测试消息：

```bash
curl -X POST http://localhost:8066/api/v1/send_push \
  -H 'Content-Type: application/json' \
  -d '{
    "platform": "huawei",
    "server_id": "test-server",
    "device_id": "你的_华为_push_token",
    "message": "@alice: hello from test",
    "type": "message"
  }'
```

- 返回 `{"status":"OK"}` 且手机收到通知 → 链路通
- 返回 `FAIL` / `REMOVE` → 按 `msg` / `code` 排查（常见：token 失效、AppId/Secret 错误、AGC 未开通推送）

## 排查

| 现象 | 原因 |
|------|------|
| 启动时 `Failed to initialize Huawei Push Kit client` | `AppId`/`AppSecret` 错误或 AGC 未开通推送服务 |
| `uawei error 80100003` | 设备 token 无效（客户端 token 过期/重新安装） |
| 手机无通知 | 通知权限未开；`PushNotificationContents` 未设；token 未上报 |
| 已读回执未生效 | 客户端未调用 push proxy 的 `/api/v1/ack`（当前客户端尚未实现，可后续补） |
