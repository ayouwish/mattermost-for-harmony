/**
 * Notifications TurboModule
 *
 * Uses @ohos.notificationManager to publish local notifications.
 * Exposed to JS as TurboModule 'Notifications'.
 *
 * JS usage:
 *   const notif = TurboModuleRegistry.getEnforcing('Notifications');
 *   await notif.notify('Title', 'Body', 1);
 */

import { TurboModule, type TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { notificationManager } from '@kit.NotificationKit';
import notification from '@ohos.notification';

export class NotificationsTurboModule extends TurboModule {
  public static readonly NAME = 'Notifications';

  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  getConstants(): Record<string, string> {
    return {};
  }

  async notify(title: string, body: string, id: number): Promise<void> {
    try {
      const request: notificationManager.NotificationRequest = {
        id,
        content: {
          contentType: notification.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: {
            title: title || '',
            text: body || '',
          },
        },
      };
      await notificationManager.publish(request);
    } catch (e) {
      // Notification may be disabled or publishing may fail — ignore.
    }
  }

  async cancelAll(): Promise<void> {
    try {
      await notificationManager.cancelAll();
    } catch (e) {
      // ignore
    }
  }

  async isEnabled(): Promise<boolean> {
    try {
      const enabled = await notificationManager.isNotificationEnabled();
      return enabled;
    } catch (e) {
      return false;
    }
  }

  /**
   * Request the notification permission (shows the system authorization dialog
   * on first call). Call once after login.
   */
  async requestPermission(): Promise<boolean> {
    try {
      await notificationManager.requestEnableNotification();
      return true;
    } catch (e) {
      return false;
    }
  }

  __onDestroy__() {
    super.__onDestroy__();
  }
}
