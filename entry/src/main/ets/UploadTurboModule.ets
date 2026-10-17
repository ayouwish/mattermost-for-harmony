/**
 * Upload TurboModule — multipart file upload to Mattermost.
 *
 * Performs the whole upload natively (ArkTS @ohos.net.http): reads the picked
 * file:// URI, builds the multipart body, POSTs to
 * {server}/api/v4/files?channel_id=…&client_ids=… with the Authorization
 * header, and returns the FileUploadResponse JSON.
 *
 * Doing this natively avoids RNOH's fetch/formData limitations with file://
 * sources.
 *
 * JS usage:
 *   const up = TurboModuleRegistry.get('Upload');
 *   const json = await up.uploadFile(serverUrl, token, channelId, fileUri, filename);
 */

import { TurboModule, type TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import fs from '@ohos.file.fs';
import http from '@ohos.net.http';
import { BusinessError } from '@kit.BasicServicesKit';

const BOUNDARY = '----MMHarmonyUploadBoundary';

function guessMime(filename: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(filename);
  const ext = m ? m[1].toLowerCase() : '';
  const map: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    'svg': 'image/svg+xml',
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'md': 'text/plain',
    'csv': 'text/csv',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'zip': 'application/zip',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'm4a': 'audio/mp4',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'mov': 'video/quicktime',
  };
  return map[ext] || 'application/octet-stream';
}

export class UploadTurboModule extends TurboModule {
  public static readonly NAME = 'Upload';

  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  getConstants(): Record<string, string> {
    return {};
  }

  /**
   * Uploads one file. Returns the raw JSON body of the FileUploadResponse
   * (array of file infos), or throws with a readable message on failure.
   */
  async uploadFile(
    serverUrl: string,
    token: string,
    channelId: string,
    fileUri: string,
    filename: string,
  ): Promise<string> {
    // 1. Read the file bytes.
    let stat: fs.Stat | null = null;
    let file: fs.File | null = null;
    try {
      const path = fileUri.startsWith('file://') ? fileUri.slice('file://'.length) : fileUri;
      stat = fs.statSync(path);
      const size = stat.size;
      file = fs.openSync(path, fs.OpenMode.READ_ONLY);
      const buf = new ArrayBuffer(size);
      fs.readSync(file.fd, buf);
      fs.closeSync(file);
      file = null;

      // 2. Build the multipart body.
      const mime = guessMime(filename);
      const before =
        `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="channel_id"\r\n\r\n${channelId}\r\n` +
        `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="client_ids"\r\n\r\nmm-${Date.now()}\r\n` +
        `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="${filename}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`;
      const after = `\r\n--${BOUNDARY}--\r\n`;

      const beforeBuf = this.strToBuf(before);
      const afterBuf = this.strToBuf(after);
      const total = beforeBuf.byteLength + size + afterBuf.byteLength;
      const body = new Uint8Array(total);
      body.set(new Uint8Array(beforeBuf), 0);
      body.set(new Uint8Array(buf), beforeBuf.byteLength);
      body.set(new Uint8Array(afterBuf), beforeBuf.byteLength + size);

      // 3. POST.
      const httpRequest = http.createHttp();
      const url = `${serverUrl.replace(/\/+$/, '')}/api/v4/files?channel_id=${encodeURIComponent(channelId)}&client_ids=mm-${Date.now()}`;
      const response = await httpRequest.request(url, {
        method: http.RequestMethod.POST,
        header: {
          'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
          'Authorization': `Bearer ${token}`,
        },
        extraData: body,
        connectTimeout: 30000,
        readTimeout: 120000,
      });
      httpRequest.destroy();
      const code = response.responseCode || 0;
      const text = typeof response.result === 'string' ? response.result : '';
      if (code < 200 || code >= 300) {
        throw new Error(`Upload failed (HTTP ${code}): ${text.slice(0, 200)}`);
      }
      return text;
    } catch (e) {
      const err = e as BusinessError;
      if (file) {
        try {
          fs.closeSync(file);
        } catch (e2) {
          // already closed
        }
      }
      throw new Error(err.message || String(e));
    } finally {
      stat = null;
    }
  }

  private strToBuf(s: string): ArrayBuffer {
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return new Uint8Array(bytes).buffer;
  }
}