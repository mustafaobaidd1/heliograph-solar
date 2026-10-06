/**
 * Skyline (horizon) profiles: a closed polyline of (azimuth, elevation) points joined by
 * straight lines and wrapping through north — the convention of PVGIS horizon files and
 * PVsyst far-shading profiles. An empty profile is a flat, unobstructed horizon.
 */
import { DEG, clamp, cosd, sind, wrap360 } from './math';

export interface HorizonPoint {
  /** Azimuth clockwise from north, degrees [0, 360) */
  az: number;
  /** Elevation of the skyline above the horizon, degrees [0, MAX_HORIZON_ELEVATION] */
  el: number;
}

export const MAX_HORIZON_ELEVATION = 80;
export const MAX_HORIZON_POINTS = 240;

/** Rounds, wraps, clamps, sorts and de-duplicates points (same azimuth keeps the highest). */
export function sanitizeHorizon(points: readonly HorizonPoint[]): HorizonPoint[] {
  const byAz = new Map<number, number>();
  for (const p of points) {
    if (!Number.isFinite(p.az) || !Number.isFinite(p.el)) continue;
    const az = Math.round(wrap360(p.az) * 10) / 10;
    const key = az >= 360 ? 0 : az;
    const el = Math.round(clamp(p.el, 0, MAX_HORIZON_ELEVATION) * 10) / 10;
    byAz.set(key, Math.max(byAz.get(key) ?? 0, el));
  }
  return [...byAz.entries()]
    .map(([az, el]) => ({ az, el }))
    .sort((a, b) => a.az - b.az)
    .slice(0, MAX_HORIZON_POINTS);
}

/** Skyline elevation at an azimuth by linear interpolation around the circle. */
export function horizonElevationAt(points: readonly HorizonPoint[], azimuthDeg: number): number {
  const n = points.length;
  if (n === 0) return 0;
  if (n === 1) return points[0].el;
  const az = wrap360(azimuthDeg);
  let i = 0;
  while (i < n && points[i].az <= az) i++;
  const next = points[i % n];
  const prev = points[(i - 1 + n) % n];
  let span = next.az - prev.az;
  let offset = az - prev.az;
  if (span <= 0) span += 360;
  if (offset < 0) offset += 360;
  const t = span === 0 ? 0 : offset / span;
  return prev.el + (next.el - prev.el) * t;
}

/** Lookup table sampling the profile every `stepDeg` degrees, for fast evaluation in loops. */
export interface HorizonTable {
  stepDeg: number;
  values: Float32Array;
  /** True when every sample is zero (flat horizon). */
  flat: boolean;
  /** Highest skyline elevation, degrees. */
  max: number;
}

export function horizonTable(points: readonly HorizonPoint[], stepDeg = 0.5): HorizonTable {
  const n = Math.round(360 / stepDeg);
  const values = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const v = horizonElevationAt(points, i * stepDeg);
    values[i] = v;
    if (v > max) max = v;
  }
  return { stepDeg, values, flat: max <= 0, max };
}

export function horizonFromTable(table: HorizonTable, azimuthDeg: number): number {
  if (table.flat) return 0;
  const n = table.values.length;
  const x = wrap360(azimuthDeg) / table.stepDeg;
  const i0 = Math.floor(x) % n;
  const i1 = (i0 + 1) % n;
  const t = x - Math.floor(x);
  return table.values[i0] * (1 - t) + table.values[i1] * t;
}

/** Whether the centre of the solar disc is above the skyline. */
export function sunAboveSkyline(
  table: HorizonTable,
  sunAzimuthDeg: number,
  sunElevationDeg: number,
): boolean {
  if (sunElevationDeg <= 0) return false;
  if (table.flat) return true;
  return sunElevationDeg > horizonFromTable(table, sunAzimuthDeg);
}

/** Width of the Perez horizon-brightening band, degrees (Perez et al. 1990 use ~6.5°). */
export const HORIZON_BAND_DEG = 6.5;

