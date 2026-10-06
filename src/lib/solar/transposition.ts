/**
 * Transposition of horizontal irradiance to a tilted plane.
 *
 * - Perez et al. (1990), "Modeling daylight availability and irradiance components from
 *   direct and global irradiance", Solar Energy 44(5), 271–289 — 'allsitescomposite1990'
 *   coefficients (Table 6), as used by pvlib, SAM and PVsyst.
 * - Hay & Davies (1980), anisotropic sky with a circumsolar part weighted by DNI/E0.
 * - Ground reflection: isotropic, albedo × GHI × (1 − cos β)/2.
 *
 * Conventions follow pvlib: zenith angles are apparent (refraction-corrected), the
 * circumsolar projection uses max(cos Z, cos 85°) for Perez and max(cos Z, 0.01745) for
 * Hay–Davies, and the sky-diffuse total is clipped at zero.
 */
import { DEG, cosd, sind } from './math';

export type TranspositionModel = 'perez' | 'haydavies';

/** Perez 1990 all-sites composite: rows = clearness bins 1–8; [f11, f12, f13, f21, f22, f23]. */
export const PEREZ_1990: readonly (readonly number[])[] = [
  [-0.008, 0.588, -0.062, -0.06, 0.072, -0.022],
  [0.13, 0.683, -0.151, -0.019, 0.066, -0.029],
  [0.33, 0.487, -0.221, 0.055, -0.064, -0.026],
  [0.568, 0.187, -0.295, 0.109, -0.152, -0.014],
  [0.873, -0.392, -0.362, 0.226, -0.462, 0.001],
  [1.132, -1.237, -0.412, 0.288, -0.823, 0.056],
  [1.06, -1.6, -0.359, 0.264, -1.127, 0.131],
  [0.678, -0.327, -0.25, 0.156, -1.377, 0.251],
];

/** Upper edges of the sky-clearness (ε) bins 1–7; bin 8 is ε ≥ 6.2. */
export const PEREZ_EPSILON_EDGES = [1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2];

export interface PerezBrightness {
  /** Circumsolar brightening coefficient (≥ 0) */
  F1: number;
  /** Horizon brightening coefficient (may be negative) */
  F2: number;
  /** Sky clearness ε */
  epsilon: number;
  /** Sky brightness Δ */
  delta: number;
}

/**
 * Perez F1/F2 for a sky state. `airMass` is the relative (not pressure-corrected) air mass.
 * Returns null when the coefficients are undefined (no diffuse light).
 */
export function perezBrightness(
  dhi: number,
  dni: number,
  dniExtra: number,
  apparentZenithDeg: number,
  airMass: number,
): PerezBrightness | null {
  if (!(dhi > 0)) return null;
  const kappa = 1.041;
  const z = apparentZenithDeg * DEG;
  const z3 = kappa * z * z * z;
  const epsilon = ((dhi + dni) / dhi + z3) / (1 + z3);
  const delta = (dhi * airMass) / dniExtra;
  let bin = 0;
  while (bin < PEREZ_EPSILON_EDGES.length && epsilon >= PEREZ_EPSILON_EDGES[bin]) bin++;
  const c = PEREZ_1990[bin];
  const F1 = Math.max(0, c[0] + c[1] * delta + c[2] * z);
  const F2 = c[3] + c[4] * delta + c[5] * z;
  return { F1, F2, epsilon, delta };
}

/** cos(angle of incidence) between the Sun and a plane's normal (can be negative). */
export function cosIncidence(
  tiltDeg: number,
  surfaceAzimuthDeg: number,
  sunZenithDeg: number,
  sunAzimuthDeg: number,
): number {
  return (
    cosd(tiltDeg) * cosd(sunZenithDeg) +
    sind(tiltDeg) * sind(sunZenithDeg) * cosd(sunAzimuthDeg - surfaceAzimuthDeg)
  );
}

/** Isotropic-sky view factor of an unobstructed tilted plane. */
export function isotropicViewFactor(tiltDeg: number): number {
  return (1 + cosd(tiltDeg)) / 2;
}

