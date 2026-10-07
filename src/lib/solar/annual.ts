/**
 * Annual (or seasonal / date-range) integration of plane-of-array irradiance, the
 * tilt × azimuth landscape, golden-section refinement of the optimum, alternative
 * strategies (seasonal re-tilt, trackers) and the PV yield estimate.
 *
 * Everything that does not depend on the panel's orientation (sun vector, irradiance
 * components, Perez brightness coefficients, skyline visibility, air temperature) is
 * computed once per time step into a YearTable, so evaluating one orientation is a single
 * pass of a dot product and a few multiply-adds per daylight step.
 */
import { airTemperature, climateFactors } from './climate';
import type { ClimateFactors, ClimateNormals } from './climate';
import { skyView, sunAboveSkyline } from './horizon';
import type { HorizonTable, SkyView } from './horizon';
import { clearSky, extraterrestrialNormal, relativeAirMass } from './irradiance';
import { DEG, RAD, clamp, wrap360 } from './math';
import type { Orientation, SiteModel } from './model';
import { solarGeometry, sunPositionFromGeometry } from './sunPosition';
import { MS_PER_MINUTE, daysInMonth, daysInYear, julianCentury, julianDay } from './time';
import { perezBrightness } from './transposition';

const COS85 = Math.cos(85 * DEG);

export interface MonthlyTriple {
  ghi: number[];
  dni: number[];
  dhi: number[];
  /** Beam on the horizontal, DNI · sin h */
  beamH: number[];
}

const zeros12 = (): number[] => new Array(12).fill(0);

export interface YearTable {
  year: number;
  lat: number;
  lon: number;
  stepMinutes: number;
  stepHours: number;
  /** Number of daylight steps stored */
  count: number;
  utc: Float64Array;
  month: Uint8Array;
  /** 0-based day of year */
  day: Uint16Array;
  /** month × 100 + day, per day of year (e.g. 621 for 21 June) */
  mmdd: Uint16Array;
  sx: Float32Array;
  sy: Float32Array;
  sz: Float32Array;
  zenith: Float32Array;
  azimuth: Float32Array;
  dni: Float32Array;
  dhi: Float32Array;
  ghi: Float32Array;
  vis: Uint8Array;
  isoBase: Float32Array;
  circK: Float32Array;
  horizBase: Float32Array;
  groundBase: Float32Array;
  airTemp: Float32Array;
  /** Clear-sky monthly means before scaling, kWh/m²/day */
  clearMonthly: MonthlyTriple;
  /** Monthly means of the irradiance actually used, kWh/m²/day */
  usedMonthly: MonthlyTriple;
  factors: ClimateFactors | null;
}

/**
 * Builds the per-step table for a calendar year. Days run from local mean midnight, steps are
 * sampled at their midpoints (`stepMinutes` apart), and only daylight steps are kept.
 */
