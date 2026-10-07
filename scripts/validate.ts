/**
 * `npm run validate` — recomputes every comparison against published references, prints
 * Markdown tables (pasted into the README) and writes src/data/validation.json, which the
 * app shows in "How it works". Runs through Vitest so the TypeScript sources need no build.
 */
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import presets from '../src/data/climate-presets.json';
import { PLACES } from '../src/lib/places';
import {
  ViewGrid,
  buildYearTable,
  compareStrategies,
  computeHeatMap,
  integrateFixed,
  periodRanges,
  refineOptimum,
} from '../src/lib/solar/annual';
import type { ClimateNormals } from '../src/lib/solar/climate';
import {
  clearSky,
  extraterrestrialNormal,
  relativeAirMass,
  simplifiedSolis,
  solisCoefficients,
} from '../src/lib/solar/irradiance';
import { cosd } from '../src/lib/solar/math';
import { SiteModel } from '../src/lib/solar/model';
import {
  HORIZONS_CASES,
  NOAA_CASES,
  PVGIS_OPTIMA,
  USNO_CASES,
  hms,
  jacobsonJadhav,
} from '../src/lib/solar/references';
import { sunPosition, sunTimes } from '../src/lib/solar/sunPosition';
import { cosIncidence, planeOfArray, skyDiffuse } from '../src/lib/solar/transposition';

const r = (x: number, d: number) => Number(x.toFixed(d));
const localMin = (utc: number, date: { year: number; month: number; day: number }, tz: number) =>
  (utc - Date.UTC(date.year, date.month - 1, date.day)) / 60000 + tz * 60;
