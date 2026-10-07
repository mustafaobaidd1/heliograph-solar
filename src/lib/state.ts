/**
 * Application state and its URL encoding ("share state via URL").
 * Everything a user can set is in AppState; everything else is derived.
 */
import { DEFAULT_PLACE, placeById } from './places';
import type { Place } from './places';
import type { PeriodSpec, PvParams } from './solar/annual';
import { MAX_HORIZON_POINTS, sanitizeHorizon } from './solar/horizon';
import type { HorizonPoint } from './solar/horizon';
import { clamp, wrap360 } from './solar/math';
import { formatIsoDate, parseIsoDate } from './solar/time';
import type { CalendarDate } from './solar/time';
import type { TranspositionModel } from './solar/transposition';
import { isValidTimeZone, nauticalZone, utcToZoned } from './solar/zone';

export interface PlaceState {
  /** Preset id, or null for a custom place */
  presetId: string | null;
  name: string;
  lat: number;
  lon: number;
  timeZone: string;
  altitude: number;
  /** True when the zone was guessed from longitude (map click) */
  zoneEstimated: boolean;
}

export type SkySource = 'clear' | 'climate';

export interface SkyState {
  source: SkySource;
  aod700: number;
  pw: number;
  albedo: number;
  transposition: TranspositionModel;
}

export interface PvState extends PvParams {
  /** Air temperature used in clear-sky mode, °C */
  ambient: number;
}

export interface AppState {
  place: PlaceState;
  date: CalendarDate;
  /** Local clock time, minutes after midnight */
  minutes: number;
  panel: { tilt: number; azimuth: number };
  horizon: HorizonPoint[];
  sky: SkyState;
  pv: PvState;
  period: PeriodSpec;
}

export const DEFAULT_SKY: SkyState = {
  source: 'clear',
  aod700: 0.1,
  pw: 1.5,
  albedo: 0.2,
  transposition: 'perez',
};

export const DEFAULT_PV: PvState = {
  kwp: 5,
  gammaPct: -0.35,
  noct: 45,
  lossesPct: 14,
  ambient: 25,
};

export const LIMITS = {
  aod700: [0, 0.45],
  pw: [0.2, 6],
  albedo: [0, 0.9],
  altitude: [-430, 6000],
  kwp: [0.1, 1000],
  gammaPct: [-0.6, 0],
  noct: [30, 60],
  lossesPct: [0, 50],
  ambient: [-30, 50],
} as const;

export function placeStateFrom(p: Place): PlaceState {
  return {
    presetId: p.id,
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    timeZone: p.timeZone,
    altitude: p.altitude,
    zoneEstimated: false,
  };
}

export function defaultState(nowUtc: number): AppState {
  const place = placeStateFrom(DEFAULT_PLACE);
  const local = utcToZoned(nowUtc, place.timeZone);
  return {
    place,
    date: { year: local.year, month: local.month, day: local.day },
    minutes: Math.floor(local.minutes),
    panel: { tilt: 30, azimuth: 180 },
    horizon: [],
    sky: { ...DEFAULT_SKY },
    pv: { ...DEFAULT_PV },
    period: { kind: 'year' },
  };
}