export function buildYearTable(
  model: SiteModel,
  year: number,
  stepMinutes: number,
  climate: ClimateNormals | null,
  ambientC: number,
): YearTable {
  const { lat, lon, albedo, transposition } = model.spec;
  const nDays = daysInYear(year);
  const perDay = Math.round(1440 / stepMinutes);
  const cap = nDays * perDay;
  const stepHours = stepMinutes / 60;
  const lonMs = lon * 4 * MS_PER_MINUTE;

  const utc = new Float64Array(cap);
  const month = new Uint8Array(cap);
  const day = new Uint16Array(cap);
  const mmdd = new Uint16Array(nDays);
  const sx = new Float32Array(cap);
  const sy = new Float32Array(cap);
  const sz = new Float32Array(cap);
  const zenith = new Float32Array(cap);
  const azimuth = new Float32Array(cap);
  const dni = new Float32Array(cap);
  const dhi = new Float32Array(cap);
  const ghi = new Float32Array(cap);
  const vis = new Uint8Array(cap);
  const extra = new Float32Array(cap);
  const airMass = new Float32Array(cap);
  const airTemp = new Float32Array(cap);

  const sums = { ghi: zeros12(), dni: zeros12(), dhi: zeros12(), beamH: zeros12() };
  let c = 0;
  for (let d = 0; d < nDays; d++) {
    const civil = Date.UTC(year, 0, 1 + d);
    const date = new Date(civil);
    const m = date.getUTCMonth();
    mmdd[d] = (m + 1) * 100 + date.getUTCDate();
    const dayStart = civil - lonMs;
    for (let k = 0; k < perDay; k++) {
      const t = dayStart + (k + 0.5) * stepMinutes * MS_PER_MINUTE;
      const g = solarGeometry(julianCentury(julianDay(t)));
      const pos = sunPositionFromGeometry(g, t, lat, lon);
      if (pos.elevation <= 0) continue;
      const sinH = Math.sin(pos.elevation * DEG);
      const cosH = Math.cos(pos.elevation * DEG);
      const e0 = extraterrestrialNormal(pos.radiusVector);
      const cs = clearSky(sinH, e0, model.solis);
      utc[c] = t;
      month[c] = m;
      day[c] = d;
      sx[c] = cosH * Math.sin(pos.azimuth * DEG);
      sy[c] = cosH * Math.cos(pos.azimuth * DEG);
      sz[c] = sinH;
      zenith[c] = pos.zenith;
      azimuth[c] = pos.azimuth;
      dni[c] = cs.dni;
      dhi[c] = cs.dhi;
      ghi[c] = cs.ghi;
      extra[c] = e0;
      airMass[c] = relativeAirMass(pos.zenith);
      vis[c] = sunAboveSkyline(model.horizon, pos.azimuth, pos.elevation) ? 1 : 0;
      const solarHour = (k + 0.5) * stepHours;
      airTemp[c] = climate ? airTemperature(climate, m, solarHour) : ambientC;
      sums.ghi[m] += cs.ghi * stepHours;
      sums.dni[m] += cs.dni * stepHours;
      sums.dhi[m] += cs.dhi * stepHours;
      sums.beamH[m] += cs.dni * sinH * stepHours;
      c++;
    }
  }

  const perDayMean = (s: number[]): number[] =>
    s.map((v, m) => v / (daysInMonth(year, m + 1) * 1000));
  const clearMonthly: MonthlyTriple = {
    ghi: perDayMean(sums.ghi),
    dni: perDayMean(sums.dni),
    dhi: perDayMean(sums.dhi),
    beamH: perDayMean(sums.beamH),
  };
  const factors = climate ? climateFactors(clearMonthly.beamH, clearMonthly.dhi, climate) : null;

  const isoBase = new Float32Array(c);
  const circK = new Float32Array(c);
  const horizBase = new Float32Array(c);
  const groundBase = new Float32Array(c);
  const used = { ghi: zeros12(), dni: zeros12(), dhi: zeros12(), beamH: zeros12() };
  for (let i = 0; i < c; i++) {
    const m = month[i];
    if (factors) {
      dni[i] *= factors.kB[m];
      dhi[i] *= factors.kD[m];
      ghi[i] = dni[i] * sz[i] + dhi[i];
    }
    const cosZ = sz[i];
    if (transposition === 'perez') {
      const pb = perezBrightness(dhi[i], dni[i], extra[i], zenith[i], airMass[i]);
      const F1 = pb ? pb.F1 : 0;
      const F2 = pb ? pb.F2 : 0;
      isoBase[i] = dhi[i] * (1 - F1);
      circK[i] = (dhi[i] * F1) / Math.max(cosZ, COS85);
      horizBase[i] = dhi[i] * F2;
    } else {
      const ai = Math.min(1, dni[i] / extra[i]);
      isoBase[i] = dhi[i] * (1 - ai);
      circK[i] = (dhi[i] * ai) / Math.max(cosZ, 0.01745);
      horizBase[i] = 0;
    }
    groundBase[i] = ghi[i] * albedo;
    used.ghi[m] += ghi[i] * stepHours;
    used.dni[m] += dni[i] * stepHours;
    used.dhi[m] += dhi[i] * stepHours;
    used.beamH[m] += dni[i] * sz[i] * stepHours;
  }

  return {
    year,
    lat,
    lon,
    stepMinutes,
    stepHours,
    count: c,
    utc: utc.slice(0, c),
    month: month.slice(0, c),
    day: day.slice(0, c),
    mmdd,
    sx: sx.slice(0, c),
    sy: sy.slice(0, c),
    sz: sz.slice(0, c),
    zenith: zenith.slice(0, c),
    azimuth: azimuth.slice(0, c),
    dni: dni.slice(0, c),
    dhi: dhi.slice(0, c),
    ghi: ghi.slice(0, c),
    vis: vis.slice(0, c),
    isoBase,
    circK,
    horizBase,
    groundBase,
    airTemp: airTemp.slice(0, c),
    clearMonthly,
    usedMonthly: {
      ghi: perDayMean(used.ghi),
      dni: perDayMean(used.dni),
      dhi: perDayMean(used.dhi),
      beamH: perDayMean(used.beamH),
    },
    factors,
  };
}

