import { describe, expect, it } from 'vitest';
import { clearSky, extraterrestrialNormal, relativeAirMass, solisCoefficients } from './irradiance';
import { cosd, sind } from './math';
import {
  cosIncidence,
  groundReflected,
  isotropicViewFactor,
  perezBrightness,
  planeOfArray,
  skyDiffuse,
} from './transposition';

/**
 * Inputs and expected values from pvlib-python tests/test_irradiance.py (main branch, read
 * 2026-10-06): fixtures generated at Location(32.2, -111, 'US/Arizona', 700) on 2014-06-24,
 * surface tilt 40°, azimuth 180°. The Hay–Davies values are labelled there as coming from
 * the MATLAB PVLIB 1.4 code.
 */
const FIXTURE = {
  ghi: [0, 79.73860422, 1042.48031487, 257.20751138],
  dni: [0, 316.1949056, 939.95469881, 646.22886049],
  dhi: [0, 40.46149818, 118.45831879, 62.03376265],
  apparentZenith: [124.0390863, 82.85457044, 10.56413562, 72.41687122],
  azimuth: [352.69550699, 66.71410338, 144.76567754, 287.04104128],
  dniExtra: 1321.1655834833093,
  airMass: [Number.NaN, 7.58831596, 1.01688136, 3.27930443],
};

const at = (i: number) => ({
  tiltDeg: 40,
  cosAoi: cosIncidence(40, 180, FIXTURE.apparentZenith[i], FIXTURE.azimuth[i]),
  zenithDeg: FIXTURE.apparentZenith[i],
  dni: FIXTURE.dni[i],
  dhi: FIXTURE.dhi[i],
  dniExtra: FIXTURE.dniExtra,
  airMass: FIXTURE.airMass[i],
});

describe('Hay–Davies sky diffuse (pvlib test_haydavies)', () => {
  const expected = [0, 27.1775, 102.9949, 33.1909];
  const iso = [0, 27.1775, 30.1818, 27.9837];
  const circ = [0, 0, 72.813, 5.2071];
  for (let i = 0; i < 4; i++) {
    it(`step ${i}`, () => {
      const r = skyDiffuse({ model: 'haydavies', ...at(i) });
      expect(r.total).toBeCloseTo(expected[i], 3);
      expect(r.isotropic).toBeCloseTo(iso[i], 3);
      expect(r.circumsolar).toBeCloseTo(circ[i], 3);
    });
  }
});

describe('Perez 1990 sky diffuse (pvlib test_perez, test_perez_components)', () => {
  it('night and low-sun steps', () => {
    expect(skyDiffuse({ model: 'perez', ...at(0) }).total).toBe(0);
    const r1 = skyDiffuse({ model: 'perez', ...at(1) });
    expect(r1.total).toBeCloseTo(31.46046871, 2);
    expect(r1.isotropic).toBeCloseTo(26.84138589, 2);
    expect(r1.circumsolar).toBeCloseTo(0, 6);
    expect(r1.horizon).toBeCloseTo(4.62212181, 2);
  });

  it('afternoon step with all three components', () => {
    const r3 = skyDiffuse({ model: 'perez', ...at(3) });
    expect(r3.total).toBeCloseTo(45.45539877, 2);
    expect(r3.isotropic).toBeCloseTo(31.72696071, 2);
    expect(r3.circumsolar).toBeCloseTo(4.47966439, 2);
    expect(r3.horizon).toBeCloseTo(9.25316454, 2);
  });

  it('near-noon scalar case (test_perez_scalar = 109.084332)', () => {
    const r = skyDiffuse({ model: 'perez', ...at(2) });
    expect(r.total).toBeCloseTo(109.084332, 4);
  });

  it('negative horizon brightening at Goodwin Creek (test_perez_negative_horizon)', () => {
    const dni = [158, 19, 1, 0, 0];
    const dhi = [249, 165, 136, 93, 50];
    const zen = [57.746951, 57.564205, 60.813841, 66.989435, 75.353368];
    const az = [171.003315, 187.346924, 202.974357, 216.725599, 228.317233];
    const am = [1.869315, 1.859981, 2.044429, 2.544943, 3.900136];
    const total = [281.410185, 152.20879, 123.867898, 82.836412, 43.517015];
    const horizon = [1.07601, -6.13353, -5.262151, -3.83123, -2.208923];
    for (let i = 0; i < 5; i++) {
      const r = skyDiffuse({
        model: 'perez',
        tiltDeg: 34,
        cosAoi: cosIncidence(34, 180, zen[i], az[i]),
        zenithDeg: zen[i],
        dni: dni[i],
        dhi: dhi[i],
        dniExtra: 1414,
        airMass: am[i],
      });
      expect(r.total).toBeCloseTo(total[i], 2);
      expect(r.horizon).toBeCloseTo(horizon[i], 2);
    }
  });

  it('clearness bins: ε grows with the beam fraction', () => {
    const overcast = perezBrightness(200, 0, 1361, 30, 1.15)!;
    const clear = perezBrightness(100, 900, 1361, 30, 1.15)!;
    expect(overcast.epsilon).toBeCloseTo(1, 6);
    expect(clear.epsilon).toBeGreaterThan(6.2);
    expect(perezBrightness(0, 800, 1361, 30, 1.15)).toBeNull();
  });
});