const r = (x: number, digits: number): string => {
  const s = x.toFixed(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Serialises the state to URL search parameters, omitting defaults where sensible. */
export function encodeState(s: AppState): URLSearchParams {
  const q = new URLSearchParams();
  const preset = s.place.presetId ? placeById(s.place.presetId) : undefined;
  const isPreset =
    preset &&
    preset.lat === s.place.lat &&
    preset.lon === s.place.lon &&
    preset.timeZone === s.place.timeZone &&
    preset.altitude === s.place.altitude;
  if (isPreset) {
    q.set('place', preset.id);
  } else {
    q.set('lat', r(s.place.lat, 4));
    q.set('lon', r(s.place.lon, 4));
    q.set('tz', s.place.timeZone);
    q.set('alt', r(s.place.altitude, 0));
    if (s.place.name) q.set('name', s.place.name);
    if (s.place.zoneEstimated) q.set('tzguess', '1');
  }
  q.set('date', formatIsoDate(s.date));
  q.set('time', `${pad2(Math.floor(s.minutes / 60))}${pad2(Math.round(s.minutes % 60))}`);
  q.set('tilt', r(s.panel.tilt, 1));
  q.set('az', r(s.panel.azimuth, 1));
  if (s.horizon.length) q.set('sky', s.horizon.map((p) => `${r(p.az, 1)}:${r(p.el, 1)}`).join(','));
  if (s.sky.source !== DEFAULT_SKY.source) q.set('src', s.sky.source);
  if (s.sky.aod700 !== DEFAULT_SKY.aod700) q.set('aod', r(s.sky.aod700, 3));
  if (s.sky.pw !== DEFAULT_SKY.pw) q.set('pw', r(s.sky.pw, 2));
  if (s.sky.albedo !== DEFAULT_SKY.albedo) q.set('alb', r(s.sky.albedo, 2));
  if (s.sky.transposition !== DEFAULT_SKY.transposition) q.set('tr', s.sky.transposition);
  if (s.pv.kwp !== DEFAULT_PV.kwp) q.set('kwp', r(s.pv.kwp, 2));
  if (s.pv.gammaPct !== DEFAULT_PV.gammaPct) q.set('gamma', r(s.pv.gammaPct, 3));
  if (s.pv.noct !== DEFAULT_PV.noct) q.set('noct', r(s.pv.noct, 1));
  if (s.pv.lossesPct !== DEFAULT_PV.lossesPct) q.set('loss', r(s.pv.lossesPct, 1));
  if (s.pv.ambient !== DEFAULT_PV.ambient) q.set('tamb', r(s.pv.ambient, 1));
  if (s.period.kind !== 'year') {
    q.set(
      'period',
      s.period.kind === 'custom'
        ? `${String(s.period.from ?? 101).padStart(4, '0')}-${String(s.period.to ?? 1231).padStart(4, '0')}`
        : s.period.kind,
    );
  }
  return q;
}

function num(q: URLSearchParams, key: string, lo: number, hi: number): number | undefined {
  const raw = q.get(key);
  if (raw === null || raw.trim() === '') return undefined;
  const v = Number(raw);
  if (!Number.isFinite(v)) return undefined;
  return clamp(v, lo, hi);
}

/** Like num() but rejects (instead of clamping) out-of-range values. */
function strictNum(q: URLSearchParams, key: string, lo: number, hi: number): number | undefined {
  const raw = q.get(key);
  if (raw === null || raw.trim() === '') return undefined;
  const v = Number(raw);
  return Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
}

function validMonthDay(md: number): boolean {
  const m = Math.floor(md / 100);
  const d = md % 100;
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/**
 * Applies URL parameters on top of a base state. Invalid values are ignored one by one,
 * so a bad parameter never breaks the page.
 */
export function decodeState(search: string, base: AppState): AppState {
  const q = new URLSearchParams(search);
  const s: AppState = structuredClone(base);

  const preset = q.get('place');
  const p = preset ? placeById(preset) : undefined;
  if (p) {
    s.place = placeStateFrom(p);
  } else {
    const lat = strictNum(q, 'lat', -90, 90);
    const lon = strictNum(q, 'lon', -180, 180);
    if (lat !== undefined && lon !== undefined) {
      const tz = q.get('tz') ?? '';
      const zoneOk = isValidTimeZone(tz);
      s.place = {
        presetId: null,
        name: (q.get('name') ?? '').slice(0, 60) || 'Custom location',
        lat,
        lon,
        timeZone: zoneOk ? tz : nauticalZone(lon),
        altitude: num(q, 'alt', LIMITS.altitude[0], LIMITS.altitude[1]) ?? 0,
        zoneEstimated: !zoneOk || q.get('tzguess') === '1',
      };
    }
  }

  const date = parseIsoDate(q.get('date') ?? '');
  if (date) s.date = date;
  const time = q.get('time');
  if (time && /^\d{4}$/.test(time)) {
    const h = Number(time.slice(0, 2));
    const m = Number(time.slice(2));
    if (h < 24 && m < 60) s.minutes = h * 60 + m;
  }
  const tilt = num(q, 'tilt', 0, 90);
  if (tilt !== undefined) s.panel.tilt = tilt;
  const az = num(q, 'az', -360, 720);
  if (az !== undefined) s.panel.azimuth = wrap360(az);

  const sky = q.get('sky');
  if (sky) {
    const pts = sky
      .split(',')
      .slice(0, MAX_HORIZON_POINTS)
      .map((pair) => pair.split(':').map(Number))
      .filter((a) => a.length === 2 && a.every(Number.isFinite))
      .map(([a, e]) => ({ az: a, el: e }));
    s.horizon = sanitizeHorizon(pts);
  }

  const src = q.get('src');
  if (src === 'clear' || src === 'climate') s.sky.source = src;
  s.sky.aod700 = num(q, 'aod', ...LIMITS.aod700) ?? s.sky.aod700;
  s.sky.pw = num(q, 'pw', ...LIMITS.pw) ?? s.sky.pw;
  s.sky.albedo = num(q, 'alb', ...LIMITS.albedo) ?? s.sky.albedo;
  const tr = q.get('tr');
  if (tr === 'perez' || tr === 'haydavies') s.sky.transposition = tr;

  s.pv.kwp = num(q, 'kwp', ...LIMITS.kwp) ?? s.pv.kwp;
  s.pv.gammaPct = num(q, 'gamma', ...LIMITS.gammaPct) ?? s.pv.gammaPct;
  s.pv.noct = num(q, 'noct', ...LIMITS.noct) ?? s.pv.noct;
  s.pv.lossesPct = num(q, 'loss', ...LIMITS.lossesPct) ?? s.pv.lossesPct;
  s.pv.ambient = num(q, 'tamb', ...LIMITS.ambient) ?? s.pv.ambient;

  const period = q.get('period');
  if (period === 'year' || period === 'summer' || period === 'winter') {
    s.period = { kind: period };
  } else if (period && /^\d{4}-\d{4}$/.test(period)) {
    const from = Number(period.slice(0, 4));
    const to = Number(period.slice(5));
    if (validMonthDay(from) && validMonthDay(to)) s.period = { kind: 'custom', from, to };
  }
  return s;
}

/** Mirrors an azimuth across the east–west line (used when a place changes hemisphere). */
export function mirrorAzimuth(az: number): number {
  return wrap360(180 - az);
}
