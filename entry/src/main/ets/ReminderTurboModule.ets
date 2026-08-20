/**
 * Reminder TurboModule
 *
 * Opens the system calendar to create a reminder for a long-pressed message.
 * Uses @kit.CalendarKit (calendarManager): gets the default calendar and adds
 * an event with the message content + a 10-min reminder.
 *
 * Requires ohos.permission.READ_CALENDAR + WRITE_CALENDAR (module.json5).
 * The system auto-prompts for these permissions on first use.
 *
 * JS usage:
 *   const rem = TurboModuleRegistry.get('Reminder');
 *   const ok = await rem.openCalendarReminder(title, description);
 */

import { TurboModule, type TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { calendarManager } from '@kit.CalendarKit';
import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';

const REMINDER_PERMISSIONS: Permissions[] = [
  'ohos.permission.READ_CALENDAR',
  'ohos.permission.WRITE_CALENDAR',
];

export class ReminderTurboModule extends TurboModule {
  public static readonly NAME = 'Reminder';

  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  getConstants(): Record<string, string> {
    return {};
  }

  private getContext(): common.UIAbilityContext {
    return this.ctx.uiAbilityContext;
  }

  /**
   * Request calendar permissions, actively prompting the user if not granted.
   */
  async requestCalendarPermission(): Promise<boolean> {
    try {
      const atManager = abilityAccessCtrl.createAtManager();
      const result = await atManager.requestPermissionsFromUser(
        this.getContext(),
        REMINDER_PERMISSIONS,
      );
      // authResults: 0 = PERMISSION_GRANTED
      const granted = result.authResults.every((r: number) => r === 0);
      if (!granted) {
        console.log(`[Reminder] permission denied: ${JSON.stringify(result.authResults)}`);
      }
      return granted;
    } catch (e) {
      const err = e as BusinessError;
      console.log(`[Reminder] permission request error: ${err.code} ${err.message}`);
      return false;
    }
  }

  /**
   * Creates a calendar event (with a 10-min reminder) pre-filled with the
   * message content, starting 1 hour from now. The user can then edit it in
   * the system calendar app.
   */
  async openCalendarReminder(title: string, description: string): Promise<boolean> {
    // Step 1: ensure calendar permissions (triggers system dialog if needed).
    const granted = await this.requestCalendarPermission();
    if (!granted) {
      return false;
    }
    try {
      const now = Date.now();
      const event: calendarManager.Event = {
        title: title || 'Mattermost reminder',
        type: calendarManager.EventType.NORMAL,
        startTime: now + 60 * 60 * 1000,
        endTime: now + 2 * 60 * 60 * 1000,
        description: description || '',
        reminderTime: [10],
      };
      const calendarMgr = calendarManager.getCalendarManager(this.getContext());
      // Try editEvent (opens system editor UI) first; fall back to addEvent.
      try {
        const eventId: number = await calendarMgr.editEvent(event);
        return eventId >= 0;
      } catch (editErr) {
        const e1 = editErr as BusinessError;
        console.log(`[Reminder] editEvent failed (${e1.code}), trying addEvent`);
        const calendar = await calendarMgr.getCalendar();
        const id: number = await calendar.addEvent(event);
        return id >= 0;
      }
    } catch (e) {
      const err = e as BusinessError;
      console.log(`[Reminder] openCalendarReminder failed: ${err.code} ${err.message}`);
      return false;
    }
  }

  __onDestroy__() {
    super.__onDestroy__();
  }
}