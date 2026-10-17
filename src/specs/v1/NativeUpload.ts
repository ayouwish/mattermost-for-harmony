import type {TurboModule} from 'react-native/Libraries/TurboModule/RCTExport';
import * as TurboModuleRegistry from 'react-native/Libraries/TurboModule/TurboModuleRegistry';

export interface Spec extends TurboModule {
  uploadFile(
    serverUrl: string,
    token: string,
    channelId: string,
    fileUri: string,
    filename: string,
  ): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Upload');