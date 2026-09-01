import type {TurboModule} from 'react-native/Libraries/TurboModule/RCTExport';
import * as TurboModuleRegistry from 'react-native/Libraries/TurboModule/TurboModuleRegistry';

export interface Spec extends TurboModule {
  openUrl(url: string): Promise<boolean>;
  shareText(title: string, content: string): Promise<boolean>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('SystemOpen');