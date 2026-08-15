/**
 * Notifications service — bridges to ArkTS NotificationsTurboModule.
 *
 * Matches Mattermost native behavior: when a message arrives in a channel
 * that is NOT currently being viewed (and isn't the current user's own
 * message), show a system notification with the sender + message text.
 */
import {TurboModuleRegistry} from 'react-native';
import type {Post, UserProfile} from './types';

let nativeModule: any = null;
let initAttempted = false;

function getNativeModule(): any {
  if (initAttempted) return nativeModule;
  initAttempted = true;
  try {
    nativeModule = TurboModuleRegistry.get('Notifications');
    if (nativeModule) {
      console.log('[Notifications] Got module via TurboModuleRegistry');
      return nativeModule;
    }
  } catch (e) {
    console.log('[Notifications] TurboModuleRegistry.get failed:', e);
  }
  console.log('[Notifications] Module NOT FOUND — notifications disabled');
  nativeModule = null;
  return nativeModule;
}

/**
 * Tracks which channel is currently being viewed so we don't notify for it.
 */
let activeChannelId: string | null = null;
let currentUserId: string | null = null;

export function setActiveChannel(channelId: string | null): void {
  activeChannelId = channelId;
}

export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId;
}

export function getActiveChannelId(): string | null {
  return activeChannelId;
}

/**
 * Should we show a notification for this incoming post?
 * Mirrors Mattermost: notify only for messages in channels the user is not
 * currently viewing, and not for the user's own messages.
 */
export function shouldNotify(post: Post): boolean {
  if (!post || !post.channel_id) return false;
  // Own messages are never notified (they're already on screen).
  if (currentUserId && post.user_id === currentUserId) return false;
  // No notification for the channel currently open.
  if (activeChannelId && post.channel_id === activeChannelId) return false;
  // Don't notify for system/join/leave messages.
  if (post.type && post.type.startsWith('system_')) return false;
  // Notify only for real messages (ignore ephemeral).
  if (post.type === 'system_ephemeral') return false;
  return true;
}

let lastNotificationId = 1;

/**
 * Request notification permission (shows the system authorization dialog on
 * first call). Call once after login.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const mod = getNativeModule();
  if (!mod) return false;
  try {
    const enabled = await mod.isEnabled();
    if (enabled) return true;
    return await mod.requestPermission();
  } catch {
    return false;
  }
}

/**
 * Show a local notification for an incoming message.
 * @param post     the incoming post
 * @param sender   resolved sender profile (for username / avatar)
 */
export async function showMessageNotification(
  post: Post,
  sender?: UserProfile | null,
): Promise<void> {
  const mod = getNativeModule();
  if (!mod || !shouldNotify(post)) return;

  const title = sender?.username || 'New message';
  const body = post.message || '';
  if (!body) return;

  // If notifications are disabled, request the permission once (system dialog).
  try {
    const enabled = await mod.isEnabled();
    if (!enabled) {
      await mod.requestPermission();
    }
  } catch {
    // ignore
  }

  const id = lastNotificationId++ % 1000;
  try {
    await mod.notify(title, body, id);
  } catch {
    // ignore
  }
}

/**
 * Clear all notifications (e.g. on logout).
 */
export async function cancelAllNotifications(): Promise<void> {
  const mod = getNativeModule();
  if (!mod) return;
  try {
    await mod.cancelAll();
  } catch {
    // ignore
  }
}

export default {
  setActiveChannel,
  setCurrentUserId,
  shouldNotify,
  requestNotificationPermission,
  showMessageNotification,
  cancelAllNotifications,
};
