import type {TurboModule} from 'react-native/Libraries/TurboModule/RCTExport';
import * as TurboModuleRegistry from 'react-native/Libraries/TurboModule/TurboModuleRegistry';

export interface Spec extends TurboModule {
  getPushToken(): Promise<string>;
  consumePushTarget(): Promise<string>;
  consumeSharedContent(): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Push');
