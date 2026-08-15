/**
 * Mattermost REST API Client
 *
 * Pure-JS implementation using fetch() — compatible with RNOH/Hermes.
 * Provides the core API surface needed for login, channels, messaging.
 */
import {JSAPIClient} from '../compat/network-client';
import {
  API_VERSION,
  HEADER_AUTH,
  HEADER_BEARER,
  HEADER_X_CSRF_TOKEN,
  PER_PAGE_DEFAULT,
  WEBSOCKET_PATH,
} from './constants';
import type {
  Channel,
  ChannelMember,
  ChannelUnread,
  FileUploadResponse,
  GetChannelsParams,
  GetPostsParams,
  LoginResponse,
  NotifyProps,
  Post,
  PostList,
  Preference,
  Reaction,
  SearchPostsParams,
  SearchPostsResponse,
  ServerInfo,
  Team,
  ThreadInfo,
  ThreadsInboxResponse,
  ThreadUnreadResponse,
  UserProfile,
  UserStatus,
  WebSocketMessage,
} from './types';
import {cache} from './cache';
import * as notifications from './notifications';

export class MattermostClient {
  private http: JSAPIClient;
  private serverUrl: string;
  private token: string | null = null;
  private csrf: string | null = null;
  private userId: string | null = null;
  private teamId: string | null = null;
  private wsToken: string | null = null; // PAT for WebSocket auth (query param)
  private wsTokenUnavailable = false; // PAT disabled on server — avoid retrying

  // WebSocket
  private ws: WebSocket | null = null;
  private wsSeq = 1;
  private wsListeners: Map<string, Set<(msg: WebSocketMessage) => void>> = new Map();
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsUrl: string = '';

