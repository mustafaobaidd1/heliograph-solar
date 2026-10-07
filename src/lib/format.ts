/** Display formatting. Uses a true minus sign and thin spaces before units. */

const MINUS = '−';
const THIN = ' ';

export function fmt(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return '–';
  const s = x.toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return s.replace('-', MINUS);
}

export function signed(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return '–';
  const v = Number(x.toFixed(digits));
  if (v === 0) return `±${fmt(0, digits)}`;
  return `${v > 0 ? '+' : MINUS}${fmt(Math.abs(v), digits)}`;
}

export function deg(x: number, digits = 1): string {
  return `${fmt(x, digits)}°`;
}

export function withUnit(value: string, unit: string): string {
  return `${value}${THIN}${unit}`;
}

/** Compass point for an azimuth: N, NNE, NE … */
export function compassPoint(az: number): string {
  const points = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  return points[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
}

const COMPASS_WORDS: Record<string, string> = {
  N: 'north',
  NNE: 'north-north-east',
  NE: 'north-east',
  ENE: 'east-north-east',
  E: 'east',
  ESE: 'east-south-east',
  SE: 'south-east',
  SSE: 'south-south-east',
  S: 'south',
  SSW: 'south-south-west',
  SW: 'south-west',
  WSW: 'west-south-west',
  W: 'west',
  WNW: 'west-north-west',
  NW: 'north-west',
  NNW: 'north-north-west',
};

export function compassWords(az: number): string {
  return COMPASS_WORDS[compassPoint(az)];
}
