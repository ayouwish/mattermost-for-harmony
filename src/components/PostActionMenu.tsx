/**
 * PostActionMenu — shared long-press action menu for messages, used by both
 * ChatScreen and ThreadScreen.
 *
 * Two layouts:
 * - Wide screens (popover=true): right-click-style horizontal icon row,
 *   anchored at the long-press location.
 * - Narrow screens (popover=false): light bottom sheet with vertical items.
 *
 * Actions are passed in by the host screen: {icon, label, onPress, danger?}.
 */

import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {theme, changeOpacity} from '../theme/utils';

export interface PostActionItem {
  icon: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
}

interface Props {
  visible: boolean;
  messagePreview: string;
  // Screen coordinates of the long-press (for the wide-screen popover).
  pos: {x: number; y: number} | null;
  // True on wide layouts → horizontal popover; false → bottom sheet.
  popover: boolean;
  items: PostActionItem[];
  onClose: () => void;
}

export default function PostActionMenu({visible, messagePreview, pos, popover, items, onClose}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType={popover ? 'fade' : 'slide'}
      onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}>
        {popover && pos ? (
          <View
            style={[
              styles.popover,
              {
                left: Math.min(pos.x, 900) + 4,
                top: Math.min(pos.y, 700) + 4,
              },
            ]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.grid}>
                {items.map((item, idx) => (
                  <TouchableOpacity key={idx} style={styles.cell} onPress={item.onPress} activeOpacity={0.7}>
                    <Text style={styles.cellIcon}>{item.icon}</Text>
                    <Text style={[styles.cellLabel, item.danger ? styles.cellLabelDanger : null]} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : (
          <View style={styles.sheet}>
            <Text style={styles.title} numberOfLines={2}>
              {messagePreview}
            </Text>
            {items.map((item, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.item}
                onPress={item.onPress}
                activeOpacity={0.7}>
                <Text style={styles.icon}>{item.icon}</Text>
                <Text style={[styles.label, item.danger ? styles.labelDanger : null]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.item, styles.cancel]} onPress={onClose}>
              <Text style={styles.label}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  popover: {
    position: 'absolute',
    backgroundColor: theme.centerChannelBg,
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: changeOpacity(theme.centerChannelColor, 0.25),
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
    elevation: 8,
  },
  grid: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    paddingVertical: 8,
  },
  cellIcon: {
    fontSize: 22,
  },
  cellLabel: {
    color: theme.centerChannelColor,
    fontSize: 11,
    marginTop: 4,
  },
  cellLabelDanger: {
    color: theme.errorTextColor,
  },
  sheet: {
    backgroundColor: theme.centerChannelBg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 34,
    paddingHorizontal: 16,
  },
  title: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    fontSize: 13,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: changeOpacity(theme.centerChannelColor, 0.2),
    marginBottom: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  icon: {
    fontSize: 20,
    width: 36,
  },
  label: {
    color: theme.centerChannelColor,
    fontSize: 16,
  },
  labelDanger: {
    color: theme.errorTextColor,
  },
  cancel: {
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: changeOpacity(theme.centerChannelColor, 0.2),
    marginTop: 8,
  },
});