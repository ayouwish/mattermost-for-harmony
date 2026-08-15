import { RNAbility, type RNOHCoreContext } from '@rnoh/react-native-openharmony';
import { pushService } from '@kit.PushKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { notificationManager } from '@kit.NotificationKit';
import notification from '@ohos.notification';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0x0100;
const TAG = 'MattermostPush';

interface PushNotificationInner {
  title?: string;
  body?: string;
}

interface PushWrappedPayload {
  notification?: PushNotificationInner;
  message?: string;
}

interface PushPayload {
  title?: string;
  message?: string;
  body?: string;
  notification?: PushNotificationInner;
  payload?: PushWrappedPayload;
}

/**
 * Holds the latest Push Kit token so JS (via PushTurboModule) can read it.
 */
export class PushTokenHolder {
  static token: string = '';
}

export default class EntryAbility extends RNAbility {
  getPagePath() {
    return 'pages/Index';
  }

  protected async onPrepareRNInstance(rnohCoreContext: RNOHCoreContext) {
    this.initPushKit();
  }

  private initPushKit(): void {
    hilog.info(DOMAIN, TAG, 'initPushKit called');
    // Request notification permission (system dialog on first launch).
    notificationManager.isNotificationEnabled().then((enabled: boolean) => {
      if (!enabled) {
        notificationManager.requestEnableNotification().catch(() => {
          hilog.warn(DOMAIN, TAG, 'requestEnableNotification rejected');
        });
      }
    }).catch(() => {
      // ignore
    });

    // Get the Push Token for this device + app.
    try {
      pushService.getToken().then((token: string) => {
        PushTokenHolder.token = token;
        hilog.info(DOMAIN, TAG, 'getToken succeeded');
      }).catch((err: BusinessError) => {
        hilog.error(DOMAIN, TAG, 'getToken failed: %{public}d %{public}s', err.code, err.message);
      });
    } catch (err) {
      let e = err as BusinessError;
      hilog.error(DOMAIN, TAG, 'getToken exception: %{public}d %{public}s', e.code, e.message);
    }

    // Receive incoming push messages (foreground; payload contains data).
    try {
      pushService.receiveMessage('DEFAULT', this, (payload) => {
        try {
          const dataStr: string = payload.data;
          hilog.info(DOMAIN, TAG, 'receiveMessage data=%{public}s', dataStr);
          if (dataStr) {
            this.publishFromPayload(dataStr);
          }
        } catch (e) {
          hilog.error(DOMAIN, TAG, 'receiveMessage parse failed');
        }
      });
    } catch (err) {
      let e = err as BusinessError;
      hilog.error(DOMAIN, TAG, 'receiveMessage register failed: %{public}d %{public}s', e.code, e.message);
    }
  }

  /**
   * Parse a Mattermost push payload and show a local notification.
   * Payload JSON (Mattermost push proxy / custom bridge) is expected to contain
   * fields like { title, message, channel_id, sender_id }.
   */
  private publishFromPayload(dataStr: string): void {
    try {
      const parsed = JSON.parse(dataStr) as PushPayload;
      // Support both raw payloads and wrapped { payload: { notification: ... } } objects.
      const notif = parsed?.notification;
      const wrapped = parsed?.payload;
      const wrappedNotif = wrapped?.notification;
      const title: string = parsed?.title || notif?.title || wrappedNotif?.title || 'Mattermost';
      const text: string = parsed?.message || parsed?.body || wrapped?.message || wrappedNotif?.body || 'New message';

      const request: notificationManager.NotificationRequest = {
        id: Date.now() % 1000,
        content: {
          contentType: notification.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: {
            title: title,
            text: text,
          },
        },
      };
      notificationManager.publish(request).catch(() => {
        // ignore publish errors
      });
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'publishFromPayload failed');
    }
  }
}
