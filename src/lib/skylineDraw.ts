/**
 * Freehand skyline drawing: strokes paint a 1°-resolution elevation profile, which is then
 * simplified (Douglas–Peucker) back to the (azimuth, elevation) point list the model uses.
 */
import {
  MAX_HORIZON_ELEVATION,
  MAX_HORIZON_POINTS,
  horizonElevationAt,
  sanitizeHorizon,
} from './solar/horizon';
import type { HorizonPoint } from './solar/horizon';
import { angleDiff, clamp, wrap360 } from './solar/math';

export const BINS = 360;

export function pointsToBins(points: readonly HorizonPoint[]): Float32Array {
  const bins = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) bins[i] = horizonElevationAt(points, i);
  return bins;
}

/** Paints a stroke segment from (az0, el0) to (az1, el1) along the shorter arc. */
export function paintBins(
  bins: Float32Array,
  az0: number,
  el0: number,
  az1: number,
  el1: number,
  mode: 'draw' | 'erase',
): void {
  const delta = angleDiff(az1, az0);
  const steps = Math.max(1, Math.ceil(Math.abs(delta)));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const az = wrap360(az0 + delta * t);
    const i = Math.round(az) % BINS;
    bins[i] = mode === 'erase' ? 0 : clamp(el0 + (el1 - el0) * t, 0, MAX_HORIZON_ELEVATION);
  }
}

function perpendicular(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

function douglasPeucker(pts: [number, number][], tol: number): [number, number][] {
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpendicular(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function binsToPoints(bins: Float32Array, tolerance = 0.35): HorizonPoint[] {
  let max = 0;
  let min = Infinity;
  let minIdx = 0;
  for (let i = 0; i < BINS; i++) {
    if (bins[i] > max) max = bins[i];
    if (bins[i] < min) {
      min = bins[i];
      minIdx = i;
    }
  }
  if (max <= 0.05) return [];
  if (max - min < 0.05) return [{ az: 0, el: Math.round(max * 10) / 10 }];
  // Open the loop at its lowest point and walk once around (closing back to the start).
  const open: [number, number][] = [];
  for (let k = 0; k <= BINS; k++) open.push([minIdx + k, bins[(minIdx + k) % BINS]]);
  let tol = tolerance;
  let simplified = douglasPeucker(open, tol);
  while (simplified.length > MAX_HORIZON_POINTS && tol < 10) {
    tol *= 1.5;
    simplified = douglasPeucker(open, tol);
  }
  simplified.pop(); // drop the closing duplicate
  return sanitizeHorizon(simplified.map(([az, el]) => ({ az: az % BINS, el })));
}
