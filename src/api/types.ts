// ── Mattermost API Types ──

export interface UserProfile {
  id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  username: string;
  auth_service: string;
  email: string;
  nickname: string;
  first_name: string;
  last_name: string;
  position: string;
  roles: string;
  locale: string;
  timezone?: {
    useAutomaticTimezone: string;
    automaticTimezone: string;
    manualTimezone: string;
  };
  last_picture_update: number;
  // Present on bot accounts (optional — not always in the payload).
  is_bot?: boolean;
}

export interface Team {
  id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  display_name: string;
  name: string;
  description: string;
  email: string;
  type: 'O' | 'I';
  allowed_domains: string;
  invite_id: string;
  allow_open_invite: boolean;
  last_team_icon_update: number;
}

export interface Channel {
  id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  team_id: string;
  type: 'O' | 'P' | 'D' | 'G';
  display_name: string;
  name: string;
  header: string;
  purpose: string;
  creator_id: string;
  last_post_at: number;
  total_msg_count: number;
  extra_update_at: number;
}

export interface ChannelMember {
  channel_id: string;
  user_id: string;
  roles: string;
  last_viewed_at: number;
  msg_count: number;
  mention_count: number;
  notify_props: NotifyProps;
}

export interface NotifyProps {
  desktop: string;
  desktop_sound: string;
  email: string;
  mobile: string;
  mobile_push_status: string;
  channel: string;
  comments: string;
  push: string;
  push_status: string;
}

export interface Post {
  id: string;
  create_at: number;
  update_at: number;
  edit_at: number;
  delete_at: number;
  is_pinned: boolean;
  user_id: string;
  channel_id: string;
  root_id: string;
  original_id: string;
  message: string;
  type: string;
  props: Record<string, any>;
  hashtags: string;
  pending_post_id: string;
  reply_count: number;
  metadata?: {
    embeds?: PostEmbed[];
    emojis?: any[];
    files?: FileInfo[];
    images?: Record<string, any>;
    reactions?: Reaction[];
  };
}

/** OpenGraph / permalink / message-attachment preview data attached to a post. */
export interface PostEmbed {
  type: string;
  url: string;
  data?: {
    url?: string;
    title?: string;
    description?: string;
    site_name?: string;
    image_url?: string;
    // permalink embeds
    post_id?: string;
    team_id?: string;
    channel_id?: string;
    channel_display_name?: string;
    channel_name?: string;
    channel_type?: string;
    post_created_by?: string;
    post_create_at?: number;
    // message_attachment embeds
    text?: string;
    fallback?: string;
    message?: string;
  };
}

export interface FileInfo {
  id: string;
  user_id: string;
  post_id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  name: string;
  extension: string;
  size: number;
  mime_type: string;
  width: number;
  height: number;
  has_preview_image: boolean;
}

export interface Reaction {
  user_id: string;
  post_id: string;
  emoji_name: string;
  create_at: number;
}

export interface PostList {
  order: string[];
  posts: Record<string, Post>;
  next_post_id: string;
  prev_post_id: string;
  has_next: boolean;
}

export interface UserStatus {
  user_id: string;
  status: 'online' | 'offline' | 'away' | 'dnd';
  manual: boolean;
  last_activity_at: number;
}

export interface Session {
  id: string;
  create_at: number;
  expires_at: number;
  last_activity_at: number;
  user_id: string;
  device_id: string;
  roles: string;
  is_oauth: boolean;
  props: Record<string, any>;
}

export interface LoginResponse {
  id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  username: string;
  auth_service: string;
  email: string;
  // ... extends UserProfile but with fewer fields
  [key: string]: any;
}

export interface ServerInfo {
  version: string;
  build_number: string;
  build_date: string;
  build_hash: string;
  build_hash_enterprise: string;
}

export interface WebSocketMessage {
  event: string;
  data: Record<string, any>;
  broadcast: {
    omit_users: Record<string, boolean>;
    user_id: string;
    channel_id: string;
    team_id: string;
  };
  seq: number;
}

// WebSocket event types
export enum WebSocketEvents {
  POSTED = 'posted',
  POST_EDITED = 'post_edited',
  POST_DELETED = 'post_deleted',
  CHANNEL_CREATED = 'channel_created',
  CHANNEL_DELETED = 'channel_deleted',
  CHANNEL_UPDATED = 'channel_updated',
  CHANNEL_VIEWED = 'channel_viewed',
  USER_ADDED = 'user_added',
  USER_REMOVED = 'user_removed',
  STATUS_CHANGE = 'status_change',
  TYPING = 'typing',
  HELLO = 'hello',
  REACTION_ADDED = 'reaction_added',
  REACTION_REMOVED = 'reaction_removed',
  EPHEMERAL_MESSAGE = 'ephemeral_message',
  PREFERENCE_CHANGED = 'preference_changed',
  CHANNEL_MEMBER_UPDATED = 'channel_member_updated',
}

export interface GetPostsParams {
  page?: number;
  per_page?: number;
  since?: number;
  before?: string;
  after?: string;
}

export interface GetChannelsParams {
  page?: number;
  per_page?: number;
  exclude_default_channels?: boolean;
}

// ── Extended types for core features ──

export interface TeamMembership {
  team_id: string;
  user_id: string;
  roles: string;
  delete_at: number;
  scheme_user: boolean;
  scheme_admin: boolean;
  scheme_guest: boolean;
  explicit_teams: string[];
}

export interface SearchPostsParams {
  terms: string;
  is_or_search?: boolean;
  page?: number;
  per_page?: number;
}

export interface SearchPostsResponse {
  order: string[];
  posts: Record<string, Post>;
}

export interface TypingEvent {
  channel_id: string;
  user_id: string;
  display_name?: string;
  parent_id?: string;
}

export interface Preference {
  user_id: string;
  category: string;
  name: string;
  value: string;
}

export interface FileUploadResponse {
  file_infos: FileInfo[];
  client_ids: string[];
}

export interface ThreadInfo {
  id: string;
  reply_count: number;
  last_reply_at: number;
  participants: Array<{ id: string; username: string }>;
  unread_replies?: number;
  unread_mentions?: number;
}

/** A thread entry in the threads inbox. */
export interface ThreadInboxItem {
  id: string; // thread root post id
  last_reply_at: number;
  last_view_at: number;
  reply_count: number;
  unread_replies: number;
  unread_mentions: number;
  is_following: boolean;
  participants?: Array<{ id: string; username: string }>;
  post?: Post; // root post
}

export interface ThreadsInboxResponse {
  threads: ThreadInboxItem[];
  total: number;
  total_unread_threads: number;
  total_unread_mentions: number;
}

export interface ThreadUnreadResponse {
  total: number;
  total_unread_threads: number;
  total_unread_mentions: number;
}

export interface ChannelUnread {
  team_id: string;
  channel_id: string;
  msg_count: number;
  mention_count: number;
  unread_count: number;
  owner?: boolean;
}
