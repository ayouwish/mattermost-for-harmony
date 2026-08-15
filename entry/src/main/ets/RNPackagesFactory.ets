import { RNPackageContext, RNPackage, UITurboModuleContext, TurboModule } from '@rnoh/react-native-openharmony/ts';
import { PersistentStorageTurboModule } from './PersistentStorageTurboModule';
import { NotificationsTurboModule } from './NotificationsTurboModule';
import { PushTurboModule } from './PushTurboModule';

class MattermostPackage extends RNPackage {
  getUITurboModuleFactoryByNameMap(): Map<string, (ctx: UITurboModuleContext) => TurboModule | null> {
    return new Map<string, (ctx: UITurboModuleContext) => TurboModule | null>([
      [PersistentStorageTurboModule.NAME, (ctx: UITurboModuleContext) => {
        return new PersistentStorageTurboModule(ctx);
      }],
      [NotificationsTurboModule.NAME, (ctx: UITurboModuleContext) => {
        return new NotificationsTurboModule(ctx);
      }],
      [PushTurboModule.NAME, (ctx: UITurboModuleContext) => {
        return new PushTurboModule(ctx);
      }],
    ]);
  }
}

export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
  return [new MattermostPackage(ctx)];
}
