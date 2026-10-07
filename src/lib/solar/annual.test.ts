import { describe, expect, it } from 'vitest';
import presets from '../../data/climate-presets.json';
import { PLACES } from '../places';
import {
  ViewGrid,
  ashraeIam,
  bestTiltAtAzimuth,
  buildYearTable,
  climateFactorsFor,
  compareStrategies,
  computeHeatMap,
  goldenSectionMax,
  inWindow,
  integrateFixed,
  noctCellTemperature,
  periodRanges,
  pvEstimate,
  pvPower,
  refineOptimum,
  resolvePeriod,
  season2,
  season4,
} from './annual';
import type { YearTable } from './annual';
import type { ClimateNormals } from './climate';
import { HORIZON_PRESETS } from './horizon';
import { SiteModel, dayProfile } from './model';
import { PVGIS_OPTIMA as PVGIS, jacobsonJadhav } from './references';
import type { SiteSpec } from './model';
import { zonedTimeToUtc } from './zone';

const STEP = 15;

function site(lat: number, lon: number, altitude = 0, extra: Partial<SiteSpec> = {}): SiteModel {
  return new SiteModel({
    lat,
    lon,
    altitude,
    aod700: 0.1,
    pw: 1.5,
    albedo: 0.2,
    transposition: 'perez',
    horizon: [],
    ...extra,
  });
}

function normalsFor(id: string): ClimateNormals {
  const p = (presets.places as Record<string, (typeof presets.places)['amman']>)[id];
  return { ...p };
}

function optimise(model: SiteModel, climate: ClimateNormals | null) {
  const table = buildYearTable(model, 2026, STEP, climate, 25);
  const ranges = periodRanges(table, null);
  const views = new ViewGrid(model.horizon);
  const heat = computeHeatMap(table, ranges, views, true);
  const opt = refineOptimum(table, ranges, heat, views, true, model.spec.lat);
  return { table, ranges, views, heat, opt };
}

describe('golden-section search', () => {
  it('finds the maximum of a parabola to the requested tolerance', () => {
    const r = goldenSectionMax((x) => -((x - 1.3) ** 2), 0, 4, 1e-6);
    expect(r.x).toBeCloseTo(1.3, 5);
    expect(r.evaluations).toBeLessThan(40);
  });
  it('handles a maximum at the boundary and reversed brackets', () => {
    expect(goldenSectionMax((x) => x, 0, 10, 1e-4).x).toBeCloseTo(10, 3);
    expect(goldenSectionMax((x) => Math.cos(x), 1, -1, 1e-6).x).toBeCloseTo(0, 5);
  });
});

describe('periods and seasons', () => {
  it('summer/winter follow the hemisphere and wrap through the new year', () => {
    expect(resolvePeriod({ kind: 'summer' }, 32)).toEqual({ from: 601, to: 831 });
    expect(resolvePeriod({ kind: 'summer' }, -34)).toEqual({ from: 1201, to: 229 });
    expect(resolvePeriod({ kind: 'year' }, 10)).toBeNull();
    const winterN = resolvePeriod({ kind: 'winter' }, 45);
    expect(inWindow(1215, winterN)).toBe(true);
    expect(inWindow(115, winterN)).toBe(true);
    expect(inWindow(615, winterN)).toBe(false);
  });
  it('re-tilt seasons split at equinoxes and cross-quarter days', () => {
    expect(season2(319)).toBe(1);
    expect(season2(320)).toBe(0);
    expect(season2(921)).toBe(0);
    expect(season2(922)).toBe(1);
    expect([season4(203), season4(204), season4(506), season4(807), season4(1106)]).toEqual([
      3, 0, 1, 2, 3,
    ]);
  });
});