/**
 * Climate scaling factors without building the full table (for the main thread's live
 * readout). Uses the same day boundaries and step midpoints as buildYearTable, so the
 * factors are identical for the same step.
 */
export function climateFactorsFor(
  model: SiteModel,
  year: number,
  normals: ClimateNormals,
  stepMinutes = 15,
): ClimateFactors {
  const { lat, lon } = model.spec;
  const nDays = daysInYear(year);
  const perDay = Math.round(1440 / stepMinutes);
  const lonMs = lon * 4 * MS_PER_MINUTE;
  const beamH = zeros12();
  const dhi = zeros12();
  for (let d = 0; d < nDays; d++) {
    const civil = Date.UTC(year, 0, 1 + d);
    const m = new Date(civil).getUTCMonth();
    const dayStart = civil - lonMs;
    for (let k = 0; k < perDay; k++) {
      const t = dayStart + (k + 0.5) * stepMinutes * MS_PER_MINUTE;
      const g = solarGeometry(julianCentury(julianDay(t)));
      const pos = sunPositionFromGeometry(g, t, lat, lon);
      if (pos.elevation <= 0) continue;
      const sinH = Math.sin(pos.elevation * DEG);
      const cs = clearSky(sinH, extraterrestrialNormal(pos.radiusVector), model.solis);
      beamH[m] += cs.dni * sinH;
      dhi[m] += cs.dhi;
    }
  }
  const h = stepMinutes / 60;
  const mean = (s: number[]): number[] =>
    s.map((v, m) => (v * h) / (daysInMonth(year, m + 1) * 1000));
  return climateFactors(mean(beamH), mean(dhi), normals);
}

// ---------------------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------------------

export type PeriodKind = 'year' | 'summer' | 'winter' | 'custom';

export interface PeriodSpec {
  kind: PeriodKind;
  /** month × 100 + day, inclusive (custom only) */
  from?: number;
  to?: number;
}

/** Inclusive month-day window, or null for the whole year. Summer/winter follow the hemisphere. */
export function resolvePeriod(p: PeriodSpec, lat: number): { from: number; to: number } | null {
  const north = lat >= 0;
  switch (p.kind) {
    case 'year':
      return null;
    case 'summer':
      return north ? { from: 601, to: 831 } : { from: 1201, to: 229 };
    case 'winter':
      return north ? { from: 1201, to: 229 } : { from: 601, to: 831 };
    case 'custom':
      return { from: p.from ?? 101, to: p.to ?? 1231 };
  }
}

export function inWindow(mmdd: number, w: { from: number; to: number } | null): boolean {
  if (!w) return true;
  return w.from <= w.to ? mmdd >= w.from && mmdd <= w.to : mmdd >= w.from || mmdd <= w.to;
}

/** Two seasons split at the equinoxes (20 Mar and 22 Sep). */
export function season2(mmdd: number): number {
  return mmdd >= 320 && mmdd < 922 ? 0 : 1;
}

/** Four seasons centred on the solstices/equinoxes, split at the cross-quarter days. */
export function season4(mmdd: number): number {
  if (mmdd < 204) return 3;
  if (mmdd < 506) return 0;
  if (mmdd < 807) return 1;
  if (mmdd < 1106) return 2;
  return 3;
}

/** Contiguous [start, end) index runs of steps whose day passes the filter. */
export function stepRanges(t: YearTable, keep: (mmdd: number) => boolean): Int32Array {
  const out: number[] = [];
  let start = -1;
  for (let i = 0; i < t.count; i++) {
    const ok = keep(t.mmdd[t.day[i]]);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      out.push(start, i);
      start = -1;
    }
  }
  if (start >= 0) out.push(start, t.count);
  return Int32Array.from(out);
}

export function periodRanges(
  t: YearTable,
  window: { from: number; to: number } | null,
): Int32Array {
  return window ? stepRanges(t, (md) => inWindow(md, window)) : Int32Array.from([0, t.count]);
}

// ---------------------------------------------------------------------------------------
// Sky views for many orientations
// ---------------------------------------------------------------------------------------

export const GRID_TILT_STEP = 2.5;
export const GRID_AZ_STEP = 5;
export const GRID_TILTS = Array.from(
  { length: 90 / GRID_TILT_STEP + 1 },
  (_, i) => i * GRID_TILT_STEP,
);
export const GRID_AZIMUTHS = Array.from({ length: 360 / GRID_AZ_STEP }, (_, i) => i * GRID_AZ_STEP);

