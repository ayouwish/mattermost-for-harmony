/**
 * Root React Native CLI config.
 *
 * Registers the `harmony` platform and the `bundle-harmony` command by re-using the
 * config shipped with @react-native-oh/react-native-harmony. Without this file, the
 * `harmony` platform is unknown to the RN CLI and `bundle-harmony` is unavailable.
 */
module.exports = {
  ...require('@react-native-oh/react-native-harmony/react-native.config.js'),
};
