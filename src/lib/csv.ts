/**
 * Hourly CSV export for the chosen configuration. Each row is the mean over the clock hour
 * (four 15-minute samples), so W/m² values equal Wh/m² in that hour and the columns sum to
 * the annual totals shown in the app.
 */
import { ashraeIam, noctCellTemperature, pvPower } from './solar/annual';
import type { PvParams } from './solar/annual';
import { airTemperature } from './solar/climate';
import type { ClimateFactors, ClimateNormals } from './solar/climate';
import { localMeanMonth } from './solar/model';
import { sunPosition } from './solar/sunPosition';
import type { Orientation, SiteModel } from './solar/model';
import { MS_PER_HOUR, MS_PER_MINUTE, daysInYear } from './solar/time';
import { utcToZoned, zonedTimeToUtc } from './solar/zone';

export const CSV_COLUMNS = [
  'local_time',
  'utc_offset',
  'sun_elevation_deg',
  'sun_azimuth_deg',
  'ghi_w_m2',
  'dni_w_m2',
  'dhi_w_m2',
  'poa_total_w_m2',
  'poa_beam_w_m2',
  'poa_sky_diffuse_w_m2',
  'poa_ground_w_m2',
  'sun_visible_fraction',
  'air_temp_c',
  'cell_temp_c',
  'ac_power_kw',
] as const;

export interface CsvInput {
  model: SiteModel;
  year: number;
  timeZone: string;
  panel: Orientation;
  pv: PvParams;
  factors: ClimateFactors | null;
  climate: ClimateNormals | null;
  ambient: number;
}

const f = (x: number, d: number): string => (Math.abs(x) < 0.5 * 10 ** -d ? '0' : x.toFixed(d));

export function hourlyCsv(input: CsvInput): string {
  const { model, year, timeZone, panel, pv, factors, climate, ambient } = input;
  const start = zonedTimeToUtc({ year, month: 1, day: 1 }, 0, timeZone);
  const end = zonedTimeToUtc({ year: year + 1, month: 1, day: 1 }, 0, timeZone);
  const rows: string[] = [CSV_COLUMNS.join(',')];
  const sub = 4;
  for (let h = start; h < end; h += MS_PER_HOUR) {
    let ghi = 0,
      dni = 0,
      dhi = 0,
      tot = 0,
      beam = 0,
      diff = 0,
      ground = 0,
      vis = 0,
      tAir = 0,
      tCell = 0,
      power = 0,
      el = 0,
      az = 0;
    for (let k = 0; k < sub; k++) {
      const t = h + (k + 0.5) * (60 / sub) * MS_PER_MINUTE;
      const s = model.sample(t, factors);
      const p = model.plane(s, panel, true);
      const solarHour = (s.sun.trueSolarTime / 60) % 24;
      const air = climate
        ? airTemperature(climate, localMeanMonth(t, model.spec.lon), solarHour)
        : ambient;
      const cell = noctCellTemperature(air, p.total, pv.noct);
      const iam = ashraeIam(p.cosAoi);
      const circ = p.parts.circumsolar;
      const eff = (p.beam + circ) * iam + (p.skyDiffuse - circ) + p.ground;
      ghi += s.ghi;
      dni += s.dni;
      dhi += s.dhi;
      tot += p.total;
      beam += p.beam;
      diff += p.skyDiffuse;
      ground += p.ground;
      vis += s.sunVisible ? 1 : 0;
      tAir += air;
      tCell += p.total > 0 ? cell : air;
      power += p.total > 0 ? pvPower(eff, cell, pv) : 0;
    }
    // Sun position at the middle of the hour.
    const midSun = sunPosition(h + 30 * MS_PER_MINUTE, model.spec.lat, model.spec.lon);
    el = midSun.elevation;
    az = midSun.azimuth;
    const local = utcToZoned(h, timeZone);
    const hh = Math.floor(local.minutes / 60);
    const stamp = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:00`;
    const off = local.offsetMinutes;
    const offText = `${off < 0 ? '-' : '+'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
    rows.push(
      [
        stamp,
        offText,
        f(el, 2),
        f(az, 2),
        f(ghi / sub, 1),
        f(dni / sub, 1),
        f(dhi / sub, 1),
        f(tot / sub, 1),
        f(beam / sub, 1),
        f(diff / sub, 1),
        f(ground / sub, 1),
        f(vis / sub, 2),
        f(tAir / sub, 1),
        f(tCell / sub, 1),
        f(power / sub, 4),
      ].join(','),
    );
  }
  return rows.join('\n') + '\n';
}

export function csvFileName(placeName: string, year: number, panel: Orientation): string {
  const slug =
    placeName
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'location';
  return `heliograph_${slug}_${year}_tilt${Math.round(panel.tilt)}_az${Math.round(panel.azimuth)}.csv`;
}

export function hoursInYear(year: number): number {
  return daysInYear(year) * 24;
}
