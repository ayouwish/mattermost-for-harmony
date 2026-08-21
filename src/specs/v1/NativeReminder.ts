import type {TurboModule} from 'react-native/Libraries/TurboModule/RCTExport';
import * as TurboModuleRegistry from 'react-native/Libraries/TurboModule/TurboModuleRegistry';

export interface Spec extends TurboModule {
  requestCalendarPermission(): Promise<boolean>;
  openCalendarReminder(title: string, description: string): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Reminder');