  constructor(serverUrl: string) {
    // Normalize URL: strip trailing slash
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.http = new JSAPIClient({
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json',
      },
    });
  }

  // ── URL Helpers ──

  private get urlVersion(): string {
    return `${this.serverUrl}${API_VERSION}`;
  }

  private usersRoute(): string {
    return `${this.urlVersion}/users`;
  }

  private userRoute(userId: string): string {
    return `${this.usersRoute()}/${userId}`;
  }

  private teamsRoute(): string {
    return `${this.urlVersion}/teams`;
  }

  private channelsRoute(): string {
    return `${this.urlVersion}/channels`;
  }

  private channelRoute(channelId: string): string {
    return `${this.channelsRoute()}/${channelId}`;
  }

  private postsRoute(): string {
    return `${this.urlVersion}/posts`;
  }

  private get authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers[HEADER_AUTH] = `${HEADER_BEARER} ${this.token}`;
    }
    if (this.csrf) {
      headers[HEADER_X_CSRF_TOKEN] = this.csrf;
    }
    return headers;
  }

  // ── Auth ──

  getServerUrl(): string {
    return this.serverUrl;
  }

  getToken(): string | null {
    return this.token;
  }

  getUserId(): string | null {
    return this.userId;
  }

  getTeamId(): string | null {
    return this.teamId;
  }

  setTeamId(teamId: string): void {
    this.teamId = teamId;
  }

  setToken(token: string): void {
    this.token = token;
    this.http.setToken(token);
  }

  setCSRF(csrf: string): void {
    this.csrf = csrf;
    this.http.setCSRF(csrf);
  }

  // ── Server ──

  async ping(): Promise<ServerInfo> {
    const url = `${this.urlVersion}/system/ping?get_server_status=true`;
    const res = await this.http.get(url);
    return res.data as ServerInfo;
  }

  async getRedirectLocation(url: string): Promise<string> {
    const res = await this.http.get(url);
    return (res.data as any)?.location || '';
  }

  // ── Auth / Login ──

  async login(loginId: string, password: string, deviceId?: string): Promise<UserProfile> {
    const body: Record<string, any> = {
      login_id: loginId,
      password,
    };
    if (deviceId) {
      body.device_id = deviceId;
    }

    const res = await this.http.post(`${this.usersRoute()}/login`, body);

    // Store token from response header
    const token = res.headers['token'] || res.headers['Token'];
    if (token) {
      this.token = token;
      this.http.setToken(token);
    }

    const user = res.data as UserProfile;
    this.userId = user.id;
    notifications.setCurrentUserId(user.id);
    return user;
  }

  async logout(): Promise<void> {
    try {
      await this.http.post(`${this.usersRoute()}/logout`, {}, this.authHeaders);
    } catch {
      // Best effort
    }
    this.token = null;
    this.csrf = null;
    this.userId = null;
    this.wsToken = null;
    notifications.setCurrentUserId(null);
    notifications.cancelAllNotifications();
    this.disconnectWebSocket();
  }

  /**
   * Create a Personal Access Token (PAT) for WebSocket authentication.
   * Mattermost servers reject session tokens in the ?access_token= query param,
   * but accept PATs. HarmonyOS WebSocket doesn't support custom headers,
   * so we must use a PAT for WS auth.
   */
  async createAccessToken(description: string): Promise<string> {
    const body = {description};
    const res = await this.http.post(
      `${this.userRoute('me')}/tokens`,
      body,
      this.authHeaders,
    );
    const data = res.data as any;
    const token = data?.token as string | undefined;
    console.log('[MattermostClient] createAccessToken response:', JSON.stringify(data));
    if (token) {
      this.wsToken = token;
    }
    return token || '';
  }

  /**
   * Get or create a PAT for WebSocket auth.
   * Tries to reuse an existing token first, creates one if none exists.
   */
  async ensureWsToken(): Promise<string> {
    if (this.wsToken) {
      return this.wsToken;
    }
    if (this.wsTokenUnavailable) {
      return ''; // PAT disabled on server; caller falls back to session token
    }
    // Create a new PAT
    const token = await this.createAccessToken('HarmonyOS WebSocket');
    if (!token) {
      this.wsTokenUnavailable = true;
    }
    return token;
  }

  // ── Users ──

  async getMe(): Promise<UserProfile> {
    const res = await this.http.get(
      `${this.userRoute('me')}`,
      this.authHeaders,
    );
    return res.data as UserProfile;
  }

  async getUser(userId: string): Promise<UserProfile> {
    const res = await this.http.get(
      this.userRoute(userId),
      this.authHeaders,
    );
    return res.data as UserProfile;
  }

  async getProfilesByIds(userIds: string[]): Promise<UserProfile[]> {
    const res = await this.http.post(
      `${this.usersRoute()}/ids`,
      userIds,
      this.authHeaders,
    );
    return res.data as UserProfile[];
  }

  async searchUsers(term: string, teamId?: string): Promise<UserProfile[]> {
    const body: Record<string, any> = {
      term,
      per_page: 50,
    };
    if (teamId) {
      body.team_id = teamId;
    }
    const url = teamId
      ? `${this.teamsRoute()}/${teamId}/users/search`
      : `${this.usersRoute()}/search`;
    const res = await this.http.post(url, body, this.authHeaders);
    return res.data as UserProfile[];
  }

  async searchUsersInTeam(term: string): Promise<UserProfile[]> {
    return this.searchUsers(term, this.teamId || undefined);
  }

  async getStatusesByIds(userIds: string[]): Promise<UserStatus[]> {
    const res = await this.http.post(
      `${this.usersRoute()}/status/ids`,
      userIds,
      this.authHeaders,
    );
    return res.data as UserStatus[];
  }

  // ── Teams ──

  async getTeams(): Promise<Team[]> {
    const res = await this.http.get(
      this.teamsRoute(),
      this.authHeaders,
    );
    return res.data as Team[];
  }

  async getTeam(teamId: string): Promise<Team> {
    const res = await this.http.get(
      `${this.teamsRoute()}/${teamId}`,
      this.authHeaders,
    );
    return res.data as Team;
  }

  // ── Channels ──

  async getChannelsForUser(
    userId: string,
    teamId: string,
    params?: GetChannelsParams,
  ): Promise<Channel[]> {
    const page = params?.page ?? 0;
    const perPage = params?.per_page ?? PER_PAGE_DEFAULT;
    const query = `?page=${page}&per_page=${perPage}`;
    const url = `${this.userRoute(userId)}/teams/${teamId}/channels${query}`;
    const res = await this.http.get(url, this.authHeaders);
    return res.data as Channel[];
  }

  async getChannel(channelId: string): Promise<Channel> {
    const res = await this.http.get(
      this.channelRoute(channelId),
      this.authHeaders,
    );
    return res.data as Channel;
  }

  async getChannelMember(
    channelId: string,
    userId: string,
  ): Promise<ChannelMember> {
    const url = `${this.channelRoute(channelId)}/members/${userId}`;
    const res = await this.http.get(url, this.authHeaders);
    return res.data as ChannelMember;
  }

  async getChannelMembers(channelId: string): Promise<ChannelMember[]> {
    const url = `${this.channelRoute(channelId)}/members`;
    const res = await this.http.get(url, this.authHeaders);
    return res.data as ChannelMember[];
  }

  async createDirectChannel(
    userId1: string,
    userId2: string,
  ): Promise<Channel> {
    const res = await this.http.post(
      `${this.channelsRoute()}/direct`,
      [userId1, userId2],
      this.authHeaders,
    );
    return res.data as Channel;
  }

  // ── Channel management ──

  /** Create a public (O) or private (P) channel. */
  async createChannel(params: {
    team_id: string;
    name: string;
    display_name: string;
    type: 'O' | 'P';
    purpose?: string;
    header?: string;
  }): Promise<Channel> {
    const res = await this.http.post(this.channelsRoute(), params, this.authHeaders);
    return res.data as Channel;
  }

  /** Update a channel (display name, purpose, header). */
  async updateChannel(
    channelId: string,
    updates: {display_name?: string; purpose?: string; header?: string},
  ): Promise<Channel> {
    const res = await this.http.put(
      `${this.channelsRoute()}/${channelId}`,
      updates,
      this.authHeaders,
    );
    return res.data as Channel;
  }

  /** Join a public channel as the current user. */
  async joinChannel(teamId: string, channelId: string): Promise<ChannelMember> {
    const body = {user_id: this.userId};
    const url = `${this.channelsRoute()}/${channelId}/members`;
    const res = await this.http.post(url, body, this.authHeaders);
    return res.data as ChannelMember;
  }

  /** Add a user to a channel (private channel invite). */
  async addChannelMember(channelId: string, userId: string): Promise<ChannelMember> {
    const body = {user_id: userId};
    const url = `${this.channelsRoute()}/${channelId}/members`;
    const res = await this.http.post(url, body, this.authHeaders);
    return res.data as ChannelMember;
  }

  /** Remove a user from a channel. */
  async removeChannelMember(channelId: string, userId: string): Promise<void> {
    const url = `${this.channelsRoute()}/${channelId}/members/${userId}`;
    await this.http.delete(url, this.authHeaders);
  }

  /** Update a channel member's notification preferences. */
  async updateChannelNotifyProps(
    channelId: string,
    notifyProps: Partial<NotifyProps>,
  ): Promise<ChannelMember> {
    const url = `${this.channelsRoute()}/${channelId}/members/${this.userId || 'me'}/notify_props`;
    const res = await this.http.put(url, notifyProps, this.authHeaders);
    return res.data as ChannelMember;
  }

  // ── Posts ──

  async getPostsForChannel(
    channelId: string,
    params?: GetPostsParams,
  ): Promise<PostList> {
    const page = params?.page ?? 0;
    const perPage = params?.per_page ?? PER_PAGE_DEFAULT;
    const queryParts = [`page=${page}`, `per_page=${perPage}`];
    if (params?.before) {
      queryParts.push(`before=${params.before}`);
    }
    if (params?.after) {
      queryParts.push(`after=${params.after}`);
    }
    const url = `${this.channelRoute(channelId)}/posts?${queryParts.join('&')}`;
    const res = await this.http.get(url, this.authHeaders);
    return res.data as PostList;
  }

  async getPost(postId: string): Promise<Post> {
    const res = await this.http.get(
      `${this.postsRoute()}/${postId}`,
      this.authHeaders,
    );
    return res.data as Post;
  }

  async createPost(post: {
    channel_id: string;
    message: string;
    root_id?: string;
    file_ids?: string[];
    props?: Record<string, any>;
    pending_post_id?: string;
  }): Promise<Post> {
    const res = await this.http.post(
      this.postsRoute(),
      post,
      this.authHeaders,
    );
    return res.data as Post;
  }

  async updatePost(postId: string, updates: {message: string}): Promise<Post> {
    const res = await this.http.put(
      `${this.postsRoute()}/${postId}`,
      updates,
      this.authHeaders,
    );
    return res.data as Post;
  }

  async deletePost(postId: string): Promise<void> {
    await this.http.delete(
      `${this.postsRoute()}/${postId}`,
      this.authHeaders,
    );
  }

  async getPostThread(postId: string): Promise<PostList> {
    const url = `${this.postsRoute()}/${postId}/thread?skipFetchThreads=false&collapsedThreads=true&collapsedThreadsExtended=false`;
    const res = await this.http.get(url, this.authHeaders);
    return res.data as PostList;
  }

  // ── Reactions ──

  async getReactions(postId: string): Promise<Reaction[]> {
    const url = `${this.postsRoute()}/${postId}/reactions`;
    const res = await this.http.get(url, this.authHeaders);
    return res.data as Reaction[];
  }

  async addReaction(postId: string, emojiName: string): Promise<Reaction> {
    const body = {
      user_id: this.userId,
      post_id: postId,
      emoji_name: emojiName,
    };
    const url = `${this.userRoute('me')}/posts/${postId}/reactions/${encodeURIComponent(emojiName)}`;
    const res = await this.http.post(url, body, this.authHeaders);
    return res.data as Reaction;
  }

  async removeReaction(postId: string, emojiName: string): Promise<void> {
    const url = `${this.userRoute('me')}/posts/${postId}/reactions/${encodeURIComponent(emojiName)}`;
    await this.http.delete(url, this.authHeaders);
  }

  // ── Pin / flags ──

  async pinPost(postId: string): Promise<void> {
    await this.http.post(`${this.postsRoute()}/${postId}/pin`, {}, this.authHeaders);
  }

  async unpinPost(postId: string): Promise<void> {
    await this.http.delete(`${this.postsRoute()}/${postId}/pin`, this.authHeaders);
  }

  // ── Search ──

  async searchPosts(
    teamId: string,
    params: SearchPostsParams,
  ): Promise<SearchPostsResponse> {
    const url = `${this.teamsRoute()}/${teamId}/posts/search`;
    const res = await this.http.post(url, params, this.authHeaders);
    return res.data as SearchPostsResponse;
  }

  // ── User status & typing ──

  async getStatus(userId: string): Promise<UserStatus> {
    const res = await this.http.get(
      `${this.userRoute(userId)}/status`,
      this.authHeaders,
    );
    return res.data as UserStatus;
  }

  async setStatus(userId: string, status: 'online' | 'away' | 'dnd' | 'offline'): Promise<void> {
    await this.http.put(
      `${this.userRoute(userId)}/status`,
      { user_id: userId, status },
      this.authHeaders,
    );
  }

  // ── Preferences ──

  async getPreferences(): Promise<Preference[]> {
    const res = await this.http.get(
      `${this.urlVersion}/preferences`,
      this.authHeaders,
    );
    return res.data as Preference[];
  }

  async savePreferences(prefs: Preference[]): Promise<void> {
    await this.http.put(
      `${this.urlVersion}/preferences`,
      prefs,
      this.authHeaders,
    );
  }

  // ── Threads ──

  async getThread(postId: string): Promise<ThreadInfo> {
    const url = `${this.postsRoute()}/${postId}/thread?skipFetchThreads=false`;
    const res = await this.http.get(url, this.authHeaders);
    return res.data as ThreadInfo;
  }

  /** Threads inbox for the current user in a team. */
  async getThreadsInbox(teamId: string): Promise<ThreadsInboxResponse> {
    // extended=true returns the root post for each thread (needed for previews).
    const url = `${this.userRoute('me')}/teams/${teamId}/threads?extended=true&per_page=50`;
    const res = await this.http.get(url, this.authHeaders);
    return res.data as ThreadsInboxResponse;
  }

  /** Unread thread counts for the current user. */
  async getThreadUnreadCount(): Promise<ThreadUnreadResponse> {
    const url = `${this.userRoute('me')}/threads/unread`;
    const res = await this.http.get(url, this.authHeaders);
    return res.data as ThreadUnreadResponse;
  }

  /** Mark a thread as read for the current user. */
  async markThreadRead(teamId: string, threadId: string): Promise<void> {
    const url = `${this.userRoute('me')}/teams/${teamId}/threads/${threadId}/read`;
    await this.http.put(url, {}, this.authHeaders);
  }

  /** Mark a thread as unread. */
  async markThreadUnread(teamId: string, threadId: string): Promise<void> {
    const url = `${this.userRoute('me')}/teams/${teamId}/threads/${threadId}/set_unread`;
    await this.http.post(url, {}, this.authHeaders);
  }

  /** Follow / unfollow a thread. */
  async setThreadFollowing(teamId: string, threadId: string, following: boolean): Promise<void> {
    const url = `${this.userRoute('me')}/teams/${teamId}/threads/${threadId}/following`;
    if (following) {
      await this.http.put(url, {}, this.authHeaders);
    } else {
      await this.http.delete(url, this.authHeaders);
    }
  }

  // ── Channel view / unread ──

  async getChannelUnread(channelId: string): Promise<ChannelUnread> {
    const url = `${this.userRoute('me')}/channels/${channelId}/unread`;
    const res = await this.http.get(url, this.authHeaders);
    return res.data as ChannelUnread;
  }

  async viewChannel(channelId: string, prevChannelId?: string): Promise<void> {
    const body: Record<string, any> = {
      channel_id: channelId,
    };
    if (prevChannelId) {
      body.prev_channel_id = prevChannelId;
    }
    await this.http.post(
      `${this.channelsRoute()}/members/me/view`,
      body,
      this.authHeaders,
    );
  }

  // ── Typing (over WebSocket) ──

  sendTypingEvent(channelId: string, parentId?: string): void {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) {
      return;
    }
    const msg = {
      action: 'user_typing',
      seq: this.wsSeq++,
      data: {
        channel_id: channelId,
        parent_id: parentId || '',
      },
    };
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      // best-effort
    }
  }

  // ── Files ──

  async getFileUrl(fileId: string): Promise<string> {
    return `${this.urlVersion}/files/${fileId}${this.token ? `?${HEADER_AUTH}=${HEADER_BEARER} ${this.token}` : ''}`;
  }

  async uploadFile(
    channelId: string,
    fileUri: string,
    fileName: string,
    mimeType: string,
  ): Promise<FileUploadResponse> {
    const formData = new FormData();
    formData.append('channel_id', channelId);
    formData.append('files', {
      uri: fileUri,
      name: fileName,
      type: mimeType,
    } as any);

    const url = `${this.urlVersion}/files`;
    const res = await this.http.post(url, formData, {
      ...this.authHeaders,
      'Content-Type': 'multipart/form-data',
    });
    return res.data as FileUploadResponse;
  }

  getProfileImageUrl(userId: string, lastUpdate: number = 0): string {
    // Plain URL — auth is passed via request headers (query-param auth is
    // rejected by Mattermost for session tokens).
    return `${this.userRoute(userId)}/image?_=${lastUpdate}`;
  }

  /** Auth headers to attach to image requests (avatars, files). */
  getImageRequestHeaders(): Record<string, string> {
    return this.token ? {Authorization: `Bearer ${this.token}`} : {};
  }

  // ── WebSocket ──

  async connectWebSocket(token?: string): Promise<void> {
    // Mattermost WS auth: prefer a PAT via ?access_token=, fall back to the
    // session token (also passed as MMAUTHTOKEN cookie). HarmonyOS WebSocket
    // ignores custom headers, so the cookie may not be sent — we try both.
    let wsAuthToken = token || this.wsToken;
    if (!wsAuthToken) {
      if (!this.token) {
        throw new Error('No auth token for WebSocket connection');
      }
      try {
        wsAuthToken = await this.ensureWsToken();
      } catch (err) {
        console.log('[MattermostClient] Failed to create PAT, using session token for WS');
        wsAuthToken = this.token;
      }
    }

    const baseUrl = this.serverUrl.replace(/^http/, 'ws');
    const wsUrl = `${baseUrl}${WEBSOCKET_PATH}?access_token=${encodeURIComponent(wsAuthToken || '')}`;
    console.log('[MattermostClient] WS URL:', wsUrl);

    if (this.ws) {
      this.disconnectWebSocket();
    }

    this.wsUrl = wsUrl;

    try {
      // Try passing cookie via WS options (HarmonyOS may ignore headers)
      this.ws = new WebSocket(wsUrl, undefined, {
        headers: {
          Cookie: `MMAUTHTOKEN=${this.token}`,
        },
      });

      this.ws.onopen = () => {
        console.log('[MattermostClient] WebSocket connected');
        // Send authentication_challenge as belt-and-suspenders
        const authMsg = {
          seq: this.wsSeq++,
          action: 'authentication_challenge',
          data: {token: this.token},
        };
        try {
          this.ws!.send(JSON.stringify(authMsg));
        } catch {
          // best-effort
        }
      };

      this.ws.onmessage = (event: WebSocketMessageEvent) => {
        try {
          const msg: WebSocketMessage = JSON.parse(
            typeof event.data === 'string' ? event.data : '',
          );
          this.handleWsMessage(msg);
        } catch {
          // Ignore parse errors
        }
      };

      this.ws.onclose = () => {
        console.log('[MattermostClient] WebSocket disconnected');
        this.ws = null;
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        console.log('[MattermostClient] WebSocket error');
      };
    } catch (error) {
      console.error('[MattermostClient] WebSocket connection failed:', error);
      this.scheduleReconnect();
    }
  }

  disconnectWebSocket(): void {
    this.clearReconnect();
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }
  }

  onWsEvent(
    eventType: string,
    handler: (msg: WebSocketMessage) => void,
  ): () => void {
    if (!this.wsListeners.has(eventType)) {
      this.wsListeners.set(eventType, new Set());
    }
    this.wsListeners.get(eventType)!.add(handler);
    return () => {
      this.wsListeners.get(eventType)?.delete(handler);
    };
  }

  private handleWsMessage(msg: WebSocketMessage): void {
    // Global notification handling for new messages (Mattermost-aligned):
    // notify when a message arrives in a channel that isn't currently open.
    if (msg.event === 'posted') {
      try {
        const postData = JSON.parse(msg.data?.post || '{}');
        console.log('[MattermostClient] WS posted received, channel:', postData?.channel_id, 'shouldNotify:', notifications.shouldNotify(postData as Post));
        if (postData && postData.channel_id && !notifications.shouldNotify(postData as Post)) {
          // Not eligible for a notification (e.g. current channel / own msg).
        } else if (postData && postData.channel_id) {
          // Fetch sender profile (may be cached) then show notification.
          const senderId = postData.user_id;
          if (senderId && senderId !== this.userId) {
            const cachedSender = cache.getUser(senderId);
            if (cachedSender) {
              notifications.showMessageNotification(postData as Post, cachedSender);
            } else {
              this.getUser(senderId)
                .then((u) => {
                  cache.setUser(u);
                  notifications.showMessageNotification(postData as Post, u);
                })
                .catch(() => {
                  notifications.showMessageNotification(postData as Post, null);
                });
            }
          }
        }
      } catch {
        // ignore notification errors
      }
    }

    const listeners = this.wsListeners.get(msg.event);
    if (listeners) {
      for (const handler of listeners) {
        try {
          handler(msg);
        } catch (error) {
          console.error('[MattermostClient] WS handler error:', error);
        }
      }
    }

    // Default handler for all events
    const allListeners = this.wsListeners.get('*');
    if (allListeners) {
      for (const handler of allListeners) {
        try {
          handler(msg);
        } catch {
          // ignore
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.wsReconnectTimer) {
      return;
    }
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      if (!this.ws && this.token) {
        console.log('[MattermostClient] Reconnecting WebSocket...');
        this.connectWebSocket().catch(() => {});
      }
    }, 5000);
  }

  private clearReconnect(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
  }
}

// Singleton instance holder
let clientInstance: MattermostClient | null = null;

export function getClient(): MattermostClient | null {
  return clientInstance;
}

export function createClient(serverUrl: string): MattermostClient {
  clientInstance = new MattermostClient(serverUrl);
  return clientInstance;
}

export function destroyClient(): void {
  if (clientInstance) {
    clientInstance.disconnectWebSocket();
    clientInstance = null;
  }
}
