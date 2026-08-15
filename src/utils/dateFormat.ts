/**
 * Date formatting utilities — Hermes-safe (no Intl API).
 *
 * Replaces toLocaleString / toLocaleDateString / toLocaleTimeString which
 * cause "dateformat not implemented" errors on RNOH's Hermes runtime.
 */

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAYS_LONG = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday',
];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Format time as HH:MM (24-hour). */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Format as "Mon DD" e.g. "Jan 15". */
export function formatShortDate(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** Format as "HH:MM" if today, "Mon DD HH:MM" otherwise. */
export function formatTimeOrDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return formatTime(ts);
  return `${formatShortDate(ts)} ${formatTime(ts)}`;
}

/** Date separator label: Today / Yesterday / full weekday, month, day, year. */
export function formatDateSeparator(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString();
  const dateStr = d.toDateString();
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return `${WEEKDAYS_LONG[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Full date+time e.g. "Jan 15, 2025, 14:30". */
export function formatFullDateTime(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${formatTime(ts)}`;
}

/** Date only e.g. "January 15, 2025". */
export function formatLongDate(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
