/**
 * Sun position after the NOAA Global Monitoring Laboratory solar calculator
 * (https://gml.noaa.gov/grad/solcalc/), which implements the low-precision solar
 * coordinates of Jean Meeus, "Astronomical Algorithms" (2nd ed., 1998), ch. 25 and 28.
 * NOAA quotes ±1 min for sunrise/sunset at mid-latitudes and better than 0.01° for
 * position between 1800 and 2100; refraction near the horizon is the main uncertainty.
 */
import { DEG, RAD, clamp } from './math';
import { MS_PER_DAY, MS_PER_MINUTE, julianCentury, julianDay } from './time';
import type { CalendarDate } from './time';

export interface SolarGeometry {
  /** Julian centuries since J2000.0 */
  T: number;
  /** Apparent declination, degrees */
  declination: number;
  /** Equation of time, minutes (true solar time − mean solar time) */
  eqTime: number;
  /** Earth–Sun distance, astronomical units */
  radiusVector: number;
  /** Apparent ecliptic longitude, degrees */
  apparentLongitude: number;
}

/** Location-independent solar quantities at a time given in Julian centuries (TT ≈ UT here). */
export function solarGeometry(T: number): SolarGeometry {
  let L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  if (L0 < 0) L0 += 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * DEG;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const trueLongitude = L0 + C;
  const trueAnomaly = M + C;
  const radiusVector = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(trueAnomaly * DEG));
  const omega = 125.04 - 1934.136 * T;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const seconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813));
  const meanObliquity = 23 + (26 + seconds / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * DEG);
  const declination =
    Math.asin(Math.sin(obliquity * DEG) * Math.sin(apparentLongitude * DEG)) * RAD;

  let y = Math.tan((obliquity * DEG) / 2);
  y *= y;
  const L0r = L0 * DEG;
  const eqTimeRad =
    y * Math.sin(2 * L0r) -
    2 * e * Math.sin(Mr) +
    4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
    0.5 * y * y * Math.sin(4 * L0r) -
    1.25 * e * e * Math.sin(2 * Mr);

  return {
    T,
    declination,
    eqTime: 4 * eqTimeRad * RAD,
    radiusVector,
    apparentLongitude,
  };
}

/**
 * Approximate atmospheric refraction (degrees) to add to the geometric elevation,
 * NOAA's piecewise fit (Saemundsson/Bennett-type near the horizon).
 */
export function refractionCorrection(elevationTrue: number): number {
  if (elevationTrue > 85) return 0;
  const te = Math.tan(elevationTrue * DEG);
  let arcsec: number;
  if (elevationTrue > 5) {
    arcsec = 58.1 / te - 0.07 / (te * te * te) + 0.000086 / te ** 5;
  } else if (elevationTrue > -0.575) {
    const h = elevationTrue;
    arcsec = 1735 + h * (-518.2 + h * (103.4 + h * (-12.79 + h * 0.711)));
  } else {
    arcsec = -20.774 / te;
  }
  return arcsec / 3600;
}

export interface SunPosition {
  /** Apparent (refraction-corrected) elevation, degrees */
  elevation: number;
  /** Geometric elevation, degrees */
  elevationTrue: number;
  /** Apparent zenith angle, degrees */
  zenith: number;
  /** Azimuth clockwise from true north, degrees in [0, 360) */
  azimuth: number;
  /** Hour angle, degrees (negative in the morning) */
  hourAngle: number;
  /** True solar time, minutes after solar midnight */
  trueSolarTime: number;
  declination: number;
  eqTime: number;
  radiusVector: number;
}

export function sunPosition(utcMs: number, latDeg: number, lonDeg: number): SunPosition {
  const g = solarGeometry(julianCentury(julianDay(utcMs)));
  return sunPositionFromGeometry(g, utcMs, latDeg, lonDeg);
}

