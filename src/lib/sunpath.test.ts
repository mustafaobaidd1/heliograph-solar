import { describe, expect, it } from 'vitest';
import {
  analemmas,
  dayPath,
  invertStereo,
  projectStereo,
  standardOffsetMinutes,
  stereoRadius,
  sunTimesForLocalDate,
} from './sunpath';
import { sunTimes } from './solar/sunPosition';
import { utcToZoned } from './solar/zone';

describe('stereographic projection', () => {
  it('maps zenith to the centre and the horizon to the unit circle', () => {
    expect(stereoRadius(90)).toBeCloseTo(0, 12);
    expect(stereoRadius(0)).toBeCloseTo(1, 12);
    expect(stereoRadius(45)).toBeCloseTo(Math.tan((22.5 * Math.PI) / 180), 12);
  });

  it('puts north up and east right, and inverts exactly', () => {
    const [xe, ye] = projectStereo(90, 0, 100, 0, 0);
    expect(xe).toBeCloseTo(100, 9);
    expect(ye).toBeCloseTo(0, 9);
    const [xn, yn] = projectStereo(0, 0, 100, 0, 0);
    expect(yn).toBeCloseTo(-100, 9);
    expect(xn).toBeCloseTo(0, 9);
    for (const [az, el] of [
      [10, 5],
      [135, 40],
      [250, 72],
      [359, 1],
    ]) {
      const [x, y] = projectStereo(az, el, 200, 210, 220);
      const back = invertStereo(x, y, 200, 210, 220);
      expect(back.az).toBeCloseTo(az, 9);
      expect(back.el).toBeCloseTo(el, 9);
    }
  });
});

describe('paths', () => {
  it('a day path spans local midnight to midnight and peaks near solar noon', () => {
    const path = dayPath({ year: 2026, month: 6, day: 21 }, 31.95, 35.93, 'Asia/Amman', 5);
    expect(path[0].minute).toBe(0);
    expect(path[path.length - 1].minute).toBe(1440);
    const top = path.reduce((a, b) => (b.el > a.el ? b : a));
    expect(Math.abs(top.minute - (12 * 60 + 38))).toBeLessThanOrEqual(5);
    expect(top.el).toBeGreaterThan(81);
  });

  it('a DST day in Toronto is 23 hours long in local time', () => {
    const path = dayPath({ year: 2026, month: 3, day: 8 }, 43.65, -79.38, 'America/Toronto', 60);
    expect(path[path.length - 1].minute).toBe(23 * 60);
  });

  it('analemmas use standard time (Toronto UTC−5 all year)', () => {
    expect(standardOffsetMinutes('America/Toronto', 2026)).toBe(-300);
    expect(standardOffsetMinutes('Australia/Sydney', 2026)).toBe(600);
    const loops = analemmas(2026, 43.65, -79.38, 'America/Toronto', 7);
    const noon = loops.find((a) => a.hour === 12)!;
    // At 12:00 EST the Sun is east of the meridian for most of the year (Toronto is 79.4° W,
    // west of the 75° W zone meridian), so the loop sits slightly east of south.
    const meanAz = noon.points.reduce((s, p) => s + p.az, 0) / noon.points.length;
    expect(meanAz).toBeGreaterThan(160);
    expect(meanAz).toBeLessThan(180);
    expect(loops.length).toBeGreaterThan(12);
  });
});

describe('local-date sun times', () => {
  it('returns events on the requested local date even across the date line', () => {
    // Kiritimati (Line Islands) keeps UTC+14 at 157.4° W: solar noon is ~22:30 UTC, which is
    // already the next local day, so the UTC calendar date alone would pick the wrong noon.
    const date = { year: 2026, month: 6, day: 21 };
    const naive = utcToZoned(sunTimes(date, 1.87, -157.4).solarNoonUtc, 'Pacific/Kiritimati');
    expect(naive.day).toBe(22);
    const t = sunTimesForLocalDate(date, 1.87, -157.4, 'Pacific/Kiritimati');
    const noon = utcToZoned(t.solarNoonUtc, 'Pacific/Kiritimati');
    expect(noon).toMatchObject({ year: 2026, month: 6, day: 21 });
    expect(noon.minutes).toBeGreaterThan(12 * 60);
    expect(noon.minutes).toBeLessThan(13 * 60);
  });
});
