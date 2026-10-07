import { describe, expect, it } from 'vitest';
import { parseCoordinates } from './places';
import { decodeState, defaultState, encodeState, mirrorAzimuth } from './state';

const NOW = Date.UTC(2026, 9, 6, 9, 0); // 12:00 in Amman

describe('URL state', () => {
  it('defaults to Amman, today, now', () => {
    const s = defaultState(NOW);
    expect(s.place.presetId).toBe('amman');
    expect(s.date).toEqual({ year: 2026, month: 10, day: 6 });
    expect(s.minutes).toBe(12 * 60);
  });

  it('round-trips a fully customised state', () => {
    const s = defaultState(NOW);
    s.place = {
      presetId: null,
      name: 'Rooftop',
      lat: -12.3456,
      lon: 130.88,
      timeZone: 'Australia/Darwin',
      altitude: 31,
      zoneEstimated: false,
    };
    s.date = { year: 2027, month: 2, day: 14 };
    s.minutes = 7 * 60 + 5;
    s.panel = { tilt: 12.5, azimuth: 355 };
    s.horizon = [
      { az: 80, el: 0 },
      { az: 90, el: 22.5 },
      { az: 120, el: 0 },
    ];
    s.sky = { source: 'climate', aod700: 0.21, pw: 3.2, albedo: 0.35, transposition: 'haydavies' };
    s.pv = { kwp: 7.2, gammaPct: -0.29, noct: 43, lossesPct: 11, ambient: 31 };
    s.period = { kind: 'custom', from: 1115, to: 215 };
    const back = decodeState(`?${encodeState(s).toString()}`, defaultState(NOW));
    expect(back).toEqual(s);
  });

  it('uses a short preset key for unmodified presets', () => {
    const q = encodeState(defaultState(NOW));
    expect(q.get('place')).toBe('amman');
    expect(q.has('lat')).toBe(false);
  });

  it('ignores invalid parameters individually', () => {
    const base = defaultState(NOW);
    const s = decodeState(
      '?lat=95&lon=10&date=2026-13-01&time=2560&tilt=abc&az=-90&aod=9&sky=10:5,x,20',
      base,
    );
    expect(s.place).toEqual(base.place); // latitude out of range → keep the place
    expect(s.date).toEqual(base.date);
    expect(s.minutes).toBe(base.minutes);
    expect(s.panel.tilt).toBe(base.panel.tilt);
    expect(s.panel.azimuth).toBe(270);
    expect(s.sky.aod700).toBe(0.45); // clamped to the model's range
    expect(s.horizon).toEqual([{ az: 10, el: 5 }]);
  });

  it('guesses a nautical zone when the zone is missing or unknown', () => {
    const s = decodeState('?lat=10&lon=44&tz=Nowhere/Land', defaultState(NOW));
    expect(s.place.timeZone).toBe('Etc/GMT-3');
    expect(s.place.zoneEstimated).toBe(true);
  });
});

describe('coordinates', () => {
  it('parses valid input, including comma decimals and a minus sign', () => {
    expect(parseCoordinates('31,95', '−35.5')).toEqual({ lat: 31.95, lon: -35.5 });
  });
  it('explains invalid input', () => {
    const r = parseCoordinates('91', 'east');
    expect('errors' in r && r.errors.lat).toMatch(/between −90° and 90°/);
    expect('errors' in r && r.errors.lon).toMatch(/Enter a longitude/);
  });
});

describe('hemisphere change', () => {
  it('mirrors the panel azimuth across the east–west line', () => {
    expect(mirrorAzimuth(180)).toBe(0);
    expect(mirrorAzimuth(135)).toBe(45);
    expect(mirrorAzimuth(90)).toBe(90);
    expect(mirrorAzimuth(250)).toBe(290);
  });
});
