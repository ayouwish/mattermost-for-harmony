/**
 * ShareExtension — receives content shared from other apps via the HarmonyOS
 * NEXT system share sheet (Share Kit).
 *
 * Flow: system share sheet launches this extension → extract the shared text
 * via systemShare.getSharedData → stash it for the main RN app (in-process
 * static holder + persistent preferences fallback) → the RN side polls it and
 * shows the channel picker to post.
 */

import ShareExtensionAbility from '@ohos.app.ability.ShareExtensionAbility';
import Want from '@ohos.app.ability.Want';
import { UIExtensionContentSession } from '@kit.AbilityKit';
import { systemShare } from '@kit.ShareKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { preferences } from '@kit.ArkData';
import { PushTokenHolder } from './entryability/EntryAbility';

const DOMAIN = 0x0100;
const TAG = 'MattermostShare';
const PREFS_NAME = 'mattermost_storage';
const KEY_SHARED = 'pendingSharedContent';

export default class ShareExtension extends ShareExtensionAbility {
  onSessionCreate(want: Want, session: UIExtensionContentSession): void {
    super.onSessionCreate(want, session);
    hilog.info(DOMAIN, TAG, 'ShareExtension onSessionCreate');
    this.extractShared(want);
    // We don't render any UI — close immediately and let the user open the
    // main app, where the shared content shows up in the channel picker.
    session.terminateSelf();
  }

  private async extractShared(want: Want): Promise<void> {
    try {
      const data = await systemShare.getSharedData(want);
      const records = data.getRecords();
      hilog.info(DOMAIN, TAG, 'shared records=%{public}d', records.length);
      // Prefer plain-text records; fall back to uri/url records.
      let text = '';
      for (const r of records) {
        if (r.content) {
          text = r.content;
          break;
        }
      }
      if (!text) {
        for (const r of records) {
          if (r.uri) {
            text = r.uri;
            break;
          }
        }
      }
      if (text) {
        hilog.info(DOMAIN, TAG, 'shared text len=%{public}d', text.length);
        // In-process handoff to the RN app (same process as EntryAbility).
        PushTokenHolder.sharedContent = text;
        // Persistent fallback in case the process is killed before the app
        // is opened.
        this.persistPending(text);
      } else {
        hilog.warn(DOMAIN, TAG, 'no usable text record found');
      }
    } catch (e) {
      const err = e as Error;
      hilog.error(DOMAIN, TAG, 'extractShared failed: %{public}s', err.message || String(e));
    }
  }

  private persistPending(text: string): void {
    try {
      preferences.getPreferences(this.context, PREFS_NAME).then((prefs) => {
        prefs.put(KEY_SHARED, text);
        prefs.flush();
      }).catch(() => {});
    } catch (e) {
      // ignore
    }
  }
}