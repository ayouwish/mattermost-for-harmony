/**
 * ShareInModal — shown when another app shares text/URL into Mattermost via the
 * system share sheet. Lets the user pick a channel and posts the content.
 */
import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {type MattermostClient} from '../api/client';
import type {Channel} from '../api/types';
import {cache} from '../api/cache';
import {theme, changeOpacity} from '../theme/utils';

interface Props {
  client: MattermostClient;
  content: string | null;
  onClose: () => void;
}

export default function ShareInModal({client, content, onClose}: Props) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!content) return;
    setSent(false);
    setLoading(true);
    const teamId = client.getTeamId() || '';
    const userId = client.getUserId() || '';
    const cached = cache.getChannels(teamId);
    if (cached && cached.length > 0) {
      setChannels(cached);
      setLoading(false);
      return;
    }
    client
      .getChannelsForUser(userId, teamId)
      .then((list) => setChannels(Array.isArray(list) ? list : []))
      .catch(() => setChannels([]))
      .finally(() => setLoading(false));
  }, [content, client]);

  const sendTo = async (channel: Channel) => {
    if (!content || sending) return;
    setSending(true);
    try {
      await client.createPost({channel_id: channel.id, message: content});
      setSent(true);
      setTimeout(onClose, 600);
    } catch {
      setSending(false);
    }
  };

  if (!content) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Share to Mattermost</Text>
          <Text style={styles.preview} numberOfLines={3}>
            {content}
          </Text>
          {sent ? (
            <Text style={styles.sent}>Sent ✓</Text>
          ) : loading ? (
            <ActivityIndicator color={theme.linkColor} style={{marginVertical: 24}} />
          ) : (
            <View style={styles.list}>
              {channels.slice(0, 12).map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.item}
                  activeOpacity={0.7}
                  disabled={sending}
                  onPress={() => sendTo(c)}>
                  <Text style={styles.itemName}>{c.display_name || c.name}</Text>
                  <Text style={styles.itemType}>
                    {c.type === 'D' ? 'Direct' : c.type === 'P' ? 'Private' : 'Public'}
                  </Text>
                </TouchableOpacity>
              ))}
              {channels.length === 0 && (
                <Text style={styles.empty}>No channels available.</Text>
              )}
            </View>
          )}
        </View>
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
  sheet: {
    backgroundColor: theme.centerChannelBg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingBottom: 34,
    paddingTop: 16,
  },
  title: {
    color: theme.centerChannelColor,
    fontSize: 17,
    fontWeight: '700',
  },
  preview: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    fontSize: 13,
    marginTop: 6,
    marginBottom: 12,
  },
  sent: {
    color: theme.linkColor,
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 24,
  },
  list: {
    maxHeight: 320,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: changeOpacity(theme.centerChannelColor, 0.12),
  },
  itemName: {
    color: theme.centerChannelColor,
    fontSize: 15,
  },
  itemType: {
    color: changeOpacity(theme.centerChannelColor, 0.5),
    fontSize: 12,
  },
  empty: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    fontSize: 14,
    paddingVertical: 16,
  },
});