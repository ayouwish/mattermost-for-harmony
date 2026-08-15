import type {TurboModule} from 'react-native/Libraries/TurboModule/RCTExport';
import * as TurboModuleRegistry from 'react-native/Libraries/TurboModule/TurboModuleRegistry';

export interface Spec extends TurboModule {
  getString(key: string): Promise<string>;
  setString(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  getAllKeys(): Promise<Array<string>>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('PersistentStorage');