describe('annual integration', () => {
  const amman = site(31.95, 35.93, 900);
  const { table, ranges, views, heat, opt } = optimise(amman, null);

  it('a horizontal plane collects the annual GHI (Perez low-sun floor: < 0.05 % short)', () => {
    let ghi = 0;
    let ghiHighSun = 0;
    for (let i = 0; i < table.count; i++) {
      ghi += table.ghi[i] * table.stepHours;
      if (table.zenith[i] < 85) ghiHighSun += table.ghi[i] * table.stepHours;
    }
    const e = integrateFixed(table, { tilt: 0, azimuth: 123 }, null, ranges, true);
    // Perez uses max(cos Z, cos 85°) in the circumsolar term, so within 5° of the horizon a
    // flat plane receives slightly less than DHI; above that the identity is exact.
    expect(e).toBeLessThanOrEqual(ghi / 1000 + 1e-9);
    expect(1 - e / (ghi / 1000)).toBeLessThan(0.0005);
    let eHigh = 0;
    for (let i = 0; i < table.count; i++) {
      if (table.zenith[i] >= 85) continue;
      eHigh += integrateFixed(
        table,
        { tilt: 0, azimuth: 0 },
        null,
        Int32Array.from([i, i + 1]),
        true,
      );
    }
    expect(eHigh).toBeCloseTo(ghiHighSun / 1000, 4); // Float32 storage rounding only
  });

  it('the tilt = 0 row of the landscape is constant (a flat plane has no azimuth)', () => {
    const row = Array.from(heat.values.slice(0, heat.azimuths.length));
    expect(Math.max(...row) - Math.min(...row)).toBe(0);
  });

  it('refined optimum faces the equator and beats every grid cell', () => {
    expect(Math.abs(opt.azimuth - 180)).toBeLessThan(1.5);
    expect(opt.energy).toBeGreaterThanOrEqual(heat.max);
    expect(Math.abs(opt.tilt - heat.bestTilt)).toBeLessThanOrEqual(2.5);
  });

  it('strategies are ordered as physics requires', () => {
    const s = Object.fromEntries(
      compareStrategies(table, null, ranges, opt, views, true).map((r) => [r.id, r]),
    );
    expect(s.fixed.gainPct).toBe(0);
    expect(s.rule.energy).toBeLessThanOrEqual(s.fixed.energy + 1e-6);
    expect(s.retilt2.energy).toBeGreaterThanOrEqual(s.fixed.energy - 1e-6);
    expect(s.retilt4.energy).toBeGreaterThanOrEqual(s.retilt2.energy - 1);
    expect(s.single.energy).toBeGreaterThan(s.retilt4.energy);
    expect(s.dual.energy).toBeGreaterThan(s.single.energy);
    // Two-position seasonal tilt: flat-ish in summer, steep in winter.
    expect(s.retilt2.tilts[0]).toBeLessThan(opt.tilt);
    expect(s.retilt2.tilts[1]).toBeGreaterThan(opt.tilt);
    // Typical clear-sky magnitudes at 32° N (Amman): re-tilt +4–7 %, 1-axis +20–35 %, 2-axis +35–50 %.
    expect(s.retilt2.gainPct).toBeGreaterThan(4);
    expect(s.retilt2.gainPct).toBeLessThan(7);
    expect(s.single.gainPct).toBeGreaterThan(20);
    expect(s.single.gainPct).toBeLessThan(35);
    expect(s.dual.gainPct).toBeGreaterThan(35);
    expect(s.dual.gainPct).toBeLessThan(50);
  });

  it('matches the main-thread day profile used by the live readout (within 0.5 %)', () => {
    const o = { tilt: 30, azimuth: 180 };
    const date = { year: 2026, month: 6, day: 21 };
    const start = zonedTimeToUtc(date, 0, 'Asia/Amman');
    const end = zonedTimeToUtc({ year: 2026, month: 6, day: 22 }, 0, 'Asia/Amman');
    const day = dayProfile(amman, start, end, o, null, 2);
    const doy = 171; // 0-based index of 21 June
    let tableDay = 0;
    for (let i = 0; i < table.count; i++) {
      if (table.day[i] !== doy) continue;
      const one = Int32Array.from([i, i + 1]);
      tableDay += integrateFixed(table, o, null, one, true);
    }
    expect(Math.abs(day.total / tableDay - 1)).toBeLessThan(0.005);
  });

  it('a seasonal window integrates less than the year and more than nothing', () => {
    const summer = periodRanges(table, resolvePeriod({ kind: 'summer' }, 31.95));
    const e = integrateFixed(table, { tilt: 10, azimuth: 180 }, null, summer, true);
    const y = integrateFixed(table, { tilt: 10, azimuth: 180 }, null, ranges, true);
    expect(e).toBeGreaterThan(0.25 * y);
    expect(e).toBeLessThan(0.4 * y);
    const best = bestTiltAtAzimuth(table, summer, 180, views, true);
    expect(best.x).toBeLessThan(15);
  });
});

