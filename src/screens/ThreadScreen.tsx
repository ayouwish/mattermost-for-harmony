/**
 * Thread Screen — shows all replies in a thread
 *
 * Displays the root message + all replies, with the ability to post new replies.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {type MattermostClient} from '../api/client';
import {cache} from '../api/cache';
import type {Channel, FileInfo, Post, PostEmbed, PostList, UserProfile} from '../api/types';
import {WebSocketEvents} from '../api/types';
import {Avatar, FileAttachments, InlineImagePreviews, LinkPreview, Markdown} from '../components';
import {formatTime} from '../utils/dateFormat';
import {theme, changeOpacity} from '../theme/utils';
import {openInBrowser} from '../utils/openLink';

interface Props {
  client: MattermostClient;
  channel: Channel;
  rootPost: Post;
  onClose: () => void;
  onMenu?: () => void;
  inPane?: boolean;
}

// Throttle for [ThreadScroll] debug traces.
let threadScrollTraceLast = 0;

interface DisplayReply {
  id: string;
  message: string;
  userId: string;
  username: string;
  timestamp: number;
  isOwn: boolean;
  isEdited: boolean;
  reactions: Array<{emoji: string; count: number; mine: boolean}>;
  files: FileInfo[];
  embeds: PostEmbed[];
}

export default function ThreadScreen({client, channel, rootPost, onClose, onMenu, inPane = false}: Props) {
  const [replies, setReplies] = useState<DisplayReply[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  // Pull-to-refresh spinner.
  const [refreshing, setRefreshing] = useState(false);
  // Whether to show the "jump to bottom" floating button.
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile>>({});
  const flatListRef = useRef<FlatList>(null);
  const currentUserId = client.getUserId() || '';
  // True while the entry "snap to bottom" is active: onContentSizeChange and a
  // polling timer keep scrolling to the end until the virtualized list has
  // fully measured its content (single scrollToEnd stops at a mid-list offset).
  const pendingScrollToEndRef = useRef(false);
  // True when the user is near the bottom (diagnostic only).
  const isNearBottomRef = useRef(false);
  // Guards the very first scroll-to-bottom so it happens exactly once.
  const initialScrollDoneRef = useRef(false);
  // Handle for the entry-positioning poll, cleared when leaving the screen.
  const positioningPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timestamp of the last PROGRAMMATIC scrollToEnd (see onScroll).
  const lastProgrammaticScrollRef = useRef(0);
  // True once the user has actually scrolled on their own.
  const userScrolledRef = useRef(false);
  // Consecutive ticks we've stayed at the true bottom edge (entry settle).
  const nearStreakRef = useRef(0);
  // True when the scroll position is within a few px of the true bottom edge.
  const atBottomRef = useRef(false);
  // Previous tick's content height, used to detect the list stopped growing.
  const lastContentHeightRef = useRef(0);
  // Latest measured content/viewport heights (from onContentSizeChange/onLayout)
  // so we can compute the exact bottom offset instead of trusting scrollToEnd.
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);
  // Latest replies length, in a ref so debug traces read the current value.
  const repliesLengthRef = useRef(0);
  repliesLengthRef.current = replies.length;

  const scrollToBottomOnce = useCallback(() => {
    lastProgrammaticScrollRef.current = Date.now();
    console.log(
      `[ThreadScroll] scrollToBottomOnce count=${repliesLengthRef.current} ` +
      `near=${isNearBottomRef.current} ch=${Math.round(contentHeightRef.current)} vh=${Math.round(viewportHeightRef.current)}`,
    );
    // Compute the exact bottom offset from the latest measured sizes. Fall back
    // to scrollToEnd before the first measurement arrives.
    if (contentHeightRef.current > 0 && viewportHeightRef.current > 0) {
      flatListRef.current?.scrollToOffset({
        offset: contentHeightRef.current - viewportHeightRef.current + 8,
        animated: false,
      });
    } else {
      flatListRef.current?.scrollToEnd({animated: false});
    }
  }, []);

  // One-time entry positioning: keep snapping to the bottom while the list
  // grows (virtualization measures cells in batches), then hand control back
  // to the user. Incoming replies never auto-scroll after this.
  const beginEntryPositioning = useCallback(() => {
    if (initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;
    pendingScrollToEndRef.current = true;
    if (positioningPollTimerRef.current) {
      clearTimeout(positioningPollTimerRef.current);
      positioningPollTimerRef.current = null;
    }
    const started = Date.now();
    nearStreakRef.current = 0;
    const settle = () => {
      pendingScrollToEndRef.current = false;
    };
    const poll = () => {
      positioningPollTimerRef.current = null;
      if (!pendingScrollToEndRef.current) return;
      if (Date.now() - started > 3000) {
        settle();
        return;
      }
      // Settle once we've been AT the true bottom edge for two ticks with the
      // content height no longer growing.
      const stable =
        Math.abs(contentHeightRef.current - lastContentHeightRef.current) < 2;
      lastContentHeightRef.current = contentHeightRef.current;
      const filled = contentHeightRef.current >= viewportHeightRef.current;
      if (filled && atBottomRef.current && stable) {
        nearStreakRef.current += 1;
      } else {
        nearStreakRef.current = 0;
      }
      if (nearStreakRef.current >= 2) {
        settle();
        return;
      }
      scrollToBottomOnce();
      positioningPollTimerRef.current = setTimeout(poll, 80);
    };
    positioningPollTimerRef.current = setTimeout(poll, 120);
  }, [scrollToBottomOnce]);

  // Stop the positioning poll when the screen is unmounted.
  useEffect(() => {
    return () => {
      if (positioningPollTimerRef.current) {
        clearTimeout(positioningPollTimerRef.current);
        positioningPollTimerRef.current = null;
      }
    };
  }, []);

  // Stable reference for avatar request headers.
  const imageHeadersRef = useRef(client.getImageRequestHeaders());
  // Keyboard height for manual offset (KeyboardAvoidingView unreliable in overlay)
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardWillShow', (e) => {
      setKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const showSub2 = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
    const hideSub2 = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      showSub2.remove();
      hideSub.remove();
      hideSub2.remove();
    };
  }, []);

  const toDisplayReply = useCallback(
    (p: Post, profiles: Record<string, UserProfile>): DisplayReply => {
      const reactions = (p.metadata?.reactions || []).reduce(
        (acc: Array<{emoji: string; count: number; mine: boolean}>, r) => {
          const existing = acc.find((a) => a.emoji === r.emoji_name);
          if (existing) {
            existing.count++;
            if (r.user_id === currentUserId) existing.mine = true;
          } else {
            acc.push({
              emoji: r.emoji_name,
              count: 1,
              mine: r.user_id === currentUserId,
            });
          }
          return acc;
        },
        [],
      );
      const profile = profiles[p.user_id];
      return {
        id: p.id,
        message: p.message,
        userId: p.user_id,
        username: profile?.username || 'unknown',
        timestamp: p.create_at,
        isOwn: p.user_id === currentUserId,
        isEdited: p.edit_at > 0 && p.edit_at !== p.create_at,
        reactions,
        files: p.metadata?.files || [],
        embeds: p.metadata?.embeds || [],
      };
    },
    [currentUserId],
  );

  const applyThreadData = useCallback(async (postList: PostList, isInitial = false) => {
    // Build reply rows using CACHED profiles only, so cached replies render
    // instantly. Missing profiles are fetched in the background below and
    // usernames update reactively (renderReply reads userProfiles).
    const userIds = [...new Set(Object.values(postList.posts).map((p: Post) => p.user_id))];
    const cachedProfiles: Record<string, UserProfile> = {};
    const missingIds: string[] = [];
    for (const uid of userIds) {
      const cached = cache.getUser(uid);
      if (cached) {
        cachedProfiles[uid] = cached;
      } else {
        missingIds.push(uid);
      }
    }

    // Get replies only (exclude root), sorted by time
    const replyList = Object.values(postList.posts)
      .filter((p: Post) => p.id !== rootPost.id && p.root_id === rootPost.id)
      .map((p: Post) => toDisplayReply(p, cachedProfiles))
      .sort((a, b) => a.timestamp - b.timestamp);

    if (isInitial) {
      // First data shown: full render + one-time jump to the newest reply.
      setReplies(replyList);
      beginEntryPositioning();
    } else {
      // SILENT MERGE: the cached first-paint is already rendered and positioned
      // at the bottom. Only append genuinely NEW replies; keep every visible
      // row untouched (no re-render if nothing changed → no flicker, no jump).
      setReplies((prev) => {
        const byId = new Map<string, DisplayReply>();
        for (const dr of prev) byId.set(dr.id, dr);
        let changed = false;
        for (const dr of replyList) {
          if (!byId.has(dr.id)) {
            byId.set(dr.id, dr);
            changed = true;
          }
        }
        if (!changed) return prev;
        return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp);
      });
    }

    // Background profile fetch — never block the cached first-paint.
    if (missingIds.length > 0) {
      client.getProfilesByIds(missingIds)
        .then((userList) => {
          for (const u of userList) cache.setUser(u);
          const fetched: Record<string, UserProfile> = {};
          for (const u of userList) fetched[u.id] = u;
          setUserProfiles((prev) => ({...prev, ...fetched}));
        })
        .catch(() => {});
    }
  }, [client, rootPost.id, toDisplayReply, beginEntryPositioning]);

  const loadThread = useCallback(async (asRefresh = false) => {
    try {
      if (asRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      // Reset scroll state per thread — switching threads reuses the component
      // instance, so without this the initial-scroll guard stays stale.
      // (Only for a fresh entry — a pull-to-refresh keeps the current position.)
      if (!asRefresh) {
        initialScrollDoneRef.current = false;
        pendingScrollToEndRef.current = false;
        isNearBottomRef.current = false;
        atBottomRef.current = false;
        lastContentHeightRef.current = 0;
        nearStreakRef.current = 0;
        lastProgrammaticScrollRef.current = 0;
        userScrolledRef.current = false;
        contentHeightRef.current = 0;
        // NOTE: viewportHeightRef is intentionally NOT reset — onLayout won't
        // re-fire for an unchanged frame, so resetting it would leave vh=0.
      }

      // Ensure the root post author's profile is available (cache-first).
      // Always seed it into userProfiles so the header never shows "unknown",
      // even when the profile is already cached (the old code only set state
      // when it had to fetch, leaving a gap for cached profiles).
      if (rootPost.user_id) {
        const cachedRoot = cache.getUser(rootPost.user_id);
        if (cachedRoot) {
          setUserProfiles((prev) => (prev[cachedRoot.id] ? prev : {...prev, [cachedRoot.id]: cachedRoot}));
        } else {
          try {
            const rootUser = await client.getUser(rootPost.user_id);
            cache.setUser(rootUser);
            setUserProfiles((prev) => ({...prev, [rootUser.id]: rootUser}));
          } catch {}
        }
      }

      // Show cached replies instantly, then refresh in background.
      // The cached data is the "local messages" the user positions against;
      // the server refresh updates the list WITHOUT re-scrolling.
      let cached = cache.getThreadPosts(rootPost.id);
      if (!cached && !asRefresh) {
        // No dedicated thread cache yet — seed it from the channel's cached
        // posts (root + replies) so the thread renders instantly instead of
        // showing an empty spinner while the network request runs.
        const tid = client.getTeamId() || '';
        const channelPosts = cache.getPosts(tid, channel.id);
        if (channelPosts?.posts) {
          const threadPosts: Record<string, Post> = {};
          for (const [id, p] of Object.entries(channelPosts.posts)) {
            if (id === rootPost.id || p.root_id === rootPost.id) {
              threadPosts[id] = p;
            }
          }
          if (Object.keys(threadPosts).length > 1) {
            cached = {
              order: Object.keys(threadPosts),
              posts: threadPosts,
              next_post_id: channelPosts.next_post_id,
              prev_post_id: channelPosts.prev_post_id,
              has_next: channelPosts.has_next,
            };
            cache.setThreadPosts(rootPost.id, cached);
          }
        }
      }
      if (cached && !asRefresh) {
        await applyThreadData(cached, true);
      }

      const postList: PostList = await client.getPostThread(rootPost.id);
      cache.setThreadPosts(rootPost.id, postList);
      await applyThreadData(postList, !cached);

      // Mark the thread as read on the server so it stops counting as unread
      // in the Threads inbox.
      const teamId = client.getTeamId();
      if (teamId) {
        client.markThreadRead(teamId, rootPost.id).catch(() => {});
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client, rootPost.id, rootPost.user_id, channel.id, applyThreadData]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  // Seed known profiles from cache immediately so the root author header never
  // renders as "unknown" while loadThread's async profile fetch is in flight.
  useEffect(() => {
    const seed: Record<string, UserProfile> = {};
    if (rootPost.user_id) {
      const cachedRoot = cache.getUser(rootPost.user_id);
      if (cachedRoot) seed[cachedRoot.id] = cachedRoot;
    }
    const tid = client.getTeamId() || '';
    const channelPosts = cache.getPosts(tid, channel.id)?.posts;
    if (channelPosts) {
      for (const p of Object.values(channelPosts)) {
        if ((p.id === rootPost.id || p.root_id === rootPost.id) && p.user_id && !seed[p.user_id]) {
          const u = cache.getUser(p.user_id);
          if (u) seed[u.id] = u;
        }
      }
    }
    if (Object.keys(seed).length > 0) {
      setUserProfiles((prev) => {
        let changed = false;
        const merged = {...prev};
        for (const id of Object.keys(seed)) {
          if (!merged[id]) {
            merged[id] = seed[id];
            changed = true;
          }
        }
        return changed ? merged : prev;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPost.id]);

  // Listen for new posts in this thread via WebSocket
  useEffect(() => {
    const unsub = client.onWsEvent(WebSocketEvents.POSTED, (msg) => {
      try {
        const postData = JSON.parse(msg.data?.post || '{}');
        if (postData.root_id !== rootPost.id) return;

        const senderId = postData.user_id;
        if (senderId && !userProfiles[senderId]) {
          client.getUser(senderId).then((u) => {
            setUserProfiles((prev) => ({...prev, [u.id]: u}));
            const dr = toDisplayReply(postData as Post, {[u.id]: u});
            addReply(dr);
          });
        } else {
          const dr = toDisplayReply(postData as Post, userProfiles);
          addReply(dr);
        }
      } catch {}
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, rootPost.id, userProfiles]);

  const addReply = useCallback((dr: DisplayReply) => {
    setReplies((prev) => {
      if (prev.some((p) => p.id === dr.id)) {
        return prev.map((p) => (p.id === dr.id ? dr : p));
      }
      return [...prev, dr];
    });
    // Auto-follow is handled by onContentSizeChange (grew + isNearBottom), so
    // no explicit scroll here — a separate timer would double-scroll.
  }, []);

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    setSending(true);
    const msgContent = trimmed;
    setMessage('');

    // Optimistic
    const tempId = `temp_${Date.now()}`;
    setReplies((prev) => [
      ...prev,
      {
        id: tempId,
        message: msgContent,
        userId: currentUserId,
        username: userProfiles[currentUserId]?.username || 'me',
        timestamp: Date.now(),
        isOwn: true,
        isEdited: false,
        reactions: [],
        files: [],
        embeds: [],
      },
    ]);

    try {
      const created = await client.createPost({
        channel_id: channel.id,
        message: msgContent,
        root_id: rootPost.id,
      });
      // Replace the optimistic row with the server-created post so the reply
      // is visible immediately even if the WS posted event is delayed. addReply
      // dedups by id, so a later WS event is harmless.
      if (created?.id) {
        const dr = toDisplayReply(created, userProfiles);
        setReplies((prev) => {
          const filtered = prev.filter((p) => p.id !== tempId);
          if (filtered.some((p) => p.id === dr.id)) {
            return filtered.map((p) => (p.id === dr.id ? dr : p));
          }
          return [...filtered, dr];
        });
      } else {
        setReplies((prev) => prev.filter((p) => p.id !== tempId));
      }
    } catch (err: any) {
      setReplies((prev) => prev.filter((p) => p.id !== tempId));
      setMessage(msgContent);
      Alert.alert('Reply failed', err.message || 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  const renderReply = ({item}: {item: DisplayReply}) => {
    const profile = userProfiles[item.userId];
    const avatarUrl = profile
      ? client.getProfileImageUrl(item.userId, profile.last_picture_update)
      : undefined;
    return (
      <View style={styles.replyRow}>
        <Avatar url={avatarUrl} headers={imageHeadersRef.current} username={item.username} size={32} />
        <View style={[styles.replyContent, item.isOwn && styles.replyContentOwn]}>
          <View style={styles.replyHeader}>
            <Text style={styles.replyUser}>
              {userProfiles[item.userId]?.username || item.username}
            </Text>
            <Text style={styles.replyTime}>
              {formatTime(item.timestamp)}
              {item.isEdited && <Text style={styles.edited}> (edited)</Text>}
            </Text>
          </View>
          <Markdown text={item.message} />
          {item.files.length > 0 && <FileAttachments client={client} files={item.files} />}
          <LinkPreview
            embeds={item.embeds}
            serverUrl={client.getServerUrl()}
            onOpen={(url) => openInBrowser(url)}
          />
          <InlineImagePreviews message={item.message} onOpen={(url) => openInBrowser(url)} />
        </View>
      </View>
    );
  };

  // Root post display
  const rootProfile = userProfiles[rootPost.user_id];
  const rootAvatarUrl = rootProfile
    ? client.getProfileImageUrl(rootPost.user_id, rootProfile.last_picture_update)
    : undefined;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={'height'}
      keyboardVerticalOffset={0}>
      {/* Header */}
      <View style={[styles.header, inPane && styles.headerPane]}>
        {onMenu && (
          <TouchableOpacity onPress={onMenu} style={styles.closeButton}>
            <Text style={styles.closeText}>☰</Text>
          </TouchableOpacity>
        )}
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Thread</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {channel.display_name || channel.name}
          </Text>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={replies}
        keyExtractor={(item) => item.id}
        renderItem={renderReply}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshing={refreshing}
        onRefresh={() => loadThread(true)}
        onLayout={(e) => {
          viewportHeightRef.current = e.nativeEvent.layout.height;
        }}
        onContentSizeChange={(w, h) => {
          contentHeightRef.current = h;
          // Only the one-time initial jump to the newest reply. Incoming
          // replies never auto-scroll (matches the official app).
          if (pendingScrollToEndRef.current) {
            console.log(`[ThreadScroll] onContentSizeChange(pending) count=${replies.length}`);
            scrollToBottomOnce();
          }
        }}
        onScroll={(e) => {
          const {contentOffset, contentSize, layoutMeasurement} = e.nativeEvent;
          // Once entry positioning has settled, any real scroll belongs to the
          // user. During positioning we ignore scroll events so the snap-to-
          // bottom can't be aborted by layout or retained-offset scrolls.
          if (contentOffset.y > 0 && !pendingScrollToEndRef.current) {
            userScrolledRef.current = true;
          }
          const distanceFromBottom =
            contentSize.height - (contentOffset.y + layoutMeasurement.height);
          const nearBottom = distanceFromBottom < 120;
          isNearBottomRef.current = nearBottom;
          atBottomRef.current = distanceFromBottom < 4;
          const shouldShow = !nearBottom && contentSize.height > layoutMeasurement.height + 120;
          setShowJumpToBottom((prev) => (prev === shouldShow ? prev : shouldShow));
          if (__DEV__) {
            if (!threadScrollTraceLast || threadScrollTraceLast < Date.now() - 500) {
              threadScrollTraceLast = Date.now();
              console.log(
                `[ThreadScroll] y=${Math.round(contentOffset.y)} h=${Math.round(contentSize.height)} ` +
                `dist=${Math.round(distanceFromBottom)} near=${isNearBottomRef.current} ` +
                `count=${repliesLengthRef.current}`,
              );
            }
          }
        }}
        scrollEventThrottle={100}
        ListHeaderComponent={
          <View style={styles.rootPost}>
            <View style={styles.rootPostRow}>
              <Avatar url={rootAvatarUrl} headers={imageHeadersRef.current} username={rootProfile?.username || '?'} size={40} />
              <View style={styles.rootPostContent}>
                <View style={styles.rootPostHeader}>
                  <Text style={styles.rootPostUser}>
                    {rootProfile?.username || 'unknown'}
                  </Text>
                  <Text style={styles.rootPostTime}>
                    {formatTime(rootPost.create_at)}
                  </Text>
                </View>
                <Markdown text={rootPost.message} style={styles.rootMarkdown} />
                {(rootPost.metadata?.files || []).length > 0 && (
                  <FileAttachments client={client} files={rootPost.metadata?.files || []} />
                )}
                <LinkPreview
                  embeds={rootPost.metadata?.embeds || []}
                  serverUrl={client.getServerUrl()}
                  onOpen={(url) => openInBrowser(url)}
                />
                <InlineImagePreviews message={rootPost.message} onOpen={(url) => openInBrowser(url)} />
              </View>
            </View>
            <View style={styles.threadDivider}>
              <Text style={styles.threadDividerText}>
                {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color="theme.buttonBg" />
            </View>
          ) : (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No replies yet. Be the first!</Text>
            </View>
          )
        }
      />

      {/* Jump-to-bottom floating button */}
      {showJumpToBottom && !loading && (
        <TouchableOpacity
          style={styles.jumpToBottom}
          onPress={() => {
            flatListRef.current?.scrollToEnd({animated: true});
            setShowJumpToBottom(false);
          }}
          activeOpacity={0.8}>
          <Text style={styles.jumpToBottomText}>↓</Text>
        </TouchableOpacity>
      )}

      {/* Input */}
      <View style={[styles.inputBar, {paddingBottom: keyboardHeight > 0 ? keyboardHeight : 8}]}>
        <TextInput
          style={styles.input}
          placeholder="Reply to thread..."
          placeholderTextColor="#6b7ca0"
          value={message}
          onChangeText={setMessage}
          multiline
          maxLength={4000}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!message.trim() || sending) && styles.sendDisabled]}
          onPress={handleSend}
          disabled={!message.trim() || sending}>
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.sendText}>Send</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
    paddingRight: 12,
  },
  closeText: {
    fontSize: 24,
    color: changeOpacity(theme.sidebarText, 0.7),
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    color: theme.sidebarHeaderTextColor,
    fontSize: 17,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 12,
    marginTop: 2,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  jumpToBottom: {
    position: 'absolute',
    right: 16,
    bottom: 90,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.buttonBg,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: {width: 0, height: 2},
    zIndex: 50,
  },
  jumpToBottomText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  centered: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 14,
  },
  // Root post
  rootPost: {
    backgroundColor: changeOpacity(theme.linkColor, 0.06),
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  rootPostRow: {
    flexDirection: 'row',
  },
  rootPostContent: {
    flex: 1,
    marginLeft: 10,
  },
  rootPostHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 3,
  },
  rootPostUser: {
    color: theme.linkColor,
    fontSize: 14,
    fontWeight: '700',
    marginRight: 8,
  },
  rootPostTime: {
    color: changeOpacity(theme.centerChannelColor, 0.5),
    fontSize: 11,
  },
  rootMarkdown: {
    marginBottom: 2,
  },
  threadDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: changeOpacity(theme.centerChannelColor, 0.2),
  },
  threadDividerText: {
    color: changeOpacity(theme.centerChannelColor, 0.7),
    fontSize: 12,
    fontWeight: '600',
  },
  // Replies
  replyRow: {
    flexDirection: 'row',
    marginBottom: 8,
    paddingVertical: 4,
  },
  replyContent: {
    flex: 1,
    marginLeft: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: changeOpacity(theme.centerChannelColor, 0.06),
  },
  replyContentOwn: {
    backgroundColor: changeOpacity(theme.linkColor, 0.15),
  },
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 3,
  },
  replyUser: {
    color: theme.linkColor,
    fontSize: 13,
    fontWeight: '700',
    marginRight: 8,
  },
  replyTime: {
    color: changeOpacity(theme.centerChannelColor, 0.5),
    fontSize: 10,
  },
  edited: {
    fontStyle: 'italic',
  },
  // Input
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.centerChannelBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: changeOpacity(theme.centerChannelColor, 0.2),
  },
  input: {
    flex: 1,
    backgroundColor: changeOpacity(theme.centerChannelColor, 0.08),
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.centerChannelColor,
    maxHeight: 120,
  },
  sendButton: {
    marginLeft: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: theme.buttonBg,
    borderRadius: 20,
    minWidth: 60,
    alignItems: 'center',
  },
  sendDisabled: {
    opacity: 0.4,
  },
  sendText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
