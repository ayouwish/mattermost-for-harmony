/**
 * Chat / Messaging Screen — full-featured
 *
 * Features:
 * - Message list with avatars, usernames, timestamps, Markdown rendering
 * - Send / edit / delete messages
 * - Emoji reactions (add/remove)
 * - Thread replies (inline)
 * - Real-time updates via WebSocket (posted, post_edited, post_deleted, typing, reactions)
 * - Typing indicator
 * - Long-press message for action menu (reply, edit, delete, react, copy)
 * - Image/file attachment display
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {type MattermostClient} from '../api/client';
import type {Channel, Post, PostList, UserProfile} from '../api/types';
import {WebSocketEvents} from '../api/types';
import {Avatar, Markdown} from '../components';
import {formatTime, formatDateSeparator} from '../utils/dateFormat';
import {cache} from '../api/cache';
import {theme, changeOpacity} from '../theme/utils';
import {setActiveChannel, setCurrentUserId} from '../api/notifications';
import {persistentStorage} from '../api/persistent-storage';

interface Props {
  client: MattermostClient;
  channel: Channel;
  onBack: () => void;
  onShowInfo?: () => void;
  onMenu?: () => void;
  onOpenThread?: (post: Post) => void;
  // True when rendered as the right pane below the full-width TopBar (wide
  // layout). In pane mode the header no longer clears the status bar.
  inPane?: boolean;
}

interface DisplayPost {
  id: string;
  message: string;
  userId: string;
  username: string;
  timestamp: number;
  isOwn: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  isSystem: boolean;
  rootId: string;
  isReply: boolean;
  isPinned: boolean;
  replyCount: number;
  reactions: Array<{emoji: string; count: number; mine: boolean}>;
  fileIds: string[];
  props: Record<string, any>;
  pendingPostId?: string;
  lastReplyPreview?: DisplayPost | null;
}

interface TypingUser {
  userId: string;
  username: string;
  timestamp: number;
}

const QUICK_EMOJIS = ['👍', '❤️', '🎉', '😂', '😮', '😢', '🚀', '✅'];
const TYPING_TIMEOUT_MS = 5000;
// Number of newest messages rendered on entry. Older messages load lazily when
// the user scrolls up (matching the official app).
const INITIAL_WINDOW = 20;
// Throttle for [Scroll] debug traces (500ms between onScroll samples).
let chatScrollTraceLast = 0;

// True when the given PostList contains messages OLDER than the currently
// rendered window (so the user can scroll up to load them).
function hasOlderPosts(postList: PostList, shownCount: number): boolean {
  const total = Object.values(postList.posts).filter((p: Post) => p.delete_at === 0).length;
  return total > shownCount || postList.has_next === true;
}

export default function ChatScreen({client, channel, onBack, onShowInfo, onMenu, onOpenThread, inPane = false}: Props) {
  const [posts, setPosts] = useState<DisplayPost[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<DisplayPost | null>(null);
  const [actionPost, setActionPost] = useState<DisplayPost | null>(null);
  const [emojiPickerPost, setEmojiPickerPost] = useState<DisplayPost | null>(null);
  const [typingUsers, setTypingUsers] = useState<Map<string, TypingUser>>(new Map());
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile>>({});
  const [hasEarlierPosts, setHasEarlierPosts] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  // Pull-to-refresh spinner (re-fetch the latest page from the server).
  const [refreshing, setRefreshing] = useState(false);
  // Post ids whose long messages were manually expanded.
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(new Set());
  // Whether to show the "jump to bottom" floating button (user scrolled up).
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  // Keep raw Post objects for thread navigation
  const rawPostsRef = useRef<Record<string, Post>>({});

  const flatListRef = useRef<FlatList>(null);
  const currentUserId = client.getUserId() || '';
  const lastTypingSent = useRef(0);
  // True when the user is near the bottom of the list.
  const isNearBottomRef = useRef(false);
  // True while the entry "snap to bottom" is active: onContentSizeChange and a
  // polling timer keep scrolling to the end until the virtualized list has
  // fully measured its content. Without this, a single scrollToEnd stops at a
  // fixed mid-list offset (only the cells near the viewport are measured yet).
  const pendingScrollToEndRef = useRef(false);
  // Guards the very first scroll-to-bottom so it happens exactly once.
  const initialScrollDoneRef = useRef(false);
  // Handle for the entry-positioning poll, cleared when switching channels or
  // leaving the screen so a stale poll can't fight the next entry.
  const positioningPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timestamp of the last PROGRAMMATIC scrollToEnd — used in onScroll to tell
  // scroll events caused by our own scrolls apart from real user scrolling.
  const lastProgrammaticScrollRef = useRef(0);
  // True once the user has actually scrolled on their own (entry snapping and
  // reposition-on-refresh are disabled afterwards).
  const userScrolledRef = useRef(false);
  // Older-message loading (onStartReached) is disabled during entry positioning
  // — otherwise it fires on mount (offset 0) and yanks the list to a random
  // page of history, which is exactly the "unknown offset" bug.
  const olderPostsEnabledRef = useRef(false);
  // Consecutive ticks we've stayed at the bottom (used to settle the entry
  // positioning poll once content stops growing).
  const nearStreakRef = useRef(0);
  // True when the scroll position is within a few px of the true bottom edge
  // (precise settle condition — the 120px isNearBottomRef is too loose).
  const atBottomRef = useRef(false);
  // Previous tick's content height, used to detect that the list stopped growing.
  const lastContentHeightRef = useRef(0);
  // Latest measured content/viewport heights (from onContentSizeChange/onLayout)
  // so we can compute the exact bottom offset instead of trusting scrollToEnd.
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);
  // Latest posts length, kept in a ref so debug traces read the current value.
  const postsLengthRef = useRef(0);
  postsLengthRef.current = posts.length;

  const scrollToBottomOnce = useCallback(() => {
    lastProgrammaticScrollRef.current = Date.now();
    console.log(
      `[Scroll] scrollToBottomOnce count=${postsLengthRef.current} ` +
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
  // to the user. Older-message loading stays disabled until this settles.
  const beginEntryPositioning = useCallback((force = false) => {
    if (!force && initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;
    olderPostsEnabledRef.current = false;
    pendingScrollToEndRef.current = true;
    if (positioningPollTimerRef.current) {
      clearTimeout(positioningPollTimerRef.current);
      positioningPollTimerRef.current = null;
    }
    const started = Date.now();
    nearStreakRef.current = 0;
    const settle = () => {
      pendingScrollToEndRef.current = false;
      olderPostsEnabledRef.current = true;
    };
    const poll = () => {
      positioningPollTimerRef.current = null;
      if (!pendingScrollToEndRef.current) return;
      if (Date.now() - started > 3000) {
        settle();
        return;
      }
      // Fill viewport: if the newest window is shorter than the viewport, load
      // older messages so the newest content fills the screen (idempotent via
      // loadingEarlier/hasEarlierPosts guards).
      if (contentHeightRef.current > 0 && contentHeightRef.current < viewportHeightRef.current) {
        loadEarlierPostsRef.current();
      }
      // Settle once we've been AT the true bottom edge for two ticks with the
      // content height no longer growing (content grows as cells render while
      // scrolling — the list hasn't settled until it stops growing).
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

  // Indirect reference to loadEarlierPosts (defined below) so beginEntryPositioning
  // can trigger a viewport-fill load without an ordering dependency.
  const loadEarlierPostsRef = useRef<() => void>(() => {});
  // Refs are assigned once loadEarlierPosts is defined (see below).

  const typingCleanupRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cursor for older-message pagination (oldest post id currently shown).
  const earliestPostIdRef = useRef<string | null>(null);
  // Keeps scroll position when older messages are prepended.
  const scrollOffsetBeforePrependRef = useRef(0);
  // Draft persistence
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftKey = `draft:${channel.id}`;

  const isDM = channel.type === 'D' || channel.type === 'G';
  // Stable reference for avatar/file request headers.
  const imageHeaders = useMemo(() => client.getImageRequestHeaders(), [client]);

  // ── Convert Post → DisplayPost ──
  const toDisplayPost = useCallback(
    (p: Post, profiles: Record<string, UserProfile>): DisplayPost => {
      const reactions = (p.metadata?.reactions || []).reduce(
        (acc: Array<{emoji: string; count: number; mine: boolean}>, r) => {
          const existing = acc.find((a) => a.emoji === r.emoji_name);
          if (existing) {
            existing.count++;
            if (r.user_id === currentUserId) {
              existing.mine = true;
            }
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
      const username = profile?.username || 'unknown';

      return {
        id: p.id,
        message: p.message,
        userId: p.user_id,
        username,
        timestamp: p.create_at,
        isOwn: p.user_id === currentUserId,
        isEdited: p.edit_at > 0 && p.edit_at !== p.create_at,
        isDeleted: p.delete_at !== 0,
        isSystem: !!(p.type && p.type.startsWith('system_')),
        rootId: p.root_id,
        isReply: !!p.root_id,
        isPinned: !!p.is_pinned,
        pendingPostId: p.pending_post_id || undefined,
        replyCount: p.reply_count || 0,
        reactions,
        fileIds: p.metadata?.files?.map((f) => f.id) || p.props?.attachments || [],
        props: p.props || {},
      };
    },
    [currentUserId],
  );

  // Helper: render posts from PostList (root posts + replies)
  // Keep only the most recent N posts from a PostList (for cache first-paint).
  const trimToLatestPage = useCallback((postList: PostList): PostList => {
    // order[0] is the newest post (Mattermost convention). Take the first 60.
    const orderedIds = Array.isArray(postList.order) && postList.order.length > 0
      ? postList.order
      : Object.values(postList.posts).sort((a, b) => b.create_at - a.create_at).map((p) => p.id);
    const sortedIds = orderedIds.slice(0, 60);
    const posts: Record<string, Post> = {};
    for (const id of sortedIds) {
      const p = postList.posts[id];
      if (p) posts[id] = p;
    }
    // has_next = true only if there were more cached posts beyond the latest 60.
    const hadMore = orderedIds.length > 60;
    return {
      order: sortedIds,
      posts,
      next_post_id: postList.next_post_id,
      prev_post_id: postList.prev_post_id,
      has_next: postList.has_next || hadMore,
    };
  }, []);

  const renderPosts = useCallback((postList: PostList): DisplayPost[] => {
    const profiles: Record<string, UserProfile> = {};
    for (const uid of new Set(Object.values(postList.posts).map((p: Post) => p.user_id))) {
      const cached = cache.getUser(uid);
      if (cached) profiles[uid] = cached;
    }
    const all = Object.values(postList.posts)
      .map((p: Post) => toDisplayPost(p, profiles))
      .filter((p) => !p.isDeleted)
      .sort((a, b) => a.timestamp - b.timestamp);
    // Only render the newest INITIAL_WINDOW messages on entry; older messages
    // render lazily when the user scrolls up.
    const windowed = all.slice(-INITIAL_WINDOW);
    setPosts(windowed);
    return windowed;
  }, [toDisplayPost]);

  // ── Load latest posts ──
  // On entry we render ONLY the newest INITIAL_WINDOW messages and position
  // them at the bottom so the newest message sits at the bottom edge, filling
  // the viewport. Older messages load lazily via loadEarlierPosts (scroll up).
  // New messages never auto-scroll — the user scrolls down to see them.
  const loadPosts = useCallback(async (forceRefresh = false) => {
    const teamId = client.getTeamId() || '';
    try {
      // Step 1: cached first-paint (newest window), positioned at the bottom.
      const cachedPostList = cache.getPosts(teamId, channel.id);
      let cachedNewestId: string | null = null;
      if (cachedPostList && !forceRefresh) {
        const windowed = renderPosts(trimToLatestPage(cachedPostList));
        cachedNewestId = windowed.length > 0 ? windowed[windowed.length - 1].id : null;
        if (windowed.length > 0) {
          earliestPostIdRef.current = windowed[0].id;
        }
        setHasEarlierPosts(hasOlderPosts(cachedPostList, windowed.length));
        setLoading(false);
        beginEntryPositioning();
      } else {
        setLoading(true);
      }

      setError(null);

      // Step 2: fetch the newest page (page=0 returns the newest posts;
      // order[0] is the most recent message).
      const postList: PostList = await client.getPostsForChannel(channel.id, {page: 0, per_page: 60});
      cache.setPosts(teamId, channel.id, postList);

      // Collect unique user IDs and fetch missing profiles
      const userIds = [...new Set(Object.values(postList.posts).map((p: Post) => p.user_id))];
      const missingIds = cache.getMissingUserIds(userIds);
      const profiles: Record<string, UserProfile> = {};

      // Use cached profiles first
      for (const uid of userIds) {
        const cached = cache.getUser(uid);
        if (cached) profiles[uid] = cached;
      }

      // Fetch only missing profiles
      if (missingIds.length > 0) {
        try {
          const userList = await client.getProfilesByIds(missingIds);
          for (const u of userList) {
            profiles[u.id] = u;
            cache.setUser(u);
          }
          setUserProfiles((prev) => ({...prev, ...profiles}));
        } catch {
          // Non-critical
        }
      } else if (Object.keys(profiles).length > 0) {
        setUserProfiles((prev) => ({...prev, ...profiles}));
      }

      // Store raw posts for thread navigation
      rawPostsRef.current = {...rawPostsRef.current, ...postList.posts};

      const freshOrder = Array.isArray(postList.order) ? postList.order : Object.keys(postList.posts);
      const freshNewestId = freshOrder.length > 0 ? freshOrder[0] : null;

      if (
        cachedPostList &&
        !forceRefresh &&
        cachedNewestId !== null &&
        cachedNewestId === freshNewestId
      ) {
        // Cache is current — the view already shows the newest window at the
        // bottom. Keep it in place (no re-render, no re-position → no flicker).
        setHasEarlierPosts(hasOlderPosts(postList, postsLengthRef.current));
      } else {
        // No cache or newer messages since the cache: show the newest window
        // and position at the newest message (unless the user already scrolled).
        const windowed = renderPosts(postList);
        if (windowed.length > 0) {
          earliestPostIdRef.current = windowed[0].id;
        }
        setHasEarlierPosts(hasOlderPosts(postList, windowed.length));
        if (!userScrolledRef.current) {
          beginEntryPositioning(true);
        }
      }

      // Mark channel as read — both server-side (viewChannel) and locally
      // (clear the cached unread badge so the sidebar doesn't keep showing it).
      client.viewChannel(channel.id).catch(() => {});
      const tid = client.getTeamId() || '';
      cache.clearUnread(tid, channel.id);
    } catch (err: any) {
      setError(err.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [client, channel.id, toDisplayPost, renderPosts, scrollToBottomOnce, beginEntryPositioning]);

  // ── Load older messages (scroll to top) ──
  const loadEarlierPosts = useCallback(async () => {
    if (loadingEarlier || !hasEarlierPosts) return;
    // Use the cursor ref instead of state to avoid re-creating this callback
    // on every posts change.
    const oldestId = earliestPostIdRef.current;
    if (!oldestId) return;

    // Remember current scroll offset so we can restore it after prepend.
    // (updated continuously in onScroll)
    setLoadingEarlier(true);
    try {
      const teamId = client.getTeamId() || '';
      const olderList: PostList = await client.getPostsForChannel(channel.id, {
        page: 0,
        per_page: 60,
        before: oldestId,
      });
      if (!olderList || Object.keys(olderList.posts).length === 0) {
        setHasEarlierPosts(false);
        return;
      }

      // Merge with existing cache
      const teamMap = cache.getPosts(teamId, channel.id);
      const merged: PostList = olderList;
      if (teamMap?.posts) {
        for (const [id, p] of Object.entries(teamMap.posts)) {
          if (!merged.posts[id]) merged.posts[id] = p;
        }
      }
      cache.setPosts(teamId, channel.id, merged);

      // Collect any missing profiles for the older posts
      const userIds = [...new Set(Object.values(olderList.posts).map((p: Post) => p.user_id))];
      const missingIds = cache.getMissingUserIds(userIds);
      if (missingIds.length > 0) {
        try {
          const userList = await client.getProfilesByIds(missingIds);
          for (const u of userList) cache.setUser(u);
        } catch {}
      }
      for (const uid of userIds) {
        const cached = cache.getUser(uid);
        if (cached) {
          setUserProfiles((prev) => (prev[uid] ? prev : {...prev, [uid]: cached}));
        }
      }

      // Prepend older posts (dedup by id), keep chronological order
      setPosts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        // Build profile map from cache for these older posts
        const olderUserIds = [...new Set(Object.values(olderList.posts).map((p: Post) => p.user_id))];
        const profileMap: Record<string, UserProfile> = {};
        for (const uid of olderUserIds) {
          const cached = cache.getUser(uid);
          if (cached) profileMap[uid] = cached;
        }
        const olderDisplay = Object.values(olderList.posts)
          .map((p: Post) => toDisplayPost(p, profileMap))
          .filter((p) => !p.isDeleted && !existingIds.has(p.id))
          .sort((a, b) => a.timestamp - b.timestamp);
        // Advance the cursor to the earliest newly-loaded post.
        if (olderDisplay.length > 0) {
          earliestPostIdRef.current = olderDisplay[0].id;
        }
        return [...olderDisplay, ...prev];
      });

      // Store raw posts for thread navigation
      rawPostsRef.current = {...rawPostsRef.current, ...olderList.posts};

      // Restore scroll position (keep the same messages on screen).
      if (scrollOffsetBeforePrependRef.current > 0) {
        const restoreOffset = scrollOffsetBeforePrependRef.current;
        scrollOffsetBeforePrependRef.current = 0;
        setTimeout(() => {
          flatListRef.current?.scrollToOffset({offset: restoreOffset, animated: false});
        }, 50);
      }

      setHasEarlierPosts(olderList.has_next);
    } catch {
      // ignore pagination errors
    } finally {
      setLoadingEarlier(false);
    }
  }, [loadingEarlier, hasEarlierPosts, client, channel.id, toDisplayPost]);

  // Keep loadEarlierPosts reachable from beginEntryPositioning (defined above).
  loadEarlierPostsRef.current = loadEarlierPosts;

  // ── Pull-to-refresh: fetch messages NEWER than the newest one we have ──
  // Matches the official app: new messages are NOT auto-scrolled into view.
  // The user pulls down to fetch them (they are appended after the current
  // list, keeping the scroll position).
  const refreshNewerPosts = useCallback(async () => {
    const teamId = client.getTeamId() || '';
    if (posts.length === 0) {
      loadPosts(true);
      return;
    }
    // Find the newest REAL post — optimistic temp_ placeholders have ids that
    // are not valid server pagination cursors.
    let newest: DisplayPost | undefined;
    for (let i = posts.length - 1; i >= 0; i--) {
      if (!posts[i].id.startsWith('temp_')) {
        newest = posts[i];
        break;
      }
    }
    if (!newest) {
      loadPosts(true);
      return;
    }
    setRefreshing(true);
    try {
      const newerList: PostList = await client.getPostsForChannel(channel.id, {
        page: 0,
        per_page: 60,
        after: newest.id,
      });
      const newerPosts = Object.values(newerList.posts)
        .filter((p: Post) => p.delete_at === 0)
        .sort((a, b) => a.create_at - b.create_at);
      if (newerPosts.length === 0) {
        return; // nothing new — keep the list as-is
      }

      // Cache merge
      const existing = cache.getPosts(teamId, channel.id);
      const merged: PostList = newerList;
      if (existing?.posts) {
        for (const [id, p] of Object.entries(existing.posts)) {
          if (!merged.posts[id]) merged.posts[id] = p;
        }
      }
      cache.setPosts(teamId, channel.id, merged);

      // Fetch missing profiles
      const userIds = [...new Set(newerPosts.map((p) => p.user_id))];
      const missingIds = cache.getMissingUserIds(userIds);
      if (missingIds.length > 0) {
        try {
          const list = await client.getProfilesByIds(missingIds);
          for (const u of list) cache.setUser(u);
        } catch {}
      }
      const profileMap: Record<string, UserProfile> = {};
      for (const uid of userIds) {
        const cached = cache.getUser(uid);
        if (cached) profileMap[uid] = cached;
      }
      const newerDisplay = newerPosts
        .map((p) => toDisplayPost(p, profileMap))
        .filter((p) => !p.isDeleted);

      // Append new messages after the current list (chronological). Do NOT
      // auto-scroll — the user decides whether to move down to see them.
      setPosts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const fresh = newerDisplay.filter((p) => !existingIds.has(p.id));
        if (fresh.length === 0) return prev;
        // Insert new messages before any pending/optimistic temp posts.
        const tempSplit = prev.findIndex((p) => p.id.startsWith('temp_'));
        if (tempSplit >= 0) {
          return [...prev.slice(0, tempSplit), ...fresh, ...prev.slice(tempSplit)];
        }
        return [...prev, ...fresh];
      });
      rawPostsRef.current = {...rawPostsRef.current, ...newerList.posts};

      // Keep the channel marked as read after refreshing.
      client.viewChannel(channel.id).catch(() => {});
      cache.clearUnread(teamId, channel.id);
    } catch {
      // ignore refresh errors
    } finally {
      setRefreshing(false);
    }
  }, [client, channel.id, toDisplayPost, posts.length]);

  // ── Initial load ──
  useEffect(() => {
    setActiveChannel(channel.id);
    setCurrentUserId(client.getUserId());

    // Reset scroll state per channel — otherwise switching channels reuses the
    // same component instance and the initial-scroll guard would be stale,
    // leaving the list unscrolled (or double-scrolling) on the next channel.
    initialScrollDoneRef.current = false;
    pendingScrollToEndRef.current = false;
    isNearBottomRef.current = false;
    atBottomRef.current = false;
    lastContentHeightRef.current = 0;
    nearStreakRef.current = 0;
    lastProgrammaticScrollRef.current = 0;
    userScrolledRef.current = false;
    olderPostsEnabledRef.current = false;
    // NOTE: viewportHeightRef is intentionally NOT reset — the list's viewport
    // height doesn't change between channels, and onLayout won't re-fire for an
    // unchanged frame, so resetting it would leave vh=0 and break positioning.

    loadPosts();

    // Restore saved draft for this channel
    persistentStorage.getString(draftKey, '').then((draft) => {
      if (draft) setMessage(draft);
    });

    // Clear active channel when leaving the chat screen so other channels'
    // messages trigger notifications again. Also stop any running entry
    // positioning poll so a stale timer can't fight the next channel.
    return () => {
      if (positioningPollTimerRef.current) {
        clearTimeout(positioningPollTimerRef.current);
        positioningPollTimerRef.current = null;
      }
      setActiveChannel(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // ── WebSocket event listeners ──
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // New post
    unsubs.push(
      client.onWsEvent(WebSocketEvents.POSTED, (msg) => {
        try {
          const postData = JSON.parse(msg.data?.post || '{}');
          if (postData.channel_id !== channel.id) return;

          // Store raw post for thread navigation + cache
          rawPostsRef.current[postData.id] = postData as Post;
          const teamId = client.getTeamId() || '';
          cache.addPostToCache(teamId, channel.id, postData as Post);
          // This is the channel being viewed — keep it marked as read so the
          // sidebar unread badge stays cleared in real-time.
          cache.clearUnread(teamId, channel.id);
          client.viewChannel(channel.id).catch(() => {});

          // Fetch profile for sender if needed
          const senderId = postData.user_id;
          if (senderId && !userProfiles[senderId]) {
            client.getUser(senderId).then((u) => {
              setUserProfiles((prev) => ({...prev, [u.id]: u}));
              // Now build display post with the new profile
              const dp = toDisplayPost(postData as Post, {[u.id]: u});
              addPost(dp);
            });
          } else {
            const dp = toDisplayPost(postData as Post, userProfiles);
            addPost(dp);
          }
        } catch {
          // ignore
        }
      }),
    );

    // Post edited
    unsubs.push(
      client.onWsEvent(WebSocketEvents.POST_EDITED, (msg) => {
        try {
          const postData = JSON.parse(msg.data?.post || '{}');
          if (postData.channel_id !== channel.id) return;
          const dp = toDisplayPost(postData as Post, userProfiles);
          setPosts((prev) =>
            prev.map((p) => (p.id === dp.id ? dp : p)),
          );
        } catch {
          // ignore
        }
      }),
    );

    // Post deleted
    unsubs.push(
      client.onWsEvent(WebSocketEvents.POST_DELETED, (msg) => {
        try {
          const postData = JSON.parse(msg.data?.post || '{}');
          if (postData.channel_id !== channel.id) return;
          setPosts((prev) => prev.filter((p) => p.id !== postData.id));
          const teamId = client.getTeamId() || '';
          cache.deletePostFromCache(teamId, channel.id, postData.id);
        } catch {
          // ignore
        }
      }),
    );

    // Typing
    unsubs.push(
      client.onWsEvent(WebSocketEvents.TYPING, (msg) => {
        const userId = msg.data?.user_id;
        if (!userId || userId === currentUserId) return;
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.set(userId, {
            userId,
            username: msg.data?.display_name || userProfiles[userId]?.username || 'user',
            timestamp: Date.now(),
          });
          return next;
        });
      }),
    );

    return () => {
      unsubs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, channel.id, userProfiles]);

  // ── Typing indicator cleanup ──
  useEffect(() => {
    typingCleanupRef.current = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [key, val] of next) {
          if (now - val.timestamp > TYPING_TIMEOUT_MS) {
            next.delete(key);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => {
      if (typingCleanupRef.current) {
        clearInterval(typingCleanupRef.current);
      }
    };
  }, []);

  // ── Add post helper (dedup) — replies are shown inline in the main list ──
  const addPost = useCallback((dp: DisplayPost) => {
    setPosts((prev) => {
      // If the incoming post references a pending (optimistic) post, replace it.
      if (dp.pendingPostId) {
        const pendingIdx = prev.findIndex((p) => p.pendingPostId === dp.pendingPostId);
        if (pendingIdx >= 0) {
          const next = [...prev];
          next[pendingIdx] = dp;
          return next;
        }
      }
      // Update existing (same id)
      if (prev.some((p) => p.id === dp.id)) {
        return prev.map((p) => (p.id === dp.id ? dp : p));
      }
      // It's a reply — insert inline AND update parent's reply count/preview
      if (dp.rootId) {
        const parentExists = prev.some((p) => p.id === dp.rootId);
        const withParentUpdate = parentExists
          ? prev.map((p) =>
              p.id === dp.rootId
                ? {...p, replyCount: p.replyCount + 1, lastReplyPreview: dp}
                : p,
            )
          : prev;
        return [...withParentUpdate, dp];
      }
      // New root post
      return [...prev, dp];
    });
    // Auto-follow is handled by onContentSizeChange (grew + isNearBottom), so
    // no explicit scroll here — a separate timer would double-scroll.
  }, []);

  // ── Send message ──
  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    // Editing mode
    if (editingPostId) {
      setSending(true);
      try {
        await client.updatePost(editingPostId, {message: trimmed});
        setEditingPostId(null);
        setMessage('');
        setReplyTo(null);
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to edit message');
      } finally {
        setSending(false);
      }
      return;
    }

    setSending(true);
    const msgContent = trimmed;
    const replyRootId = replyTo?.id || '';
    setMessage('');

    // ── Slash command handling ──
    if (msgContent.startsWith('/') && !replyRootId) {
      const handled = await handleSlashCommand(msgContent);
      if (handled) {
        setSending(false);
        return;
      }
    }

    // Optimistic update
    const tempId = `temp_${Date.now()}`;
    const optimistic: DisplayPost = {
      id: tempId,
      message: msgContent,
      userId: currentUserId,
      username: userProfiles[currentUserId]?.username || 'me',
      timestamp: Date.now(),
      isOwn: true,
      isEdited: false,
      isDeleted: false,
      isSystem: false,
      rootId: replyRootId,
      isReply: !!replyRootId,
      isPinned: false,
      pendingPostId: tempId,
      replyCount: 0,
      reactions: [],
      fileIds: [],
      props: {},
    };
    if (!replyRootId) {
      // Only optimistically insert root posts; replies come back via WS posted.
      setPosts((prev) => [...prev, optimistic]);
    }
    setReplyTo(null);

    try {
      await client.createPost({
        channel_id: channel.id,
        message: msgContent,
        root_id: replyRootId || undefined,
        pending_post_id: tempId,
      });
      // Clear the draft now that the message was sent.
      persistentStorage.delete(draftKey).catch(() => {});
      // The optimistic placeholder is replaced by the real post (matched by
      // pending_post_id in addPost when the WS 'posted' event arrives).
      // Fallback: if WS is slow, keep the optimistic message visible.
      // (auto-scroll happens via onContentSizeChange, not a timer here)
    } catch (err: any) {
      // Remove optimistic post on failure
      setPosts((prev) => prev.filter((p) => p.id !== tempId));
      setMessage(msgContent);
      Alert.alert('Error', err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  // ── Typing indicator send ──
  const handleTextChange = (text: string) => {
    setMessage(text);
    // Persist draft (debounced)
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      persistentStorage.setString(draftKey, text).catch(() => {});
    }, 500);
    // Send typing event (throttled to once per 3s)
    const now = Date.now();
    if (now - lastTypingSent.current > 3000 && text.length > 0) {
      lastTypingSent.current = now;
      client.sendTypingEvent(channel.id);
    }
  };

  // ── Slash commands ──
  const handleSlashCommand = async (input: string): Promise<boolean> => {
    const parts = input.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case 'me':
        // Action message — italicized
        if (!args) {
          Alert.alert('Usage', '/me <action>');
          return true;
        }
        try {
          await client.createPost({
            channel_id: channel.id,
            message: `*${args}*`,
          });
        } catch (err: any) {
          Alert.alert('Error', err.message);
        }
        return true;

      case 'echo':
        // Test message
        if (!args) {
          Alert.alert('Usage', '/echo <message>');
          return true;
        }
        try {
          await client.createPost({
            channel_id: channel.id,
            message: args,
          });
        } catch (err: any) {
          Alert.alert('Error', err.message);
        }
        return true;

      case 'header':
        // Set channel header (requires admin, may fail)
        if (!args) {
          Alert.alert('Usage', '/header <text>');
          return true;
        }
        Alert.alert('Not Available', 'Setting channel header requires admin permissions. Use the web app.');
        return true;

      case 'purpose':
        if (!args) {
          Alert.alert('Usage', '/purpose <text>');
          return true;
        }
        Alert.alert('Not Available', 'Setting channel purpose requires admin permissions.');
        return true;

      case 'leave':
        // Leave channel
        Alert.alert(
          'Leave Channel',
          `Leave ${channel.display_name || channel.name}?`,
          [
            {text: 'Cancel', style: 'cancel'},
            {
              text: 'Leave',
              style: 'destructive',
              onPress: () => {
                onBack();
              },
            },
          ],
        );
        return true;

      case 'help':
        Alert.alert(
          'Available Commands',
          '/me <action> — send action message\n' +
          '/echo <message> — test message\n' +
          '/leave — leave channel\n' +
          '/help — show this help\n\n' +
          'Markdown: **bold** *italic* `code` >quote\n' +
          'Reactions: long-press a message',
        );
        return true;

      default:
        // Unknown command — let it send as a regular message
        return false;
    }
  };

  // ── Actions ──
  const handlePin = async (post: DisplayPost) => {
    setActionPost(null);
    try {
      if (post.isPinned) {
        await client.unpinPost(post.id);
      } else {
        await client.pinPost(post.id);
      }
      setPosts((prev) =>
        prev.map((p) => (p.id === post.id ? {...p, isPinned: !p.isPinned} : p)),
      );
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update pin');
    }
  };

  const handleDelete = (post: DisplayPost) => {
    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await client.deletePost(post.id);
              setPosts((prev) => prev.filter((p) => p.id !== post.id));
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to delete');
            }
          },
        },
      ],
    );
    setActionPost(null);
  };

  const handleEdit = (post: DisplayPost) => {
    setEditingPostId(post.id);
    setMessage(post.message);
    setActionPost(null);
  };

  const handleReply = (post: DisplayPost) => {
    const teamId = client.getTeamId() || '';
    const cachedPosts = cache.getPosts(teamId, channel.id);
    const raw = cachedPosts?.posts[post.id] || rawPostsRef.current[post.id];
    if (raw && onOpenThread) {
      onOpenThread(raw);
    } else {
      setReplyTo(post);
    }
    setActionPost(null);
  };

  const handleReact = async (post: DisplayPost, emoji: string) => {
    setEmojiPickerPost(null);
    // Find if user already reacted with this emoji
    const existing = post.reactions.find((r) => r.emoji === emoji && r.mine);
    try {
      if (existing) {
        await client.removeReaction(post.id, emoji);
      } else {
        await client.addReaction(post.id, emoji);
      }
      // The WS reaction_added/removed event will update the UI,
      // but also do an immediate local update for responsiveness
      setPosts((prev) =>
        prev.map((p) => {
          if (p.id !== post.id) return p;
          const reactions = [...p.reactions];
          const idx = reactions.findIndex((r) => r.emoji === emoji);
          if (idx >= 0) {
            if (existing) {
              reactions[idx] = {
                ...reactions[idx],
                count: reactions[idx].count - 1,
                mine: false,
              };
              if (reactions[idx].count <= 0) {
                reactions.splice(idx, 1);
              }
            } else {
              reactions[idx] = {
                ...reactions[idx],
                count: reactions[idx].count + 1,
                mine: true,
              };
            }
          } else {
            reactions.push({emoji, count: 1, mine: true});
          }
          return {...p, reactions};
        }),
      );
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to react');
    }
  };

  const cancelEditing = () => {
    setEditingPostId(null);
    setReplyTo(null);
    setMessage('');
  };

  // ── Typing indicator text ──
  const typingText = useMemo(() => {
    const active = Array.from(typingUsers.values());
    if (active.length === 0) return '';
    if (active.length === 1) return `${active[0].username} is typing...`;
    if (active.length === 2) return `${active[0].username} and ${active[1].username} are typing...`;
    return `${active[0].username} and ${active.length - 1} others are typing...`;
  }, [typingUsers]);

  // ── Render ──
  // Map post id -> post for O(1) parent lookup in replies (avoids an O(n^2)
  // scan on every rendered reply, which slows down page switches noticeably).
  const postsById = useMemo(() => {
    const m = new Map<string, DisplayPost>();
    for (const p of posts) m.set(p.id, p);
    return m;
  }, [posts]);

  const renderPost = ({item, index}: {item: DisplayPost; index: number}) => {
    const prevPost = index > 0 ? posts[index - 1] : null;
    const showDateSeparator = !prevPost || !isSameDay(prevPost.timestamp, item.timestamp);
    const showAvatar = showDateSeparator || !prevPost || prevPost.userId !== item.userId || item.timestamp - prevPost.timestamp > 5 * 60 * 1000;
    const profile = userProfiles[item.userId];
    const avatarUrl = profile ? client.getProfileImageUrl(item.userId, profile.last_picture_update) : undefined;

    if (item.isDeleted) {
      return showDateSeparator ? <DateSeparator timestamp={item.timestamp} /> : null;
    }

    // System message
    if (item.isSystem) {
      return (
        <View>
          {showDateSeparator && <DateSeparator timestamp={item.timestamp} />}
          <View style={styles.systemMessage}>
            <Text style={styles.systemText}>{item.message}</Text>
          </View>
        </View>
      );
    }

    // Reply messages: show a parent reference bar + indent
    const parentPost = item.rootId
      ? postsById.get(item.rootId)
      : undefined;

    return (
      <View>
        {showDateSeparator && <DateSeparator timestamp={item.timestamp} />}
        <TouchableOpacity
          style={[
            styles.postRow,
            item.isOwn ? styles.postRowOwn : null,
            item.isReply ? styles.postRowReply : null,
          ]}
          onLongPress={() => setActionPost(item)}
          activeOpacity={0.7}>
        {showAvatar ? (
          <Avatar url={avatarUrl} headers={imageHeaders} username={item.username} size={36} />
        ) : (
          <View style={{width: 36}} />
        )}
        <View style={[styles.postContent, item.isOwn ? styles.postContentOwn : null]}>
          {showAvatar && (
            <View style={styles.postHeader}>
              <Text style={styles.postUser}>{item.username}</Text>
              <Text style={styles.postTime}>
                {formatTime(item.timestamp)}
                {item.isPinned && <Text style={styles.pinnedFlag}> 📌</Text>}
                {item.isEdited && <Text style={styles.editedFlag}> (edited)</Text>}
              </Text>
            </View>
          )}
          {item.isReply && (
            <View style={styles.replyRefBar}>
              <Text style={styles.replyRefText} numberOfLines={1}>
                {parentPost ? (
                  <>
                    <Text style={styles.replyRefAuthor}>↳ {parentPost.username}</Text>
                    {parentPost.message ? ` ${parentPost.message}` : ''}
                  </>
                ) : (
                  '↳ In reply to a message'
                )}
              </Text>
            </View>
          )}
          <CollapsibleMarkdown
            message={item.message}
            expanded={expandedPosts.has(item.id)}
            onToggle={() => {
              setExpandedPosts((prev) => {
                const next = new Set(prev);
                if (next.has(item.id)) {
                  next.delete(item.id);
                } else {
                  next.add(item.id);
                }
                return next;
              });
            }}
          />
          {item.replyCount > 0 && (
            <TouchableOpacity
              style={styles.threadBadge}
              onPress={() => {
                // Find the raw post from cache (survives screen switches)
                const teamId = client.getTeamId() || '';
                const cachedPosts = cache.getPosts(teamId, channel.id);
                const raw = cachedPosts?.posts[item.id] || rawPostsRef.current[item.id];
                if (raw && onOpenThread) onOpenThread(raw);
              }}>
              <View style={styles.threadBadgeRow}>
                <Text style={styles.threadBadgeText}>
                  💬 {item.replyCount} {item.replyCount === 1 ? 'reply' : 'replies'}
                </Text>
                <Text style={styles.threadViewLink}>View thread →</Text>
              </View>
              {item.lastReplyPreview && (
                <View style={styles.threadPreview}>
                  <Text style={styles.threadPreviewUser}>
                    {item.lastReplyPreview.username}:
                  </Text>
                  <Text style={styles.threadPreviewMsg} numberOfLines={1}>
                    {item.lastReplyPreview.message}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          {item.reactions.length > 0 && (
            <View style={styles.reactionRow}>
              {item.reactions.map((r, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.reactionChip, r.mine && styles.reactionChipMine]}
                  onPress={() => handleReact(item, r.emoji)}>
                  <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                  <Text style={[styles.reactionCount, r.mine && styles.reactionCountMine]}>
                    {r.count}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </TouchableOpacity>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={'height'}
      keyboardVerticalOffset={0}>
      {/* Header */}
      <View style={[styles.header, inPane && styles.headerPane]}>
        {onMenu && (
          <TouchableOpacity onPress={onMenu} style={styles.backButton}>
            <Text style={styles.backText}>☰</Text>
          </TouchableOpacity>
        )}
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {isDM ? channel.display_name || 'Direct Message' : channel.display_name || channel.name}
          </Text>
          {(channel.purpose || channel.header) ? (
            <Text style={styles.headerPurpose} numberOfLines={1}>
              {channel.purpose || channel.header}
            </Text>
          ) : null}
        </View>
        {onShowInfo && (
          <TouchableOpacity onPress={onShowInfo} style={styles.infoButton}>
            <Text style={styles.infoIcon}>ⓘ</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Messages */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1868db" />
        </View>
      ) : error ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadPosts(true)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={renderPost}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={refreshNewerPosts}
          onScroll={(e) => {
            const {contentOffset, contentSize, layoutMeasurement} = e.nativeEvent;
            scrollOffsetBeforePrependRef.current = contentOffset.y;
            // Once entry positioning has settled, any real scroll belongs to the
            // user (enables older-message loading). During positioning (pending)
            // we ignore scroll events so the snap-to-bottom can't be aborted by
            // layout or retained-offset scrolls.
            if (contentOffset.y > 0 && !pendingScrollToEndRef.current) {
              userScrolledRef.current = true;
              olderPostsEnabledRef.current = true;
            }
            // Consider near-bottom when within ~120px of the bottom edge.
            const distanceFromBottom =
              contentSize.height - (contentOffset.y + layoutMeasurement.height);
            const nearBottom = distanceFromBottom < 120;
            isNearBottomRef.current = nearBottom;
            // Precise "at the true bottom edge" flag for entry-positioning settle.
            atBottomRef.current = distanceFromBottom < 4;
            // Drive the "jump to bottom" button visibility from scroll.
            // Only update state when it actually flips, to avoid re-render churn
            // on every scroll event (which would make page switches feel slow).
            const shouldShow = !nearBottom && contentSize.height > layoutMeasurement.height + 120;
            setShowJumpToBottom((prev) => (prev === shouldShow ? prev : shouldShow));
            // Debug trace for positioning issues — throttled, dev only.
            if (__DEV__) {
              if (!chatScrollTraceLast || chatScrollTraceLast < Date.now() - 500) {
                chatScrollTraceLast = Date.now();
                console.log(
                  `[Scroll] y=${Math.round(contentOffset.y)} h=${Math.round(contentSize.height)} ` +
                  `view=${Math.round(layoutMeasurement.height)} dist=${Math.round(distanceFromBottom)} ` +
                  `near=${isNearBottomRef.current} count=${postsLengthRef.current}`,
                );
              }
            }
          }}
          scrollEventThrottle={100}
          onLayout={(e) => {
            viewportHeightRef.current = e.nativeEvent.layout.height;
          }}
          onContentSizeChange={(w, h) => {
            contentHeightRef.current = h;
            // Only the one-time initial jump to the newest message. Incoming
            // messages never auto-scroll (matches the official app).
            if (pendingScrollToEndRef.current && !loadingEarlier) {
              console.log(`[Scroll] onContentSizeChange(pending) count=${posts.length}`);
              scrollToBottomOnce();
            }
          }}
          onStartReached={() => {
            // Older-message loading is disabled during entry positioning —
            // otherwise it fires at mount (offset 0) and yanks the list to a
            // random page of history (the "unknown offset" bug).
            if (olderPostsEnabledRef.current) {
              loadEarlierPosts();
            }
          }}
          onStartReachedThreshold={0.1}
          ListHeaderComponent={
            loadingEarlier ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={theme.linkColor} />
                <Text style={styles.emptyText}>Loading older messages...</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.loadingContainer}>
              <Text style={styles.emptyText}>No messages yet. Say hello! 👋</Text>
            </View>
          }
        />
      )}

      {/* Jump-to-bottom floating button — shown when scrolled up, so the user
          can always return to the newest message even without new ones. */}
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

      {/* Typing indicator */}
      {typingText ? (
        <View style={styles.typingBar}>
          <Text style={styles.typingText}>{typingText}</Text>
        </View>
      ) : null}

      {/* Reply / Edit banner */}
      {(replyTo || editingPostId) && (
        <View style={styles.replyBanner}>
          <Text style={styles.replyBannerText} numberOfLines={1}>
            {editingPostId ? 'Editing' : 'Replying to'}:{' '}
            <Text style={styles.replyBannerContent}>
              {editingPostId ? message : replyTo?.message}
            </Text>
          </Text>
          <TouchableOpacity onPress={cancelEditing}>
            <Text style={styles.replyBannerCancel}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder={editingPostId ? 'Edit message...' : 'Type a message...'}
          placeholderTextColor="#6b7ca0"
          value={message}
          onChangeText={handleTextChange}
          multiline
          maxLength={4000}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!message.trim() || sending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!message.trim() || sending}>
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.sendText}>{editingPostId ? '✓' : 'Send'}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Action sheet */}
      <Modal
        visible={!!actionPost}
        transparent
        animationType="slide"
        onRequestClose={() => setActionPost(null)}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setActionPost(null)}>
          <View style={styles.actionSheet}>
            <Text style={styles.actionTitle} numberOfLines={2}>
              {actionPost?.message}
            </Text>
            <TouchableOpacity style={styles.actionItem} onPress={() => actionPost && handleReply(actionPost)}>
              <Text style={styles.actionIcon}>💬</Text>
              <Text style={styles.actionLabel}>Reply</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionItem} onPress={() => actionPost && setEmojiPickerPost(actionPost)}>
              <Text style={styles.actionIcon}>😀</Text>
              <Text style={styles.actionLabel}>React</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionItem} onPress={() => actionPost && handlePin(actionPost)}>
              <Text style={styles.actionIcon}>{actionPost?.isPinned ? '📌' : '📍'}</Text>
              <Text style={styles.actionLabel}>{actionPost?.isPinned ? 'Unpin' : 'Pin'}</Text>
            </TouchableOpacity>
            {actionPost?.isOwn && (
              <TouchableOpacity style={styles.actionItem} onPress={() => actionPost && handleEdit(actionPost)}>
                <Text style={styles.actionIcon}>✏️</Text>
                <Text style={styles.actionLabel}>Edit</Text>
              </TouchableOpacity>
            )}
            {actionPost?.isOwn && (
              <TouchableOpacity style={[styles.actionItem, styles.actionDanger]} onPress={() => actionPost && handleDelete(actionPost)}>
                <Text style={styles.actionIcon}>🗑️</Text>
                <Text style={[styles.actionLabel, styles.actionLabelDanger]}>Delete</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.actionItem, styles.actionCancel]} onPress={() => setActionPost(null)}>
              <Text style={styles.actionLabel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Emoji picker */}
      <Modal
        visible={!!emojiPickerPost}
        transparent
        animationType="fade"
        onRequestClose={() => setEmojiPickerPost(null)}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setEmojiPickerPost(null)}>
          <View style={styles.emojiPicker}>
            <Text style={styles.emojiPickerTitle}>React with emoji</Text>
            <View style={styles.emojiGrid}>
              {QUICK_EMOJIS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  style={styles.emojiCell}
                  onPress={() => emojiPickerPost && handleReact(emojiPickerPost, emoji)}>
                  <Text style={styles.emojiCellText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

    </KeyboardAvoidingView>
  );
}

function isSameDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return d1.toDateString() === d2.toDateString();
}

// Date separator component
function DateSeparator({timestamp}: {timestamp: number}) {
  return (
    <View style={dateSepStyles.container}>
      <View style={dateSepStyles.line} />
      <Text style={dateSepStyles.text}>{formatDateSeparator(timestamp)}</Text>
      <View style={dateSepStyles.line} />
    </View>
  );
}

const dateSepStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    paddingHorizontal: 4,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: changeOpacity(theme.centerChannelColor, 0.2),
  },
  text: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    fontSize: 12,
    fontWeight: '600',
    marginHorizontal: 12,
  },
});

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
    borderBottomColor: changeOpacity(theme.centerChannelColor, 0.2),
  },
  headerPane: {
    paddingTop: 12,
  },
  backButton: {
    paddingRight: 12,
  },
  backText: {
    fontSize: 24,
    color: theme.sidebarText,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.sidebarHeaderTextColor,
  },
  headerPurpose: {
    fontSize: 12,
    color: changeOpacity(theme.sidebarHeaderTextColor, 0.7),
    marginTop: 2,
  },
  infoButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  infoIcon: {
    color: theme.sidebarHeaderTextColor,
    fontSize: 22,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
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
  systemMessage: {
    alignItems: 'center',
    paddingVertical: 6,
    marginVertical: 4,
  },
  systemText: {
    color: changeOpacity(theme.centerChannelColor, 0.5),
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  postRow: {
    flexDirection: 'row',
    marginBottom: 8,
    paddingVertical: 4,
  },
  postRowOwn: {
    justifyContent: 'flex-end',
  },
  postRowReply: {
    marginLeft: 20,
    marginBottom: 6,
    paddingVertical: 2,
  },
  replyRefBar: {
    marginBottom: 4,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: changeOpacity(theme.linkColor, 0.5),
  },
  replyRefText: {
    color: changeOpacity(theme.centerChannelColor, 0.5),
    fontSize: 11,
  },
  replyRefAuthor: {
    color: theme.linkColor,
    fontWeight: '600',
  },
  postContent: {
    flex: 1,
    marginLeft: 10,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  postContentOwn: {
    alignItems: 'flex-end',
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 3,
  },
  postUser: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.linkColor,
    marginRight: 8,
  },
  postTime: {
    fontSize: 10,
    color: changeOpacity(theme.centerChannelColor, 0.5),
  },
  editedFlag: {
    fontStyle: 'italic',
  },
  pinnedFlag: {
    fontWeight: '700',
  },
  markdownBody: {
    marginBottom: 2,
  },
  threadBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    backgroundColor: changeOpacity(theme.linkColor, 0.2),
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  threadBadgeText: {
    color: theme.linkColor,
    fontSize: 12,
    fontWeight: '600',
  },
  threadBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  threadPreview: {
    flexDirection: 'row',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: changeOpacity(theme.linkColor, 0.2),
  },
  threadPreviewUser: {
    color: theme.linkColor,
    fontSize: 12,
    fontWeight: '600',
    marginRight: 4,
  },
  threadPreviewMsg: {
    color: changeOpacity(theme.centerChannelColor, 0.7),
    fontSize: 12,
    flex: 1,
  },
  threadViewLink: {
    color: theme.linkColor,
    fontSize: 12,
    marginTop: 2,
    marginLeft: 8,
  },
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
    gap: 4,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: changeOpacity(theme.centerChannelColor, 0.12),
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginRight: 4,
    marginTop: 2,
  },
  reactionChipMine: {
    backgroundColor: changeOpacity(theme.linkColor, 0.3),
  },
  reactionEmoji: {
    fontSize: 14,
    marginRight: 4,
  },
  reactionCount: {
    color: changeOpacity(theme.centerChannelColor, 0.8),
    fontSize: 12,
    fontWeight: '600',
  },
  reactionCountMine: {
    color: theme.linkColor,
  },
  typingBar: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    backgroundColor: changeOpacity(theme.centerChannelBg, 0.9),
  },
  typingText: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    fontSize: 12,
    fontStyle: 'italic',
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: theme.sidebarHeaderBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: changeOpacity(theme.centerChannelColor, 0.2),
  },
  replyBannerText: {
    flex: 1,
    color: changeOpacity(theme.centerChannelColor, 0.6),
    fontSize: 12,
  },
  replyBannerContent: {
    color: changeOpacity(theme.centerChannelColor, 0.8),
  },
  replyBannerCancel: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    fontSize: 16,
    paddingHorizontal: 8,
  },
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
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendText: {
    color: theme.buttonColor,
    fontSize: 14,
    fontWeight: '600',
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
  emptyText: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    fontSize: 14,
  },
  // Modals
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  actionSheet: {
    backgroundColor: theme.sidebarHeaderBg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 34,
    paddingHorizontal: 16,
  },
  actionTitle: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    fontSize: 13,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: changeOpacity(theme.centerChannelColor, 0.2),
    marginBottom: 8,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  actionIcon: {
    fontSize: 20,
    width: 36,
  },
  actionLabel: {
    color: theme.sidebarHeaderTextColor,
    fontSize: 16,
  },
  actionDanger: {},
  actionLabelDanger: {
    color: theme.errorTextColor,
  },
  actionCancel: {
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: changeOpacity(theme.centerChannelColor, 0.2),
    marginTop: 8,
  },
  emojiPicker: {
    backgroundColor: theme.sidebarHeaderBg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 34,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  emojiPickerTitle: {
    color: changeOpacity(theme.centerChannelColor, 0.6),
    fontSize: 14,
    marginBottom: 12,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
  },
  emojiCell: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiCellText: {
    fontSize: 28,
  },
});

