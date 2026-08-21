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
 * user can set a reminder time and save it.
 * Returns 'ok' | 'permission_denied' | 'error' | 'module_missing'.
 */
export async function openCalendarReminder(
  title: string,
  description: string,
): Promise<string> {
  const mod = getModule();
  console.log(`[Reminder] module=${mod ? 'found' : 'MISSING'} method=${mod?.openCalendarReminder ? 'ok' : 'missing'}`);
  if (!mod) return 'module_missing';
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: string = await mod.openCalendarReminder(title, description);
    console.log(`[Reminder] native result=${result}`);
    return typeof result === 'string' ? result : 'error';
  } catch (e) {
    console.log('[Reminder] call error:', e);
    return 'error';
  }
}

export default {
  openCalendarReminder,
};