describe('shading by a drawn skyline', () => {
  const block = HORIZON_PRESETS.find((p) => p.id === 'block-east')!.points;
  const open = optimise(site(31.95, 35.93, 900), null);
  const shaded = optimise(site(31.95, 35.93, 900, { horizon: block }), null);

  it('reduces the energy and moves the optimum azimuth away from the obstruction (west)', () => {
    expect(shaded.opt.energy).toBeLessThan(open.opt.energy);
    expect(shaded.opt.azimuth).toBeGreaterThan(open.opt.azimuth + 3);
  });

  it('reports a positive shading loss for a panel facing the block, none without a skyline', () => {
    const pv = { kwp: 5, gammaPct: -0.35, noct: 45, lossesPct: 14 };
    const o = { tilt: 30, azimuth: 120 };
    const model = site(31.95, 35.93, 900, { horizon: block });
    const withSkyline = pvEstimate(shaded.table, o, model.view(o), pv);
    expect(withSkyline.shadingLossPct).toBeGreaterThan(2);
    const clear = pvEstimate(open.table, o, null, pv);
    expect(clear.shadingLossPct).toBeCloseTo(0, 6);
  });
});

/**
 * Validation of the optimum fixed tilt.
 * PVGIS 5.3 optimal slope with an equator-facing aspect (re.jrc.ec.europa.eu/api/v5_3/PVcalc,
 * optimalinclination=1, loss=14, queried 2026-10-06; SARAH3 for Amman/Reykjavík/Cape Town,
 * ERA5 elsewhere), and the Jacobson & Jadhav (2018) cubic fit to PVWatts optima,
 * Solar Energy 169, 55–66, Fig. 1: NH 1.3793 + φ(1.2011 + φ(−0.014404 + 0.000080509 φ)),
 * SH −0.41657 + φ(1.4216 + φ(0.024051 + 0.00021828 φ)).
 */
describe('optimum tilt vs PVGIS and Jacobson & Jadhav (2018)', () => {
  const results = PLACES.map((p) => {
    const model = site(p.lat, p.lon, p.altitude);
    const clear = optimise(model, null);
    const climate = optimise(model, normalsFor(p.id));
    const pvgisAz = p.lat >= 0 ? 180 : 0;
    const atPvgis = integrateFixed(
      climate.table,
      { tilt: PVGIS[p.id].slope, azimuth: pvgisAz },
      null,
      climate.ranges,
      true,
    );
    return { p, clear: clear.opt, climate: climate.opt, captured: atPvgis / climate.opt.energy };
  });

  for (const r of results) {
    const { p } = r;
    const equatorial = Math.abs(p.lat) < 15;
    it(`${p.name}: with NASA POWER normals the optimum is within ${equatorial ? 5 : 3}° of PVGIS`, () => {
      expect(Math.abs(r.climate.tilt - PVGIS[p.id].slope)).toBeLessThanOrEqual(equatorial ? 5 : 3);
      // The PVGIS angle captures at least 99.7 % of the energy at our optimum.
      expect(r.captured).toBeGreaterThan(0.997);
      // and within 5° of the J&J global fit (R = 0.96; site-to-site scatter is larger)
      expect(Math.abs(r.climate.tilt - jacobsonJadhav(p.lat))).toBeLessThanOrEqual(5);
    });

    it(`${p.name}: the clear-sky optimum is steeper than or close to the weather-based one`, () => {
      // Clear skies lack diffuse cloud light (which favours flat planes) and cloudy winters,
      // so the clear-sky optimum is steeper: +0…11° vs PVGIS, most at cloudy high latitudes.
      // Sunny sites with cloudier summers (Phoenix monsoon, Sydney) come out up to ~1° flatter.
      const d = r.clear.tilt - PVGIS[p.id].slope;
      expect(d).toBeGreaterThan(-2);
      expect(d).toBeLessThan(11);
    });
  }

  it('equator-facing azimuth everywhere outside the tropics (±2°)', () => {
    for (const r of results) {
      if (Math.abs(r.p.lat) < 15) continue;
      const target = r.p.lat >= 0 ? 180 : 0;
      const d = Math.abs(((r.clear.azimuth - target + 540) % 360) - 180);
      expect(d).toBeLessThan(2);
    }
  });
});

