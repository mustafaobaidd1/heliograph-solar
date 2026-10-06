import { describe, expect, it } from 'vitest';
import {
  SOLAR_CONSTANT,
  clearSky,
  extraterrestrialNormal,
  pressureFromAltitude,
  relativeAirMass,
  simplifiedSolis,
  solisCoefficients,
} from './irradiance';
import { sind } from './math';

/**
 * Expected values are pvlib-python's own regression tests for simplified_solis
 * (tests/test_clearsky.py, pvlib main branch, read 2026-10-06), which reproduce
 * Ineichen (2008). Relative tolerance 1e-6 (pvlib uses assert_allclose rtol 1e-7).
 */
const close = (actual: number, expected: number, rtol = 1e-6, atol = 1e-6) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(atol + rtol * Math.abs(expected));

describe('simplified Solis clear-sky model (pvlib test vectors)', () => {
  it('apparent elevation 80°, defaults (aod700 0.1, w 1 cm, 101325 Pa, I0 1364)', () => {
    const r = simplifiedSolis(80);
    close(r.ghi, 1064.653145);
    close(r.dni, 959.335463);
    close(r.dhi, 129.125602);
  });

  it('returns zeros below the horizon', () => {
    expect(simplifiedSolis(-10)).toEqual({ ghi: 0, dni: 0, dhi: 0 });
  });

  it('scales with extraterrestrial irradiance', () => {
    const r = simplifiedSolis(80, 0.1, 1, 101325, 1370);
    close(r.ghi, 1069.33637);
    close(r.dni, 963.555414);
    close(r.dhi, 129.693603);
  });

  it('pressure dependence', () => {
    const expected = [
      [95000, 1067.96543669, 964.26930718, 127.22841797],
      [98000, 1066.36847963, 961.88811874, 128.1402539],
      [101000, 1064.81837558, 959.58112234, 129.0304193],
    ];
    for (const [p, ghi, dni, dhi] of expected) {
      const r = simplifiedSolis(80, 0.1, 1, p);
      close(r.ghi, ghi);
      close(r.dni, dni);
      close(r.dhi, dhi);
    }
  });

  it('aerosol optical depth dependence, including both taud branches', () => {
    const expected = [
      [0.0, 1105.7229086, 1056.61710493, 64.41747323],
      [0.05, 1085.74139063, 1007.50558875, 102.96233698],
      [0.1, 1064.65314509, 959.3354628, 129.12560167],
      [1, 638.63409683, 342.45810926, 77.71786575],
      [10, 7.5413313, 55.24140911, 0],
    ];
    for (const [aod, ghi, dni, dhi] of expected) {
      const r = simplifiedSolis(80, aod);
      close(r.ghi, ghi);
      close(r.dni, dni);
      close(r.dhi, dhi);
    }
  });

  it('precipitable water dependence (values below 0.2 cm are clamped)', () => {
    const expected = [
      [0.0, 1107.84678941, 1001.15353307, 128.58887606],
      [0.2, 1107.84678941, 1001.15353307, 128.58887606],
      [0.5, 1089.62306672, 983.51027357, 129.08755996],
      [1.0, 1064.65314509, 959.3354628, 129.12560167],
      [5.0, 974.18046717, 872.02335029, 125.63581346],
    ];
    for (const [w, ghi, dni, dhi] of expected) {
      const r = simplifiedSolis(80, 0.1, w);
      close(r.ghi, ghi);
      close(r.dni, dni);
      close(r.dhi, dhi);
    }
  });

  it('meshgrid case aod700 ∈ {0, 0.5} × w ∈ {0, 10}', () => {
    const cases = [
      [0, 0, 1148.40081325, 1099.25706525, 64.1063074],
      [0.5, 0, 913.42330823, 656.24601381, 254.6186615],
      [0, 10, 965.48550828, 915.31689149, 62.75642216],
      [0.5, 10, 760.04527609, 530.31697378, 232.21931597],
    ];
    for (const [aod, w, ghi, dni, dhi] of cases) {
      const r = simplifiedSolis(80, aod, w);
      close(r.ghi, ghi);
      close(r.dni, dni);
      close(r.dhi, dhi);
    }
  });

  it('closed variant keeps DNI and DHI and enforces GHI = DNI·sin h + DHI', () => {
    const c = solisCoefficients(0.1, 1, 101325);
    const r = clearSky(sind(80), 1364, c);
    close(r.dni, 959.335463);
    close(r.dhi, 129.125602);
    close(r.ghi, r.dni * sind(80) + r.dhi, 1e-12);
    // The published three-fit GHI differs from closure by under 1 % at this elevation.
    expect(Math.abs(r.ghi / 1064.653145 - 1)).toBeLessThan(0.01);
  });

  it('closure adds at most 14 W/m² to the fitted GHI (≤ 2.5 % above 30°) for typical skies', () => {
    // Ineichen (2008) quotes ~20 W/m² accuracy for the global fit, so closure stays within it.
    for (const aod of [0.05, 0.1, 0.2, 0.3]) {
      for (const w of [0.5, 1.5, 3]) {
        const c = solisCoefficients(aod, w, 101325);
        for (let h = 2; h <= 90; h += 1) {
          const fitted = simplifiedSolis(h, aod, w, 101325, 1361).ghi;
          const closed = clearSky(sind(h), 1361, c).ghi;
          expect(closed - fitted).toBeGreaterThanOrEqual(0);
          expect(closed - fitted).toBeLessThan(14);
          if (h >= 30) expect(closed / fitted - 1).toBeLessThan(0.025);
        }
      }
    }
  });
});

describe('extraterrestrial irradiance, air mass and pressure', () => {
  it('uses the 1361 W/m² solar constant with the inverse-square law', () => {
    expect(SOLAR_CONSTANT).toBe(1361);
    expect(extraterrestrialNormal(1)).toBe(1361);
    // Perihelion (0.9833 AU) and aphelion (1.0167 AU): about ±3.4 %.
    expect(extraterrestrialNormal(0.9833)).toBeCloseTo(1407.6, 0);
    expect(extraterrestrialNormal(1.0167)).toBeCloseTo(1316.6, 0);
  });

  it('Kasten–Young air mass: 1 at zenith, ~2 at 60°, ~38 at the horizon, NaN below', () => {
    expect(relativeAirMass(0)).toBeCloseTo(0.99972, 4);
    expect(relativeAirMass(60)).toBeCloseTo(1.9942, 3);
    expect(relativeAirMass(90)).toBeCloseTo(37.92, 1);
    expect(Number.isNaN(relativeAirMass(95))).toBe(true);
  });

  it('standard-atmosphere pressure from altitude', () => {
    expect(pressureFromAltitude(0)).toBeCloseTo(101325, -1);
    // pvlib alt2pres(1000) ≈ 89876 Pa; Quito (2850 m) ≈ 71.7 kPa
    expect(pressureFromAltitude(1000)).toBeCloseTo(89876, -2);
    expect(pressureFromAltitude(2850) / 1000).toBeCloseTo(71.7, 0);
  });
});
