/**
 * PersistentStorage TurboModule
 *
 * Uses @ohos.data.preferences to store key-value pairs on device.
 * Exposed to JS as TurboModule 'PersistentStorage'.
 *
 * All methods are synchronous from JS perspective (return Promise).
 * The ArkTS preferences API is async internally.
 */

import { TurboModule, type TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { preferences } from '@kit.ArkData';
import type common from '@ohos.app.ability.common';

const PREFS_NAME = 'mattermost_storage';

export class PersistentStorageTurboModule extends TurboModule {
  public static readonly NAME = 'PersistentStorage';

  private prefs: preferences.Preferences | null = null;

  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  private getContext(): common.UIAbilityContext {
    return this.ctx.uiAbilityContext;
  }

  private async getPrefs(): Promise<preferences.Preferences> {
    if (!this.prefs) {
      this.prefs = await preferences.getPreferences(this.getContext(), PREFS_NAME);
    }
    return this.prefs;
  }

  getConstants(): Record<string, string> {
    return {};
  }

  async getString(key: string): Promise<string> {
    try {
      const prefs = await this.getPrefs();
      const val = await prefs.get(key, '');
      if (typeof val === 'string') {
        return val;
      }
      return String(val);
    } catch (e) {
      return '';
    }
  }

  async setString(key: string, value: string): Promise<void> {
    try {
      const prefs = await this.getPrefs();
      await prefs.put(key, value);
      await prefs.flush();
    } catch (e) {
      // ignore errors
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const prefs = await this.getPrefs();
      await prefs.delete(key);
      await prefs.flush();
    } catch (e) {
      // ignore
    }
  }

  async getAllKeys(): Promise<string[]> {
    try {
      const prefs = await this.getPrefs();
      const all = await prefs.getAll() as Record<string, string>;
      return Object.keys(all);
    } catch (e) {
      return [];
    }
  }

  __onDestroy__() {
    super.__onDestroy__();
    this.prefs = null;
  }
}