/** Sky-view factors on the tilt × azimuth grid with bilinear lookup (for trackers). */
export class ViewGrid {
  readonly flat: boolean;
  private readonly horizon: HorizonTable;
  private iso: Float32Array | null = null;
  private band: Float32Array | null = null;
  private readonly memo = new Map<string, SkyView>();

  constructor(horizon: HorizonTable) {
    this.horizon = horizon;
    this.flat = horizon.flat;
  }

  exact(tilt: number, az: number): SkyView {
    const key = `${tilt.toFixed(4)}|${wrap360(az).toFixed(4)}`;
    let v = this.memo.get(key);
    if (!v) {
      v = skyView(this.horizon, tilt, wrap360(az));
      if (this.memo.size > 20000) this.memo.clear();
      this.memo.set(key, v);
    }
    return v;
  }

  private ensureGrid(): void {
    if (this.iso) return;
    const nt = GRID_TILTS.length;
    const na = GRID_AZIMUTHS.length;
    this.iso = new Float32Array(nt * na);
    this.band = new Float32Array(nt * na);
    for (let i = 0; i < nt; i++) {
      for (let j = 0; j < na; j++) {
        const v = this.exact(GRID_TILTS[i], GRID_AZIMUTHS[j]);
        this.iso[i * na + j] = v.iso;
        this.band![i * na + j] = v.horizonBand;
      }
    }
  }

  /** Bilinear interpolation of (iso, horizonBand); exact closed form when the horizon is flat. */
  lookup(tilt: number, az: number, out: { iso: number; band: number }): void {
    if (this.flat) {
      out.iso = (1 + Math.cos(tilt * DEG)) / 2;
      out.band = 1;
      return;
    }
    this.ensureGrid();
    const na = GRID_AZIMUTHS.length;
    const ti = clamp(tilt / GRID_TILT_STEP, 0, GRID_TILTS.length - 1.000001);
    const i0 = Math.floor(ti);
    const ft = ti - i0;
    const aj = wrap360(az) / GRID_AZ_STEP;
    const j0 = Math.floor(aj) % na;
    const j1 = (j0 + 1) % na;
    const fa = aj - Math.floor(aj);
    const iso = this.iso!;
    const band = this.band!;
    const a = (1 - ft) * (1 - fa);
    const b = (1 - ft) * fa;
    const c2 = ft * (1 - fa);
    const d = ft * fa;
    const r0 = i0 * na;
    const r1 = (i0 + 1) * na;
    out.iso = a * iso[r0 + j0] + b * iso[r0 + j1] + c2 * iso[r1 + j0] + d * iso[r1 + j1];
    out.band = a * band[r0 + j0] + b * band[r0 + j1] + c2 * band[r1 + j0] + d * band[r1 + j1];
  }
}

// ---------------------------------------------------------------------------------------
// Integrals
// ---------------------------------------------------------------------------------------

/** kWh/m² on a fixed plane over the given step ranges. */
export function integrateFixed(
  t: YearTable,
  o: Orientation,
  view: SkyView | null,
  ranges: Int32Array,
  shaded: boolean,
): number {
  const st = Math.sin(o.tilt * DEG);
  const ct = Math.cos(o.tilt * DEG);
  const nx = st * Math.sin(o.azimuth * DEG);
  const ny = st * Math.cos(o.azimuth * DEG);
  const nz = ct;
  const useView = shaded && view !== null;
  const iso = useView ? view.iso : (1 + ct) / 2;
  const hTerm = st * (useView ? view.horizonBand : 1);
  const gTerm = (1 - ct) / 2;
  const { sx, sy, sz, vis, dni, isoBase, circK, horizBase, groundBase } = t;
  let sum = 0;
  for (let r = 0; r < ranges.length; r += 2) {
    const end = ranges[r + 1];
    for (let i = ranges[r]; i < end; i++) {
      let c = nx * sx[i] + ny * sy[i] + nz * sz[i];
      if (c < 0) c = 0;
      const cv = shaded ? c * vis[i] : c;
      let diff = isoBase[i] * iso + circK[i] * cv + horizBase[i] * hTerm;
      if (diff < 0) diff = 0;
      sum += dni[i] * cv + diff + groundBase[i] * gTerm;
    }
  }
  return (sum * t.stepHours) / 1000;
}

