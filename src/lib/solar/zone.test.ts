import { describe, expect, it } from 'vitest';
import { dateFromDayOfYear, dayOfYear, formatClock, formatDuration, parseIsoDate } from './time';
import {
  describeZone,
  formatUtcOffset,
  isValidTimeZone,
  nauticalZone,
  utcToZoned,
  zoneOffsetMinutes,
  zonedTimeToUtc,
} from './zone';

describe('time zones (Intl-based)', () => {
  it('Amman is on permanent UTC+3', () => {
    expect(zoneOffsetMinutes('Asia/Amman', Date.UTC(2026, 0, 15))).toBe(180);
    expect(zoneOffsetMinutes('Asia/Amman', Date.UTC(2026, 6, 15))).toBe(180);
  });

  it('Toronto observes daylight saving time', () => {
    expect(zoneOffsetMinutes('America/Toronto', Date.UTC(2026, 0, 15))).toBe(-300);
    expect(zoneOffsetMinutes('America/Toronto', Date.UTC(2026, 6, 15))).toBe(-240);
  });

  it('converts local wall-clock time to UTC and back, including a DST date', () => {
    const date = { year: 2026, month: 7, day: 1 };
    const utc = zonedTimeToUtc(date, 9 * 60 + 30, 'America/Toronto');
    expect(new Date(utc).toISOString()).toBe('2026-07-01T13:30:00.000Z');
    const back = utcToZoned(utc, 'America/Toronto');
    expect(back).toMatchObject({ year: 2026, month: 7, day: 1, offsetMinutes: -240 });
    expect(back.minutes).toBeCloseTo(570, 6);
    const syd = zonedTimeToUtc({ year: 2026, month: 12, day: 21 }, 12 * 60, 'Australia/Sydney');
    expect(new Date(syd).toISOString()).toBe('2026-12-21T01:00:00.000Z');
  });

  it('nautical zones invert the Etc/GMT sign convention correctly', () => {
    expect(nauticalZone(35.9)).toBe('Etc/GMT-2');
    expect(zoneOffsetMinutes(nauticalZone(44), Date.UTC(2026, 0, 1))).toBe(180);
    expect(zoneOffsetMinutes(nauticalZone(-79), Date.UTC(2026, 0, 1))).toBe(-300);
    expect(nauticalZone(3)).toBe('Etc/GMT');
    expect(describeZone('Etc/GMT-3', 0)).toBe('UTC+3 (from longitude)');
  });

  it('formats offsets with a true minus sign and half hours', () => {
    expect(formatUtcOffset(180)).toBe('UTC+3');
    expect(formatUtcOffset(-300)).toBe('UTC−5');
    expect(formatUtcOffset(330)).toBe('UTC+5:30');
  });

  it('rejects unknown zones', () => {
    expect(isValidTimeZone('Asia/Amman')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('calendar helpers', () => {
  it('day of year round-trips, including leap years', () => {
    expect(dayOfYear({ year: 2026, month: 1, day: 1 })).toBe(1);
    expect(dayOfYear({ year: 2026, month: 12, day: 31 })).toBe(365);
    expect(dayOfYear({ year: 2028, month: 12, day: 31 })).toBe(366);
    expect(dateFromDayOfYear(2026, 172)).toEqual({ year: 2026, month: 6, day: 21 });
  });

  it('parses ISO dates and rejects invalid ones', () => {
    expect(parseIsoDate('2026-06-21')).toEqual({ year: 2026, month: 6, day: 21 });
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('21/06/2026')).toBeNull();
    expect(parseIsoDate('3000-01-01')).toBeNull();
  });

  it('formats clock times and durations', () => {
    expect(formatClock(330.8)).toBe('05:31');
    expect(formatClock(1440 + 4)).toBe('00:04');
    expect(formatDuration(853.5)).toBe('14 h 14 min');
  });
});
