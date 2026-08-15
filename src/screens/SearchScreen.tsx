/**
 * Search Screen — search messages across the current team
 *
 * Features:
 * - Full-text message search (uses Mattermost search syntax: from:, in:, on:, etc.)
 * - Results show channel name, author, message excerpt with highlighted terms
 * - Tap result to navigate to the channel
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {type MattermostClient} from '../api/client';
import type {Channel, Post, UserProfile} from '../api/types';
import {Avatar, Markdown} from '../components';
import {formatTimeOrDate} from '../utils/dateFormat';
import {theme, changeOpacity} from '../theme/utils';

interface Props {
  client: MattermostClient;
  onClose: () => void;
  onChannelSelect: (channel: Channel) => void;
  onMenu?: () => void;
  inPane?: boolean;
}

interface SearchResult {
  post: Post;
  channel?: Channel;
  author?: UserProfile;
}

const SEARCH_TIPS = [
  'Use quotes for exact phrases: "deploy plan"',
  'from:@username — messages from a user',
  'in:channel-name — messages in a channel',
  'after:2024-01-01 — messages after a date',
  '-word — exclude a keyword',
];

export default function SearchScreen({client, onClose, onChannelSelect, onMenu, inPane = false}: Props) {
  const imageHeaders = useMemo(() => client.getImageRequestHeaders(), [client]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    Keyboard.dismiss();
    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const teamId = client.getTeamId();
      if (!teamId) {
        setError('No team selected');
        return;
      }

      const response = await client.searchPosts(teamId, {
        terms: trimmed,
        is_or_search: false,
        page: 0,
        per_page: 30,
      });

      // Resolve channels and authors for results
      const channelIds = new Set(Object.values(response.posts).map((p: Post) => p.channel_id));
      const userIds = new Set(Object.values(response.posts).map((p: Post) => p.user_id));

      const channelMap: Record<string, Channel> = {};
      const userMap: Record<string, UserProfile> = {};

      await Promise.all([
        ...Array.from(channelIds).map(async (cid) => {
          try {
            channelMap[cid] = await client.getChannel(cid);
          } catch {
            // may be deleted channel
          }
        }),
        ...Array.from(userIds).map(async (uid) => {
          try {
            userMap[uid] = await client.getUser(uid);
          } catch {
            // ignore
          }
        }),
      ]);

      const searchResults: SearchResult[] = response.order
        .map((pid) => response.posts[pid])
        .filter((p) => p.delete_at === 0)
        .sort((a, b) => b.create_at - a.create_at)
        .map((post) => ({
          post,
          channel: channelMap[post.channel_id],
          author: userMap[post.user_id],
        }));

      setResults(searchResults);
    } catch (err: any) {
      setError(err.message || 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [client, query]);

  const handleResultPress = (result: SearchResult) => {
    if (result.channel) {
      onChannelSelect(result.channel);
    }
  };

  const renderResult = ({item}: {item: SearchResult}) => {
    const {post, channel, author} = item;
    const avatarUrl = author
      ? client.getProfileImageUrl(author.id, author.last_picture_update)
      : undefined;

    return (
      <TouchableOpacity
        style={styles.resultItem}
        onPress={() => handleResultPress(item)}>
        <View style={styles.resultHeader}>
          {author && <Avatar url={avatarUrl} headers={imageHeaders} username={author.username} size={28} />}
          <View style={styles.resultMeta}>
            <Text style={styles.resultAuthor}>{author?.username || 'unknown'}</Text>
            <Text style={styles.resultChannel} numberOfLines={1}>
              {channel ? `# ${channel.display_name || channel.name}` : 'Unknown channel'}
            </Text>
          </View>
          <Text style={styles.resultTime}>{formatTimeOrDate(post.create_at)}</Text>
        </View>
        <Text style={styles.resultMessage} numberOfLines={4}>
          {post.message}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, inPane && styles.headerPane]}>
        {onMenu && (
          <TouchableOpacity onPress={onMenu} style={styles.closeButton}>
            <Text style={styles.closeText}>☰</Text>
          </TouchableOpacity>
        )}
        {!onMenu && (
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Search</Text>
        <View style={{width: 32}} />
      </View>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search messages... (from:, in:, after:)"
          placeholderTextColor="#6b7ca0"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          autoFocus
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
          <Text style={styles.searchButtonText}>🔍</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="theme.buttonBg" />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={(item, idx) => `${item.post.id}-${idx}`}
          renderItem={renderResult}
          style={styles.list}
          contentContainerStyle={styles.listContent}
        />
      ) : searched ? (
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyText}>No results found</Text>
          <Text style={styles.emptyHint}>Try different keywords or search syntax</Text>
        </View>
      ) : (
        <View style={styles.centered}>
          <Text style={styles.tipTitle}>Search Tips</Text>
          {SEARCH_TIPS.map((tip, i) => (
            <Text key={i} style={styles.tipItem}>• {tip}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.sidebarBg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 50,
    paddingBottom: 12,
    backgroundColor: theme.sidebarHeaderBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: changeOpacity(theme.sidebarText, 0.15),
  },
  headerPane: {
    paddingTop: 12,
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 20,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.sidebarHeaderBg,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    backgroundColor: changeOpacity(theme.sidebarText, 0.1),
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#fff',
    borderWidth: 1,
    borderColor: changeOpacity(theme.sidebarText, 0.2),
  },
  searchButton: {
    marginLeft: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.buttonBg,
    borderRadius: 8,
  },
  searchButtonText: {
    fontSize: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    color: changeOpacity(theme.sidebarText, 0.7),
    marginTop: 12,
    fontSize: 14,
  },
  errorText: {
    color: theme.errorTextColor,
    fontSize: 14,
    textAlign: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 16,
    fontWeight: '600',
  },
  emptyHint: {
    color: changeOpacity(theme.sidebarText, 0.5),
    fontSize: 13,
    marginTop: 8,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  resultItem: {
    backgroundColor: changeOpacity(theme.sidebarText, 0.1),
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  resultMeta: {
    flex: 1,
    marginLeft: 8,
  },
  resultAuthor: {
    color: theme.linkColor,
    fontSize: 13,
    fontWeight: '600',
  },
  resultChannel: {
    color: changeOpacity(theme.sidebarText, 0.5),
    fontSize: 11,
    marginTop: 1,
  },
  resultTime: {
    color: changeOpacity(theme.sidebarText, 0.5),
    fontSize: 11,
  },
  resultMessage: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 19,
  },
  tipTitle: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
  },
  tipItem: {
    color: changeOpacity(theme.sidebarText, 0.5),
    fontSize: 13,
    marginVertical: 4,
    textAlign: 'left',
    width: '100%',
  },
});
