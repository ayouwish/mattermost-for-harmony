/**
 * System reminder bridge — opens the system calendar/memo editor pre-filled
 * with a message's content via the native Reminder TurboModule
 * (@kit.CalendarKit calendarManager.editEvent).
 */
import {TurboModuleRegistry} from 'react-native';

let nativeModule: any = null;
let resolved = false;

function getModule(): any {
  if (!resolved) {
    resolved = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nativeModule = TurboModuleRegistry.get<any>('Reminder') || null;
    } catch {
      nativeModule = null;
    }
  }
  return nativeModule;
}

/**
 * Opens the system calendar editor pre-filled with the message content so the
 * user can set a reminder time and save it. Returns true on success.
 */
export async function openCalendarReminder(
  title: string,
  description: string,
): Promise<boolean> {
  const mod = getModule();
  if (!mod) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok: boolean = await mod.openCalendarReminder(title, description);
    return Boolean(ok);
  } catch {
    return false;
  }
}

export default {
  openCalendarReminder,
};