describe('climate scaling', () => {
  const normals = normalsFor('toronto');
  const model = site(43.65, -79.38, 100);
  const t: YearTable = buildYearTable(model, 2026, STEP, normals, 20);

  it('monthly GHI and diffuse equal the NASA POWER normals', () => {
    for (let m = 0; m < 12; m++) {
      expect(t.usedMonthly.ghi[m]).toBeCloseTo(normals.ghi[m], 6);
      expect(t.usedMonthly.dhi[m]).toBeCloseTo(normals.dhi[m], 6);
    }
  });

  it('the light main-thread factors equal the table factors', () => {
    const f = climateFactorsFor(model, 2026, normals, STEP);
    for (let m = 0; m < 12; m++) {
      expect(f.kB[m]).toBeCloseTo(t.factors!.kB[m], 9);
      expect(f.kD[m]).toBeCloseTo(t.factors!.kD[m], 9);
    }
  });

  it('polar-night months get zero factors instead of NaN', () => {
    const tromso = site(69.65, 18.96, 5);
    const f = climateFactorsFor(tromso, 2026, normalsFor('tromso'), 30);
    expect(f.kB[11]).toBe(0);
    expect(f.kD[11]).toBe(0);
    expect(f.kB.every(Number.isFinite)).toBe(true);
  });
});

describe('PV model', () => {
  const pv = { kwp: 5, gammaPct: -0.35, noct: 45, lossesPct: 14 };

  it('STC irradiance at 25 °C gives the nameplate power minus system losses', () => {
    expect(pvPower(1000, 25, pv)).toBeCloseTo(5 * 0.86, 12);
  });

  it('temperature coefficient: −0.35 %/°C', () => {
    expect(pvPower(1000, 45, pv) / pvPower(1000, 25, pv)).toBeCloseTo(1 - 0.0035 * 20, 12);
  });

  it('NOCT model reproduces NOCT at its defining conditions (800 W/m², 20 °C)', () => {
    expect(noctCellTemperature(20, 800, 45)).toBeCloseTo(45, 12);
    expect(noctCellTemperature(30, 1000, 45)).toBeCloseTo(30 + (25 / 800) * 1000, 12);
  });

  it('ASHRAE incidence-angle modifier (b0 = 0.05)', () => {
    expect(ashraeIam(1)).toBe(1);
    expect(ashraeIam(0.5)).toBeCloseTo(0.95, 12);
    expect(ashraeIam(0)).toBe(0);
    expect(ashraeIam(-0.2)).toBe(0);
  });

  it('monthly values add up to the annual estimate', () => {
    const model = site(31.95, 35.93, 900);
    const t = buildYearTable(model, 2026, 30, null, 25);
    const r = pvEstimate(t, { tilt: 30, azimuth: 180 }, null, pv);
    expect(r.monthlyKwh.reduce((a, b) => a + b, 0)).toBeCloseTo(r.annualKwh, 6);
    expect(r.specificYield).toBeCloseTo(r.annualKwh / 5, 9);
    expect(r.performanceRatio).toBeGreaterThan(0.7);
    expect(r.performanceRatio).toBeLessThan(0.86);
  });
});
