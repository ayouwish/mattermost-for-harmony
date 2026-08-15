/**
 * Avatar component — shows a user's profile image or a colored initial fallback.
 */
import React, {useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';

interface AvatarProps {
  /** Profile image URL (may be empty to use the fallback). */
  url?: string | null;
  /** Optional HTTP headers for the image request (e.g. Authorization). */
  headers?: Record<string, string>;
  /** Username for the initial fallback + color hash. */
  username?: string;
  /** Diameter in pixels. */
  size?: number;
}

const COLORS = [
  '#e06c75', '#d19a66', '#e5c07b', '#98c379',
  '#56b6c2', '#61afef', '#c678dd', '#be5046',
  '#7f8c8d', '#2980b9', '#27ae60', '#8e44ad',
];

function colorForUsername(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function Avatar({url, headers, username, size = 36}: AvatarProps) {
  const [loadFailed, setLoadFailed] = useState(false);
  const diameter = size;
  const initials = (username || '?').slice(0, 2).toUpperCase();
  const bgColor = colorForUsername(username || '?');

  // Show fallback if no URL or the image failed to load.
  if (url && !loadFailed) {
    return (
      <Image
        source={{uri: url, headers}}
        style={[styles.image, {width: diameter, height: diameter, borderRadius: diameter / 2}]}
        onError={() => setLoadFailed(true)}
      />
    );
  }

  return (
    <View style={[styles.fallback, {width: diameter, height: diameter, borderRadius: diameter / 2, backgroundColor: bgColor}]}>
      <Text style={[styles.initials, {fontSize: diameter * 0.4}]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: '#e0e0e0',
  },
  fallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  initials: {
    color: '#fff',
    fontWeight: '700',
  },
});

export default Avatar;
