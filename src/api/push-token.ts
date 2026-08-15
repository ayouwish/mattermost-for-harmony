/**
 * Push token bridge — reads the Push Kit token from the ArkTS PushTurboModule.
 */
import {TurboModuleRegistry} from 'react-native';

let nativeModule: any = null;
let initAttempted = false;

function getNativeModule(): any {
  if (initAttempted) return nativeModule;
  initAttempted = true;
  try {
    nativeModule = TurboModuleRegistry.get('Push');
    if (nativeModule) {
      console.log('[Push] Got module via TurboModuleRegistry');
      return nativeModule;
    }
  } catch (e) {
    console.log('[Push] TurboModuleRegistry.get failed:', e);
  }
  console.log('[Push] Module NOT FOUND');
  nativeModule = null;
  return nativeModule;
}

export async function getPushToken(): Promise<string> {
  const mod = getNativeModule();
  if (!mod) return '';
  try {
    const token = await mod.getPushToken();
    console.log('[Push] getPushToken:', token ? '(got token)' : '(empty)');
    return token || '';
  } catch (e) {
    console.log('[Push] getPushToken error:', e);
    return '';
  }
}

export async function logPushToken(): Promise<void> {
  const token = await getPushToken();
  if (token) {
    console.log('[Push] Push token available, length:', token.length);
  } else {
    console.log('[Push] Push token not yet available (AGC/network?)');
  }
}

export default {
  getPushToken,
  logPushToken,
};
