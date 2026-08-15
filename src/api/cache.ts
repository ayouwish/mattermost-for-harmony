/**
 * Local cache layer for Mattermost data.
 *
 * Reduces API calls by caching:
 * - User profiles (by ID)
 * - Channels (by team + channel ID)
 * - Posts (by channel ID)
 * - Team list
 *
 * Cache is in-memory (persisted for the app session). Data is fetched once
 * and reused across screen switches. A global version counter allows
 * invalidation.
 */
import type {Channel, ChannelMember, Post, PostList, Team, ThreadsInboxResponse, UserProfile} from '../api/types';
import {persistentStorage} from './persistent-storage';

/**
 * A fully-resolved channel for display (includes unread counts, DM user names).
 * This is the "view model" that ChannelListScreen renders directly.
 */
export interface DisplayChannelData {
  channel: Channel;
  unreadCount: number;
  mentionCount: number;
  displayName: string;
  otherUserId?: string; // DM other user ID
}

interface ChannelCache {
  channels: Channel[];
  posts: PostList | null;
  loadedAt: number;
}

class AppCache {
  // User profiles: { userId: { profile, loadedAt } }
  private users = new Map<string, {profile: UserProfile; loadedAt: number}>();
  // Channels + posts per team: { teamId: { channelId: ChannelCache } }
  private channelsByTeam = new Map<string, Map<string, ChannelCache>>();
  // Team list per server
  private teams: Team[] | null = null;
  private teamsLoadedAt = 0;
  // Display channels (fully resolved with unread + DM names) per team
  private displayChannelsByTeam = new Map<string, {data: DisplayChannelData[]; loadedAt: number}>();
  // Threads inbox per team
  private threadsByTeam = new Map<string, {data: ThreadsInboxResponse; loadedAt: number}>();
  // Thread replies: root thread post id -> PostList
  private threadPosts = new Map<string, {data: PostList; loadedAt: number}>();
  // Channel info page data (members + pinned) per channel id
  private channelInfoByChannel = new Map<
    string,
    {members: ChannelMember[]; pinned: Post[]; loadedAt: number}
  >();

  private readonly TTL = 30 * 60 * 1000; // 30 minutes — stale-but-usable cache shown instantly, refreshed in background

  // ── Persistence ──
  private static readonly PERSIST_PREFIX = 'mmcache:';
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistKeys = new Set<string>();

