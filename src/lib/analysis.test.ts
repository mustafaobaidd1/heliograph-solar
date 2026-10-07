import { describe, expect, it } from 'vitest';
import { AnalysisEngine } from './analysis';
import type { SiteJob } from './analysis';
import { CSV_COLUMNS, csvFileName, hourlyCsv } from './csv';
import { HORIZON_PRESETS } from './solar/horizon';
import { SiteModel } from './solar/model';

const site = {
  lat: 31.95,
  lon: 35.93,
  altitude: 900,
  aod700: 0.1,
  pw: 1.5,
  albedo: 0.2,
  transposition: 'perez' as const,
  horizon: [],
};
const pv = { kwp: 5, gammaPct: -0.35, noct: 45, lossesPct: 14 };

describe('analysis engine', () => {
  const engine = new AnalysisEngine();
  const job: SiteJob = {
    site,
    year: 2026,
    climate: null,
    ambient: 25,
    period: { kind: 'year' },
    panel: { tilt: 30, azimuth: 180 },
    pv,
  };
  const stages: number[] = [];
  const result = engine.runSite(job, (f) => stages.push(f));

  it('reports monotonic progress up to 1', () => {
    expect(stages[stages.length - 1]).toBe(1);
    for (let i = 1; i < stages.length; i++) expect(stages[i]).toBeGreaterThanOrEqual(stages[i - 1]);
  });

  it('finds the optimum and orders the strategies', () => {
    expect(result.optimum.tilt).toBeGreaterThan(25);
    expect(result.optimum.tilt).toBeLessThan(38);
    expect(result.strategies.map((s) => s.id)).toEqual([
      'rule',
      'fixed',
      'retilt2',
      'retilt4',
      'single',
      'dual',
    ]);
    expect(result.strategiesUnshaded).toBeNull();
    expect(result.optimumUnshaded).toBeNull();
  });

  it('re-runs the PV estimate for a new panel from the cached table', () => {
    const p = engine.runPanel({ panel: { tilt: 90, azimuth: 180 }, pv, ambient: 25 });
    expect(p).not.toBeNull();
    expect(p!.pv.annualKwh).toBeLessThan(result.pv.annualKwh);
    expect(p!.periodEnergy).toBeLessThan(result.optimum.energy);
    const same = engine.runPanel({ panel: { tilt: 30, azimuth: 180 }, pv, ambient: 25 });
    expect(same!.periodEnergy).toBeCloseTo(result.panelEnergy, 9);
  });

  it('with a skyline, reports both the shaded and the open-horizon optimum', () => {
    const tree = HORIZON_PRESETS.find((h) => h.id === 'tree-sw')!.points;
    const r = new AnalysisEngine().runSite({ ...job, site: { ...site, horizon: tree } });
    expect(r.optimumUnshaded).not.toBeNull();
    expect(r.optimum.energy).toBeLessThan(r.optimumUnshaded!.energy);
    expect(r.pv.shadingLossPct).toBeGreaterThan(0);
    // The tree is to the south-west, so the shaded optimum swings east (< 180°).
    expect(r.optimum.azimuth).toBeLessThan(r.optimumUnshaded!.azimuth);
  });
});

describe('hourly CSV', () => {
  const model = new SiteModel(site);
  const csv = hourlyCsv({
    model,
    year: 2026,
    timeZone: 'Asia/Amman',
    panel: { tilt: 30, azimuth: 180 },
    pv,
    factors: null,
    climate: null,
    ambient: 25,
  });
  const lines = csv.trim().split('\n');

  it('has a header and one row per hour of the year', () => {
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines.length - 1).toBe(8760);
    expect(lines[1].startsWith('2026-01-01T00:00,+03:00,')).toBe(true);
  });

  it('hourly means add up to the annual totals of the year table (within 0.5 %)', () => {
    const col = (name: (typeof CSV_COLUMNS)[number]) => CSV_COLUMNS.indexOf(name);
    let poa = 0;
    let kwh = 0;
    for (const line of lines.slice(1)) {
      const cells = line.split(',');
      poa += Number(cells[col('poa_total_w_m2')]);
      kwh += Number(cells[col('ac_power_kw')]);
    }
    const r = new AnalysisEngine().runSite({
      site,
      year: 2026,
      climate: null,
      ambient: 25,
      period: { kind: 'year' },
      panel: { tilt: 30, azimuth: 180 },
      pv,
    });
    expect(Math.abs(poa / 1000 / r.pv.annualPoa - 1)).toBeLessThan(0.005);
    expect(Math.abs(kwh / r.pv.annualKwh - 1)).toBeLessThan(0.005);
  });

  it('builds a readable file name', () => {
    expect(csvFileName('Reykjavík', 2026, { tilt: 43.2, azimuth: 179.6 })).toBe(
      'heliograph_reykjavik_2026_tilt43_az180.csv',
    );
  });
});
