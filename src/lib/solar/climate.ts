/**
 * Long-term monthly climate normals (NASA POWER climatology API, 2001–2020) and the scaling
 * that turns clear-sky days into "average days": each month's clear-sky beam and diffuse
 * profiles are multiplied by the ratio of the observed monthly mean to the clear-sky mean,
 * so monthly totals match NASA POWER while the within-day shape comes from the sun's path.
 *
 * The beam is taken as POWER's GHI − diffuse on the horizontal, not from POWER's DNI: in the
 * tropics POWER's monthly DNI is inconsistent with its own GHI and diffuse (for Singapore the
 * implied DNI-weighted mean cos Z exceeds 1, which is impossible), whereas GHI is the primary
 * satellite product. Monthly GHI and diffuse therefore match POWER exactly.
 */

export const MONTH_KEYS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

export interface ClimateNormals {
  /** Latitude/longitude the data was requested for. */
  lat: number;
  lon: number;
  /** Monthly mean daily totals, kWh/m²/day. */
  ghi: number[];
  dni: number[];
  dhi: number[];
  /** Clear-sky GHI from POWER (for reference only), kWh/m²/day. */
  clearGhi: number[];
  /** Monthly mean 2 m air temperature and mean daily range, °C. */
  t2m: number[];
  t2mRange: number[];
}

export const POWER_PARAMETERS = [
  'ALLSKY_SFC_SW_DWN',
  'ALLSKY_SFC_SW_DNI',
  'ALLSKY_SFC_SW_DIFF',
  'CLRSKY_SFC_SW_DWN',
  'T2M',
  'T2M_RANGE',
] as const;

export function powerClimatologyUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    parameters: POWER_PARAMETERS.join(','),
    community: 'RE',
    longitude: lon.toFixed(2),
    latitude: lat.toFixed(2),
    format: 'JSON',
  });
  return `https://power.larc.nasa.gov/api/temporal/climatology/point?${q.toString()}`;
}

const FILL = -999;

/** Parses a POWER climatology JSON response. Throws with a readable message when invalid. */
export function parsePowerClimatology(json: unknown, lat: number, lon: number): ClimateNormals {
  const params = (json as { properties?: { parameter?: Record<string, Record<string, number>> } })
    ?.properties?.parameter;
  if (!params) throw new Error('Unexpected response from NASA POWER');
  const series = (key: string): number[] => {
    const rec = params[key];
    if (!rec) throw new Error(`NASA POWER response is missing ${key}`);
    return MONTH_KEYS.map((m) => {
      const v = Number(rec[m]);
      if (!Number.isFinite(v) || v === FILL) throw new Error(`NASA POWER has no ${key} for ${m}`);
      return v;
    });
  };
  return {
    lat,
    lon,
    ghi: series('ALLSKY_SFC_SW_DWN'),
    dni: series('ALLSKY_SFC_SW_DNI'),
    dhi: series('ALLSKY_SFC_SW_DIFF'),
    clearGhi: series('CLRSKY_SFC_SW_DWN'),
    t2m: series('T2M'),
    t2mRange: series('T2M_RANGE'),
  };
}

export interface ClimateFactors {
  /** Monthly multiplier on clear-sky DNI (and so on the clear-sky beam) */
  kB: number[];
  /** Monthly multiplier on clear-sky DHI */
  kD: number[];
}

/**
 * Ratios observed/clear-sky per month, from monthly mean daily totals (kWh/m²/day) of the
 * clear-sky beam on the horizontal and clear-sky diffuse. Diffuse is capped at GHI (POWER
 * occasionally reports DIFF > GHI in polar twilight months). Months without clear-sky
 * sunshine (polar night) get factors of 0.
 */
export function climateFactors(
  clearBeamHorizontal: readonly number[],
  clearDhi: readonly number[],
  normals: ClimateNormals,
): ClimateFactors {
  const ratio = (obs: number, clear: number): number => (clear > 1e-6 ? obs / clear : 0);
  const diffuse = normals.dhi.map((d, m) => Math.min(Math.max(d, 0), Math.max(normals.ghi[m], 0)));
  return {
    kB: normals.ghi.map((g, m) => ratio(Math.max(0, g - diffuse[m]), clearBeamHorizontal[m])),
    kD: diffuse.map((d, m) => ratio(d, clearDhi[m])),
  };
}

/** Diurnal air temperature: monthly mean ± half the mean daily range, peaking at 15:00 solar time. */
export function airTemperature(normals: ClimateNormals, month0: number, solarHour: number): number {
  return (
    normals.t2m[month0] +
    (normals.t2mRange[month0] / 2) * Math.cos((2 * Math.PI * (solarHour - 15)) / 24)
  );
}