/** Same as sunPosition but reuses precomputed geometry (for tight loops). */
export function sunPositionFromGeometry(
  g: SolarGeometry,
  utcMs: number,
  latDeg: number,
  lonDeg: number,
): SunPosition {
  const minutesUtc = (((utcMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / MS_PER_MINUTE;
  let tst = (minutesUtc + g.eqTime + 4 * lonDeg) % 1440;
  if (tst < 0) tst += 1440;
  const hourAngle = tst / 4 - 180;

  const phi = latDeg * DEG;
  const dec = g.declination * DEG;
  const ha = hourAngle * DEG;
  const cosZ = clamp(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha),
    -1,
    1,
  );
  const zenithTrue = Math.acos(cosZ) * RAD;
  // Meeus eq. 13.5 (azimuth from south, westward) shifted to north-based, clockwise.
  let azimuth =
    Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) * RAD +
    180;
  if (azimuth >= 360) azimuth -= 360;

  const elevationTrue = 90 - zenithTrue;
  const elevation = elevationTrue + refractionCorrection(elevationTrue);
  return {
    elevation,
    elevationTrue,
    zenith: 90 - elevation,
    azimuth,
    hourAngle,
    trueSolarTime: tst,
    declination: g.declination,
    eqTime: g.eqTime,
    radiusVector: g.radiusVector,
  };
}

/** Geometric zenith of the Sun's centre at apparent sunrise/sunset: 34′ refraction + 16′ semi-diameter. */
export const SUNRISE_ZENITH = 90.833;

export interface SunTimes {
  /** UTC instant of local apparent noon (Sun on the meridian). */
  solarNoonUtc: number;
  /** Apparent elevation at solar noon, degrees. */
  noonElevation: number;
  sunriseUtc: number | null;
  sunsetUtc: number | null;
  /** 'day' = the Sun never sets on this date, 'night' = it never rises. On transition days
   * near the poles only one of sunrise/sunset exists and polar is null. */
  polar: 'day' | 'night' | null;
  /** Minutes the Sun is up in the noon-centred day (1440 for polar day, 0 for polar night). */
  dayLength: number;
  /** Declination at solar noon, degrees. */
  declination: number;
  /** Equation of time at solar noon, minutes. */
  eqTime: number;
}

/**
 * Sunrise, solar noon and sunset for a calendar date at a longitude. Events are the crossings of
 * the 90.833° geometric zenith (NOAA's definition) within the noon-centred day [noon − 12 h,
 * noon + 12 h]: the elevation is sampled every 10 minutes, including both lower culminations and
 * noon, and each crossing is refined by bisection to a fraction of a second. This agrees with NOAA's
 * hour-angle method on ordinary days and stays correct on transition days near the poles, when
 * the Sun only dips below (or peeks above) the horizon for a few minutes. Events are found around
 * the solar noon that falls on the given UTC calendar date (see sunTimesForLocalDate for zones).
 */
export function sunTimes(date: CalendarDate, latDeg: number, lonDeg: number): SunTimes {
  const day0 = Date.UTC(date.year, date.month - 1, date.day);
  const jd0 = julianDay(day0);
  const geomAt = (minutes: number): SolarGeometry =>
    solarGeometry(julianCentury(jd0 + minutes / 1440));

  // Solar noon: 720 − 4·λ − EoT (minutes after 0h UT), with EoT taken at noon itself.
  let noonMin = 720 - 4 * lonDeg;
  let noonGeom = geomAt(noonMin);
  for (let i = 0; i < 4; i++) {
    const next = 720 - 4 * lonDeg - noonGeom.eqTime;
    const done = Math.abs(next - noonMin) < 1e-4;
    noonMin = next;
    noonGeom = geomAt(noonMin);
    if (done) break;
  }
  const solarNoonUtc = day0 + noonMin * MS_PER_MINUTE;
  const noonElevation = sunPositionFromGeometry(noonGeom, solarNoonUtc, latDeg, lonDeg).elevation;

  const horizon = 90 - SUNRISE_ZENITH;
  const f = (m: number): number =>
    sunPositionFromGeometry(geomAt(m), day0 + m * MS_PER_MINUTE, latDeg, lonDeg).elevationTrue -
    horizon;
  const STEP = 10;
  const N = 144;
  const start = noonMin - 720;
  const values = new Array<number>(N + 1);
  for (let k = 0; k <= N; k++) values[k] = f(start + k * STEP);

  const refine = (k: number): number => {
    let lo = start + k * STEP;
    let hi = lo + STEP;
    let flo = values[k];
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if (fm >= 0 === flo >= 0) {
        lo = mid;
        flo = fm;
      } else hi = mid;
    }
    return (lo + hi) / 2;
  };

  const noonK = N / 2;
  let rise: number | null = null;
  let set: number | null = null;
  for (let k = noonK - 1; k >= 0; k--) {
    if (values[k] < 0 && values[k + 1] >= 0) {
      rise = refine(k);
      break;
    }
  }
  for (let k = noonK; k < N; k++) {
    if (values[k] >= 0 && values[k + 1] < 0) {
      set = refine(k);
      break;
    }
  }

  const base = {
    solarNoonUtc,
    noonElevation,
    declination: noonGeom.declination,
    eqTime: noonGeom.eqTime,
  };
  if (rise === null && set === null) {
    const up = values[noonK] > 0;
    return {
      ...base,
      sunriseUtc: null,
      sunsetUtc: null,
      polar: up ? 'day' : 'night',
      dayLength: up ? 1440 : 0,
    };
  }
  return {
    ...base,
    sunriseUtc: rise === null ? null : day0 + rise * MS_PER_MINUTE,
    sunsetUtc: set === null ? null : day0 + set * MS_PER_MINUTE,
    polar: null,
    // On a transition day only one event exists: count from the window edge instead.
    dayLength: (set ?? start + 1440) - (rise ?? start),
  };
}

/**
 * The next sunrise or sunset after (direction 1) or before (−1) the given date's noon-centred day,
 * as a UTC instant, searching up to `maxDays` — used to explain polar day and night ("the Sun
 * first sets again on 26 Jul, 00:36").
 */
export function nextSunEvent(
  date: CalendarDate,
  latDeg: number,
  lonDeg: number,
  kind: 'rise' | 'set',
  direction: 1 | -1 = 1,
  maxDays = 200,
): number | null {
  const start = Date.UTC(date.year, date.month - 1, date.day);
  for (let i = 1; i <= maxDays; i++) {
    const d = new Date(start + direction * i * MS_PER_DAY);
    const cd = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    const t = sunTimes(cd, latDeg, lonDeg);
    const event = kind === 'rise' ? t.sunriseUtc : t.sunsetUtc;
    if (event !== null) return event;
  }
  return null;
}

/** Solar declination bounds used in tests: ± obliquity of the ecliptic (≈ 23.44° in 2026). */
export function obliquityOfEcliptic(T: number): number {
  const seconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813));
  return 23 + (26 + seconds / 60) / 60;
}