/** Ground-reflected irradiance on a tilted plane (isotropic ground). */
export function groundReflected(tiltDeg: number, ghi: number, albedo: number): number {
  return ghi * albedo * ((1 - cosd(tiltDeg)) / 2);
}

export interface SkyDiffuseParts {
  total: number;
  isotropic: number;
  circumsolar: number;
  horizon: number;
}

export interface SkyDiffuseInput {
  model: TranspositionModel;
  tiltDeg: number;
  /** cos of the angle of incidence (may be negative) */
  cosAoi: number;
  /** apparent solar zenith, degrees */
  zenithDeg: number;
  dni: number;
  dhi: number;
  dniExtra: number;
  /** relative air mass (Perez only) */
  airMass: number;
  /**
   * Sky view factor of the isotropic dome as seen by the plane, after obstructions.
   * Defaults to (1 + cos β)/2 (unobstructed).
   */
  isoViewFactor?: number;
  /** Fraction of the horizon band visible to the plane (Perez F2 term). Default 1. */
  horizonVisibility?: number;
  /** 1 if the solar disc is visible, 0 if hidden behind the skyline. Default 1. */
  sunVisible?: number;
}

export function skyDiffuse(input: SkyDiffuseInput): SkyDiffuseParts {
  const { model, tiltDeg, cosAoi, zenithDeg, dni, dhi, dniExtra } = input;
  const iso = input.isoViewFactor ?? isotropicViewFactor(tiltDeg);
  const vis = input.sunVisible ?? 1;
  const hzVis = input.horizonVisibility ?? 1;
  const a = Math.max(cosAoi, 0);
  const cosZ = cosd(zenithDeg);
  if (!(dhi > 0) || zenithDeg >= 90) {
    return { total: 0, isotropic: 0, circumsolar: 0, horizon: 0 };
  }

  if (model === 'haydavies') {
    const ai = dni / dniExtra;
    const rb = a / Math.max(cosZ, 0.01745);
    const isotropic = Math.max(dhi * (1 - ai) * iso, 0);
    const circumsolar = Math.max(dhi * ai * rb * vis, 0);
    return { total: isotropic + circumsolar, isotropic, circumsolar, horizon: 0 };
  }

  const pb = perezBrightness(dhi, dni, dniExtra, zenithDeg, input.airMass);
  if (!pb) return { total: 0, isotropic: 0, circumsolar: 0, horizon: 0 };
  const b = Math.max(cosZ, cosd(85));
  const isotropic = dhi * (1 - pb.F1) * iso;
  const circumsolar = dhi * pb.F1 * (a / b) * vis;
  const horizon = dhi * pb.F2 * sind(tiltDeg) * hzVis;
  const total = Math.max(isotropic + circumsolar + horizon, 0);
  if (total === 0) return { total: 0, isotropic: 0, circumsolar: 0, horizon: 0 };
  return { total, isotropic, circumsolar, horizon };
}

export interface PlaneOfArray {
  total: number;
  beam: number;
  skyDiffuse: number;
  ground: number;
  /** cos of angle of incidence */
  cosAoi: number;
  parts: SkyDiffuseParts;
}

export interface PlaneInput extends Omit<SkyDiffuseInput, 'cosAoi'> {
  surfaceAzimuthDeg: number;
  sunAzimuthDeg: number;
  ghi: number;
  albedo: number;
}

/** Beam + sky diffuse + ground-reflected irradiance on a tilted plane. */
export function planeOfArray(input: PlaneInput): PlaneOfArray {
  const cosAoi = cosIncidence(
    input.tiltDeg,
    input.surfaceAzimuthDeg,
    input.zenithDeg,
    input.sunAzimuthDeg,
  );
  const vis = input.sunVisible ?? 1;
  const up = input.zenithDeg < 90;
  const beam = up ? input.dni * Math.max(cosAoi, 0) * vis : 0;
  const parts = skyDiffuse({ ...input, cosAoi });
  const ground = up ? groundReflected(input.tiltDeg, input.ghi, input.albedo) : 0;
  return {
    total: beam + parts.total + ground,
    beam,
    skyDiffuse: parts.total,
    ground,
    cosAoi,
    parts,
  };
}
