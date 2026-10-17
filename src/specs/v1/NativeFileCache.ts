import type {TurboModule} from 'react-native/Libraries/TurboModule/RCTExport';
import * as TurboModuleRegistry from 'react-native/Libraries/TurboModule/TurboModuleRegistry';

export interface Spec extends TurboModule {
  getString(key: string): Promise<string | null>;
  setString(key: string, value: string): Promise<boolean>;
  remove(key: string): Promise<boolean>;
  clearAll(): Promise<boolean>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('FileCache');