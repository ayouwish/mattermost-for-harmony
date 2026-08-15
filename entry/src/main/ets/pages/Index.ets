import { RNApp } from '@rnoh/react-native-openharmony/src/main/ets/RNApp'
import { ResourceJSBundleProvider, RNInstanceOptions } from '@rnoh/react-native-openharmony/ts'
import { createRNPackages } from '../RNPackagesFactory'

const APP_KEY = 'MattermostHarmonyOS'
const BUNDLE_PATH = 'bundle.harmony.js'

@Entry
@Component
struct Index {
  private rnInstanceConfig: RNInstanceOptions = {
    createRNPackages,
  }

  aboutToAppear(): void {
  }

  build() {
    Column() {
      RNApp({
        rnInstanceConfig: this.rnInstanceConfig,
        appKey: APP_KEY,
        jsBundleProvider: new ResourceJSBundleProvider(
          getContext(this).resourceManager,
          BUNDLE_PATH,
          [APP_KEY],
        ),
      })
    }
    .height('100%')
    .width('100%')
  }
}
