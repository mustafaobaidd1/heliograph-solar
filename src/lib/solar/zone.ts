/**
 * IANA time-zone conversions built on Intl.DateTimeFormat (no tz database is bundled:
 * the browser's own data is used, so daylight-saving rules are always current).
 */
import { MS_PER_DAY, MS_PER_MINUTE } from './time';
import type { CalendarDate } from './time';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface WallClock extends CalendarDate {
  hour: number;
  minute: number;
  second: number;
}

function wallClock(timeZone: string, utcMs: number): WallClock {
  const parts = formatter(timeZone).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of local wall-clock time from UTC, in minutes, at the given instant. */
export function zoneOffsetMinutes(timeZone: string, utcMs: number): number {
  const w = wallClock(timeZone, utcMs);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const wholeSecond = Math.floor(utcMs / 1000) * 1000;
  return Math.round((asUtc - wholeSecond) / MS_PER_MINUTE);
}

/** UTC instant of a local date and wall-clock minutes in a zone. */
export function zonedTimeToUtc(date: CalendarDate, minutes: number, timeZone: string): number {
  const naive = Date.UTC(date.year, date.month - 1, date.day) + minutes * MS_PER_MINUTE;
  const first = zoneOffsetMinutes(timeZone, naive);
  let utc = naive - first * MS_PER_MINUTE;
  const second = zoneOffsetMinutes(timeZone, utc);
  if (second !== first) utc = naive - second * MS_PER_MINUTE;
  return utc;
}

export interface ZonedTime extends CalendarDate {
  /** Minutes after local midnight, fractional. */
  minutes: number;
  offsetMinutes: number;
}

export function utcToZoned(utcMs: number, timeZone: string): ZonedTime {
  const offsetMinutes = zoneOffsetMinutes(timeZone, utcMs);
  const local = utcMs + offsetMinutes * MS_PER_MINUTE;
  const d = new Date(local);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    minutes: (local - dayStart) / MS_PER_MINUTE,
    offsetMinutes,
  };
}

/** Whole days between two calendar dates (b − a). */
export function daysBetween(a: CalendarDate, b: CalendarDate): number {
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / MS_PER_DAY,
  );
}

/** "UTC+3", "UTC−5", "UTC+5:30". Uses a true minus sign. */
export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '−' : '+';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/**
 * Nautical (longitude-based) zone, used when a place is picked on the map and its civil
 * time zone is unknown. IANA "Etc/GMT-3" means UTC+3 (the sign is inverted by convention).
 */
export function nauticalZone(lonDeg: number): string {
  const hours = Math.max(-12, Math.min(12, Math.round(lonDeg / 15)));
  if (hours === 0) return 'Etc/GMT';
  return `Etc/GMT${hours > 0 ? '-' : '+'}${Math.abs(hours)}`;
}

export function isNauticalZone(timeZone: string): boolean {
  return /^Etc\/GMT([+-]\d{1,2})?$/.test(timeZone);
}

/** Human label for a zone: "Asia/Amman" → "Asia/Amman", "Etc/GMT-3" → "UTC+3 (from longitude)". */
export function describeZone(timeZone: string, utcMs: number): string {
  if (isNauticalZone(timeZone)) {
    return `${formatUtcOffset(zoneOffsetMinutes(timeZone, utcMs))} (from longitude)`;
  }
  return timeZone.replace(/_/g, ' ');
}

/** All IANA zones the browser knows, with a small fallback list for old engines. */
export function listTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    if (typeof intl.supportedValuesOf === 'function') return intl.supportedValuesOf('timeZone');
  } catch {
    // fall through to the fallback list
  }
  return [
    'UTC',
    'Africa/Johannesburg',
    'America/Guayaquil',
    'America/Phoenix',
    'America/Toronto',
    'Asia/Amman',
    'Asia/Singapore',
    'Atlantic/Reykjavik',
    'Australia/Sydney',
    'Europe/London',
    'Europe/Oslo',
  ];
}
