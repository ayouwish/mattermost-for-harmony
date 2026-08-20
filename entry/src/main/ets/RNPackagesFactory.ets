import { RNPackageContext, RNPackage, UITurboModuleContext, TurboModule } from '@rnoh/react-native-openharmony/ts';
import { PersistentStorageTurboModule } from './PersistentStorageTurboModule';
import { NotificationsTurboModule } from './NotificationsTurboModule';
import { PushTurboModule } from './PushTurboModule';
import { ImageCacheTurboModule } from './ImageCacheTurboModule';
import { SystemOpenTurboModule } from './SystemOpenTurboModule';
import { ReminderTurboModule } from './ReminderTurboModule';
import { ClipboardTurboModule } from './ClipboardTurboModule';

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
      [ImageCacheTurboModule.NAME, (ctx: UITurboModuleContext) => {
        return new ImageCacheTurboModule(ctx);
      }],
      [SystemOpenTurboModule.NAME, (ctx: UITurboModuleContext) => {
        return new SystemOpenTurboModule(ctx);
      }],
      [ReminderTurboModule.NAME, (ctx: UITurboModuleContext) => {
        return new ReminderTurboModule(ctx);
      }],
      [ClipboardTurboModule.NAME, (ctx: UITurboModuleContext) => {
        return new ClipboardTurboModule(ctx);
      }],
    ]);
  }
}

export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
  return [new MattermostPackage(ctx)];
}
