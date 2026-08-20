/**
 * Authenticated image loading with persistent disk cache.
 *
 * RNOH's <Image> pipeline does NOT attach custom `source.headers` to the
 * download request (401) and Mattermost rejects session tokens via query
 * params. So images are downloaded with an authenticated fetch() — which does
 * send the Authorization header — and rendered as data: URIs.
 *
 * To avoid re-downloading images on every render AND after app restarts, the
 * payload ("mime\n<base64>") is persisted via the native ImageCache
 * TurboModule (app sandbox cache dir) and rehydrated on later reads.
 *
 * Caching layers, in order of preference:
 *   1. in-memory Map (current JS instance)
 *   2. disk cache (survives app restarts / kill)
 *   3. network fetch → written to disk for future reads
 */

import {TurboModuleRegistry} from 'react-native';

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBase64(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result +=
      BASE64_CHARS[(n >> 18) & 63] +
      BASE64_CHARS[(n >> 12) & 63] +
      BASE64_CHARS[(n >> 6) & 63] +
      BASE64_CHARS[n & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i] << 16;
    result += BASE64_CHARS[(n >> 18) & 63] + BASE64_CHARS[(n >> 12) & 63] + '==';
  } else if (remaining === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    result +=
      BASE64_CHARS[(n >> 18) & 63] +
      BASE64_CHARS[(n >> 12) & 63] +
      BASE64_CHARS[(n >> 6) & 63] +
      '=';
  }
  return result;
}

// Simple stable hash for file names (kept ASCII-safe for the filesystem).
function cacheKeyFor(url: string, auth: string): string {
  const input = `${url}|${auth}`;
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = ((h1 << 5) + h1) ^ c;
    h2 = ((h2 << 5) + h2) ^ (c << 8);
  }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}

function authHeader(headers: Record<string, string>): string {
  return headers['Authorization'] || headers['authorization'] || '';
}

function guessMimeFromExtension(url: string): string {
  const m = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.exec(url);
  switch (m ? m[1].toLowerCase() : '') {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'image/jpeg';
  }
}

export interface AuthHeaders {
  [key: string]: string;
}

interface CacheModule {
  getBase64(key: string): Promise<string | null>;
  saveBase64(key: string, value: string): Promise<boolean>;
}

let nativeModule: CacheModule | null = null;
let moduleResolved = false;

function getCacheModule(): CacheModule | null {
  if (moduleResolved) return nativeModule;
  moduleResolved = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = TurboModuleRegistry.get('ImageCache');
    nativeModule = mod || null;
  } catch {
    nativeModule = null;
  }
  if (!nativeModule) {
    // Module not linked (older HAP) — degrade to in-memory-only.
    console.log('[ImageCache] native module NOT available — memory-only caching');
  }
  return nativeModule;
}

// in-memory cache: key -> full data: URI
const memoryCache = new Map<string, string>();
// in-flight fetch deduplication: key -> promise
const inflight = new Map<string, Promise<string | null>>();

function dataUriFor(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

/**
 * Returns a renderable image URI (data: or cached) for an authenticated image,
 * or null on failure. Results are cached in memory + on disk.
 */
export async function fetchImageAsDataUri(
  url: string,
  headers: AuthHeaders = {},
): Promise<string | null> {
  let key = '';
  let auth = '';
  let uri: string | null = null;

  if (url.startsWith('data:') || url.startsWith('file://')) {
    return url;
  }

  key = cacheKeyFor(url, authHeader(headers));
  auth = authHeader(headers);

  // 1. In-memory cache
  const mem = memoryCache.get(key);
  if (mem) return mem;

  // 2. Deduplicate concurrent loads of the same image
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = loadAndCache(url, headers, key, auth);
  inflight.set(key, promise);
  try {
    uri = await promise;
    return uri;
  } finally {
    inflight.delete(key);
  }
}

async function loadAndCache(
  url: string,
  headers: AuthHeaders,
  key: string,
  auth: string,
): Promise<string | null> {
  const mod = getCacheModule();

  // 2. Disk cache (survives app restarts/kills)
  if (mod) {
    try {
      const raw = await mod.getBase64(key);
      if (raw) {
        const nl = raw.indexOf('\n');
        const mime = nl > 0 ? raw.slice(0, nl) : guessMimeFromExtension(url);
        const base64 = nl > 0 ? raw.slice(nl + 1) : raw;
        const uri = dataUriFor(mime, base64);
        memoryCache.set(key, uri);
        return uri;
      }
    } catch {
      // cache read failed — fall through to network
    }
  }

  // 3. Network fetch + persist
  try {
    const res = await fetch(url, {
      headers: auth ? {...headers} : undefined,
      method: 'GET',
    });
    if (!res.ok) return null;

    const contentType =
      (typeof res.headers.get === 'function'
        ? res.headers.get('content-type')
        : null) || guessMimeFromExtension(url);

    const buf = await res.arrayBuffer();
    const base64 = encodeBase64(new Uint8Array(buf));
    const uri = dataUriFor(contentType, base64);

    memoryCache.set(key, uri);
    if (mod) {
      try {
        await mod.saveBase64(key, `${contentType}\n${base64}`);
      } catch {
        // disk write failed — in-memory cache still fine
      }
    }
    return uri;
  } catch {
    return null;
  }
}

export default {
  fetchImageAsDataUri,
};