/** Horizontal single-axis tracker, north–south axis, true tracking within ±maxAngle (no backtracking). */
export function integrateSingleAxis(
  t: YearTable,
  ranges: Int32Array,
  views: ViewGrid,
  shaded: boolean,
  maxAngleDeg = 60,
): number {
  const maxR = maxAngleDeg * DEG;
  const { sx, sz, vis, dni, isoBase, circK, horizBase, groundBase } = t;
  const v = { iso: 1, band: 1 };
  let sum = 0;
  for (let r = 0; r < ranges.length; r += 2) {
    const end = ranges[r + 1];
    for (let i = ranges[r]; i < end; i++) {
      let R = Math.atan2(sx[i], sz[i]);
      if (R > maxR) R = maxR;
      else if (R < -maxR) R = -maxR;
      const sR = Math.sin(R);
      const cR = Math.cos(R);
      let c = sR * sx[i] + cR * sz[i];
      if (c < 0) c = 0;
      const st = Math.abs(sR);
      if (shaded) views.lookup(Math.abs(R) * RAD, R >= 0 ? 90 : 270, v);
      else {
        v.iso = (1 + cR) / 2;
        v.band = 1;
      }
      const cv = shaded ? c * vis[i] : c;
      let diff = isoBase[i] * v.iso + circK[i] * cv + horizBase[i] * st * v.band;
      if (diff < 0) diff = 0;
      sum += dni[i] * cv + diff + groundBase[i] * ((1 - cR) / 2);
    }
  }
  return (sum * t.stepHours) / 1000;
}

/** Two-axis tracker: the panel normal follows the Sun. */
export function integrateDualAxis(
  t: YearTable,
  ranges: Int32Array,
  views: ViewGrid,
  shaded: boolean,
): number {
  const { sz, zenith, azimuth, vis, dni, isoBase, circK, horizBase, groundBase } = t;
  const v = { iso: 1, band: 1 };
  let sum = 0;
  for (let r = 0; r < ranges.length; r += 2) {
    const end = ranges[r + 1];
    for (let i = ranges[r]; i < end; i++) {
      const ct = sz[i];
      const st = Math.sqrt(Math.max(0, 1 - ct * ct));
      if (shaded) views.lookup(zenith[i], azimuth[i], v);
      else {
        v.iso = (1 + ct) / 2;
        v.band = 1;
      }
      const cv = shaded ? vis[i] : 1;
      let diff = isoBase[i] * v.iso + circK[i] * cv + horizBase[i] * st * v.band;
      if (diff < 0) diff = 0;
      sum += dni[i] * cv + diff + groundBase[i] * ((1 - ct) / 2);
    }
  }
  return (sum * t.stepHours) / 1000;
}

// ---------------------------------------------------------------------------------------
// Optimisation
// ---------------------------------------------------------------------------------------

export interface GoldenResult {
  x: number;
  fx: number;
  evaluations: number;
}

/** Golden-section search for the maximum of a unimodal function on [a, b]. */
export function goldenSectionMax(
  f: (x: number) => number,
  a: number,
  b: number,
  tol = 1e-3,
  maxIter = 200,
): GoldenResult {
  const invphi = (Math.sqrt(5) - 1) / 2;
  let lo = Math.min(a, b);
  let hi = Math.max(a, b);
  let x1 = hi - invphi * (hi - lo);
  let x2 = lo + invphi * (hi - lo);
  let f1 = f(x1);
  let f2 = f(x2);
  let evaluations = 2;
  for (let k = 0; k < maxIter && hi - lo > tol; k++) {
    if (f1 >= f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - invphi * (hi - lo);
      f1 = f(x1);
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + invphi * (hi - lo);
      f2 = f(x2);
    }
    evaluations++;
  }
  return f1 >= f2 ? { x: x1, fx: f1, evaluations } : { x: x2, fx: f2, evaluations };
}

export interface HeatMap {
  tilts: number[];
  azimuths: number[];
  /** kWh/m², row-major [tiltIndex * azimuths.length + azimuthIndex] */
  values: Float32Array;
  max: number;
  min: number;
  bestTilt: number;
  bestAzimuth: number;
}

