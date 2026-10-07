/**
 * Geometry of the massing model, shared by the 3D scene and the 2D plan fallback.
 * Units are arbitrary "model metres". Frame: x = east, z = south, y = up.
 */
import { horizonElevationAt } from '../../lib/solar/horizon';
import type { HorizonPoint } from '../../lib/solar/horizon';
import { DEG } from '../../lib/solar/math';

export interface Box {
  /** centre x (east), centre z (south) */
  x: number;
  z: number;
  /** size along x and z */
  w: number;
  d: number;
  /** bottom and height */
  y0: number;
  h: number;
  /** rotation about y, radians (for skyline blocks) */
  rot?: number;
  kind: 'house' | 'roof' | 'block';
}

export const DISC_R = 11;
export const DOME_R = 9;
export const SKYLINE_R = 10;

export const HOUSE: Box[] = [
  { kind: 'house', x: -0.7, z: 0.1, w: 4.4, d: 3.4, y0: 0, h: 2.7 }, // main volume
  { kind: 'house', x: 2.35, z: 0.75, w: 2.5, d: 2.3, y0: 0, h: 1.65 }, // low wing
  { kind: 'roof', x: -0.7, z: 0.1, w: 4.6, d: 3.6, y0: 2.7, h: 0.14 }, // roof plate (overhang)
  { kind: 'roof', x: 2.35, z: 0.75, w: 2.7, d: 2.5, y0: 1.65, h: 0.12 }, // wing roof plate
  { kind: 'house', x: -2.1, z: -0.8, w: 1.0, d: 0.9, y0: 2.84, h: 0.75 }, // stair core on the roof
];

/** Panel pivot (centre of the module) and size. */
export const PANEL = { x: -0.2, z: 0.45, y: 3.55, w: 1.9, d: 1.15, post: 0.71 };

/**
 * Skyline as boxes on a ring around the model, one per 6° sector, tall enough that the
 * skyline elevation is the same as seen from the panel (pivot height + R·tan h).
 */
export function skylineBoxes(points: HorizonPoint[]): Box[] {
  if (points.length === 0) return [];
  const sector = 6;
  const out: Box[] = [];
  const width = 2 * SKYLINE_R * Math.tan((sector / 2) * DEG) * 1.02;
  for (let a = 0; a < 360; a += sector) {
    let el = 0;
    for (let s = 0; s <= 4; s++)
      el = Math.max(el, horizonElevationAt(points, a + (s * sector) / 4));
    if (el < 0.4) continue;
    const mid = (a + sector / 2) * DEG;
    const h = Math.min(14, PANEL.y + SKYLINE_R * Math.tan(Math.min(el, 75) * DEG));
    out.push({
      kind: 'block',
      x: SKYLINE_R * Math.sin(mid),
      z: -SKYLINE_R * Math.cos(mid),
      w: width,
      d: 1.1,
      y0: 0,
      h,
      rot: -mid,
    });
  }
  return out;
}

/** Ground shadow polygon (convex hull in x–z) of a box lit from a sun direction. */
export function boxShadow(b: Box, sunAz: number, sunEl: number): [number, number][] | null {
  if (sunEl <= 0.5) return null;
  const len = 1 / Math.tan(sunEl * DEG);
  // shadow falls away from the sun
  const dx = -Math.sin(sunAz * DEG) * len;
  const dz = Math.cos(sunAz * DEG) * len;
  const rot = b.rot ?? 0;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const corners: [number, number][] = [
    [-b.w / 2, -b.d / 2],
    [b.w / 2, -b.d / 2],
    [b.w / 2, b.d / 2],
    [-b.w / 2, b.d / 2],
  ].map(([u, v]) => [b.x + u * c + v * s, b.z - u * s + v * c] as [number, number]);
  const pts: [number, number][] = [];
  for (const [x, z] of corners) {
    pts.push([x + dx * b.y0, z + dz * b.y0]);
    pts.push([x + dx * (b.y0 + b.h), z + dz * (b.y0 + b.h)]);
  }
  return convexHull(pts);
}

export function convexHull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0)
      lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0)
      upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
