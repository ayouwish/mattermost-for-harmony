/**
 * FileCache TurboModule
 *
 * Key → JSON-string file store in the app sandbox cache directory
 * (cache/mmcache/). Purpose-built for LARGE blobs (per-channel post lists,
 * thread inboxes — tens to hundreds of KB each), which must NOT live in
 * @ohos.data.preferences: preferences keeps the whole file in memory and
 * re-flushes it on every write, so big blobs made cold starts crawl.
 *
 * JS usage:
 *   const fc = TurboModuleRegistry.get('FileCache');
 *   const s = await fc.getString(key);   // string | null
 *   await fc.setString(key, jsonText);
 *   await fc.remove(key);
 */

import { TurboModule, type TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import fs from '@ohos.file.fs';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';

const SUBDIR = 'mmcache';
const MAX_FILES = 300;
const DOMAIN = 0x0100;
const TAG = 'MattermostFileCache';

interface CacheFileEntry {
  n: string;
  t: number;
}

export class FileCacheTurboModule extends TurboModule {
  public static readonly NAME = 'FileCache';

  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  private cacheDir(): string {
    return `${this.ctx.uiAbilityContext.cacheDir}/${SUBDIR}`;
  }

  private ensureDir(dir: string): string {
    if (!fs.accessSync(dir)) {
      fs.mkdirSync(dir, true);
    }
    return dir;
  }

  private filePath(key: string): string {
    return `${this.ensureDir(this.cacheDir())}/${key}.json`;
  }

  getConstants(): Record<string, string> {
    return {};
  }

  async getString(key: string): Promise<string | null> {
    if (!key) return null;
    try {
      const p = this.filePath(key);
      if (fs.accessSync(p) && fs.statSync(p).size > 0) {
        return fs.readTextSync(p);
      }
    } catch (e) {
      // treat read failures as cache miss
    }
    return null;
  }

  async setString(key: string, value: string): Promise<boolean> {
    if (!key || value === undefined || value === null) return false;
    try {
      const dir = this.ensureDir(this.cacheDir());
      this.cleanupIfNeeded(dir);
      const p = `${dir}/${key}.json`;
      const file = fs.openSync(p, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      fs.writeSync(file.fd, value);
      fs.closeSync(file);
      return true;
    } catch (e) {
      const err = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'setString %{public}s failed: %{public}d', key, err.code);
      return false;
    }
  }

  async remove(key: string): Promise<boolean> {
    try {
      const p = this.filePath(key);
      if (fs.accessSync(p)) {
        fs.unlinkSync(p);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async clearAll(): Promise<boolean> {
    try {
      const dir = this.ensureDir(this.cacheDir());
      const entries = fs.listFileSync(dir);
      for (const n of entries) {
        try {
          fs.unlinkSync(`${dir}/${n}`);
        } catch (e) {
          // best effort
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

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
      // best effort eviction
    }
  }

  __onDestroy__() {
    super.__onDestroy__();
  }
}