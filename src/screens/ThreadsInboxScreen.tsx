/**
 * Threads Inbox Screen — unified list of followed threads.
 *
 * Mirrors Mattermost native threads inbox:
 * - Lists all threads the user is following (participated in or mentioned).
 * - Shows root post preview, author, channel, reply count.
 * - Unread replies / mentions highlighted.
 * - Tap a thread to open it; follow/unfollow toggle.
 * - Total unread badge in the header.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {type MattermostClient} from '../api/client';
import type {Channel, ThreadInboxItem, ThreadsInboxResponse, UserProfile} from '../api/types';
import {WebSocketEvents} from '../api/types';
import {Avatar} from '../components';
import {formatTimeOrDate} from '../utils/dateFormat';
import {theme, changeOpacity} from '../theme/utils';
import {persistentStorage} from '../api/persistent-storage';
import {cache} from '../api/cache';

interface Props {
  client: MattermostClient;
  onClose: () => void;
  onOpenThread: (rootPostId: string, channelId: string) => void;
  onMenu?: () => void;
  inPane?: boolean;
}

interface InboxEntry {
  thread: ThreadInboxItem;
  author?: UserProfile;
  channel?: Channel;
}

export default function ThreadsInboxScreen({client, onClose, onOpenThread, onMenu, inPane = false}: Props) {
  const imageHeaders = useMemo(() => client.getImageRequestHeaders(), [client]);
  const [entries, setEntries] = useState<InboxEntry[]>([]);
  // Locally pinned thread ids (survives restarts): important topics stay at
  // the top of the inbox for ongoing conversations.
  const [pinnedThreads, setPinnedThreads] = useState<Set<string>>(new Set());

  // Load pinned thread ids once on mount.
  useEffect(() => {
    persistentStorage.getString('pinnedThreads', '').then((raw) => {
      if (raw) {
        try {
          const arr = JSON.parse(raw) as string[];
          setPinnedThreads(new Set(arr));
        } catch {
          // ignore malformed
        }
      }
    });
  }, []);

  const togglePinThread = useCallback((threadId: string) => {
    setPinnedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      persistentStorage.setString('pinnedThreads', JSON.stringify(Array.from(next))).catch(() => {});
      return next;
    });
  }, []);

  // Re-sort whenever pins change (no refetch needed).
  useEffect(() => {
    setEntries((prev) =>
      [...prev].sort((a, b) => {
        const aPin = pinnedThreads.has(a.thread.id) ? 1 : 0;
        const bPin = pinnedThreads.has(b.thread.id) ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
        if (a.thread.unread_mentions > 0 && b.thread.unread_mentions === 0) return -1;
        if (a.thread.unread_replies > 0 && b.thread.unread_replies === 0) return -1;
        return (b.thread.last_reply_at || 0) - (a.thread.last_reply_at || 0);
      }),
    );
  }, [pinnedThreads]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [totalMentions, setTotalMentions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile>>({});

  // Resolve authors + channels and populate the list.
  const renderInbox = useCallback(async (inbox: ThreadsInboxResponse) => {
    const threadList = inbox.threads || [];
    const channelIds = new Set<string>();
    for (const t of threadList) {
      if (t.post?.channel_id) channelIds.add(t.post.channel_id);
    }
    const authorIds = new Set<string>();
    for (const t of threadList) {
      if (t.post?.user_id) authorIds.add(t.post.user_id);
    }

    // Build the list IMMEDIATELY with cached channels/profiles so the UI never
    // flashes the empty state while channels/profiles are being fetched.
    const channelMap: Record<string, Channel> = {};
    const profileMap: Record<string, UserProfile> = {};
    const teamId = client.getTeamId() || '';
    for (const cid of channelIds) {
      const cached = teamId ? cache.getChannel(teamId, cid) : null;
      if (cached) channelMap[cid] = cached;
    }
    for (const uid of authorIds) {
      const cached = cache.getUser(uid);
      if (cached) profileMap[uid] = cached;
    }

    const buildEntries = () => {
      // Sort: unread first, then last_reply_at desc
      // NOTE: do NOT filter out threads without a root post — extended=true may
      // not always be honored by the server, and dropping them would show
      // "No followed threads" even though threads exist.
      // Also: the inbox API does not return is_following. Every thread in the
      // inbox is by definition followed by the user, so default it to true.
      const entries: InboxEntry[] = threadList
        .map((t) => ({
          thread: {...t, is_following: t.is_following ?? true},
          author: t.post ? profileMap[t.post.user_id] : undefined,
          channel: t.post ? channelMap[t.post.channel_id] : undefined,
        }))
        .sort((a, b) => {
          // Pinned threads always first.
          const aPin = pinnedThreads.has(a.thread.id) ? 1 : 0;
          const bPin = pinnedThreads.has(b.thread.id) ? 1 : 0;
          if (aPin !== bPin) return bPin - aPin;
          if (a.thread.unread_mentions > 0 && b.thread.unread_mentions === 0) return -1;
          if (a.thread.unread_replies > 0 && b.thread.unread_replies === 0) return -1;
          return (b.thread.last_reply_at || 0) - (a.thread.last_reply_at || 0);
        });
      setEntries(entries);
    };

    buildEntries();

    // Fetch missing channels/profiles in the background and re-render once.
    const missingChannels = Array.from(channelIds).filter((cid) => !channelMap[cid]);
    const missingProfiles = Array.from(authorIds).filter((uid) => !profileMap[uid]);
    if (missingChannels.length > 0 || missingProfiles.length > 0) {
      try {
        await Promise.all([
          ...missingChannels.map(async (cid) => {
            try {
              const ch = await client.getChannel(cid);
              channelMap[cid] = ch;
              if (teamId) cache.setChannels(teamId, [ch]);
            } catch {}
          }),
          ...(missingProfiles.length > 0
            ? [client.getProfilesByIds(missingProfiles).then((list) => {
                for (const u of list) {
                  profileMap[u.id] = u;
                  cache.setUser(u);
                }
                setUserProfiles((prev) => ({...prev, ...profileMap}));
              })]
            : []),
        ]);
        buildEntries();
      } catch {}
    }
  }, [client]);

  const loadInbox = useCallback(async () => {
    // Resolve a team: use the cached selection, otherwise auto-pick the first.
    let teamId = client.getTeamId();
    console.log(`[ThreadsInbox] loadInbox: cachedTeamId=${teamId || '(null)'}`);
    if (!teamId) {
      try {
        const teams = await client.getTeams();
        console.log(`[ThreadsInbox] getTeams -> ${teams.length} teams: ${teams.map((t) => `${t.id}/${t.name}`).join(', ') || '(empty)'}`);
        if (teams.length > 0) {
          teamId = teams[0].id;
          client.setTeamId(teamId);
        }
      } catch (e) {
        console.log('[ThreadsInbox] getTeams error:', e);
      }
    }
    if (!teamId) {
      console.log('[ThreadsInbox] !! No team selected — giving up');
      setError('No team selected');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      // Show cached threads instantly, then refresh in background.
      // Only drop the loading state for a cache hit when it actually has
      // threads — an empty cache would briefly flash "No followed threads"
      // before the fresh fetch resolves.
      const cachedInbox = cache.getThreadsInbox(teamId);
      if (cachedInbox && cachedInbox.threads && cachedInbox.threads.length > 0) {
        renderInbox(cachedInbox);
        setLoading(false);
      }

      const [inbox, unread] = await Promise.all([
        client.getThreadsInbox(teamId),
        client.getThreadUnreadCount(),
      ]);
      cache.setThreadsInbox(teamId, inbox);

      setTotalUnread(unread.total_unread_threads || 0);
      setTotalMentions(unread.total_unread_mentions || 0);

      await renderInbox(inbox);
    } catch (err: any) {
      setError(err.message || 'Failed to load threads');
    } finally {
      setLoading(false);
    }
    // NOTE: intentionally does NOT depend on userProfiles — profiles come from
    // cache (cache.getUser) to avoid an infinite loadInbox <-> setUserProfiles loop.
  }, [client, renderInbox]);



  useEffect(() => {
    loadInbox();

    // Refresh when a thread is updated (new reply in a followed thread)
    const unsub = client.onWsEvent(WebSocketEvents.POSTED, () => {
      loadInbox();
    });
    return unsub;
  }, [client, loadInbox]);

  const handleToggleFollow = async (entry: InboxEntry) => {
    const teamId = client.getTeamId();
    if (!teamId) return;
    const next = !entry.thread.is_following;
    try {
      await client.setThreadFollowing(teamId, entry.thread.id, next);
      setEntries((prev) =>
        prev.map((e) =>
          e.thread.id === entry.thread.id
            ? {...e, thread: {...e.thread, is_following: next}}
            : e,
        ),
      );
    } catch {}
  };

  const renderEntry = ({item}: {item: InboxEntry}) => {
    const {thread, author, channel} = item;
    const hasUnread = thread.unread_mentions > 0 || thread.unread_replies > 0;
    const avatarUrl = author
      ? client.getProfileImageUrl(author.id, author.last_picture_update)
      : undefined;

    return (
      <TouchableOpacity
        style={[styles.row, hasUnread && styles.rowUnread]}
        onLongPress={() => togglePinThread(thread.id)}
        onPress={() => {
          const t = thread.post;
          if (t) {
            // Locally clear unread for this thread so returning to the inbox
            // doesn't show stale badges (markThreadRead runs on the server
            // side from ThreadScreen).
            setEntries((prev) =>
              prev.map((e) =>
                e.thread.id === thread.id
                  ? {...e, thread: {...e.thread, unread_replies: 0, unread_mentions: 0}}
                  : e,
              ),
            );
            onOpenThread(thread.id, t.channel_id);
          }
        }}
        activeOpacity={0.7}>
        <View style={styles.avatarWrap}>
          <Avatar url={avatarUrl} headers={imageHeaders} username={author?.username} size={40} />
          {thread.unread_mentions > 0 && (
            <View style={styles.mentionDot}>
              <Text style={styles.mentionDotText}>{thread.unread_mentions}</Text>
            </View>
          )}
        </View>

        <View style={styles.content}>
          <View style={styles.topRow}>
            <Text style={[styles.authorName, hasUnread && styles.bold]} numberOfLines={1}>
              {pinnedThreads.has(thread.id) ? '📌 ' : ''}
              {author?.username || 'Unknown'}
            </Text>
            <Text style={styles.time}>
              {formatTimeOrDate(thread.last_reply_at || thread.post?.create_at || 0)}
            </Text>
          </View>

          <Text
            style={[styles.preview, hasUnread && styles.previewUnread]}
            numberOfLines={2}>
            {thread.post?.message || ''}
          </Text>

          <View style={styles.metaRow}>
            <Text style={styles.channelName} numberOfLines={1}>
              {channel ? `# ${channel.display_name || channel.name}` : ''}
            </Text>
            <Text style={styles.replyCount}>
              💬 {thread.reply_count} {thread.reply_count === 1 ? 'reply' : 'replies'}
            </Text>
            {thread.unread_replies > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{thread.unread_replies} new</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={() => handleToggleFollow(item)}
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <Text style={styles.followText}>
                {thread.is_following ? '✓ Following' : '+ Follow'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
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
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Threads</Text>
          {totalUnread > 0 && (
            <Text style={styles.headerSubtitle}>
              {totalUnread} unread thread{totalUnread !== 1 ? 's' : ''}
              {totalMentions > 0 ? ` · ${totalMentions} mention${totalMentions !== 1 ? 's' : ''}` : ''}
            </Text>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.linkColor} />
          <Text style={styles.loadingText}>Loading threads...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadInbox}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.thread.id}
          renderItem={renderEntry}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshing={loading}
          onRefresh={loadInbox}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyTitle}>No followed threads</Text>
              <Text style={styles.emptyHint}>
                Reply to or get mentioned in a message to follow its thread
              </Text>
            </View>
          }
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
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: theme.sidebarHeaderBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: changeOpacity(theme.centerChannelColor, 0.2),
  },
  headerPane: {
    paddingTop: 12,
  },
  closeButton: {
    paddingRight: 12,
  },
  closeText: {
    fontSize: 24,
    color: theme.sidebarHeaderTextColor,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    color: theme.sidebarHeaderTextColor,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: theme.linkColor,
    fontSize: 12,
    marginTop: 2,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    marginTop: 12,
    fontSize: 14,
  },
  errorText: {
    color: theme.errorTextColor,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: theme.buttonBg,
    borderRadius: 8,
  },
  retryText: {
    color: theme.buttonColor,
    fontSize: 14,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: changeOpacity(theme.centerChannelColor, 0.15),
  },
  rowUnread: {
    backgroundColor: changeOpacity(theme.linkColor, 0.05),
  },
  avatarWrap: {
    position: 'relative',
    marginRight: 12,
  },
  mentionDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.dndIndicator,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  mentionDotText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  authorName: {
    color: theme.centerChannelColor,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  bold: {
    fontWeight: '800',
  },
  time: {
    color: changeOpacity(theme.centerChannelColor, 0.5),
    fontSize: 11,
  },
  preview: {
    color: changeOpacity(theme.centerChannelColor, 0.7),
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  previewUnread: {
    color: theme.centerChannelColor,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  channelName: {
    color: theme.linkColor,
    fontSize: 12,
    flex: 1,
  },
  replyCount: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    fontSize: 12,
    marginRight: 10,
  },
  unreadBadge: {
    backgroundColor: theme.mentionBg,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 10,
  },
  unreadBadgeText: {
    color: theme.mentionColor,
    fontSize: 10,
    fontWeight: '700',
  },
  followText: {
    color: theme.linkColor,
    fontSize: 12,
    fontWeight: '600',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    color: theme.centerChannelColor,
    fontSize: 16,
    fontWeight: '600',
  },
  emptyHint: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
});
