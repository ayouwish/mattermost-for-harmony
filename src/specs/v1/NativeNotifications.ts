import type {TurboModule} from 'react-native/Libraries/TurboModule/RCTExport';
import * as TurboModuleRegistry from 'react-native/Libraries/TurboModule/TurboModuleRegistry';

export interface Spec extends TurboModule {
  notify(title: string, body: string, id: number): Promise<void>;
  cancelAll(): Promise<void>;
  isEnabled(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Notifications');
