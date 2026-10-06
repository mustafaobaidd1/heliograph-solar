/** Calendar and Julian-day helpers (proleptic Gregorian calendar, UTC milliseconds). */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** Julian Day for a UTC instant (Unix epoch = JD 2440587.5). */
export function julianDay(utcMs: number): number {
  return utcMs / MS_PER_DAY + 2440587.5;
}

/** Julian centuries since J2000.0 (JD 2451545.0). */
export function julianCentury(jd: number): number {
  return (jd - 2451545.0) / 36525.0;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/** Month is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export interface CalendarDate {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

/** 1-based day of year. */
export function dayOfYear({ year, month, day }: CalendarDate): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / MS_PER_DAY) + 1;
}

export function dateFromDayOfYear(year: number, doy: number): CalendarDate {
  const d = new Date(Date.UTC(year, 0, doy));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(text: string): CalendarDate | null {
  const m = ISO_DATE.exec(text.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function formatIsoDate({ year, month, day }: CalendarDate): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** "HH:MM" for a number of minutes after midnight (rounded to the nearest minute). */
export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** "h:mm" style duration, e.g. 14 h 13 min. */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h} h ${pad2(m)} min`;
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

export function formatLongDate({ year, month, day }: CalendarDate): string {
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}