describe('isotropic and ground-reflected components (pvlib)', () => {
  it('isotropic(40, 100) = 88.30222215594891', () => {
    expect(100 * isotropicViewFactor(40)).toBeCloseTo(88.30222215594891, 10);
  });
  it('get_ground_diffuse(40, 900) with albedo 0.25 = 26.32000014911496', () => {
    expect(groundReflected(40, 900, 0.25)).toBeCloseTo(26.32000014911496, 8);
  });
  it('get_ground_diffuse(45, 1000, 0.2) = 0.2·0.5·(1 − √2/2)·1000', () => {
    expect(groundReflected(45, 1000, 0.2)).toBeCloseTo(0.2 * 0.5 * (1 - Math.SQRT2 / 2) * 1000, 10);
  });
});

describe('transposition sanity checks (brief)', () => {
  const c = solisCoefficients(0.1, 1.5, 101325);
  const e0 = extraterrestrialNormal(1);

  for (const model of ['perez', 'haydavies'] as const) {
    it(`${model}: a horizontal plane receives exactly GHI`, () => {
      for (const zen of [5, 20, 40, 60, 75, 84]) {
        const cs = clearSky(cosd(zen), e0, c);
        const poa = planeOfArray({
          model,
          tiltDeg: 0,
          surfaceAzimuthDeg: 180,
          zenithDeg: zen,
          sunAzimuthDeg: 135,
          dni: cs.dni,
          dhi: cs.dhi,
          ghi: cs.ghi,
          dniExtra: e0,
          airMass: relativeAirMass(zen),
          albedo: 0.2,
        });
        expect(poa.total).toBeCloseTo(cs.ghi, 8);
        expect(poa.ground).toBe(0);
      }
    });

    it(`${model}: a plane facing the Sun receives the full DNI as beam`, () => {
      const zen = 35;
      const sunAz = 150;
      const cs = clearSky(cosd(zen), e0, c);
      const poa = planeOfArray({
        model,
        tiltDeg: zen,
        surfaceAzimuthDeg: sunAz,
        zenithDeg: zen,
        sunAzimuthDeg: sunAz,
        dni: cs.dni,
        dhi: cs.dhi,
        ghi: cs.ghi,
        dniExtra: e0,
        airMass: relativeAirMass(zen),
        albedo: 0.2,
      });
      expect(poa.cosAoi).toBeCloseTo(1, 12);
      expect(poa.beam).toBeCloseTo(cs.dni, 9);
    });

    it(`${model}: night gives zero on any plane`, () => {
      const poa = planeOfArray({
        model,
        tiltDeg: 60,
        surfaceAzimuthDeg: 90,
        zenithDeg: 101,
        sunAzimuthDeg: 40,
        dni: 0,
        dhi: 0,
        ghi: 0,
        dniExtra: e0,
        airMass: Number.NaN,
        albedo: 0.2,
      });
      expect(poa.total).toBe(0);
    });
  }

  it('beam is zero when the Sun is behind the plane or hidden by the skyline', () => {
    const base = {
      model: 'perez' as const,
      tiltDeg: 30,
      surfaceAzimuthDeg: 180,
      zenithDeg: 70,
      sunAzimuthDeg: 0,
      dni: 700,
      dhi: 90,
      ghi: 700 * cosd(70) + 90,
      dniExtra: e0,
      airMass: relativeAirMass(70),
      albedo: 0.2,
    };
    // cos(AOI) = cos30·cos70 − sin30·sin70 < 0: the Sun is behind the panel.
    expect(planeOfArray(base).cosAoi).toBeLessThan(0);
    expect(planeOfArray(base).beam).toBe(0);
    const facing = { ...base, sunAzimuthDeg: 180 };
    expect(planeOfArray(facing).beam).toBeGreaterThan(0);
    expect(planeOfArray({ ...facing, sunVisible: 0 }).beam).toBe(0);
  });

  it('cos(AOI) follows the spherical law of cosines', () => {
    expect(cosIncidence(0, 0, 30, 77)).toBeCloseTo(cosd(30), 12);
    expect(cosIncidence(90, 90, 90, 90)).toBeCloseTo(1, 12);
    expect(cosIncidence(90, 90, 90, 270)).toBeCloseTo(-1, 12);
    expect(cosIncidence(30, 180, 30, 180)).toBeCloseTo(1, 12);
    expect(cosIncidence(45, 180, 0, 0)).toBeCloseTo(sind(45), 12);
  });
});
