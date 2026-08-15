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

  __onDestroy__() {
    super.__onDestroy__();
  }
}
