/**
 * Clipboard bridge — uses the native Clipboard TurboModule (@ohos.pasteboard)
 * because RN 0.84's Clipboard is not available in RNOH.
 */
import {TurboModuleRegistry} from 'react-native';

let nativeModule: any = null;
let resolved = false;

function getModule(): any {
  if (!resolved) {
    resolved = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nativeModule = TurboModuleRegistry.get<any>('MattermostClipboard') || null;
    } catch {
      nativeModule = null;
    }
  }
  return nativeModule;
}

export async function copyToClipboard(text: string): Promise<void> {
  const mod = getModule();
  console.log(`[Clipboard] module=${mod ? 'found' : 'MISSING'} method=${mod?.setString ? 'ok' : 'missing'}`);
  if (!mod) return;
  try {
    await mod.setString(text);
    console.log('[Clipboard] setString returned');
  } catch (e) {
    console.log('[Clipboard] setString error:', e);
  }
}

export default {
  copyToClipboard,
};