export function computeHeatMap(
  t: YearTable,
  ranges: Int32Array,
  views: ViewGrid,
  shaded: boolean,
  onRow?: (done: number, total: number) => void,
): HeatMap {
  const na = GRID_AZIMUTHS.length;
  const nt = GRID_TILTS.length;
  const values = new Float32Array(nt * na);
  let max = -Infinity;
  let min = Infinity;
  let bestTilt = 0;
  let bestAzimuth = 0;
  for (let i = 0; i < nt; i++) {
    const tilt = GRID_TILTS[i];
    for (let j = 0; j < na; j++) {
      const azimuth = GRID_AZIMUTHS[j];
      const view = shaded && !views.flat ? views.exact(tilt, azimuth) : null;
      const e = integrateFixed(t, { tilt, azimuth }, view, ranges, shaded);
      values[i * na + j] = e;
      if (e > max) {
        max = e;
        bestTilt = tilt;
        bestAzimuth = azimuth;
      }
      if (e < min) min = e;
      // A horizontal plane has no azimuth: fill the row with the same value.
      if (tilt === 0) {
        for (let jj = 1; jj < na; jj++) values[jj] = e;
        break;
      }
    }
    onRow?.(i + 1, nt);
  }
  return { tilts: GRID_TILTS, azimuths: GRID_AZIMUTHS, values, max, min, bestTilt, bestAzimuth };
}

export interface Optimum {
  tilt: number;
  azimuth: number;
  /** kWh/m² over the period */
  energy: number;
  evaluations: number;
}

/**
 * Refines the best grid cell with nested golden-section searches (azimuth outside, tilt
 * inside) over a bracket of ±2 grid steps, which contains the maximum of a smooth unimodal
 * landscape sampled at this resolution.
 */
export function refineOptimum(
  t: YearTable,
  ranges: Int32Array,
  heat: HeatMap,
  views: ViewGrid,
  shaded: boolean,
  lat: number,
): Optimum {
  let evaluations = 0;
  const energy = (tilt: number, az: number): number => {
    evaluations++;
    const view = shaded && !views.flat ? views.exact(tilt, az) : null;
    return integrateFixed(t, { tilt, azimuth: wrap360(az) }, view, ranges, shaded);
  };
  const tLo = Math.max(0, heat.bestTilt - 2 * GRID_TILT_STEP);
  const tHi = Math.min(90, heat.bestTilt + 2 * GRID_TILT_STEP);
  const bestTiltAt = (az: number): GoldenResult =>
    goldenSectionMax((tilt) => energy(tilt, az), tLo, tHi, 0.01);

  const equator = lat >= 0 ? 180 : 0;
  let best: Optimum;
  if (heat.bestTilt === 0 && tHi <= 2 * GRID_TILT_STEP) {
    // Nearly flat optimum: azimuth is weakly defined, search it fully on a coarse ring first.
    let az0 = equator;
    let e0 = -Infinity;
    for (let az = 0; az < 360; az += 15) {
      const r = bestTiltAt(az);
      if (r.fx > e0) {
        e0 = r.fx;
        az0 = az;
      }
    }
    const outer = goldenSectionMax((az) => bestTiltAt(az).fx, az0 - 15, az0 + 15, 0.01);
    const inner = bestTiltAt(outer.x);
    best = { tilt: inner.x, azimuth: wrap360(outer.x), energy: inner.fx, evaluations: 0 };
  } else {
    const azLo = heat.bestAzimuth - 2 * GRID_AZ_STEP;
    const azHi = heat.bestAzimuth + 2 * GRID_AZ_STEP;
    const outer = goldenSectionMax((az) => bestTiltAt(az).fx, azLo, azHi, 0.01);
    const inner = bestTiltAt(outer.x);
    best = { tilt: inner.x, azimuth: wrap360(outer.x), energy: inner.fx, evaluations: 0 };
  }
  if (heat.max > best.energy) {
    best = { tilt: heat.bestTilt, azimuth: heat.bestAzimuth, energy: heat.max, evaluations: 0 };
  }
  // A plane within 0.05° of horizontal faces nowhere in particular: report the equator.
  if (best.tilt < 0.05) best = { ...best, tilt: 0, azimuth: equator };
  return { ...best, evaluations };
}

/** Best tilt (0–90°) at a fixed azimuth: coarse 5° scan, then golden-section. */
export function bestTiltAtAzimuth(
  t: YearTable,
  ranges: Int32Array,
  azimuth: number,
  views: ViewGrid,
  shaded: boolean,
): GoldenResult {
  const f = (tilt: number): number => {
    const view = shaded && !views.flat ? views.exact(tilt, azimuth) : null;
    return integrateFixed(t, { tilt, azimuth }, view, ranges, shaded);
  };
  let bt = 0;
  let be = -Infinity;
  for (let tilt = 0; tilt <= 90; tilt += 5) {
    const e = f(tilt);
    if (e > be) {
      be = e;
      bt = tilt;
    }
  }
  const r = goldenSectionMax(f, Math.max(0, bt - 5), Math.min(90, bt + 5), 0.01);
  return r.fx >= be ? r : { x: bt, fx: be, evaluations: r.evaluations };
}

