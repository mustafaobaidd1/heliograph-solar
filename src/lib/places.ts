/** City presets. Altitudes set the air pressure used by the clear-sky model. */

export interface Place {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  /** IANA time zone */
  timeZone: string;
  /** Metres above sea level */
  altitude: number;
  /** Why this place is interesting, shown on hover/focus */
  note: string;
}

export const PLACES: Place[] = [
  {
    id: 'amman',
    name: 'Amman',
    country: 'Jordan',
    lat: 31.95,
    lon: 35.93,
    timeZone: 'Asia/Amman',
    altitude: 900, // midpoint of the city's 700–1,100 m range
    note: 'Sunny, dry subtropics on a high plateau',
  },
  {
    id: 'toronto',
    name: 'Toronto',
    country: 'Canada',
    lat: 43.65,
    lon: -79.38,
    timeZone: 'America/Toronto',
    altitude: 100, // city spans 76.5–209 m
    note: 'Cloudy winters, daylight saving time',
  },
  {
    id: 'reykjavik',
    name: 'Reykjavík',
    country: 'Iceland',
    lat: 64.15,
    lon: -21.94,
    timeZone: 'Atlantic/Reykjavik',
    altitude: 20,
    note: 'White nights: the Sun sets for under three hours in June',
  },
  {
    id: 'singapore',
    name: 'Singapore',
    country: 'Singapore',
    lat: 1.35,
    lon: 103.82,
    timeZone: 'Asia/Singapore',
    altitude: 20,
    note: 'On the equator: the Sun passes north and south of the zenith',
  },
  {
    id: 'cape-town',
    name: 'Cape Town',
    country: 'South Africa',
    lat: -33.92,
    lon: 18.42,
    timeZone: 'Africa/Johannesburg',
    altitude: 20,
    note: 'Southern hemisphere: panels face north',
  },
  {
    id: 'sydney',
    name: 'Sydney',
    country: 'Australia',
    lat: -33.87,
    lon: 151.21,
    timeZone: 'Australia/Sydney',
    altitude: 20,
    note: 'Southern hemisphere with daylight saving time',
  },
  {
    id: 'quito',
    name: 'Quito',
    country: 'Ecuador',
    lat: -0.18,
    lon: -78.47,
    timeZone: 'America/Guayaquil',
    altitude: 2850,
    note: 'Equatorial and 2,850 m high: thinner air, stronger beam',
  },
  {
    id: 'phoenix',
    name: 'Phoenix',
    country: 'USA',
    lat: 33.45,
    lon: -112.07,
    timeZone: 'America/Phoenix',
    altitude: 331,
    note: 'Desert sun, no daylight saving time',
  },
  {
    id: 'tromso',
    name: 'Tromsø',
    country: 'Norway',
    lat: 69.65,
    lon: 18.96,
    timeZone: 'Europe/Oslo',
    altitude: 5,
    note: 'Above the Arctic Circle: midnight sun and polar night',
  },
];

export const DEFAULT_PLACE = PLACES[0];

export function placeById(id: string): Place | undefined {
  return PLACES.find((p) => p.id === id);
}

export interface CoordinateErrors {
  lat?: string;
  lon?: string;
}

/** Validates typed coordinates; accepts a comma decimal separator. */
export function parseCoordinates(
  latText: string,
  lonText: string,
): { lat: number; lon: number } | { errors: CoordinateErrors } {
  const num = (t: string): number => {
    const s = t.trim().replace(',', '.').replace('−', '-');
    return s === '' || !/^[-+]?\d*\.?\d+$/.test(s) ? Number.NaN : Number(s);
  };
  const lat = num(latText);
  const lon = num(lonText);
  const errors: CoordinateErrors = {};
  if (!Number.isFinite(lat)) errors.lat = 'Enter a latitude in degrees, e.g. 31.95';
  else if (lat < -90 || lat > 90) errors.lat = 'Latitude must be between −90° and 90°';
  if (!Number.isFinite(lon)) errors.lon = 'Enter a longitude in degrees, e.g. 35.93';
  else if (lon < -180 || lon > 180) errors.lon = 'Longitude must be between −180° and 180°';
  if (errors.lat || errors.lon) return { errors };
  return { lat, lon };
}

/** "31.95° N, 35.93° E" */
export function formatLatLon(lat: number, lon: number, digits = 2): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}° ${ns}, ${Math.abs(lon).toFixed(digits)}° ${ew}`;
}
