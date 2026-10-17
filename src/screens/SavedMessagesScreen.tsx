/**
 * SavedMessagesScreen — lists posts the user has flagged/saved (flagged_post
 * preferences), matching the native app's "Saved messages" view.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {type MattermostClient} from '../api/client';
import type {Channel, Post, Preference, UserProfile} from '../api/types';
import {Avatar} from '../components';
import {formatTimeOrDate} from '../utils/dateFormat';
import {cache} from '../api/cache';
import {theme, changeOpacity} from '../theme/utils';

interface Props {
  client: MattermostClient;
  onBack: () => void;
  onOpenChannel: (channel: Channel, postId: string) => void;
  inPane?: boolean;
}

interface SavedRow {
  post: Post;
  author?: UserProfile;
  channel?: Channel;
}

export default function SavedMessagesScreen({client, onBack, onOpenChannel, inPane = false}: Props) {
  const [rows, setRows] = useState<SavedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const imageHeaders = client.getImageRequestHeaders();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const prefs: Preference[] = await client.getPreferences();
      const flaggedIds = prefs
        .filter((p) => p.category === 'flagged_post' && p.value === 'true')
        .map((p) => p.name)
        .filter((id) => !!id);
      console.log(`[Saved] prefs=${prefs.length} categories=${[...new Set(prefs.map((p) => p.category))].join('|')} flagged=${flaggedIds.length}`);

      // Fetch posts in parallel (serial per-post requests made the screen crawl
      // once more than a few messages were saved).
      const results = await Promise.all(
        flaggedIds.map(async (id): Promise<SavedRow | null> => {
          try {
            const post: Post = await client.getPost(id);
            if (!post || post.delete_at !== 0) return null;
            const author =
              cache.getUser(post.user_id) ||
              (await client.getUser(post.user_id).catch(() => undefined));
            if (author) cache.setUser(author);
            const channel = await client.getChannel(post.channel_id).catch(() => undefined);
            return {post, author, channel};
          } catch {
            return null; // deleted / no permission — skip
          }
        }),
      );
      const result = results.filter((r): r is SavedRow => r !== null);
      result.sort((a, b) => b.post.create_at - a.post.create_at);
      setRows(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Saved messages</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.linkColor} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.empty}>No saved messages yet.</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.post.id}
          renderItem={({item}) => (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => {
                if (item.channel) onOpenChannel(item.channel, item.post.id);
              }}>
              <Avatar
                url={item.author ? client.getProfileImageUrl(item.author.id, item.author.last_picture_update) : undefined}
                headers={imageHeaders}
                username={item.author?.username || '?'}
                size={34}
              />
              <View style={styles.rowBody}>
                <View style={styles.rowHeader}>
                  <Text style={styles.author}>{item.author?.username || 'unknown'}</Text>
                  <Text style={styles.channel}>
                    {item.channel?.display_name || item.channel?.name || ''}
                  </Text>
                  <Text style={styles.time}>{formatTimeOrDate(item.post.create_at)}</Text>
                </View>
                <Text style={styles.message} numberOfLines={3}>
                  {item.post.message}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.centerChannelBg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: changeOpacity(theme.centerChannelColor, 0.15),
    backgroundColor: theme.centerChannelBg,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backText: {
    color: theme.linkColor,
    fontSize: 28,
    fontWeight: '600',
  },
  headerTitle: {
    color: theme.centerChannelColor,
    fontSize: 17,
    fontWeight: '700',
    marginLeft: 4,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  empty: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: changeOpacity(theme.centerChannelColor, 0.1),
  },
  rowBody: {
    flex: 1,
    marginLeft: 10,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  author: {
    color: theme.centerChannelColor,
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  channel: {
    color: theme.linkColor,
    fontSize: 12,
    flexShrink: 1,
    marginRight: 8,
  },
  time: {
    color: changeOpacity(theme.centerChannelColor, 0.5),
    fontSize: 11,
    marginLeft: 'auto',
  },
  message: {
    color: theme.centerChannelColor,
    fontSize: 14,
    marginTop: 2,
  },
});

export {SavedMessagesScreen};