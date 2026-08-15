// Mattermost API v4 constants
export const API_VERSION = '/api/v4';

export const HEADER_AUTH = 'Authorization';
export const HEADER_BEARER = 'BEARER';
export const HEADER_X_CSRF_TOKEN = 'X-CSRF-Token';
export const HEADER_REQUESTED_WITH = 'X-Requested-With';
export const HEADER_ACCEPT_LANGUAGE = 'Accept-Language';

export const PER_PAGE_DEFAULT = 60;
export const DEFAULT_LIMIT_BEFORE = 30;
export const DEFAULT_LIMIT_AFTER = 30;

export const WEBSOCKET_PATH = '/api/v4/websocket';

// Login types
export type LoginType = 'email' | 'ldap' | 'saml' | 'gitlab' | 'google' | 'office365' | 'openid';

// Post types
export const POST_TYPES = {
  CHANNEL_DELETED: 'system_channel_deleted',
  EPHEMERAL: 'system_ephemeral',
} as const;
