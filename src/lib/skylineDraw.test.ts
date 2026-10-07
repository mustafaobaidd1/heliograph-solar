import { describe, expect, it } from 'vitest';
import { BINS, binsToPoints, paintBins, pointsToBins } from './skylineDraw';
import { horizonElevationAt } from './solar/horizon';

describe('skyline drawing', () => {
  it('paints a stroke with linear interpolation along the shorter arc', () => {
    const bins = new Float32Array(BINS);
    paintBins(bins, 350, 10, 10, 30, 'draw');
    expect(bins[350]).toBeCloseTo(10, 5);
    expect(bins[0]).toBeCloseTo(20, 5);
    expect(bins[10]).toBeCloseTo(30, 5);
    expect(bins[180]).toBe(0); // did not go the long way round
    paintBins(bins, 355, 0, 5, 0, 'erase');
    expect(bins[0]).toBe(0);
    expect(bins[10]).toBeCloseTo(30, 5);
  });

  it('simplifies a drawn block to a handful of points that reproduce it', () => {
    const bins = new Float32Array(BINS);
    for (let a = 100; a <= 140; a++) bins[a] = 25;
    const pts = binsToPoints(bins);
    expect(pts.length).toBeLessThanOrEqual(6);
    for (let a = 0; a < 360; a++) {
      expect(Math.abs(horizonElevationAt(pts, a) - bins[a])).toBeLessThan(0.5);
    }
  });

  it('round-trips a smooth profile within the simplification tolerance', () => {
    const bins = new Float32Array(BINS);
    for (let a = 0; a < 360; a++) bins[a] = 8 + 6 * Math.sin((a * Math.PI) / 90);
    const pts = binsToPoints(bins);
    const back = pointsToBins(pts);
    for (let a = 0; a < 360; a++) expect(Math.abs(back[a] - bins[a])).toBeLessThan(0.5);
  });

  it('empty and uniform profiles', () => {
    expect(binsToPoints(new Float32Array(BINS))).toEqual([]);
    expect(binsToPoints(new Float32Array(BINS).fill(12))).toEqual([{ az: 0, el: 12 }]);
  });
});