/**
 * Long messages are collapsed to a fixed height with a "Read more" toggle,
 * matching the mobile Mattermost behaviour. Collapsed by default when the raw
 * message exceeds the threshold; tapping expands the full content.
 */
const COLLAPSE_CHAR_LIMIT = 280;
const COLLAPSE_MAX_LINES = 8;
const COLLAPSED_HEIGHT = 220;

function CollapsibleMarkdown({
  message,
  expanded,
  onToggle,
}: {
  message: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Fold long messages: estimate from length + newlines (Markdown renders as
  // multiple Text blocks, so we can't rely on onTextLayout for total height).
  const chars = message.length;
  const lineBreaks = message.split('\n').length - 1;
  const isLong =
    chars > COLLAPSE_CHAR_LIMIT || lineBreaks >= COLLAPSE_MAX_LINES;

  if (!isLong) {
    return <Markdown text={message} style={styles.markdownBody} />;
  }

  return (
    <View style={collapsibleStyles.collapsibleWrap}>
      <View
        style={[
          collapsibleStyles.collapsibleBody,
          !expanded && collapsibleStyles.collapsibleBodyCollapsed,
        ]}>
        <Markdown text={message} style={styles.markdownBody} />
      </View>
      {!expanded && (
        <View style={collapsibleStyles.collapsibleFade} pointerEvents="none" />
      )}
      <TouchableOpacity
        onPress={onToggle}
        style={collapsibleStyles.collapsibleToggle}>
        <Text style={collapsibleStyles.collapsibleToggleText}>
          {expanded ? 'Show less' : 'Read more'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const collapsibleStyles = StyleSheet.create({
  collapsibleWrap: {
    marginBottom: 2,
  },
  collapsibleBody: {
    overflow: 'hidden',
  },
  collapsibleBodyCollapsed: {
    maxHeight: COLLAPSED_HEIGHT,
  },
  collapsibleFade: {
    height: 40,
    marginTop: -40,
    backgroundColor: 'transparent',
  },
  collapsibleToggle: {
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  collapsibleToggleText: {
    color: theme.linkColor,
    fontSize: 13,
    fontWeight: '600',
  },
});
