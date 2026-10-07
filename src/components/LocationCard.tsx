import { useId, useMemo, useState } from 'react';
import { PLACES, formatLatLon, parseCoordinates } from '../lib/places';
import type { CoordinateErrors } from '../lib/places';
import { LIMITS } from '../lib/state';
import type { PlaceState } from '../lib/state';
import {
  describeZone,
  formatUtcOffset,
  isValidTimeZone,
  listTimeZones,
  nauticalZone,
  zoneOffsetMinutes,
} from '../lib/solar/zone';
import { LocateIcon, PinIcon } from './icons';
import { WorldMap } from './WorldMap';

type GeoState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string };

export function LocationCard({
  place,
  onPlace,
  utc,
  declination,
  eqTime,
  onPickMap,
}: {
  place: PlaceState;
  onPlace: (p: PlaceState) => void;
  onPickMap: (lat: number, lon: number) => void;
  utc: number;
  declination: number;
  eqTime: number;
}) {
  const id = useId();
  const [geo, setGeo] = useState<GeoState>({ kind: 'idle' });
  const [latText, setLatText] = useState('');
  const [lonText, setLonText] = useState('');
  const [zoneText, setZoneText] = useState('');
  const [altText, setAltText] = useState('');
  const [errors, setErrors] = useState<CoordinateErrors & { zone?: string; alt?: string }>({});
  const [showForm, setShowForm] = useState(false);
  const zones = useMemo(() => listTimeZones(), []);
  const offset = zoneOffsetMinutes(place.timeZone, utc);
  const preset = PLACES.find((p) => p.id === place.presetId);

  const locate = () => {
    const keep = `Kept ${place.name}.`;
    if (!('geolocation' in navigator)) {
      setGeo({
        kind: 'error',
        text: `This browser cannot share its location. ${keep} Type coordinates instead.`,
      });
      return;
    }
    if (!window.isSecureContext) {
      setGeo({ kind: 'error', text: `Location needs a secure (https) page. ${keep}` });
      return;
    }
    setGeo({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 10000) / 10000;
        const lon = Math.round(pos.coords.longitude * 10000) / 10000;
        const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const timeZone = isValidTimeZone(browserZone) ? browserZone : nauticalZone(lon);
        onPlace({
          presetId: null,
          name: 'My location',
          lat,
          lon,
          timeZone,
          altitude: pos.coords.altitude != null ? Math.round(pos.coords.altitude) : 0,
          zoneEstimated: timeZone !== browserZone,
        });
        setGeo({
          kind: 'ok',
          text: `Using your location (within ${Math.round(pos.coords.accuracy)} m)${pos.coords.altitude == null ? '; altitude assumed at sea level' : ''}.`,
        });
      },
      (err) => {
        const text =
          err.code === err.PERMISSION_DENIED
            ? `Location permission was denied. ${keep} Pick a city or type coordinates instead.`
            : err.code === err.TIMEOUT
              ? `Finding your location took too long. ${keep}`
              : `Your position is unavailable right now. ${keep}`;
        setGeo({ kind: 'error', text });
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  };

  const openCustom = () => {
    setLatText(String(place.lat));
    setLonText(String(place.lon));
    setZoneText(place.timeZone);
    setAltText(String(place.altitude));
    setErrors({});
  };

  const applyCustom = () => {
    const parsed = parseCoordinates(latText, lonText);
    const next: typeof errors = 'errors' in parsed ? { ...parsed.errors } : {};
    const zone = zoneText.trim();
    if (zone && !isValidTimeZone(zone))
      next.zone =
        'Unknown time zone. Use an IANA name such as Europe/Paris, or leave it empty to estimate from longitude.';
    const alt = altText.trim() === '' ? 0 : Number(altText.replace(',', '.'));
    if (!Number.isFinite(alt) || alt < LIMITS.altitude[0] || alt > LIMITS.altitude[1])
      next.alt = `Altitude must be between ${LIMITS.altitude[0]} and ${LIMITS.altitude[1]} m.`;
    setErrors(next);
    if ('errors' in parsed || next.zone || next.alt) return;
    const timeZone = zone || nauticalZone(parsed.lon);
    onPlace({
      presetId: null,
      name: 'Custom location',
      lat: parsed.lat,
      lon: parsed.lon,
      timeZone,
      altitude: Math.round(alt),
      zoneEstimated: !zone,
    });
    setGeo({ kind: 'idle' });
  };

  const formId = `${id}-coords`;
  const field = (
    key: 'lat' | 'lon' | 'alt',
    label: string,
    value: string,
    set: (v: string) => void,
  ) => (
    <div className={`field field--sm ${errors[key] ? 'field--invalid' : ''}`}>
      <label className="field__label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        className="input"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `${id}-${key}-err` : undefined}
      />
      {errors[key] && (
        <p className="field__error" id={`${id}-${key}-err`}>
          {errors[key]}
        </p>
      )}
    </div>
  );

  return (
    <section className="placebar" aria-labelledby="place-title">
      <div className="placebar__main">
        <h2 id="place-title" className="visually-hidden">
          Place
        </h2>
        <div className="place__top">
          <p className="place__current" aria-live="polite">
            <PinIcon />
            <span>
              <strong>{place.name}</strong>
              {preset ? `, ${preset.country}` : ''}
              <span className="place__meta">
                {formatLatLon(place.lat, place.lon)} · {describeZone(place.timeZone, utc)}
                {!place.zoneEstimated && ` (${formatUtcOffset(offset)})`} · {place.altitude} m
              </span>
            </span>
          </p>
          <div className="place__actions">
            <button
              type="button"
              className="btn btn--sm"
              onClick={locate}
              disabled={geo.kind === 'locating'}
            >
              <LocateIcon /> {geo.kind === 'locating' ? 'Locating…' : 'Use my location'}
            </button>
            <button
              type="button"
              className={`btn btn--sm btn--ghost btn--disclosure ${showForm ? 'is-open' : ''}`}
              aria-expanded={showForm}
              aria-controls={formId}
              onClick={() => {
                if (!showForm) openCustom();
                setShowForm(!showForm);
              }}
            >
              Enter coordinates
            </button>
          </div>
        </div>
        <div className="chips chips--scroll" role="group" aria-label="City presets">
          {PLACES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${place.presetId === p.id ? 'is-active' : ''}`}
              aria-pressed={place.presetId === p.id}
              title={p.note}
              onClick={() => {
                onPlace({
                  presetId: p.id,
                  name: p.name,
                  lat: p.lat,
                  lon: p.lon,
                  timeZone: p.timeZone,
                  altitude: p.altitude,
                  zoneEstimated: false,
                });
                setGeo({ kind: 'idle' });
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        {showForm && (
          <form
            id={formId}
            className="place__form"
            aria-label="Coordinates"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              applyCustom();
            }}
          >
            {field('lat', 'Latitude °', latText, setLatText)}
            {field('lon', 'Longitude °', lonText, setLonText)}
            <div className={`field field--wide ${errors.zone ? 'field--invalid' : ''}`}>
              <label className="field__label" htmlFor={`${id}-tz`}>
                Time zone (IANA)
              </label>
              <input
                id={`${id}-tz`}
                className="input"
                list={`${id}-zones`}
                value={zoneText}
                onChange={(e) => setZoneText(e.target.value)}
                placeholder="Estimate from longitude"
                aria-invalid={errors.zone ? true : undefined}
                aria-describedby={errors.zone ? `${id}-tz-err` : undefined}
                autoComplete="off"
              />
              <datalist id={`${id}-zones`}>
                {zones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
              {errors.zone && (
                <p className="field__error" id={`${id}-tz-err`}>
                  {errors.zone}
                </p>
              )}
            </div>
            {field('alt', 'Altitude m', altText, setAltText)}
            <button type="submit" className="btn btn--sm btn--primary">
              Go there
            </button>
          </form>
        )}
        {place.zoneEstimated && (
          <p className="note note--soft">
            Time zone estimated from longitude ({formatUtcOffset(offset)}). If local clocks differ,
            set it under “Enter coordinates”; sun positions are unaffected, only clock times shift.
          </p>
        )}
        {(geo.kind === 'ok' || geo.kind === 'error') && (
          <p className={`note ${geo.kind === 'error' ? 'note--warn' : 'note--ok'}`} role="status">
            {geo.text}
          </p>
        )}
      </div>
      <WorldMap
        variant="card"
        lat={place.lat}
        lon={place.lon}
        utc={utc}
        declination={declination}
        eqTime={eqTime}
        onPick={(lat, lon) => {
          onPickMap(lat, lon);
          setGeo({ kind: 'idle' });
        }}
      />
    </section>
  );
}
