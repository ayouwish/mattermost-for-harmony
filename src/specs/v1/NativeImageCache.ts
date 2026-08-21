import type {TurboModule} from 'react-native/Libraries/TurboModule/RCTExport';
import * as TurboModuleRegistry from 'react-native/Libraries/TurboModule/TurboModuleRegistry';

export interface Spec extends TurboModule {
  getBase64(key: string): Promise<string | null>;
  saveBase64(key: string, value: string): Promise<boolean>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('ImageCache');