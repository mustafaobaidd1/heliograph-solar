/**
 * A site model ties the pieces together for one place: sun position → clear-sky (or
 * climate-scaled) irradiance → skyline check → plane-of-array irradiance. The same code is
 * used on the main thread (live readout, today's curve) and in the worker (annual work).
 */
import type { ClimateFactors } from './climate';
import { horizonTable, skyView, sunAboveSkyline } from './horizon';
import type { HorizonPoint, HorizonTable, SkyView } from './horizon';
import {
  clearSky,
  extraterrestrialNormal,
  pressureFromAltitude,
  relativeAirMass,
  solisCoefficients,
} from './irradiance';
import type { SolisCoefficients } from './irradiance';
import { sind } from './math';
import { sunPosition } from './sunPosition';
import type { SunPosition } from './sunPosition';
import { MS_PER_MINUTE } from './time';
import { planeOfArray } from './transposition';
import type { PlaneOfArray, TranspositionModel } from './transposition';

export interface SiteSpec {
  lat: number;
  lon: number;
  /** Site altitude above sea level, metres (sets the pressure used by the clear-sky model). */
  altitude: number;
  /** Aerosol optical depth at 700 nm */
  aod700: number;
  /** Precipitable water, cm */
  pw: number;
  /** Ground albedo 0–1 */
  albedo: number;
  transposition: TranspositionModel;
  horizon: HorizonPoint[];
}

export interface Orientation {
  /** Tilt from horizontal, degrees 0–90 */
  tilt: number;
  /** Direction the panel faces, degrees clockwise from north */
  azimuth: number;
}

export interface SkySample {
  utc: number;
  sun: SunPosition;
  dniExtra: number;
  airMass: number;
  dni: number;
  dhi: number;
  ghi: number;
  /** Solar disc above the skyline */
  sunVisible: boolean;
}

/** Calendar month (0–11) of the local-mean-time day that contains a UTC instant. */
export function localMeanMonth(utcMs: number, lonDeg: number): number {
  return new Date(utcMs + lonDeg * 4 * MS_PER_MINUTE).getUTCMonth();
}

export class SiteModel {
  readonly spec: SiteSpec;
  readonly solis: SolisCoefficients;
  readonly horizon: HorizonTable;
  readonly pressure: number;
  private readonly views = new Map<string, SkyView>();

  constructor(spec: SiteSpec) {
    this.spec = spec;
    this.pressure = pressureFromAltitude(spec.altitude);
    this.solis = solisCoefficients(spec.aod700, spec.pw, this.pressure);
    this.horizon = horizonTable(spec.horizon);
  }

  /** Sun and irradiance at an instant; `factors` scales clear-sky to long-term averages. */
  sample(utc: number, factors: ClimateFactors | null = null): SkySample {
    const sun = sunPosition(utc, this.spec.lat, this.spec.lon);
    const dniExtra = extraterrestrialNormal(sun.radiusVector);
    if (sun.elevation <= 0) {
      return { utc, sun, dniExtra, airMass: Number.NaN, dni: 0, dhi: 0, ghi: 0, sunVisible: false };
    }
    const sinH = sind(sun.elevation);
    const cs = clearSky(sinH, dniExtra, this.solis);
    let { dni, dhi } = cs;
    if (factors) {
      const m = localMeanMonth(utc, this.spec.lon);
      dni *= factors.kB[m];
      dhi *= factors.kD[m];
    }
    return {
      utc,
      sun,
      dniExtra,
      airMass: relativeAirMass(sun.zenith),
      dni,
      dhi,
      ghi: dni * sinH + dhi,
      sunVisible: sunAboveSkyline(this.horizon, sun.azimuth, sun.elevation),
    };
  }

  /** Sky view of a plane after the skyline (memoised per orientation). */
  view(o: Orientation): SkyView {
    const key = `${o.tilt.toFixed(3)}|${o.azimuth.toFixed(3)}`;
    let v = this.views.get(key);
    if (!v) {
      v = skyView(this.horizon, o.tilt, o.azimuth);
      if (this.views.size > 512) this.views.clear();
      this.views.set(key, v);
    }
    return v;
  }

  /** Plane-of-array irradiance; `shaded = false` ignores the skyline (for shading-loss figures). */
  plane(s: SkySample, o: Orientation, shaded = true): PlaneOfArray {
    const v = shaded ? this.view(o) : null;
    return planeOfArray({
      model: this.spec.transposition,
      tiltDeg: o.tilt,
      surfaceAzimuthDeg: o.azimuth,
      zenithDeg: s.sun.zenith,
      sunAzimuthDeg: s.sun.azimuth,
      dni: s.dni,
      dhi: s.dhi,
      ghi: s.ghi,
      dniExtra: s.dniExtra,
      airMass: s.airMass,
      albedo: this.spec.albedo,
      sunVisible: shaded ? (s.sunVisible ? 1 : 0) : s.sun.elevation > 0 ? 1 : 0,
      isoViewFactor: v ? v.iso : undefined,
      horizonVisibility: v ? v.horizonBand : undefined,
    });
  }
}

export interface DayPoint {
  utc: number;
  /** Minutes since local midnight */
  minute: number;
  elevation: number;
  azimuth: number;
  poa: number;
  beam: number;
  diffuse: number;
  ground: number;
  ghi: number;
  /** POA if the skyline were absent */
  poaUnshaded: number;
  sunVisible: boolean;
}

export interface DayProfile {
  points: DayPoint[];
  /** kWh/m² on the panel over the day */
  total: number;
  totalUnshaded: number;
  /** kWh/m² on a horizontal surface over the day */
  totalGhi: number;
}

/**
 * Samples a local day [startUtc, endUtc) every `stepMinutes` and integrates with the
 * trapezoidal rule. Start and end are local midnights (DST days are 23 or 25 h long).
 */
export function dayProfile(
  model: SiteModel,
  startUtc: number,
  endUtc: number,
  o: Orientation,
  factors: ClimateFactors | null,
  stepMinutes = 5,
): DayProfile {
  const step = stepMinutes * MS_PER_MINUTE;
  const n = Math.round((endUtc - startUtc) / step);
  const points: DayPoint[] = [];
  for (let k = 0; k <= n; k++) {
    const utc = startUtc + k * step;
    const s = model.sample(utc, factors);
    const p = model.plane(s, o, true);
    const pu = model.spec.horizon.length ? model.plane(s, o, false) : p;
    points.push({
      utc,
      minute: k * stepMinutes,
      elevation: s.sun.elevation,
      azimuth: s.sun.azimuth,
      poa: p.total,
      beam: p.beam,
      diffuse: p.skyDiffuse,
      ground: p.ground,
      ghi: s.ghi,
      poaUnshaded: pu.total,
      sunVisible: s.sunVisible,
    });
  }
  const h = stepMinutes / 60;
  const trap = (f: (p: DayPoint) => number): number => {
    let sum = 0;
    for (let k = 1; k < points.length; k++) sum += ((f(points[k - 1]) + f(points[k])) / 2) * h;
    return sum / 1000;
  };
  return {
    points,
    total: trap((p) => p.poa),
    totalUnshaded: trap((p) => p.poaUnshaded),
    totalGhi: trap((p) => p.ghi),
  };
}
