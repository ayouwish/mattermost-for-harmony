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
      nativeModule = TurboModuleRegistry.get<any>('Clipboard') || null;
    } catch {
      nativeModule = null;
    }
  }
  return nativeModule;
}

export async function copyToClipboard(text: string): Promise<void> {
  const mod = getModule();
  if (!mod) return;
  try {
    await mod.setString(text);
  } catch {
    // ignore
  }
}

export default {
  copyToClipboard,
};