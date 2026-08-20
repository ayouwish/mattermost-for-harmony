/**
 * Opens http/https URLs in the system browser via the native SystemOpen
 * TurboModule (backed by @kit.BasicServicesKit openLink).
 */
import {TurboModuleRegistry} from 'react-native';

let nativeModule: any = null;
let resolved = false;

function getModule(): any {
  if (!resolved) {
    resolved = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nativeModule = TurboModuleRegistry.get<any>('SystemOpen') || null;
    } catch {
      nativeModule = null;
    }
  }
  return nativeModule;
}

export async function openInBrowser(url: string): Promise<boolean> {
  const mod = getModule();
  if (!mod) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Boolean(await mod.openUrl(url));
  } catch {
    return false;
  }
}

export default {
  openInBrowser,
};