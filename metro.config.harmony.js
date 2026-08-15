/**
 * Metro configuration for HarmonyOS bundle generation
 *
 * Uses createHarmonyMetroConfig from @react-native-oh/react-native-harmony to install
 * the resolveRequest hook (rewrites react-native -> harmony adapter), inject
 * InitializeCore (harmony) pre-main, and patch @react-native/virtualized-lists.
 *
 * Usage: npx react-native bundle-harmony --config metro.config.harmony.js
 *   or:  npx react-native bundle --platform harmony --config metro.config.harmony.js
 */
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const {
  createHarmonyMetroConfig,
} = require('@react-native-oh/react-native-harmony/metro.config');

module.exports = mergeConfig(
  getDefaultConfig(__dirname),
  createHarmonyMetroConfig({
    reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony',
  }),
);
