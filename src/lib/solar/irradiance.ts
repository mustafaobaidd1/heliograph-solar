/**
 * Extraterrestrial irradiance, air mass and the simplified Solis clear-sky model.
 *
 * Simplified Solis: P. Ineichen, "A broadband simplified version of the Solis clear sky
 * model", Solar Energy 82 (2008) 758–762. Coefficients transcribed from pvlib-python
 * (pvlib.clearsky.simplified_solis, BSD-3-Clause), whose published test values are used
 * in the unit tests.
 */
import { DEG } from './math';

/** Total solar irradiance at 1 AU, W/m² (Kopp & Lean, Geophys. Res. Lett. 38, L01706, 2011). */
export const SOLAR_CONSTANT = 1361;

/** Extraterrestrial normal irradiance for an Earth–Sun distance in AU (inverse-square law). */
export function extraterrestrialNormal(radiusVectorAu: number): number {
  return SOLAR_CONSTANT / (radiusVectorAu * radiusVectorAu);
}

/**
 * Relative optical air mass, Kasten & Young (1989), from the apparent zenith angle in degrees.
 * Returns NaN when the Sun is below the horizon.
 */
export function relativeAirMass(apparentZenithDeg: number): number {
  if (!(apparentZenithDeg <= 90)) return Number.NaN;
  const z = apparentZenithDeg;
  return 1 / (Math.cos(z * DEG) + 0.50572 * (96.07995 - z) ** -1.6364);
}

/** Standard-atmosphere pressure (Pa) at an altitude in metres (as pvlib.atmosphere.alt2pres). */
export function pressureFromAltitude(altitudeM: number): number {
  return 100 * ((44331.514 - altitudeM) / 11880.516) ** (1 / 0.1902632);
}

export interface Irradiance {
  /** Global horizontal irradiance, W/m² */
  ghi: number;
  /** Direct normal irradiance, W/m² */
  dni: number;
  /** Diffuse horizontal irradiance, W/m² */
  dhi: number;
}

/** Elevation-independent part of the simplified Solis model. */
export interface SolisCoefficients {
  /** Enhanced extraterrestrial irradiance as a multiple of I0 */
  i0pFactor: number;
  taub: number;
  b: number;
  taug: number;
  g: number;
  taud: number;
  d: number;
}

export function solisCoefficients(
  aod700: number,
  precipitableWaterCm: number,
  pressurePa: number,
): SolisCoefficients {
  const p0 = 101325;
  const w = Math.max(precipitableWaterCm, 0.2); // the fit is undefined below 0.2 cm
  const a = aod700;
  const lnw = Math.log(w);
  const lnp = Math.log(pressurePa / p0);

  const io0 = 1.08 * w ** 0.0051;
  const i01 = 0.97 * w ** 0.032;
  const i02 = 0.12 * w ** 0.56;
  const i0pFactor = i02 * a * a + i01 * a + io0 + 0.071 * lnp;

  const tb1 = 1.82 + 0.056 * lnw + 0.0071 * lnw * lnw;
  const tb0 = 0.33 + 0.045 * lnw + 0.0096 * lnw * lnw;
  const tbp = 0.0089 * w + 0.13;
  const taub = tb1 * a + tb0 + tbp * lnp;

  const b1 = 0.00925 * a * a + 0.0148 * a - 0.0172;
  const b0 = -0.7565 * a * a + 0.5057 * a + 0.4557;
  const b = b1 * lnw + b0;

  const tg1 = 1.24 + 0.047 * lnw + 0.0061 * lnw * lnw;
  const tg0 = 0.27 + 0.043 * lnw + 0.009 * lnw * lnw;
  const tgp = 0.0079 * w + 0.1;
  const taug = tg1 * a + tg0 + tgp * lnp;

  const g = -0.0147 * lnw - 0.3079 * a * a + 0.2846 * a + 0.3798;

  let td4: number, td3: number, td2: number, td1: number, td0: number, tdp: number;
  if (a < 0.05) {
    td4 = 86 * w - 13800;
    td3 = -3.11 * w + 79.4;
    td2 = -0.23 * w + 74.8;
    td1 = 0.092 * w - 8.86;
    td0 = 0.0042 * w + 3.12;
    tdp = -0.83 * (1 + a) ** -17.2;
  } else {
    td4 = -0.21 * w + 11.6;
    td3 = 0.27 * w - 20.7;
    td2 = -0.134 * w + 15.5;
    td1 = 0.0554 * w - 5.71;
    td0 = 0.0057 * w + 2.94;
    tdp = -0.71 * (1 + a) ** -15.0;
  }
  const taud = td4 * a ** 4 + td3 * a ** 3 + td2 * a * a + td1 * a + td0 + tdp * lnp;

  const dp = 1 / (18 + 152 * a);
  const d = -0.337 * a * a + 0.63 * a + 0.116 + dp * lnp;

  return { i0pFactor, taub, b, taug, g, taud, d };
}

/**
 * The simplified Solis model exactly as published (three independent fits).
 * Note that GHI ≠ DNI·sin(h) + DHI exactly; see `clearSky` for the closed version.
 */
export function simplifiedSolis(
  apparentElevationDeg: number,
  aod700 = 0.1,
  precipitableWaterCm = 1,
  pressurePa = 101325,
  dniExtra = 1364,
): Irradiance {
  const c = solisCoefficients(aod700, precipitableWaterCm, pressurePa);
  return solisFromCoefficients(Math.sin(apparentElevationDeg * DEG), dniExtra, c, false);
}

/**
 * Clear-sky irradiance with closure enforced: the model's DNI and DHI are kept and
 * GHI = DNI·sin(h) + DHI, so a horizontal plane receives exactly GHI after transposition.
 */
export function clearSky(sinElevation: number, dniExtra: number, c: SolisCoefficients): Irradiance {
  return solisFromCoefficients(sinElevation, dniExtra, c, true);
}

function solisFromCoefficients(
  sinElevation: number,
  dniExtra: number,
  c: SolisCoefficients,
  closed: boolean,
): Irradiance {
  if (!(sinElevation > 0)) return { ghi: 0, dni: 0, dhi: 0 };
  const i0p = dniExtra * c.i0pFactor;
  const dni = i0p * Math.exp(-c.taub / sinElevation ** c.b);
  const dhi = i0p * Math.exp(-c.taud / sinElevation ** c.d);
  const ghi = closed
    ? dni * sinElevation + dhi
    : i0p * Math.exp(-c.taug / sinElevation ** c.g) * sinElevation;
  return { ghi, dni, dhi };
}
