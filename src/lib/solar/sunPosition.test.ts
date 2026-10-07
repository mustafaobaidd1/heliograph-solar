import { describe, expect, it } from 'vitest';
import { nextOrdinaryDay, solarGeometry, sunPosition, sunTimes } from './sunPosition';
import { HORIZONS_CASES, NOAA_CASES as NOAA, USNO_CASES, hms } from './references';
import { MS_PER_DAY, julianCentury, julianDay } from './time';

/** Reference values with their sources and dates: see ./references.ts. */
const localMinutes = (
  utc: number,
  date: { year: number; month: number; day: number },
  tz: number,
) => (utc - Date.UTC(date.year, date.month - 1, date.day)) / 60000 + tz * 60;

describe('sun position vs NOAA Solar Calculator', () => {
  for (const c of NOAA) {
    describe(`${c.name} ${c.date.year}-${c.date.month}-${c.date.day}`, () => {
      const utc =
        Date.UTC(c.date.year, c.date.month - 1, c.date.day) + (c.localTime - c.tz * 60) * 60000;
      const pos = sunPosition(utc, c.lat, c.lon);
      const times = sunTimes(c.date, c.lat, c.lon);

      it('elevation (with refraction) within 0.1°', () => {
        expect(Math.abs(pos.elevation - c.elevation)).toBeLessThan(0.1);
        // and in fact agrees to the page's 0.01° display resolution
        expect(Math.abs(pos.elevation - c.elevation)).toBeLessThanOrEqual(0.006);
      });

      it('azimuth within 0.1°', () => {
        expect(Math.abs(pos.azimuth - c.azimuth)).toBeLessThan(0.1);
        expect(Math.abs(pos.azimuth - c.azimuth)).toBeLessThanOrEqual(0.006);
      });

      it('declination and equation of time match', () => {
        expect(Math.abs(pos.declination - c.declination)).toBeLessThanOrEqual(0.006);
        expect(Math.abs(pos.eqTime - c.eqTime)).toBeLessThanOrEqual(0.006);
      });

      it('sunrise, sunset and solar noon within 1 minute', () => {
        const rise = localMinutes(times.sunriseUtc!, c.date, c.tz);
        const set = localMinutes(times.sunsetUtc!, c.date, c.tz);
        const noon = localMinutes(times.solarNoonUtc, c.date, c.tz);
        expect(Math.abs(rise - hms(c.sunrise))).toBeLessThan(1);
        expect(Math.abs(set - hms(c.sunset))).toBeLessThan(1);
        expect(Math.abs(noon - hms(c.solarNoon))).toBeLessThan(1);
        // Against the calculator's unrounded values the difference is a few seconds:
        // NOAA refines sunrise once and takes the noon equation of time at 0h UT, we iterate.
        expect(Math.abs(rise - c.precise.sunrise)).toBeLessThan(0.25);
        expect(Math.abs(set - c.precise.sunset)).toBeLessThan(0.25);
        expect(Math.abs(noon - c.precise.solarNoon)).toBeLessThan(0.25);
      });
    });
  }
});

/**
 * Independent check: JPL Horizons apparent (refracted) azimuth/elevation of the Sun
 * (ssd.jpl.nasa.gov/api/horizons.api, QUANTITIES=4, APPARENT=REFRACTED, geodetic site at
 * 0 m, queried 2026-10-06). The NOAA/Meeus algorithm agrees to better than 0.01°.
 */
describe('sun position vs JPL Horizons', () => {
  const cases = HORIZONS_CASES;
  for (const c of cases) {
    it(`agrees within 0.01° at ${new Date(c.utc).toISOString()}`, () => {
      const p = sunPosition(c.utc, c.lat, c.lon);
      expect(Math.abs(p.elevation - c.el)).toBeLessThan(0.01);
      expect(Math.abs(p.azimuth - c.az)).toBeLessThan(0.01);
    });
  }
});

/**
 * Independent rise/set: US Naval Observatory API (aa.usno.navy.mil/api/rstt/oneday,
 * queried 2026-10-06), times rounded to the minute by USNO.
 */
describe('sunrise/sunset vs USNO', () => {
  const cases = USNO_CASES;
  for (const c of cases) {
    it(`matches to the minute for ${JSON.stringify(c.date)}`, () => {
      const t = sunTimes(c.date, c.lat, c.lon);
      expect(Math.abs(localMinutes(t.sunriseUtc!, c.date, c.tz) - hms(c.rise))).toBeLessThan(1);
      expect(Math.abs(localMinutes(t.sunsetUtc!, c.date, c.tz) - hms(c.set))).toBeLessThan(1);
      expect(Math.abs(localMinutes(t.solarNoonUtc, c.date, c.tz) - hms(c.noon))).toBeLessThan(1);
    });
  }
});

