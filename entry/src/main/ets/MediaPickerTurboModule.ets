/**
 * MediaPicker TurboModule — file/photo selection for uploads.
 *
 * pickPhoto: system photo picker (gallery), returns file:// URIs.
 * pickFile:  system document picker for arbitrary files.
 * Both are NON-UI TurboModule friendly — the pickers run in the ability
 * context and resolve with URI lists.
 *
 * JS usage:
 *   const mp = TurboModuleRegistry.get('MediaPicker');
 *   const uris = await mp.pickPhoto(false);  // false = single, true = multi
 *   const uris = await mp.pickFile();
 */

import { TurboModule, type TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import picker from '@ohos.file.picker';
import { BusinessError } from '@kit.BasicServicesKit';

export class MediaPickerTurboModule extends TurboModule {
  public static readonly NAME = 'MediaPicker';

  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  getConstants(): Record<string, string> {
    return {};
  }

  /**
   * Opens the system photo picker. multiple=false → max 1 selection.
   * Returns an array of file:// URIs (empty on cancel).
   */
  async pickPhoto(multiple: boolean): Promise<string> {
    try {
      const photoPicker = new picker.PhotoViewPicker();
      const options = new picker.PhotoSelectOptions();
      options.MIMEType = picker.PhotoViewMIMETypes.IMAGE_TYPE;
      options.maxSelectNumber = multiple ? 9 : 1;
      const result: picker.PhotoSelectResult = await photoPicker.select(options);
      return JSON.stringify(result.photoUris || []);
    } catch (e) {
      const err = e as BusinessError;
      console.log(`[MediaPicker] pickPhoto failed: ${err.code} ${err.message}`);
      return '[]';
    }
  }

  /**
   * Opens the system document picker for arbitrary files.
   * Returns an array of file:// URIs (empty on cancel).
   */
  async pickFile(): Promise<string> {
    try {
      const docPicker = new picker.DocumentViewPicker();
      const options = new picker.DocumentSelectOptions();
      options.maxSelectNumber = 5;
      const uris: Array<string> = await docPicker.select(options);
      return JSON.stringify(uris || []);
    } catch (e) {
      const err = e as BusinessError;
      console.log(`[MediaPicker] pickFile failed: ${err.code} ${err.message}`);
      return '[]';
    }
  }
}