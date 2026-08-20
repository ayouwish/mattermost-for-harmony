/**
 * SystemOpen TurboModule
 *
 * Opens URLs (http/https) in the system browser via UIAbilityContext.openLink.
 * Used by the rich-link preview cards and media cards.
 *
 * JS usage:
 *   const sys = TurboModuleRegistry.get('SystemOpen');
 *   const ok = await sys.openUrl('https://example.com');
 */

import { TurboModule, type TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import type common from '@ohos.app.ability.common';

export class SystemOpenTurboModule extends TurboModule {
  public static readonly NAME = 'SystemOpen';

  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  private getContext(): common.UIAbilityContext {
    return this.ctx.uiAbilityContext;
  }

  getConstants(): Record<string, string> {
    return {};
  }

  async openUrl(url: string): Promise<boolean> {
    if (!url) return false;
    try {
      await this.getContext().openLink(url);
      return true;
    } catch (e) {
      // ignore failures — caller can surface a message
    }
    return false;
  }

  __onDestroy__() {
    super.__onDestroy__();
  }
}