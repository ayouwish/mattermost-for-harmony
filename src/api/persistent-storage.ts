/**
 * Persistent storage wrapper — bridges to ArkTS PersistentStorageTurboModule.
 *
 * Survives app restarts. Used for:
 * - Server URL
 * - Session token (for auto-login)
 * - User preferences
 */
import { TurboModuleRegistry, NativeModules } from 'react-native';

// Try multiple ways to get the native module
let nativeModule: any = null;
let initAttempted = false;

function getNativeModule(): any {
  if (initAttempted) return nativeModule;
  initAttempted = true;

  // Method 1: TurboModuleRegistry
  try {
    nativeModule = TurboModuleRegistry.get('PersistentStorage');
    if (nativeModule) {
      return nativeModule;
    }
  } catch (e) {
  }

  // Method 2: NativeModules fallback
  try {
    nativeModule = (NativeModules as any)?.PersistentStorage;
    if (nativeModule) {
      return nativeModule;
    }
  } catch (e) {
  }

  nativeModule = null;
  return nativeModule;
}

// In-memory fallback store (used when native module is unavailable)
const memStore: Record<string, string> = {};

export const persistentStorage = {
  async getString(key: string, defaultValue: string = ''): Promise<string> {
    const mod = getNativeModule();
    if (!mod) {
      return memStore[key] ?? defaultValue;
    }
    try {
      const result = await mod.getString(key);
      return result || defaultValue;
    } catch (e) {
      console.log('[PersistentStorage] getString error:', key, e);
      return memStore[key] ?? defaultValue;
    }
  },

  async setString(key: string, value: string): Promise<void> {
    memStore[key] = value; // always keep in memory as cache
    const mod = getNativeModule();
    if (!mod) {
      return;
    }
    try {
      await mod.setString(key, value);
    } catch (e) {
      console.log('[PersistentStorage] setString error:', key, e);
    }
  },

  async delete(key: string): Promise<void> {
    delete memStore[key];
    const mod = getNativeModule();
    if (!mod) return;
    try {
      await mod.delete(key);
    } catch {
      // ignore
    }
  },

  async getAllKeys(): Promise<string[]> {
    const mod = getNativeModule();
    if (!mod) return Object.keys(memStore);
    try {
      return await mod.getAllKeys();
    } catch {
      return Object.keys(memStore);
    }
  },

  /** Serialize an object to JSON and store it. */
  async setJSON(key: string, value: unknown): Promise<void> {
    try {
      await this.setString(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  },

  /** Read a stored JSON object; returns null if missing/corrupt. */
  async getJSON<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.getString(key, '');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
};

// Storage keys
export const STORAGE_KEYS = {
  SERVER_URL: 'serverUrl',
  AUTH_TOKEN: 'authToken',
  USER_ID: 'userId',
  USERNAME: 'username',
} as const;

export default persistentStorage;
