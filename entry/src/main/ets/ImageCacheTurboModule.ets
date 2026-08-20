/**
 * ImageCache TurboModule
 *
 * Persistent disk cache for authenticated images (the RNOH <Image> pipeline
 * cannot send custom headers, so images are fetched with an authenticated
 * fetch() in JS and rendered as data: URIs — see src/utils/imageDataUri.ts).
 *
 * This module stores the base64 payload (with a leading "mime\n" line) in the
 * app sandbox cache directory, so JS can rehydrate images across app restarts
 * WITHOUT re-downloading them.
 *
 * JS usage:
 *   const cache = TurboModuleRegistry.get('ImageCache');
 *   const raw = await cache.getBase64(key);      // "image/png\n<base64>" | null
 *   await cache.saveBase64(key, "image/png\n<base64>");
 */

import { TurboModule, type TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import fs from '@ohos.file.fs';
import type common from '@ohos.app.ability.common';

const SUBDIR = 'imagecache';
const MAX_FILES = 500;

interface CacheFileEntry {
  n: string;
  t: number;
}

export class ImageCacheTurboModule extends TurboModule {
  public static readonly NAME = 'ImageCache';

  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  private getContext(): common.UIAbilityContext {
    return this.ctx.uiAbilityContext;
  }

  private cacheDir(): string {
    return `${this.getContext().cacheDir}/${SUBDIR}`;
  }

  private ensureDir(dir: string): string {
    if (!fs.accessSync(dir)) {
      fs.mkdirSync(dir, true);
    }
    return dir;
  }

  private filePath(key: string): string {
    return `${this.ensureDir(this.cacheDir())}/${key}.img`;
  }

  getConstants(): Record<string, string> {
    return {};
  }

  /**
   * Returns the cached "mime\n<base64>" payload for the key, or null.
   */
  async getBase64(key: string): Promise<string | null> {
    if (!key) return null;
    try {
      const p = this.filePath(key);
      if (fs.accessSync(p) && fs.statSync(p).size > 0) {
        return fs.readTextSync(p);
      }
    } catch (e) {
      // ignore read failures (corrupt/evicted file) — treat as cache miss
    }
    return null;
  }

  /**
   * Persists the "mime\n<base64>" payload under the key and returns whether
   * the write succeeded.
   */
  async saveBase64(key: string, value: string): Promise<boolean> {
    if (!key || !value) return false;
    try {
      const dir = this.ensureDir(this.cacheDir());
      this.cleanupIfNeeded(dir);
      const p = `${dir}/${key}.img`;
      const file = fs.openSync(p, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      fs.writeSync(file.fd, value);
      fs.closeSync(file);
      return true;
    } catch (e) {
      // ignore write failures — caller falls back to in-memory data URI
    }
    return false;
  }

  /**
   * Evicts the oldest files once the cache directory exceeds MAX_FILES.
   */
  private cleanupIfNeeded(dir: string): void {
    try {
      const entries = fs.listFileSync(dir);
      if (entries.length <= MAX_FILES) return;
      const files: CacheFileEntry[] = entries
        .map((n: string): CacheFileEntry => ({ n: n, t: fs.statSync(`${dir}/${n}`).mtime }))
        .sort((a: CacheFileEntry, b: CacheFileEntry) => a.t - b.t);
      const toDelete = files.length - MAX_FILES;
      for (let i = 0; i < toDelete; i++) {
        fs.unlinkSync(`${dir}/${files[i].n}`);
      }
    } catch (e) {
      // ignore — eviction is best-effort
    }
  }

  __onDestroy__() {
    super.__onDestroy__();
  }
}