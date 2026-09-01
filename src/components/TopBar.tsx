/**
 * TopBar — full-width app header for the wide-screen (tablet/desktop) layout.
 *
 * Contains the user identity (Mattermost @username), the ＋ create-channel
 * action, and Logout. Channel selection lives in the left sidebar; the chat
 * content lives in the right pane.
 */
import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {type MattermostClient} from '../api/client';
import type {Channel} from '../api/types';
import {theme, changeOpacity} from '../theme/utils';
import CreateChannelModal from './CreateChannelModal';

interface Props {
  client: MattermostClient;
  onLogout: () => void;
  onChannelCreated: (channel: Channel) => void;
}

export default function TopBar({client, onLogout, onChannelCreated}: Props) {
  const [userName, setUserName] = useState('');
  const [showCreateChannel, setShowCreateChannel] = useState(false);

  useEffect(() => {
    let active = true;
    client.getMe().then((me) => {
      if (active) setUserName(me.username);
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  return (
    <View style={styles.bar}>
      <View style={styles.left}>
        <Text style={styles.title}>Mattermost</Text>
        <Text style={styles.user}>@{userName}</Text>
      </View>
      <View style={styles.right}>
        <TouchableOpacity onPress={() => setShowCreateChannel(true)} style={styles.addButton}>
          <Text style={styles.addButtonText}>＋</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onLogout} style={styles.logoutButton}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <CreateChannelModal
        visible={showCreateChannel}
        client={client}
        teamId={client.getTeamId()}
        onClose={() => setShowCreateChannel(false)}
        onChannelCreated={(channel) => {
          setShowCreateChannel(false);
          onChannelCreated(channel);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    // The status-bar inset is handled by the SafeAreaView in MainLayout —
    // only a small breathing room is needed here (a fixed 50 here doubled up
    // with the safe area and broke on rotation).
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: theme.sidebarHeaderBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.sidebarHeaderBg,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.sidebarHeaderTextColor,
  },
  user: {
    fontSize: 13,
    color: changeOpacity(theme.sidebarHeaderTextColor, 0.7),
    marginLeft: 8,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addButtonText: {
    fontSize: 22,
    color: theme.sidebarHeaderTextColor,
  },
  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  logoutText: {
    color: changeOpacity(theme.sidebarHeaderTextColor, 0.7),
    fontSize: 14,
  },
});
