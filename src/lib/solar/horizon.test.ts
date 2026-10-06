import { describe, expect, it } from 'vitest';
import {
  HORIZON_PRESETS,
  horizonElevationAt,
  horizonFromTable,
  horizonTable,
  sanitizeHorizon,
  skyView,
  sunAboveSkyline,
} from './horizon';
import type { HorizonPoint } from './horizon';
import { DEG, cosd, sind } from './math';

describe('skyline profile', () => {
  it('is flat when empty and constant with a single point', () => {
    expect(horizonElevationAt([], 123)).toBe(0);
    expect(horizonElevationAt([{ az: 40, el: 12 }], 300)).toBe(12);
  });

  it('interpolates linearly and wraps through north', () => {
    const pts: HorizonPoint[] = [
      { az: 10, el: 30 },
      { az: 350, el: 10 },
    ];
    expect(horizonElevationAt(pts, 0)).toBeCloseTo(20, 10);
    expect(horizonElevationAt(pts, 360)).toBeCloseTo(20, 10);
    expect(horizonElevationAt(pts, 5)).toBeCloseTo(25, 10);
    // The long way round, from 30° at az 10 to 10° at az 350 across 340°.
    expect(horizonElevationAt(pts, 180)).toBeCloseTo(20, 10);
    expect(horizonElevationAt(pts, 95)).toBeCloseTo(25, 10);
  });

  it('a block with near-vertical sides', () => {
    const block = HORIZON_PRESETS.find((p) => p.id === 'block-east')!.points;
    expect(horizonElevationAt(block, 100)).toBe(24);
    expect(horizonElevationAt(block, 60)).toBe(0);
    expect(horizonElevationAt(block, 70.5)).toBeCloseTo(12, 6);
    expect(horizonElevationAt(block, 200)).toBe(0);
  });

  it('sanitises points: wraps, clamps, sorts and merges duplicates', () => {
    const s = sanitizeHorizon([
      { az: 370, el: 5 },
      { az: -90, el: 100 },
      { az: 10, el: 7 },
      { az: Number.NaN, el: 3 },
      { az: 180, el: -4 },
    ]);
    expect(s).toEqual([
      { az: 10, el: 7 },
      { az: 180, el: 0 },
      { az: 270, el: 80 },
    ]);
  });

  it('lookup table reproduces the exact profile', () => {
    const pts = HORIZON_PRESETS.find((p) => p.id === 'tree-sw')!.points;
    const table = horizonTable(pts);
    for (let az = 0; az < 360; az += 0.37) {
      expect(Math.abs(horizonFromTable(table, az) - horizonElevationAt(pts, az))).toBeLessThan(
        0.75,
      );
    }
    expect(table.max).toBeCloseTo(31, 6);
    expect(horizonTable([]).flat).toBe(true);
  });

  it('blocks the Sun only below the skyline', () => {
    const table = horizonTable(HORIZON_PRESETS.find((p) => p.id === 'block-east')!.points);
    expect(sunAboveSkyline(table, 100, 20)).toBe(false);
    expect(sunAboveSkyline(table, 100, 30)).toBe(true);
    expect(sunAboveSkyline(table, 200, 2)).toBe(true);
    expect(sunAboveSkyline(table, 200, -1)).toBe(false);
  });
});

/** Brute-force sky view factor: (1/π)∬_visible max(0, n·s) cos e de dφ. */
function bruteSkyView(points: HorizonPoint[], tilt: number, az: number): number {
  const n = [sind(tilt) * sind(az), sind(tilt) * cosd(az), cosd(tilt)];
  const nPhi = 720;
  const nE = 900;
  let sum = 0;
  for (let i = 0; i < nPhi; i++) {
    const phi = ((i + 0.5) * 360) / nPhi;
    const h = horizonElevationAt(points, phi);
    for (let k = 0; k < nE; k++) {
      const e = ((k + 0.5) * 90) / nE;
      if (e < h) continue;
      const s = [cosd(e) * sind(phi), cosd(e) * cosd(phi), sind(e)];
      const c = Math.max(0, n[0] * s[0] + n[1] * s[1] + n[2] * s[2]);
      sum += c * cosd(e);
    }
  }
  return (sum * ((2 * Math.PI) / nPhi) * ((90 / nE) * DEG)) / Math.PI;
}

describe('sky view factor with a skyline', () => {
  it('equals (1 + cos β)/2 for a flat horizon', () => {
    const flat = horizonTable([]);
    for (const tilt of [0, 20, 45, 90]) {
      expect(skyView(flat, tilt, 180).iso).toBeCloseTo((1 + cosd(tilt)) / 2, 12);
    }
  });

  it('horizontal plane under a uniform 30° skyline sees cos²(30°) = 0.75 of the sky', () => {
    const v = skyView(horizonTable([{ az: 0, el: 30 }]), 0, 180);
    expect(v.iso).toBeCloseTo(0.75, 3);
  });

  it('vertical plane under a uniform skyline matches the closed form', () => {
    const h = 30 * DEG;
    const expected = 0.5 - (h + Math.sin(2 * h) / 2) / Math.PI;
    const v = skyView(horizonTable([{ az: 0, el: 30 }]), 90, 180);
    expect(v.iso).toBeCloseTo(expected, 3);
  });

  it('matches brute-force integration for drawn skylines and tilted planes', () => {
    for (const preset of HORIZON_PRESETS) {
      for (const [tilt, az] of [
        [30, 180],
        [60, 225],
        [15, 90],
      ]) {
        const analytic = skyView(horizonTable(preset.points), tilt, az).iso;
        const brute = bruteSkyView(preset.points, tilt, az);
        expect(Math.abs(analytic - brute)).toBeLessThan(0.004);
      }
    }
  });

  it('horizon-band visibility drops when the skyline covers the band the panel faces', () => {
    const southWall = horizonTable([
      { az: 90, el: 0 },
      { az: 91, el: 20 },
      { az: 269, el: 20 },
      { az: 270, el: 0 },
    ]);
    expect(skyView(southWall, 40, 180).horizonBand).toBeLessThan(0.05);
    expect(skyView(southWall, 40, 0).horizonBand).toBeGreaterThan(0.95);
  });
});
