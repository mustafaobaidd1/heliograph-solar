/** Small numeric helpers shared by the solar models. Angles are in degrees unless noted. */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const sind = (x: number): number => Math.sin(x * DEG);
export const cosd = (x: number): number => Math.cos(x * DEG);
export const tand = (x: number): number => Math.tan(x * DEG);

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Wraps an angle into [0, 360). */
export function wrap360(x: number): number {
  const r = x % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed smallest difference a − b, in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = wrap360(a - b);
  if (d > 180) d -= 360;
  return d;
}

/**
 * Unit vector for a direction given by azimuth (clockwise from north) and elevation.
 * Frame: x = east, y = north, z = up.
 */
export function directionVector(
  azimuthDeg: number,
  elevationDeg: number,
): [number, number, number] {
  const ce = cosd(elevationDeg);
  return [ce * sind(azimuthDeg), ce * cosd(azimuthDeg), sind(elevationDeg)];
}

/** Outward normal of a plane with the given tilt (from horizontal) and azimuth (direction it faces). */
export function planeNormal(tiltDeg: number, azimuthDeg: number): [number, number, number] {
  const st = sind(tiltDeg);
  return [st * sind(azimuthDeg), st * cosd(azimuthDeg), cosd(tiltDeg)];
}