const hhmm = (m: number) => {
  const total = Math.round(m);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const clock = (m: number) => {
  const s = Math.round(m * 60);
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

it('validation report', () => {
  const out: Record<string, unknown> = { generated: new Date().toISOString().slice(0, 10) };
  const md: string[] = [];

  // 1. Sun position vs NOAA (live page values)
  const noaa = NOAA_CASES.map((c) => {
    const utc =
      Date.UTC(c.date.year, c.date.month - 1, c.date.day) + (c.localTime - c.tz * 60) * 60000;
    const p = sunPosition(utc, c.lat, c.lon);
    const t = sunTimes(c.date, c.lat, c.lon);
    return {
      case: `${c.name} ${c.date.year}-${String(c.date.month).padStart(2, '0')}-${String(c.date.day).padStart(2, '0')} 12:00`,
      elevation: { ref: c.elevation, got: r(p.elevation, 3) },
      azimuth: { ref: c.azimuth, got: r(p.azimuth, 3) },
      sunrise: {
        ref: c.sunrise,
        got: clock(localMin(t.sunriseUtc!, c.date, c.tz)),
        diffS: r((localMin(t.sunriseUtc!, c.date, c.tz) - c.precise.sunrise) * 60, 1),
      },
      sunset: {
        ref: c.sunset,
        got: clock(localMin(t.sunsetUtc!, c.date, c.tz)),
        diffS: r((localMin(t.sunsetUtc!, c.date, c.tz) - c.precise.sunset) * 60, 1),
      },
      noon: {
        ref: c.solarNoon,
        got: clock(localMin(t.solarNoonUtc, c.date, c.tz)),
        diffS: r((localMin(t.solarNoonUtc, c.date, c.tz) - hms(c.solarNoon)) * 60, 1),
      },
    };
  });
  out.noaa = noaa;
  md.push('### Sun position vs the NOAA Solar Calculator (live page, 2026-10-06)', '');
  md.push(
    '| Case | Elevation NOAA / ours | Azimuth NOAA / ours | Sunrise NOAA / ours | Sunset NOAA / ours | Solar noon NOAA / ours |',
  );
  md.push('|---|---|---|---|---|---|');
  for (const n of noaa) {
    md.push(
      `| ${n.case} | ${n.elevation.ref}° / ${n.elevation.got}° | ${n.azimuth.ref}° / ${n.azimuth.got}° | ${n.sunrise.ref} / ${n.sunrise.got} | ${n.sunset.ref} / ${n.sunset.got} | ${n.noon.ref} / ${n.noon.got} |`,
    );
  }

  // 2. Horizons and USNO
  const horizons = HORIZONS_CASES.map((c) => {
    const p = sunPosition(c.utc, c.lat, c.lon);
    return { case: c.label, dEl: r(p.elevation - c.el, 4), dAz: r(p.azimuth - c.az, 4) };
  });
  out.horizons = horizons;
  md.push('', '### Independent checks', '');
  md.push('| Case | Reference | Δ elevation | Δ azimuth |', '|---|---|---|---|');
  for (const h of horizons)
    md.push(`| ${h.case} | JPL Horizons (refracted) | ${h.dEl}° | ${h.dAz}° |`);
  const usno = USNO_CASES.map((c) => {
    const t = sunTimes(c.date, c.lat, c.lon);
    return {
      case: c.label,
      rise: { ref: c.rise, got: hhmm(localMin(t.sunriseUtc!, c.date, c.tz)) },
      set: { ref: c.set, got: hhmm(localMin(t.sunsetUtc!, c.date, c.tz)) },
    };
  });
  out.usno = usno;
  md.push('', '| Case | USNO rise / ours | USNO set / ours |', '|---|---|---|');
  for (const u of usno)
    md.push(`| ${u.case} | ${u.rise.ref} / ${u.rise.got} | ${u.set.ref} / ${u.set.got} |`);

  // 3. pvlib regression vectors (max abs error)
  const solisCases: [number, number, number, number, number, number][] = [
    [0.1, 1, 101325, 1064.653145, 959.335463, 129.125602],
    [0.0, 1, 101325, 1105.7229086, 1056.61710493, 64.41747323],
    [1, 1, 101325, 638.63409683, 342.45810926, 77.71786575],
    [0.1, 5, 101325, 974.18046717, 872.02335029, 125.63581346],
    [0.1, 1, 95000, 1067.96543669, 964.26930718, 127.22841797],
  ];
  let solisErr = 0;
  for (const [aod, w, p, g, b, d] of solisCases) {
    const s = simplifiedSolis(80, aod, w, p);
    solisErr = Math.max(solisErr, Math.abs(s.ghi - g), Math.abs(s.dni - b), Math.abs(s.dhi - d));
  }
  const fix = {
    dni: [316.1949056, 939.95469881, 646.22886049],
    dhi: [40.46149818, 118.45831879, 62.03376265],
    zen: [82.85457044, 10.56413562, 72.41687122],
    az: [66.71410338, 144.76567754, 287.04104128],
    am: [7.58831596, 1.01688136, 3.27930443],
  };
  const perezRef = [31.46046871, 109.084332, 45.45539877];
  const hdRef = [27.1775, 102.9949, 33.1909];
  let perezErr = 0;
  let hdErr = 0;
  for (let i = 0; i < 3; i++) {
    const base = {
      tiltDeg: 40,
      cosAoi: cosIncidence(40, 180, fix.zen[i], fix.az[i]),
      zenithDeg: fix.zen[i],
      dni: fix.dni[i],
      dhi: fix.dhi[i],
      dniExtra: 1321.1655834833093,
      airMass: fix.am[i],
    };
    perezErr = Math.max(
      perezErr,
      Math.abs(skyDiffuse({ ...base, model: 'perez' }).total - perezRef[i]),
    );
    hdErr = Math.max(hdErr, Math.abs(skyDiffuse({ ...base, model: 'haydavies' }).total - hdRef[i]));
  }
  // Brief sanity checks
  const c = solisCoefficients(0.1, 1.5, 101325);
  let tilt0 = 0;
  let normal = 0;
  for (const zen of [10, 30, 50, 70, 84]) {
    const cs = clearSky(cosd(zen), extraterrestrialNormal(1), c);
    const common = {
      dni: cs.dni,
      dhi: cs.dhi,
      ghi: cs.ghi,
      dniExtra: extraterrestrialNormal(1),
      airMass: relativeAirMass(zen),
      albedo: 0.2,
      model: 'perez' as const,
      zenithDeg: zen,
      sunAzimuthDeg: 140,
    };
    tilt0 = Math.max(
      tilt0,
      Math.abs(planeOfArray({ ...common, tiltDeg: 0, surfaceAzimuthDeg: 180 }).total - cs.ghi),
    );
    normal = Math.max(
      normal,
      Math.abs(planeOfArray({ ...common, tiltDeg: zen, surfaceAzimuthDeg: 140 }).beam - cs.dni),
    );
  }
  out.models = {
    solisMaxAbs: solisErr,
    perezMaxAbs: perezErr,
    hayDaviesMaxAbs: hdErr,
    tilt0MaxAbs: tilt0,
    normalBeamMaxAbs: normal,
  };
  md.push('', '### Irradiance models vs pvlib-python test vectors', '');
  md.push('| Check | Max abs. difference |', '|---|---|');
  md.push(`| Simplified Solis (GHI/DNI/DHI, 5 cases) | ${solisErr.toExponential(1)} W/m² |`);
  md.push(`| Perez 1990 sky diffuse (3 cases) | ${perezErr.toExponential(1)} W/m² |`);
  md.push(`| Hay–Davies sky diffuse (3 cases) | ${hdErr.toExponential(1)} W/m² |`);
  md.push(`| Tilt 0° → POA = GHI (5 zeniths) | ${tilt0.toExponential(1)} W/m² |`);
  md.push(`| Normal incidence → beam = DNI | ${normal.toExponential(1)} W/m² |`);

  // 4. Optimum tilt vs PVGIS 5.3 and Jacobson & Jadhav (2018)
  const rows = PLACES.map((p) => {
    const model = new SiteModel({
      lat: p.lat,
      lon: p.lon,
      altitude: p.altitude,
      aod700: 0.1,
      pw: 1.5,
      albedo: 0.2,
      transposition: 'perez',
      horizon: [],
    });
    const data = (presets.places as Record<string, ClimateNormals>)[p.id];
    const normals: ClimateNormals = { ...data, lat: p.lat, lon: p.lon };
    const res = [null, normals].map((climate) => {
      const t = buildYearTable(model, 2026, 15, climate, 25);
      const ranges = periodRanges(t, null);
      const views = new ViewGrid(model.horizon);
      const heat = computeHeatMap(t, ranges, views, true);
      const opt = refineOptimum(t, ranges, heat, views, true, p.lat);
      const strat = compareStrategies(t, null, ranges, opt, views, true);
      const pvgisAz = p.lat >= 0 ? 180 : 0;
      const captured =
        integrateFixed(
          t,
          { tilt: PVGIS_OPTIMA[p.id].slope, azimuth: pvgisAz },
          null,
          ranges,
          true,
        ) / opt.energy;
      return { opt, strat, captured };
    });
    const [clear, clim] = res;
    return {
      place: p.name,
      lat: p.lat,
      pvgis: PVGIS_OPTIMA[p.id].slope,
      pvgisDb: PVGIS_OPTIMA[p.id].db,
      jj: r(jacobsonJadhav(p.lat), 1),
      clearTilt: r(clear.opt.tilt, 1),
      climateTilt: r(clim.opt.tilt, 1),
      clearAz: r(clear.opt.azimuth, 1),
      capturedPct: r(clim.captured * 100, 2),
      clearEnergy: r(clear.opt.energy, 0),
      climateEnergy: r(clim.opt.energy, 0),
      pvgisHiy: PVGIS_OPTIMA[p.id].hiy,
      gains: Object.fromEntries(clear.strat.map((s) => [s.id, r(s.gainPct, 1)])),
    };
  });
  out.optimum = rows;
  md.push('', '### Optimum fixed tilt (equator-facing), 2026', '');
  md.push(
    '| Place | Lat | PVGIS 5.3 | J&J 2018 fit | Ours, NASA POWER normals | Ours, clear sky | PVGIS angle captures | H(i) PVGIS / ours (normals) |',
  );
  md.push('|---|---|---|---|---|---|---|---|');
  for (const o of rows) {
    md.push(
      `| ${o.place} | ${o.lat}° | ${o.pvgis}° (${o.pvgisDb}) | ${o.jj}° | ${o.climateTilt}° | ${o.clearTilt}° | ${o.capturedPct} % | ${o.pvgisHiy} / ${o.climateEnergy} kWh/m² |`,
    );
  }
  md.push('', '### Clear-sky strategy gains vs the optimum fixed panel', '');
  md.push(
    '| Place | Rule of thumb | Re-tilt 2× | Re-tilt 4× | 1-axis | 2-axis |',
    '|---|---|---|---|---|---|',
  );
  for (const o of rows) {
    const g = o.gains as Record<string, number>;
    md.push(
      `| ${o.place} | ${g.rule} % | +${g.retilt2} % | +${g.retilt4} % | +${g.single} % | +${g.dual} % |`,
    );
  }

  writeFileSync('src/data/validation.json', JSON.stringify(out, null, 1) + '\n');
  process.stdout.write('\n' + md.join('\n') + '\n\n');
}, 300_000);
