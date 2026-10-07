/** Colour helpers: palette tokens used by SVG and WebGL, and interpolation in linear RGB. */

export const PALETTE = {
  paper: '#f4efe6',
  ink: '#1d1a16',
  ochre: '#e3a22a',
  ochreDeep: '#b07a12',
  ochreText: '#8f5d07',
  vermilion: '#c23b1e',
} as const;

function toLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function toSrgb(l: number): number {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
}

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function mix(a: string, b: string, t: number): string {
  const A = parse(a).map(toLinear);
  const B = parse(b).map(toLinear);
  const c = A.map((v, i) => toSrgb(v + (B[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Day-path colour: deep ochre for the summer solstice through vermilion for the winter one. */
export function seasonColor(fraction: number): string {
  return mix(PALETTE.ochreDeep, PALETTE.vermilion, Math.min(1, Math.max(0, fraction)));
}

/** Sequential ramp for the energy landscape: paper → ochre → vermilion → umber. */
const RAMP = ['#f3ead8', '#efd6a1', '#e3a22a', '#c9601f', '#8c2a14', '#3f160b'];

export function rampColor(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  return mix(RAMP[i], RAMP[i + 1], x - i);
}

export function rampRgb(t: number): [number, number, number] {
  return parse(rampColor(t));
}
