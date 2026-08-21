import { RNAbility, type RNOHCoreContext } from '@rnoh/react-native-openharmony';
import { pushService } from '@kit.PushKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { notificationManager } from '@kit.NotificationKit';
import notification from '@ohos.notification';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { Want, AbilityConstant } from '@kit.AbilityKit';
import wantAgent from '@ohos.app.ability.wantAgent';
import { WantAgent } from '@ohos.wantAgent';

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
  channel_id?: string;
  post_id?: string;
  root_id?: string;
  notification?: PushNotificationInner;
  payload?: PushWrappedPayload;
}

interface PushDeepLinkData {
  channel_id?: string;
  post_id?: string;
  root_id?: string;
}

interface PushDeepLinkTarget {
  channelId: string;
  postId: string;
  rootId: string;
  // When the target was captured (ms). Stale targets (user didn't tap the
  // notification promptly) are discarded so old pushes never yank the app to a
  // random channel later.
  capturedAt: number;
}

/**
 * Holds the latest Push Kit token so JS (via PushTurboModule) can read it.
 */
export class PushTokenHolder {
  static token: string = '';
  // Deep-link target of the most recently received push: which channel + post
  // to open. JS reads (and clears) this via PushTurboModule to navigate the
  // user to the tapped notification's message.
  static pushTarget: PushDeepLinkTarget | null = null;
}

export default class EntryAbility extends RNAbility {
  getPagePath() {
    return 'pages/Index';
  }

  // Extract the push deep-link params from a launch Want (set by the
  // notification's wantAgent) and store them for JS to consume.
  private capturePushTargetFromWant(want: Want): void {
    try {
      const params = want?.parameters as Record<string, string> | undefined;
      const channelId = params?.pushChannelId || '';
      const postId = params?.pushPostId || '';
      const rootId = params?.pushRootId || '';
      if (channelId && postId) {
        hilog.info(DOMAIN, TAG, 'want deep-link: channel=%{public}s post=%{public}s', channelId, postId);
        PushTokenHolder.pushTarget = { channelId, postId, rootId, capturedAt: Date.now() };
      }
    } catch (e) {
      // ignore
    }
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.capturePushTargetFromWant(want);
    super.onNewWant(want, launchParam);
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.capturePushTargetFromWant(want);
    super.onCreate(want, launchParam);
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
        hilog.info(DOMAIN, TAG, '[PUSH_TOKEN] getToken succeeded, token=%{public}s', token);
      }).catch((err: BusinessError) => {
        hilog.error(DOMAIN, TAG, '[PUSH_TOKEN] getToken failed: %{public}d %{public}s', err.code, err.message);
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
  private async publishFromPayload(dataStr: string): Promise<void> {
    try {
      const parsed = JSON.parse(dataStr) as PushPayload;
      // Support both raw payloads and wrapped { payload: { notification: ... } } objects.
      const notif = parsed?.notification;
      const wrapped = parsed?.payload;
      const wrappedNotif = wrapped?.notification;
      const title: string = parsed?.title || notif?.title || wrappedNotif?.title || 'Mattermost';
      const text: string = parsed?.message || parsed?.body || wrapped?.message || wrappedNotif?.body || 'New message';

      // Try to extract channel_id / post_id for deep-linking to the message.
      // They may be at the top level, or embedded inside the "data" JSON string
      // (the Huawei push provider sends the Mattermost payload as a stringified
      // JSON under `data`).
      let channelId: string = parsed?.channel_id || '';
      let postId: string = parsed?.post_id || '';
      let rootId: string = parsed?.root_id || '';
      if ((!channelId || (!postId && rootId === '')) && typeof parsed?.body === 'string') {
        try {
          const inner = JSON.parse(parsed.body) as PushDeepLinkData;
          channelId = channelId || inner?.channel_id || '';
          postId = postId || inner?.post_id || '';
          rootId = rootId || inner?.root_id || '';
        } catch (e) {
          // not JSON — ignore
        }
      }

      // NOTE: we deliberately do NOT set PushTokenHolder.pushTarget here.
      // The target is only consumed for navigation when the user TAPS the
      // notification (which fires onNewWant with the wantAgent params). Setting
      // it on receive would make the JS poll navigate the app even when the
      // user never tapped anything ("jumped to a random channel" bug).
      if (channelId && postId) {
        hilog.info(DOMAIN, TAG, 'notification deep-link params: channel=%{public}s post=%{public}s', channelId, postId);
      }

      // Build a WantAgent so tapping this notification opens the app with the
      // channel/post deep-link parameters (parsed in onNewWant/onCreate).
      let agent: WantAgent | undefined = undefined;
      try {
        const wantObj: Want = {
          bundleName: this.context.abilityInfo.bundleName,
          abilityName: 'EntryAbility',
          parameters: {
            pushChannelId: channelId,
            pushPostId: postId,
            pushRootId: rootId,
          },
        };
        agent = await wantAgent.getWantAgent({
          wants: [wantObj],
          operationType: wantAgent.OperationType.START_ABILITY,
          requestCode: 0,
          wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
        });
      } catch (e) {
        hilog.warn(DOMAIN, TAG, 'build wantAgent failed');
      }

      const request: notificationManager.NotificationRequest = {
        id: Date.now() % 1000,
        content: {
          contentType: notification.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: {
            title: title,
            text: text,
          },
        },
        // Tap → relaunch/foreground the app with the deep-link params.
        wantAgent: agent,
      };
      notificationManager.publish(request).catch(() => {
        // ignore publish errors
      });
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'publishFromPayload failed');
    }
  }
}
