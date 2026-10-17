/**
 * FileCache bridge — key → JSON store backed by files in the app sandbox
 * cache dir (native FileCache TurboModule).
 *
 * Used for LARGE cached blobs (per-channel post lists, thread inboxes,
 * channel info) which must not live in @ohos.data.preferences: preferences
 * keeps its whole file in memory and re-flushes on every write, so big JSON
 * blobs made app starts crawl.
 */
import {TurboModuleRegistry} from 'react-native';

let nativeModule: any = null;
let resolved = false;

function getModule(): any {
  if (!resolved) {
    resolved = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nativeModule = TurboModuleRegistry.get<any>('FileCache') || null;
    } catch {
      nativeModule = null;
    }
  }
  return nativeModule;
}

export async function fcGetString(key: string): Promise<string | null> {
  const mod = getModule();
  if (!mod) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: string = await mod.getString(key);
    return raw || null;
  } catch {
    return null;
  }
}

export async function fcSetString(key: string, value: string): Promise<boolean> {
  const mod = getModule();
  if (!mod) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Boolean(await mod.setString(key, value));
  } catch {
    return false;
  }
}

export async function fcRemove(key: string): Promise<boolean> {
  const mod = getModule();
  if (!mod) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Boolean(await mod.remove(key));
  } catch {
    return false;
  }
}

export async function fcClearAll(): Promise<boolean> {
  const mod = getModule();
  if (!mod) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Boolean(await mod.clearAll());
  } catch {
    return false;
  }
}

export default {
  fcGetString,
  fcSetString,
  fcRemove,
  fcClearAll,
};