describe('polar day and night', () => {
  it('Reykjavík in June still has a (short) night: sets 00:04 the next day, rises 02:55', () => {
    // NOAA: sunrise 02:55, sunset 00:04 (22 Jun); USNO lists Set 00:04 / Rise 02:55.
    const date = { year: 2026, month: 6, day: 21 };
    const t = sunTimes(date, 64.1466, -21.9426);
    expect(t.polar).toBeNull();
    expect(Math.abs(localMinutes(t.sunriseUtc!, date, 0) - hms('02:55'))).toBeLessThan(1);
    expect(Math.abs(localMinutes(t.sunsetUtc!, date, 0) - (1440 + hms('00:04')))).toBeLessThan(1);
    expect(t.dayLength).toBeGreaterThan(21 * 60);
  });

  it('Tromsø has polar day at the June solstice and polar night at the December solstice', () => {
    const june = sunTimes({ year: 2026, month: 6, day: 21 }, 69.6492, 18.9553);
    expect(june.polar).toBe('day');
    expect(june.sunriseUtc).toBeNull();
    expect(june.dayLength).toBe(1440);
    const dec = sunTimes({ year: 2026, month: 12, day: 21 }, 69.6492, 18.9553);
    expect(dec.polar).toBe('night');
    expect(dec.dayLength).toBe(0);
    expect(dec.noonElevation).toBeLessThan(0);
  });

  it('finds when an ordinary day returns after the midnight sun', () => {
    const next = nextOrdinaryDay({ year: 2026, month: 6, day: 21 }, 69.6492, 18.9553, 1);
    const prev = nextOrdinaryDay({ year: 2026, month: 6, day: 21 }, 69.6492, 18.9553, -1);
    expect(next).not.toBeNull();
    expect(prev).not.toBeNull();
    // Midnight sun in Tromsø lasts roughly 20 May – 22 July.
    expect(next!.month).toBe(7);
    expect(prev!.month).toBe(5);
  });

  it('handles the North Pole and the equator without NaN', () => {
    const pole = sunPosition(Date.UTC(2026, 5, 21, 12), 90, 0);
    expect(pole.elevation).toBeGreaterThan(23);
    expect(Number.isFinite(pole.azimuth)).toBe(true);
    const eq = sunTimes({ year: 2026, month: 3, day: 20 }, 0, 0);
    expect(eq.dayLength).toBeGreaterThan(12 * 60);
    expect(eq.dayLength).toBeLessThan(12 * 60 + 10);
  });
});

describe('declination and equation of time over 2026', () => {
  const days: { doy: number; decl: number; eot: number }[] = [];
  for (let d = 0; d < 365; d++) {
    const utc = Date.UTC(2026, 0, 1) + d * MS_PER_DAY + 12 * 3600_000;
    const g = solarGeometry(julianCentury(julianDay(utc)));
    days.push({ doy: d + 1, decl: g.declination, eot: g.eqTime });
  }

  it('declination stays within ±23.44° and reaches both extremes', () => {
    const max = Math.max(...days.map((d) => d.decl));
    const min = Math.min(...days.map((d) => d.decl));
    expect(max).toBeLessThanOrEqual(23.44 + 0.005);
    expect(min).toBeGreaterThanOrEqual(-23.44 - 0.005);
    expect(max).toBeGreaterThan(23.43);
    expect(min).toBeLessThan(-23.43);
  });

  it('equation of time peaks near +16.4 min in early November and −14.2 min in mid February', () => {
    const top = days.reduce((a, b) => (b.eot > a.eot ? b : a));
    const bottom = days.reduce((a, b) => (b.eot < a.eot ? b : a));
    expect(top.eot).toBeCloseTo(16.4, 0);
    expect(Math.abs(top.eot - 16.4)).toBeLessThan(0.15);
    expect(bottom.eot).toBeCloseTo(-14.2, 0);
    expect(Math.abs(bottom.eot + 14.2)).toBeLessThan(0.15);
    // Early November is day 305–312; mid February day 40–48.
    expect(top.doy).toBeGreaterThanOrEqual(300);
    expect(top.doy).toBeLessThanOrEqual(312);
    expect(bottom.doy).toBeGreaterThanOrEqual(38);
    expect(bottom.doy).toBeLessThanOrEqual(48);
  });

  it('Earth–Sun distance is least in early January (perihelion) and greatest in early July', () => {
    const r = (m: number, d: number) =>
      solarGeometry(julianCentury(julianDay(Date.UTC(2026, m, d, 12)))).radiusVector;
    expect(r(0, 3)).toBeLessThan(0.984);
    expect(r(6, 6)).toBeGreaterThan(1.016);
  });
});
