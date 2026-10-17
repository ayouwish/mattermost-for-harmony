/**
 * MediaPicker bridge — system photo/document pickers for uploads.
 * pickPhoto/pickFile return arrays of file:// URIs (empty on cancel).
 */
import {TurboModuleRegistry} from 'react-native';

let nativeModule: any = null;
let resolved = false;

function getModule(): any {
  if (!resolved) {
    resolved = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nativeModule = TurboModuleRegistry.get<any>('MediaPicker') || null;
    } catch {
      nativeModule = null;
    }
  }
  return nativeModule;
}

async function parseUris(raw: string): Promise<string[]> {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function pickPhoto(multiple: boolean = false): Promise<string[]> {
  const mod = getModule();
  if (!mod) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: string = await mod.pickPhoto(multiple);
    return parseUris(raw);
  } catch {
    return [];
  }
}

export async function pickFile(): Promise<string[]> {
  const mod = getModule();
  if (!mod) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: string = await mod.pickFile();
    return parseUris(raw);
  } catch {
    return [];
  }
}

export default {
  pickPhoto,
  pickFile,
};