export interface SkyView {
  /** Isotropic sky view factor of the plane, after the skyline is removed (0 … (1 + cos β)/2). */
  iso: number;
  /** Unobstructed isotropic view factor (1 + cos β)/2. */
  isoClear: number;
  /** Visible fraction of the horizon band, weighted by the plane's view of it (0 … 1). */
  horizonBand: number;
}

/**
 * Sky view factor of a tilted plane with a skyline. The obstructed part of the dome is
 * subtracted analytically in elevation for each 1° azimuth sector:
 *   F = (1 + cos β)/2 − (1/π) Σ Δφ ∫₀^{h(φ)} max(0, sin β cos e cos(φ − A) + cos β sin e) cos e de.
 */
export function skyView(table: HorizonTable, tiltDeg: number, surfaceAzimuthDeg: number): SkyView {
  const isoClear = (1 + cosd(tiltDeg)) / 2;
  if (table.flat) return { iso: isoClear, isoClear, horizonBand: 1 };

  const sinB = sind(tiltDeg);
  const cosB = cosd(tiltDeg);
  const sectors = 360;
  const dPhi = (2 * Math.PI) / sectors;
  let blocked = 0;
  let bandWeight = 0;
  let bandVisible = 0;

  // F(e) = ∫ (P cos e + Q sin e) cos e de = P (e/2 + sin 2e / 4) + Q sin² e / 2
  const F = (P: number, Q: number, e: number): number =>
    P * (e / 2 + Math.sin(2 * e) / 4) + (Q * Math.sin(e) * Math.sin(e)) / 2;

  for (let k = 0; k < sectors; k++) {
    const phi = k + 0.5;
    const h = horizonFromTable(table, phi);
    const cosRel = cosd(phi - surfaceAzimuthDeg);
    const P = sinB * cosRel;
    const Q = cosB;
    if (h > 0) {
      const hr = h * DEG;
      let lower = 0;
      if (P < 0) lower = Q > 0 ? Math.atan(-P / Q) : Math.PI / 2; // where the plane starts to see the sky
      if (hr > lower) blocked += (F(P, Q, hr) - F(P, Q, lower)) * dPhi;
    }
    const w = Math.max(0, cosRel);
    bandWeight += w;
    bandVisible += w * clamp(1 - h / HORIZON_BAND_DEG, 0, 1);
  }

  const iso = Math.max(0, isoClear - blocked / Math.PI);
  const horizonBand = bandWeight > 0 ? bandVisible / bandWeight : 1;
  return { iso, isoClear, horizonBand };
}

/** Example skylines offered in the editor. */
export const HORIZON_PRESETS: { id: string; label: string; points: HorizonPoint[] }[] = [
  {
    id: 'tree-sw',
    label: 'Tree to the south-west',
    points: [
      { az: 196, el: 0 },
      { az: 200, el: 14 },
      { az: 207, el: 27 },
      { az: 216, el: 31 },
      { az: 226, el: 26 },
      { az: 233, el: 12 },
      { az: 236, el: 0 },
    ],
  },
  {
    id: 'block-east',
    label: 'Neighbouring block to the east',
    points: [
      { az: 70, el: 0 },
      { az: 71, el: 24 },
      { az: 128, el: 24 },
      { az: 129, el: 0 },
    ],
  },
  {
    id: 'street',
    label: 'Street canyon (east–west street)',
    points: [
      { az: 0, el: 34 },
      { az: 60, el: 30 },
      { az: 90, el: 6 },
      { az: 120, el: 30 },
      { az: 180, el: 34 },
      { az: 240, el: 30 },
      { az: 270, el: 6 },
      { az: 300, el: 30 },
    ],
  },
  {
    id: 'ridge',
    label: 'Mountain ridge',
    points: [
      { az: 0, el: 4 },
      { az: 60, el: 6 },
      { az: 100, el: 11 },
      { az: 140, el: 8 },
      { az: 190, el: 5 },
      { az: 240, el: 9 },
      { az: 280, el: 13 },
      { az: 320, el: 7 },
    ],
  },
];