export type StrategyId = 'rule' | 'fixed' | 'retilt2' | 'retilt4' | 'single' | 'dual';

export interface StrategyResult {
  id: StrategyId;
  /** kWh/m² over the period */
  energy: number;
  /** % relative to the optimum fixed panel */
  gainPct: number;
  /** Tilts used (rule/fixed: one; re-tilt: per season) */
  tilts: number[];
  azimuth: number | null;
  /** Re-tilt only: the direction faced in each season (the mount may tip either way about its E–W axis) */
  azimuths?: number[];
}

export function compareStrategies(
  t: YearTable,
  window: { from: number; to: number } | null,
  ranges: Int32Array,
  opt: Optimum,
  views: ViewGrid,
  shaded: boolean,
): StrategyResult[] {
  const lat = t.lat;
  const ruleTilt = Math.min(90, Math.abs(lat));
  const ruleAz = lat >= 0 ? 180 : 0;
  const ruleView = shaded && !views.flat ? views.exact(ruleTilt, ruleAz) : null;
  const rule = integrateFixed(t, { tilt: ruleTilt, azimuth: ruleAz }, ruleView, ranges, shaded);

  const retilt = (seasons: number, seasonOf: (mmdd: number) => number): StrategyResult => {
    let energy = 0;
    const tilts: number[] = [];
    const azimuths: number[] = [];
    const back = wrap360(opt.azimuth + 180);
    for (let s = 0; s < seasons; s++) {
      const rs = stepRanges(t, (md) => inWindow(md, window) && seasonOf(md) === s);
      if (rs.length === 0) {
        tilts.push(Number.NaN);
        azimuths.push(opt.azimuth);
        continue;
      }
      // The re-tilt mount pivots about a horizontal axis across the panel, so a season may
      // tip it either way (this matters near the equator, where the Sun crosses the zenith).
      const front = bestTiltAtAzimuth(t, rs, opt.azimuth, views, shaded);
      const rear = bestTiltAtAzimuth(t, rs, back, views, shaded);
      const useRear = rear.fx > front.fx + 1e-9 && rear.x > 0.05;
      energy += useRear ? rear.fx : front.fx;
      tilts.push(useRear ? rear.x : front.x);
      azimuths.push(useRear ? back : opt.azimuth);
    }
    return {
      id: seasons === 2 ? 'retilt2' : 'retilt4',
      energy,
      gainPct: 0,
      tilts,
      azimuth: opt.azimuth,
      azimuths,
    };
  };

  const results: StrategyResult[] = [
    { id: 'rule', energy: rule, gainPct: 0, tilts: [ruleTilt], azimuth: ruleAz },
    { id: 'fixed', energy: opt.energy, gainPct: 0, tilts: [opt.tilt], azimuth: opt.azimuth },
    retilt(2, season2),
    retilt(4, season4),
    {
      id: 'single',
      energy: integrateSingleAxis(t, ranges, views, shaded),
      gainPct: 0,
      tilts: [],
      azimuth: null,
    },
    {
      id: 'dual',
      energy: integrateDualAxis(t, ranges, views, shaded),
      gainPct: 0,
      tilts: [],
      azimuth: null,
    },
  ];
  for (const r of results) {
    r.gainPct = opt.energy > 0 ? (r.energy / opt.energy - 1) * 100 : 0;
  }
  return results;
}

// ---------------------------------------------------------------------------------------
// PV estimate
// ---------------------------------------------------------------------------------------

export interface PvParams {
  /** Nameplate DC power, kWp */
  kwp: number;
  /** Power temperature coefficient, %/°C (negative) */
  gammaPct: number;
  /** Nominal operating cell temperature, °C */
  noct: number;
  /** System losses (wiring, soiling, mismatch, inverter…), % */
  lossesPct: number;
}

/** ASHRAE incidence-angle modifier coefficient for glass-covered modules. */
export const ASHRAE_B0 = 0.05;

export function ashraeIam(cosAoi: number, b0 = ASHRAE_B0): number {
  if (cosAoi <= 0) return 0;
  return Math.max(0, 1 - b0 * (1 / cosAoi - 1));
}

