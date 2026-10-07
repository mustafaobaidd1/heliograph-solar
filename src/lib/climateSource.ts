/**
 * Where climate normals come from: the bundled NASA POWER file for preset cities, otherwise
 * a live POWER request (CORS-enabled, no key) cached in localStorage. Never blocks the app:
 * failures resolve to an error the UI explains while clear-sky values stay on screen.
 */
import presets from '../data/climate-presets.json';
import { placeById } from './places';
import { parsePowerClimatology, powerClimatologyUrl } from './solar/climate';
import type { ClimateNormals } from './solar/climate';

export type ClimateOrigin = 'bundled' | 'cache' | 'network';

export interface ClimateLoaded {
  normals: ClimateNormals;
  origin: ClimateOrigin;
}

export const CLIMATE_PERIOD = presets.source;
export const CLIMATE_RETRIEVED = presets.retrieved;

const CACHE_PREFIX = 'heliograph:power:v1:';

function cacheKey(lat: number, lon: number): string {
  return `${CACHE_PREFIX}${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function readCache(lat: number, lon: number): ClimateNormals | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(lat, lon));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClimateNormals;
    return Array.isArray(parsed.ghi) && parsed.ghi.length === 12 ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(n: ClimateNormals): void {
  try {
    window.localStorage.setItem(cacheKey(n.lat, n.lon), JSON.stringify(n));
  } catch {
    // storage full or blocked: the data still works for this session
  }
}

export function bundledNormals(
  presetId: string | null,
  lat: number,
  lon: number,
): ClimateNormals | null {
  if (!presetId) return null;
  const preset = placeById(presetId);
  const data = (presets.places as Record<string, ClimateNormals | undefined>)[presetId];
  if (!preset || !data || preset.lat !== lat || preset.lon !== lon) return null;
  return {
    lat,
    lon,
    ghi: data.ghi,
    dni: data.dni,
    dhi: data.dhi,
    clearGhi: data.clearGhi,
    t2m: data.t2m,
    t2mRange: data.t2mRange,
  };
}

export async function loadClimate(
  presetId: string | null,
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<ClimateLoaded> {
  const bundled = bundledNormals(presetId, lat, lon);
  if (bundled) return { normals: bundled, origin: 'bundled' };
  const cached = readCache(lat, lon);
  if (cached) return { normals: cached, origin: 'cache' };

  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), 20_000);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    let res: Response;
    try {
      res = await fetch(powerClimatologyUrl(lat, lon), { signal: timeout.signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new Error(
        timeout.signal.aborted
          ? 'NASA POWER did not answer within 20 seconds.'
          : 'Could not reach NASA POWER (offline or blocked).',
        { cause: err },
      );
    }
    if (res.status === 429)
      throw new Error('NASA POWER is rate-limiting requests; try again in a minute.');
    if (!res.ok) throw new Error(`NASA POWER answered ${res.status}.`);
    const normals = parsePowerClimatology(await res.json(), lat, lon);
    writeCache(normals);
    return { normals, origin: 'network' };
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
