/**
 * ConnectionBanner — thin yellow bar shown under the top bar when the
 * WebSocket is disconnected/reconnecting, matching the official app's
 * "Connection lost" indicator.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {theme, changeOpacity} from '../theme/utils';

interface Props {
  state: 'connected' | 'disconnected' | 'reconnecting';
}

export default function ConnectionBanner({state}: Props) {
  if (state === 'connected') return null;
  const label =
    state === 'reconnecting' ? 'Reconnecting…' : 'No connection — reconnecting…';
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: changeOpacity('#ffbc1f', 0.9),
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  text: {
    color: '#3d2e00',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});