/**
 * SystemOpen TurboModule
 *
 * Opens URLs (http/https) in the system browser via UIAbilityContext.openLink,
 * and shares text out to other apps (WeChat / Weibo / Huawei Share ...) via
 * the Share Kit system share panel (ShareController).
 *
 * JS usage:
 *   const sys = TurboModuleRegistry.get('SystemOpen');
 *   const ok = await sys.openUrl('https://example.com');
 *   const ok = await sys.shareText('title', 'content');
 */

import { TurboModule, type TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import type common from '@ohos.app.ability.common';
import { systemShare } from '@kit.ShareKit';
import { BusinessError } from '@kit.BasicServicesKit';

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

  /**
   * Opens the Share Kit system share panel (华为分享/微信/微博...) with the
   * given text prefilled. Uses systemShare.ShareController — the standard
   * sender API on HarmonyOS NEXT (raw startAbility sendData wants don't
   * resolve to the share panel).
   */
  async shareText(title: string, content: string): Promise<boolean> {
    if (!content) return false;
    try {
      const record: systemShare.SharedRecord = {
        utd: 'general.plain-text',
        content: content,
        title: title || 'Share',
      };
      const data = new systemShare.SharedData(record);
      const controller = new systemShare.ShareController(data);
      await controller.show(this.getContext(), {
        previewMode: systemShare.SharePreviewMode.DETAIL,
        selectionMode: systemShare.SelectionMode.SINGLE,
      });
      return true;
    } catch (e) {
      const err = e as BusinessError;
      console.log(`[SystemOpen] shareText failed: ${err.code} ${err.message}`);
      return false;
    }
  }

  __onDestroy__() {
    super.__onDestroy__();
  }
}