/** NOCT cell temperature: Tc = Ta + (NOCT − 20 °C)/(800 W/m²) × G_POA. */
export function noctCellTemperature(airC: number, poa: number, noct: number): number {
  return airC + ((noct - 20) / 800) * poa;
}

/** AC power (kW) for a given effective irradiance and cell temperature. */
export function pvPower(effectiveIrradiance: number, cellC: number, pv: PvParams): number {
  const dc = pv.kwp * (effectiveIrradiance / 1000) * (1 + (pv.gammaPct / 100) * (cellC - 25));
  return Math.max(0, dc * (1 - pv.lossesPct / 100));
}

export interface PvResult {
  monthlyKwh: number[];
  annualKwh: number;
  /** kWh per kWp per year */
  specificYield: number;
  /** kWh/m² on the panel per month (with skyline) */
  monthlyPoa: number[];
  annualPoa: number;
  annualPoaUnshaded: number;
  shadingLossPct: number;
  /** Energy-weighted mean cell temperature in daylight, °C */
  meanCellTemp: number;
  /** AC yield / (POA × kWp): performance ratio including temperature, IAM and system losses */
  performanceRatio: number;
}

/**
 * PV yield over the year table. `ambientC` overrides the table's air temperature (used in
 * clear-sky mode, where there is no climatology); pass null to use the table's values.
 */
export function pvEstimate(
  t: YearTable,
  o: Orientation,
  view: SkyView | null,
  pv: PvParams,
  ambientC: number | null = null,
): PvResult {
  const st = Math.sin(o.tilt * DEG);
  const ct = Math.cos(o.tilt * DEG);
  const nx = st * Math.sin(o.azimuth * DEG);
  const ny = st * Math.cos(o.azimuth * DEG);
  const nz = ct;
  const isoClear = (1 + ct) / 2;
  const iso = view ? view.iso : isoClear;
  const hTerm = st * (view ? view.horizonBand : 1);
  const gTerm = (1 - ct) / 2;
  const monthlyKwh = new Array(12).fill(0);
  const monthlyPoa = new Array(12).fill(0);
  let annualPoaUnshaded = 0;
  let tcWeighted = 0;
  let poaSum = 0;
  const h = t.stepHours;
  for (let i = 0; i < t.count; i++) {
    let c = nx * t.sx[i] + ny * t.sy[i] + nz * t.sz[i];
    if (c < 0) c = 0;
    const cv = c * t.vis[i];
    const beam = t.dni[i] * cv;
    const circ = t.circK[i] * cv;
    let diff = t.isoBase[i] * iso + circ + t.horizBase[i] * hTerm;
    const circPart = diff > 0 ? circ : 0;
    if (diff < 0) diff = 0;
    const ground = t.groundBase[i] * gTerm;
    const poa = beam + diff + ground;
    let diffU = t.isoBase[i] * isoClear + t.circK[i] * c + t.horizBase[i] * st;
    if (diffU < 0) diffU = 0;
    annualPoaUnshaded += t.dni[i] * c + diffU + ground;

    const iam = ashraeIam(c);
    const eff = (beam + circPart) * iam + (diff - circPart) + ground;
    const tc = noctCellTemperature(ambientC ?? t.airTemp[i], poa, pv.noct);
    const p = pvPower(eff, tc, pv);
    monthlyKwh[t.month[i]] += p * h;
    monthlyPoa[t.month[i]] += (poa * h) / 1000;
    tcWeighted += tc * poa;
    poaSum += poa;
  }
  annualPoaUnshaded = (annualPoaUnshaded * h) / 1000;
  const annualKwh = monthlyKwh.reduce((a, b) => a + b, 0);
  const annualPoa = monthlyPoa.reduce((a, b) => a + b, 0);
  return {
    monthlyKwh,
    annualKwh,
    specificYield: pv.kwp > 0 ? annualKwh / pv.kwp : 0,
    monthlyPoa,
    annualPoa,
    annualPoaUnshaded,
    shadingLossPct:
      annualPoaUnshaded > 0 ? Math.max(0, (1 - annualPoa / annualPoaUnshaded) * 100) : 0,
    meanCellTemp: poaSum > 0 ? tcWeighted / poaSum : Number.NaN,
    performanceRatio: annualPoa > 0 && pv.kwp > 0 ? annualKwh / (annualPoa * pv.kwp) : 0,
  };
}
