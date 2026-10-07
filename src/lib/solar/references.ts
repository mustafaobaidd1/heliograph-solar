/**
 * Published reference values used by the unit tests, `npm run validate` and the in-app
 * validation table. Each block names its source and when it was read.
 */
import type { CalendarDate } from './time';

export interface NoaaCase {
  name: string;
  lat: number;
  lon: number;
  /** UTC offset in hours used in the calculator */
  tz: number;
  date: CalendarDate;
  /** local clock minutes */
  localTime: number;
  elevation: number;
  azimuth: number;
  eqTime: number;
  declination: number;
  solarNoon: string;
  sunrise: string;
  sunset: string;
  /** The calculator's unrounded outputs (local minutes), from its own main.js */
  precise: { sunrise: number; sunset: number; solarNoon: number };
}

/**
 * NOAA GML Solar Calculator, https://gml.noaa.gov/grad/solcalc/ — values displayed by the live
 * page for these inputs on 2026-10-06 (elevation/azimuth to 0.01°, rise/set to the minute,
 * noon to the second).
 */
export const NOAA_CASES: NoaaCase[] = [
  {
    name: 'Amman',
    lat: 31.95,
    lon: 35.93,
    tz: 3,
    date: { year: 2026, month: 6, day: 21 },
    localTime: 12 * 60,
    elevation: 78.04,
    azimuth: 132.97,
    eqTime: -1.8,
    declination: 23.44,
    solarNoon: '12:37:58',
    sunrise: '05:31',
    sunset: '19:45',
    precise: { sunrise: 330.8151, sunset: 1185.3498, solarNoon: 757.974 },
  },
  {
    name: 'Greenwich',
    lat: 51.4769,
    lon: -0.0005,
    tz: 0,
    date: { year: 2026, month: 3, day: 20 },
    localTime: 12 * 60,
    elevation: 38.48,
    azimuth: 177.63,
    eqTime: -7.43,
    declination: -0.04,
    solarNoon: '12:07:35',
    sunrise: '06:03',
    sunset: '18:13',
    precise: { sunrise: 362.8677, sunset: 1093.0038, solarNoon: 727.5812 },
  },
  {
    name: 'Quito',
    lat: -0.1807,
    lon: -78.4678,
    tz: -5,
    date: { year: 2026, month: 12, day: 21 },
    localTime: 12 * 60,
    elevation: 66.57,
    azimuth: 173.04,
    eqTime: 1.82,
    declination: -23.44,
    solarNoon: '12:11:48',
    sunrise: '06:08',
    sunset: '18:16',
    precise: { sunrise: 367.9852, sunset: 1096.1259, solarNoon: 731.8078 },
  },
];

/**
 * JPL Horizons apparent (refracted) azimuth/elevation of the Sun, ssd.jpl.nasa.gov/api/horizons.api
 * with QUANTITIES=4, APPARENT=REFRACTED, geodetic site at 0 m (queried 2026-10-06).
 */
export const HORIZONS_CASES = [
  {
    label: 'Amman 21 Jun 09:00 UT',
    lat: 31.95,
    lon: 35.93,
    utc: Date.UTC(2026, 5, 21, 9, 0),
    az: 132.973145,
    el: 78.036563,
  },
  {
    label: 'Amman 21 Jun 12:30 UT',
    lat: 31.95,
    lon: 35.93,
    utc: Date.UTC(2026, 5, 21, 12, 30),
    az: 268.375889,
    el: 51.279814,
  },
  {
    label: 'Greenwich 20 Mar 12:00 UT',
    lat: 51.4769,
    lon: -0.0005,
    utc: Date.UTC(2026, 2, 20, 12, 0),
    az: 177.625506,
    el: 38.472966,
  },
  {
    label: 'Quito 21 Dec 17:00 UT',
    lat: -0.1807,
    lon: -78.4678,
    utc: Date.UTC(2026, 11, 21, 17, 0),
    az: 173.042911,
    el: 66.566725,
  },
];

/** US Naval Observatory rise/set API, aa.usno.navy.mil/api/rstt/oneday (queried 2026-10-06). */
export const USNO_CASES = [
  {
    label: 'Amman 21 Jun',
    lat: 31.95,
    lon: 35.93,
    tz: 3,
    date: { year: 2026, month: 6, day: 21 },
    rise: '05:31',
    set: '19:45',
    noon: '12:38',
  },
  {
    label: 'Greenwich 20 Mar',
    lat: 51.4769,
    lon: -0.0005,
    tz: 0,
    date: { year: 2026, month: 3, day: 20 },
    rise: '06:03',
    set: '18:13',
    noon: '12:07',
  },
  {
    label: 'Quito 21 Dec',
    lat: -0.1807,
    lon: -78.4678,
    tz: -5,
    date: { year: 2026, month: 12, day: 21 },
    rise: '06:08',
    set: '18:16',
    noon: '12:12',
  },
];

/**
 * PVGIS 5.3 optimal slope with a fixed equator-facing aspect (re.jrc.ec.europa.eu/api/v5_3/PVcalc,
 * optimalinclination=1, loss=14, queried 2026-10-06) and its in-plane annual irradiation H(i)_y.
 */
export const PVGIS_OPTIMA: Record<string, { slope: number; hiy: number; db: string }> = {
  amman: { slope: 28, hiy: 2341.8, db: 'SARAH3' },
  toronto: { slope: 36, hiy: 1553.5, db: 'ERA5' },
  reykjavik: { slope: 43, hiy: 870.81, db: 'SARAH3' },
  singapore: { slope: 0, hiy: 1810.12, db: 'ERA5' },
  'cape-town': { slope: 30, hiy: 2171.03, db: 'SARAH3' },
  sydney: { slope: 34, hiy: 1973.02, db: 'ERA5' },
  quito: { slope: 0, hiy: 1686.68, db: 'ERA5' },
  phoenix: { slope: 34, hiy: 2462.07, db: 'ERA5' },
  tromso: { slope: 48, hiy: 903.17, db: 'ERA5' },
};

/**
 * Jacobson & Jadhav (2018), "World estimates of PV optimal tilt angles…", Solar Energy 169,
 * 55–66, Fig. 1: cubic fits to PVWatts optimal tilts (R = 0.96 north, 0.97 south).
 * Returns the tilt magnitude (facing the equator).
 */
export function jacobsonJadhav(lat: number): number {
  return lat >= 0
    ? 1.3793 + lat * (1.2011 + lat * (-0.014404 + lat * 0.000080509))
    : -(-0.41657 + lat * (1.4216 + lat * (0.024051 + lat * 0.00021828)));
}

export const hms = (s: string): number => {
  const [h, m, sec] = s.split(':').map(Number);
  return h * 60 + m + (sec ?? 0) / 60;
};
