/**
 * Push TurboModule
 *
 * Exposes the Push Kit token to JS so the app can report it to the
 * Mattermost server for push notifications.
 *
 * JS usage:
 *   const push = TurboModuleRegistry.getEnforcing('Push');
 *   const token = await push.getPushToken();
 */

import { TurboModule, type TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { PushTokenHolder } from './entryability/EntryAbility';
import { preferences } from '@kit.ArkData';

export class PushTurboModule extends TurboModule {
  public static readonly NAME = 'Push';

  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  getConstants(): Record<string, string> {
    return {};
  }

  async getPushToken(): Promise<string> {
    return PushTokenHolder.token || '';
  }

  /**
   * Returns the deep-link target (channel_id/post_id/root_id) of the most
   * recently received push, and clears it so it isn't replayed. Targets older
   * than 30s are discarded — the user didn't tap the notification promptly, so
   * navigating now would yank them to a random channel.
   */
  async consumePushTarget(): Promise<string> {
    const target = PushTokenHolder.pushTarget;
    PushTokenHolder.pushTarget = null;
    if (!target) return '';
    if (Date.now() - target.capturedAt > 30000) {
      return '';
    }
    return JSON.stringify(target);
  }

  /**
   * Returns (and clears) content shared into the app from other apps via the
   * system share sheet. Empty string when nothing is pending. Falls back to
   * the persistent copy (ShareExtension may have run in a previous process).
   */
  async consumeSharedContent(): Promise<string> {
    let shared = PushTokenHolder.sharedContent;
    PushTokenHolder.sharedContent = '';
    if (!shared) {
      try {
        const prefs = await preferences.getPreferences(this.ctx.uiAbilityContext, 'mattermost_storage');
        const persisted = prefs.getSync('pendingSharedContent', '') as string;
        if (persisted) {
          prefs.deleteSync('pendingSharedContent');
          await prefs.flush();
          shared = persisted;
        }
      } catch (e) {
        // ignore
      }
    }
    return shared || '';
  }

  __onDestroy__() {
    super.__onDestroy__();
  }
}