  /** Schedule a persistence write (debounced) for the given logical key. */
  private schedulePersist(key: string): void {
    this.persistKeys.add(key);
    // Batch all writes into a single flush shortly after the last change.
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const keys = Array.from(this.persistKeys);
      this.persistKeys.clear();
      this.persistNow(keys);
    }, 1500);
  }

  private persistNow(keys: string[]): void {
    for (const key of keys) {
      try {
        if (key === 'teams') {
          persistentStorage.setJSON(AppCache.PERSIST_PREFIX + 'teams', this.teams);
        } else if (key === 'users') {
          const usersToSave: Array<{profile: UserProfile; loadedAt: number}> = [];
          this.users.forEach((v) => usersToSave.push(v));
          persistentStorage.setJSON(AppCache.PERSIST_PREFIX + 'users', usersToSave);
        } else if (key.startsWith('display:')) {
          const teamId = key.slice('display:'.length);
          const entry = this.displayChannelsByTeam.get(teamId);
          if (entry) {
            persistentStorage.setJSON(AppCache.PERSIST_PREFIX + 'display:' + teamId, {
              data: entry.data,
              loadedAt: entry.loadedAt,
            });
          }
        } else if (key.startsWith('posts:')) {
          const channelId = key.slice('posts:'.length);
          const postList = this.findPostsByChannelId(channelId);
          if (postList) {
            persistentStorage.setJSON(AppCache.PERSIST_PREFIX + 'posts:' + channelId, postList);
          }
        } else if (key.startsWith('threads:')) {
          const teamId = key.slice('threads:'.length);
          const entry = this.threadsByTeam.get(teamId);
          if (entry) {
            persistentStorage.setJSON(AppCache.PERSIST_PREFIX + 'threads:' + teamId, {
              data: entry.data,
              loadedAt: entry.loadedAt,
            });
          }
        } else if (key.startsWith('thread:')) {
          const rootId = key.slice('thread:'.length);
          const entry = this.threadPosts.get(rootId);
          if (entry) {
            persistentStorage.setJSON(AppCache.PERSIST_PREFIX + 'thread:' + rootId, entry.data);
          }
        } else if (key.startsWith('chaninfo:')) {
          const channelId = key.slice('chaninfo:'.length);
          const entry = this.channelInfoByChannel.get(channelId);
          if (entry) {
            persistentStorage.setJSON(AppCache.PERSIST_PREFIX + 'chaninfo:' + channelId, {
              members: entry.members,
              pinned: entry.pinned,
              loadedAt: entry.loadedAt,
            });
          }
        }
      } catch {
        // ignore persistence errors
      }
    }
  }

  private findPostsByChannelId(channelId: string): PostList | null {
    for (const [, teamMap] of this.channelsByTeam) {
      const cache = teamMap.get(channelId);
      if (cache?.posts) return cache.posts;
    }
    return null;
  }

  /**
   * Restore cached data from persistent storage (call once at app startup,
   * after the native TurboModule is available).
   */
  async restoreFromPersistent(): Promise<void> {
    try {
      const p = AppCache.PERSIST_PREFIX;

      const teams = await persistentStorage.getJSON<Team[]>(p + 'teams');
      if (teams && teams.length > 0) {
        this.teams = teams;
        this.teamsLoadedAt = Date.now();
      }

      const users = await persistentStorage.getJSON<Array<{profile: UserProfile; loadedAt: number}>>(p + 'users');
      if (users) {
        const now = Date.now();
        for (const u of users) {
          if (u?.profile?.id) {
            this.users.set(u.profile.id, {profile: u.profile, loadedAt: now});
          }
        }
      }

      // Restore display channels + posts (scan known keys via getAllKeys)
      const allKeys = await persistentStorage.getAllKeys();
      for (const key of allKeys) {
        if (key.startsWith(p + 'display:')) {
          const teamId = key.slice((p + 'display:').length);
          const val = await persistentStorage.getJSON<{data: DisplayChannelData[]; loadedAt: number}>(key);
          if (val?.data) {
            this.displayChannelsByTeam.set(teamId, {data: val.data, loadedAt: Date.now()});
          }
        } else if (key.startsWith(p + 'posts:')) {
          const channelId = key.slice((p + 'posts:').length);
          const postList = await persistentStorage.getJSON<PostList>(key);
          if (postList?.posts) {
            this.setPosts('', channelId, postList);
          }
        } else if (key.startsWith(p + 'threads:')) {
          const teamId = key.slice((p + 'threads:').length);
          const val = await persistentStorage.getJSON<{data: ThreadsInboxResponse; loadedAt: number}>(key);
          if (val?.data) {
            this.threadsByTeam.set(teamId, {data: val.data, loadedAt: Date.now()});
          }
        } else if (key.startsWith(p + 'chaninfo:')) {
          const channelId = key.slice((p + 'chaninfo:').length);
          const val = await persistentStorage.getJSON<{members: ChannelMember[]; pinned: Post[]; loadedAt: number}>(key);
          if (val?.members) {
            this.channelInfoByChannel.set(channelId, {
              members: val.members,
              pinned: val.pinned ?? [],
              loadedAt: Date.now(),
            });
          }
        }
      }
    } catch {
      // ignore restore errors
    }
  }

  /** Persist everything currently in memory (used on logout/invalidation). */
  persistAll(): void {
    this.schedulePersist('teams');
    this.schedulePersist('users');
    this.displayChannelsByTeam.forEach((_, teamId) => this.schedulePersist('display:' + teamId));
    for (const [, teamMap] of this.channelsByTeam) {
      for (const channelId of teamMap.keys()) {
        this.schedulePersist('posts:' + channelId);
      }
    }
  }

  // ── Users ──
  getUser(userId: string): UserProfile | null {
    const entry = this.users.get(userId);
    if (!entry) return null;
    if (Date.now() - entry.loadedAt > this.TTL) {
      this.users.delete(userId);
      return null;
    }
    return entry.profile;
  }

  setUser(profile: UserProfile): void {
    this.users.set(profile.id, {profile, loadedAt: Date.now()});
    // Individual user writes are frequent; persist only via batch setUsers or persistAll.
  }

  setUsers(profiles: UserProfile[]): void {
    const now = Date.now();
    for (const p of profiles) {
      this.users.set(p.id, {profile: p, loadedAt: now});
    }
    this.schedulePersist('users');
  }

  getUsersByIds(userIds: string[]): UserProfile[] {
    const result: UserProfile[] = [];
    for (const id of userIds) {
      const u = this.getUser(id);
      if (u) result.push(u);
    }
    return result;
  }

  getMissingUserIds(userIds: string[]): string[] {
    return userIds.filter((id) => !this.getUser(id));
  }

  // ── Teams ──
  getTeams(): Team[] | null {
    if (this.teams && Date.now() - this.teamsLoadedAt < this.TTL) {
      return this.teams;
    }
    return null;
  }

  setTeams(teams: Team[]): void {
    this.teams = teams;
    this.teamsLoadedAt = Date.now();
    this.schedulePersist('teams');
  }

  // ── Channels ──
  getChannels(teamId: string): Channel[] | null {
    const teamMap = this.channelsByTeam.get(teamId);
    if (!teamMap) return null;
    // Reconstruct channel list from cache
    const channels: Channel[] = [];
    let oldest = Date.now();
    for (const [, cache] of teamMap) {
      channels.push(cache.channels[0]); // first entry is the channel itself
      if (cache.loadedAt < oldest) oldest = cache.loadedAt;
    }
    if (Date.now() - oldest > this.TTL) {
      return null; // expired
    }
    return channels;
  }

  setChannels(teamId: string, channels: Channel[]): void {
    const teamMap = this.channelsByTeam.get(teamId) || new Map<string, ChannelCache>();
    const now = Date.now();
    for (const ch of channels) {
      const existing = teamMap.get(ch.id);
      teamMap.set(ch.id, {
        channels: [ch],
        posts: existing?.posts || null,
        loadedAt: now,
      });
    }
    this.channelsByTeam.set(teamId, teamMap);
  }

  getChannel(teamId: string, channelId: string): Channel | null {
    const teamMap = this.channelsByTeam.get(teamId);
    if (!teamMap) return null;
    const cache = teamMap.get(channelId);
    if (!cache) return null;
    return cache.channels[0] || null;
  }

  // ── Posts ──
  getPosts(teamId: string, channelId: string): PostList | null {
    const teamMap = this.channelsByTeam.get(teamId);
    if (teamMap) {
      const cache = teamMap.get(channelId);
      if (cache?.posts) {
        if (Date.now() - cache.loadedAt > this.TTL) return null;
        return cache.posts;
      }
    }
    // Fallback: search all teams (for posts restored with teamId='')
    return this.findPostsByChannelId(channelId);
  }

  setPosts(teamId: string, channelId: string, posts: PostList): void {
    const teamMap = this.channelsByTeam.get(teamId) || new Map<string, ChannelCache>();
    const existing = teamMap.get(channelId);
    teamMap.set(channelId, {
      channels: existing?.channels || [],
      posts,
      loadedAt: Date.now(),
    });
    this.channelsByTeam.set(teamId, teamMap);
    this.schedulePersist('posts:' + channelId);
  }

  addPostToCache(teamId: string, channelId: string, post: Post): void {
    const teamMap = this.channelsByTeam.get(teamId);
    if (!teamMap) return;
    const cache = teamMap.get(channelId);
    if (!cache || !cache.posts) return;
    cache.posts.posts[post.id] = post;
    if (!cache.posts.order.includes(post.id)) {
      cache.posts.order.unshift(post.id);
    }
    // Keep only the most recent 200 posts per channel to bound memory.
    if (cache.posts.order.length > 200) {
      const overflow = cache.posts.order.slice(200);
      cache.posts.order = cache.posts.order.slice(0, 200);
      for (const id of overflow) {
        delete cache.posts.posts[id];
      }
    }
    this.schedulePersist('posts:' + channelId);
  }

  updatePostInCache(teamId: string, channelId: string, post: Post): void {
    this.addPostToCache(teamId, channelId, post);
  }

  deletePostFromCache(teamId: string, channelId: string, postId: string): void {
    const teamMap = this.channelsByTeam.get(teamId);
    if (!teamMap) return;
    const cache = teamMap.get(channelId);
    if (!cache || !cache.posts) return;
    delete cache.posts.posts[postId];
    cache.posts.order = cache.posts.order.filter((id) => id !== postId);
  }

  // ── Display Channels (fully resolved view models) ──

  getDisplayChannels(teamId: string): DisplayChannelData[] | null {
    const entry = this.displayChannelsByTeam.get(teamId);
    if (!entry) return null;
    // Return stale data too — the UI shows it instantly and refreshes in the
    // background. Expiry is handled by the caller via getDisplayChannelsAge.
    return entry.data;
  }

  /** Milliseconds since the display channels were last fetched (-1 if none). */
  getDisplayChannelsAge(teamId: string): number {
    const entry = this.displayChannelsByTeam.get(teamId);
    if (!entry) return -1;
    return Date.now() - entry.loadedAt;
  }

  setDisplayChannels(teamId: string, data: DisplayChannelData[]): void {
    this.displayChannelsByTeam.set(teamId, {data, loadedAt: Date.now()});
    this.schedulePersist('display:' + teamId);
  }

  // ── Threads Inbox ──

  getThreadsInbox(teamId: string): ThreadsInboxResponse | null {
    const entry = this.threadsByTeam.get(teamId);
    if (!entry) return null;
    return entry.data;
  }

  setThreadsInbox(teamId: string, data: ThreadsInboxResponse): void {
    this.threadsByTeam.set(teamId, {data, loadedAt: Date.now()});
    this.schedulePersist('threads:' + teamId);
  }

  getThreadPosts(rootId: string): PostList | null {
    const entry = this.threadPosts.get(rootId);
    if (!entry) return null;
    return entry.data;
  }

  setThreadPosts(rootId: string, data: PostList): void {
    // Cap stored posts per thread to keep memory bounded.
    const ids = Array.isArray(data.order) ? data.order : Object.keys(data.posts);
    if (ids.length > 200) {
      const keep = ids.slice(0, 200);
      const trimmed: PostList = {order: keep, posts: {}, has_next: data.has_next, next_post_id: data.next_post_id, prev_post_id: data.prev_post_id};
      for (const id of keep) {
        const p = data.posts[id];
        if (p) trimmed.posts[id] = p;
      }
      this.threadPosts.set(rootId, {data: trimmed, loadedAt: Date.now()});
    } else {
      this.threadPosts.set(rootId, {data, loadedAt: Date.now()});
    }
    this.schedulePersist('thread:' + rootId);
  }

  /**
   * Cached channel info (members + pinned posts) used by ChannelInfoScreen.
   * Shown instantly when fresh; otherwise stale data is displayed while a
   * background refresh runs.
   */
  getChannelInfo(channelId: string): {members: ChannelMember[]; pinned: Post[]; loadedAt: number} | null {
    const entry = this.channelInfoByChannel.get(channelId);
    return entry ?? null;
  }

  setChannelInfo(channelId: string, members: ChannelMember[], pinned: Post[]): void {
    this.channelInfoByChannel.set(channelId, {members, pinned, loadedAt: Date.now()});
    this.schedulePersist('chaninfo:' + channelId);
  }

  isChannelInfoFresh(channelId: string): boolean {
    const entry = this.channelInfoByChannel.get(channelId);
    return !!entry && Date.now() - entry.loadedAt < this.TTL;
  }

  /**
   * Incrementally update unread counts without rebuilding the whole list.
   * Called when WS 'posted' event arrives.
   */
  incrementUnread(teamId: string, channelId: string, mentionCount: number = 0): void {
    const entry = this.displayChannelsByTeam.get(teamId);
    if (!entry) return;
    const dc = entry.data.find((d) => d.channel.id === channelId);
    if (dc) {
      dc.unreadCount++;
      dc.mentionCount += mentionCount;
    }
  }

  /**
   * Reset unread for a channel (when user views it).
   */
  clearUnread(teamId: string, channelId: string): void {
    const entry = this.displayChannelsByTeam.get(teamId);
    if (!entry) return;
    const dc = entry.data.find((d) => d.channel.id === channelId);
    if (dc) {
      dc.unreadCount = 0;
      dc.mentionCount = 0;
    }
  }

  // ── Invalidation ──
  invalidateChannel(teamId: string, channelId: string): void {
    const teamMap = this.channelsByTeam.get(teamId);
    if (!teamMap) return;
    const cache = teamMap.get(channelId);
    if (cache) {
      cache.loadedAt = 0; // force refresh
    }
  }

  invalidateAll(): void {
    this.users.clear();
    this.channelsByTeam.clear();
    this.displayChannelsByTeam.clear();
    this.teams = null;
    this.teamsLoadedAt = 0;
    // Clear persisted cache
    const p = AppCache.PERSIST_PREFIX;
    persistentStorage.delete(p + 'teams');
    persistentStorage.delete(p + 'users');
    persistentStorage.getAllKeys().then((keys) => {
      for (const key of keys) {
        if (key.startsWith(p)) {
          persistentStorage.delete(key);
        }
      }
    });
  }

  // For debugging
  stats(): {users: number; teams: number; channels: number} {
    let channelCount = 0;
    for (const [, teamMap] of this.channelsByTeam) {
      channelCount += teamMap.size;
    }
    return {
      users: this.users.size,
      teams: this.teams?.length || 0,
      channels: channelCount,
    };
  }
}

export const cache = new AppCache();
export default cache;
