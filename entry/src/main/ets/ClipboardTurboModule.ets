/**
 * Clipboard TurboModule — wraps @ohos.pasteboard for copy-to-clipboard.
 *
 * RN 0.84 removed Clipboard from core, and RNOH doesn't ship it, so we expose
 * the HarmonyOS system pasteboard via this TurboModule.
 *
 * JS usage:
 *   const clip = TurboModuleRegistry.get('Clipboard');
 *   await clip.setString('text');
 */

import { TurboModule, type TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import pasteboard from '@ohos.pasteboard';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0x0100;
const TAG = 'MattermostClipboard';

export class ClipboardTurboModule extends TurboModule {
  public static readonly NAME = 'Clipboard';

  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  getConstants(): Record<string, string> {
    return {};
  }

  async setString(text: string): Promise<void> {
    try {
      // createPlainTextData is the simplest way to create a text pasteboard
      // entry — no MIME type enum needed.
      const pasteData = pasteboard.createPlainTextData(text || '');
      const systemPasteboard = pasteboard.getSystemPasteboard();
      await systemPasteboard.setData(pasteData);
      hilog.info(DOMAIN, TAG, 'clipboard setString ok, len=%{public}d', text.length);
    } catch (e) {
      const err = e as Error;
      hilog.error(DOMAIN, TAG, 'clipboard setString failed: %{public}s', err.message || String(e));
    }
  }

  __onDestroy__() {
    super.__onDestroy__();
  }
}