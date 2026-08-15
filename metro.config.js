const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const {
  createHarmonyMetroConfig,
} = require('@react-native-oh/react-native-harmony/metro.config');

/**
 * Default Metro configuration for HarmonyOS.
 * Aligned with metro.config.harmony.js so that `react-native start` (Metro dev server)
 * resolves the harmony adapter the same way bundle generation does.
 * https://reactnative.dev/docs/metro
 */
module.exports = mergeConfig(
  getDefaultConfig(__dirname),
  createHarmonyMetroConfig({
    reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony',
  }),
);
