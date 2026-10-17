/**
 * File upload bridge — pick + upload to Mattermost.
 *
 * Flow: MediaPicker picks a file:// URI → native Upload TurboModule performs
 * the multipart POST → returns FileUploadResponse (file infos) → the caller
 * creates a post with file_ids.
 */
import {TurboModuleRegistry} from 'react-native';
import type {FileUploadResponse} from '../api/types';

let pickerModule: any = null;
let uploadModule: any = null;
let resolved = false;

function getPicker(): any {
  if (!resolved) {
    resolved = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pickerModule = TurboModuleRegistry.get<any>('MediaPicker') || null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      uploadModule = TurboModuleRegistry.get<any>('Upload') || null;
    } catch {
      pickerModule = null;
      uploadModule = null;
    }
  }
  return pickerModule;
}

function getUploader(): any {
  getPicker();
  return uploadModule;
}

export async function pickPhoto(multiple: boolean = false): Promise<string[]> {
  const mod = getPicker();
  if (!mod) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: string = await mod.pickPhoto(multiple);
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function pickFile(): Promise<string[]> {
  const mod = getPicker();
  if (!mod) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: string = await mod.pickFile();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Uploads one already-picked file URI. Returns the file id to attach to a post.
 */
export async function uploadFile(
  serverUrl: string,
  token: string,
  channelId: string,
  fileUri: string,
  filename: string,
): Promise<string> {
  const mod = getUploader();
  if (!mod) throw new Error('Upload module not available');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: string = await mod.uploadFile(serverUrl, token, channelId, fileUri, filename);
  const parsed = JSON.parse(raw) as FileUploadResponse;
  const infos = parsed?.file_infos || [];
  if (infos.length === 0) {
    throw new Error('Upload returned no file info');
  }
  return infos[0].id;
}

export default {
  pickPhoto,
  pickFile,
  uploadFile,
};