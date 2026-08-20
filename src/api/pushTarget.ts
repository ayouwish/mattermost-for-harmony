/**
 * Push deep-link target bridge.
 *
 * The native side stores the channel_id/post_id/root_id of the most recently
 * received push; tapping that notification should open the channel and locate
 * the message. This reads (and consumes) the target via the Push TurboModule.
 */
import {TurboModuleRegistry} from 'react-native';

export interface PushTarget {
  channelId: string;
  postId: string;
  rootId: string;
}

let nativeModule: any = null;
let resolved = false;

function getModule(): any {
  if (!resolved) {
    resolved = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nativeModule = TurboModuleRegistry.get<any>('Push') || null;
    } catch {
      nativeModule = null;
    }
  }
  return nativeModule;
}

/**
 * Returns and clears the pending push deep-link target, or null.
 */
export async function consumePushTarget(): Promise<PushTarget | null> {
  const mod = getModule();
  if (!mod) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: string = await mod.consumePushTarget();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {channelId?: string; postId?: string; rootId?: string};
    if (!parsed.channelId || !parsed.postId) return null;
    return {
      channelId: parsed.channelId,
      postId: parsed.postId,
      rootId: parsed.rootId || '',
    };
  } catch {
    return null;
  }
}

export default {
  consumePushTarget,
};