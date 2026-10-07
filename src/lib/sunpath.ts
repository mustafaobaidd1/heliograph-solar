/**
 * Geometry for the sun-path diagram and the 3D day arc: stereographic polar projection,
 * day lines and hour analemmas.
 */
import { DEG, RAD, wrap360 } from './solar/math';
import { sunPosition, sunTimes } from './solar/sunPosition';
import type { SunTimes } from './solar/sunPosition';
import { MS_PER_DAY, MS_PER_MINUTE } from './solar/time';
import type { CalendarDate } from './solar/time';
import { utcToZoned, zoneOffsetMinutes, zonedTimeToUtc } from './solar/zone';

export interface SkyPoint {
  az: number;
  el: number;
}

export interface PathPoint extends SkyPoint {
  utc: number;
  /** Local clock minutes since midnight of the path's date */
  minute: number;
}

/**
 * Stereographic projection from the nadir onto the horizon plane: zenith at the centre,
 * horizon on the unit circle, r = tan((90° − h)/2). North is up, east to the right.
 */
export function stereoRadius(elDeg: number): number {
  return Math.tan(((90 - elDeg) / 2) * DEG);
}

export function projectStereo(
  az: number,
  el: number,
  R: number,
  cx: number,
  cy: number,
): [number, number] {
  const r = R * stereoRadius(el);
  return [cx + r * Math.sin(az * DEG), cy - r * Math.cos(az * DEG)];
}

export function invertStereo(x: number, y: number, R: number, cx: number, cy: number): SkyPoint {
  const dx = (x - cx) / R;
  const dy = (cy - y) / R;
  const r = Math.hypot(dx, dy);
  const el = 90 - 2 * Math.atan(r) * RAD;
  const az = r < 1e-9 ? 0 : wrap360(Math.atan2(dx, dy) * RAD);
  return { az, el };
}

/** Sun positions over a local calendar day (midnight to midnight in the zone). */
export function dayPath(
  date: CalendarDate,
  lat: number,
  lon: number,
  timeZone: string,
  stepMinutes = 5,
): PathPoint[] {
  const start = zonedTimeToUtc(date, 0, timeZone);
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day) + MS_PER_DAY);
  const end = zonedTimeToUtc(
    { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() },
    0,
    timeZone,
  );
  const out: PathPoint[] = [];
  for (let t = start; t <= end; t += stepMinutes * MS_PER_MINUTE) {
    const p = sunPosition(t, lat, lon);
    out.push({ az: p.azimuth, el: p.elevation, utc: t, minute: (t - start) / MS_PER_MINUTE });
  }
  return out;
}

/** Standard-time UTC offset of a zone in a year (the smaller of January and July: DST adds). */
export function standardOffsetMinutes(timeZone: string, year: number): number {
  return Math.min(
    zoneOffsetMinutes(timeZone, Date.UTC(year, 0, 15)),
    zoneOffsetMinutes(timeZone, Date.UTC(year, 6, 15)),
  );
}

export interface Analemma {
  /** Local standard-time hour */
  hour: number;
  points: (SkyPoint & { doy: number })[];
}

/** Figure-of-eight traced by the Sun at a fixed standard clock time through the year. */
export function analemmas(
  year: number,
  lat: number,
  lon: number,
  timeZone: string,
  everyDays = 4,
): Analemma[] {
  const offset = standardOffsetMinutes(timeZone, year);
  const out: Analemma[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const points: (SkyPoint & { doy: number })[] = [];
    let anyUp = false;
    for (let d = 0; d < 366; d += everyDays) {
      const utc = Date.UTC(year, 0, 1 + d, hour) - offset * MS_PER_MINUTE;
      const p = sunPosition(utc, lat, lon);
      if (p.elevation > 0) anyUp = true;
      points.push({ az: p.azimuth, el: p.elevation, doy: d + 1 });
    }
    if (anyUp) out.push({ hour, points });
  }
  return out;
}

/**
 * Sunrise/noon/sunset for a local calendar date. `sunTimes` finds events around the solar
 * noon of a UTC date; for zones far from their longitude that noon can fall on the adjacent
 * local date, so the neighbouring day is used when needed.
 */
export function sunTimesForLocalDate(
  date: CalendarDate,
  lat: number,
  lon: number,
  timeZone: string,
): SunTimes {
  const key = (d: CalendarDate) => d.year * 10000 + d.month * 100 + d.day;
  const target = key(date);
  for (const shift of [0, -1, 1]) {
    const dd = new Date(Date.UTC(date.year, date.month - 1, date.day + shift));
    const cd = { year: dd.getUTCFullYear(), month: dd.getUTCMonth() + 1, day: dd.getUTCDate() };
    const t = sunTimes(cd, lat, lon);
    const local = utcToZoned(t.solarNoonUtc, timeZone);
    if (key(local) === target) return t;
  }
  return sunTimes(date, lat, lon);
}

/** Colour position 0 (June solstice) … 1 (December solstice) from declination, for path colours. */
export function seasonFraction(declinationDeg: number, lat: number): number {
  const f = (23.44 - declinationDeg) / (2 * 23.44);
  const t = Math.min(1, Math.max(0, f));
  // In the southern hemisphere December is summer: keep "summer = ochre".
  return lat >= 0 ? t : 1 - t;
}
