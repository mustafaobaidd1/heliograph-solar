/**
 * Two slices through the energy landscape at the current panel orientation (energy vs tilt at
 * its azimuth, energy vs azimuth at its tilt), plus how far the angles can stray from the
 * optimum before losing more than 5 %.
 */
import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import { useMemo } from 'react';
import { compassPoint, fmt } from '../lib/format';
import type { HeatMap, Optimum } from '../lib/solar/annual';
import { GRID_AZ_STEP, GRID_TILT_STEP } from '../lib/solar/annual';
import { clamp, wrap360 } from '../lib/solar/math';

/** Bilinear sample of the landscape (kWh/m²) with azimuth wrap-around. */
export function sampleHeat(h: HeatMap, tilt: number, az: number): number {
  const na = h.azimuths.length;
  const nt = h.tilts.length;
  const ti = clamp(tilt / GRID_TILT_STEP, 0, nt - 1.000001);
  const i0 = Math.floor(ti);
  const ft = ti - i0;
  const aj = wrap360(az) / GRID_AZ_STEP;
  const j0 = Math.floor(aj) % na;
  const j1 = (j0 + 1) % na;
  const fa = aj - Math.floor(aj);
  const v = h.values;
  const a = v[i0 * na + j0] * (1 - fa) + v[i0 * na + j1] * fa;
  const b = v[(i0 + 1) * na + j0] * (1 - fa) + v[(i0 + 1) * na + j1] * fa;
  return a * (1 - ft) + b * ft;
}

export interface Tolerance {
  tilt: [number, number];
  /** null when every direction stays within the threshold (nearly flat optimum) */
  azimuth: [number, number] | null;
}

/** Contiguous ranges around the optimum where energy stays ≥ `frac` of the optimum. */
export function tolerance(h: HeatMap, opt: Optimum, frac = 0.95): Tolerance {
  const limit = frac * opt.energy;
  let tLo = opt.tilt;
  let tHi = opt.tilt;
  while (tLo > 0 && sampleHeat(h, tLo - 0.5, opt.azimuth) >= limit) tLo -= 0.5;
  while (tHi < 90 && sampleHeat(h, tHi + 0.5, opt.azimuth) >= limit) tHi += 0.5;
  let left = 0;
  let right = 0;
  while (left < 180 && sampleHeat(h, opt.tilt, opt.azimuth - left - 1) >= limit) left += 1;
  while (right < 180 && sampleHeat(h, opt.tilt, opt.azimuth + right + 1) >= limit) right += 1;
  return {
    tilt: [Math.max(0, tLo), Math.min(90, tHi)],
    azimuth:
      left + right >= 358 ? null : [wrap360(opt.azimuth - left), wrap360(opt.azimuth + right)],
  };
}

const W = 300;
const H = 132;
const M = { l: 38, r: 10, t: 12, b: 26 };

function Slice({
  points,
  xDomain,
  xTicks,
  xLabel,
  marker,
  title,
}: {
  points: [number, number][];
  xDomain: [number, number];
  xTicks: { v: number; label: string }[];
  xLabel: (v: number) => string;
  marker: [number, number];
  title: string;
}) {
  const minY = Math.max(0, Math.floor((Math.min(...points.map((p) => p[1])) - 2) / 10) * 10);
  const x = scaleLinear()
    .domain(xDomain)
    .range([M.l, W - M.r]);
  const y = scaleLinear()
    .domain([minY, 100])
    .range([H - M.b, M.t]);
  const d = line<[number, number]>()
    .x((p) => x(p[0]))
    .y((p) => y(p[1]))(points);
  return (
    <figure className="slice">
      <figcaption>{title}</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title}: your panel gets ${fmt(marker[1], 1)} % of the optimum at ${xLabel(marker[0])}.`}
      >
        {y.ticks(3).map((t) => (
          <g key={t} className="axis">
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
            <text x={M.l - 5} y={y(t)} textAnchor="end" dominantBaseline="central">
              {t}%
            </text>
          </g>
        ))}
        <line x1={M.l} x2={W - M.r} y1={y(95)} y2={y(95)} className="slice__band" />
        {xTicks.map((t) => (
          <text key={t.v} x={x(t.v)} y={H - 8} textAnchor="middle" className="axis-label">
            {t.label}
          </text>
        ))}
        <path d={d ?? ''} className="slice__line" />
        <line
          x1={x(marker[0])}
          x2={x(marker[0])}
          y1={y(minY)}
          y2={y(marker[1])}
          className="slice__drop"
        />
        <circle cx={x(marker[0])} cy={y(marker[1])} r="4" className="slice__dot" />
      </svg>
    </figure>
  );
}

export function HeatSlices({
  heat,
  optimum,
  panel,
}: {
  heat: HeatMap;
  optimum: Optimum;
  panel: { tilt: number; azimuth: number };
}) {
  const tilts = useMemo(() => {
    const pts: [number, number][] = [];
    for (let t = 0; t <= 90; t += 1)
      pts.push([t, (sampleHeat(heat, t, panel.azimuth) / optimum.energy) * 100]);
    return pts;
  }, [heat, optimum.energy, panel.azimuth]);
  const azimuths = useMemo(() => {
    const pts: [number, number][] = [];
    for (let a = 0; a <= 360; a += 2)
      pts.push([a, (sampleHeat(heat, panel.tilt, a) / optimum.energy) * 100]);
    return pts;
  }, [heat, optimum.energy, panel.tilt]);
  const here = (sampleHeat(heat, panel.tilt, panel.azimuth) / optimum.energy) * 100;
  const tol = useMemo(() => tolerance(heat, optimum), [heat, optimum]);
  const deg = (v: number) => `${fmt(v, 0)}°`;
  return (
    <div className="slices">
      <p className="slices__tol">
        Stay within <strong>95 %</strong> of the optimum with a tilt of {deg(tol.tilt[0])}–
        {deg(tol.tilt[1])}
        {tol.azimuth ? (
          <>
            {' '}
            and a direction between {deg(tol.azimuth[0])} {compassPoint(tol.azimuth[0])} and{' '}
            {deg(tol.azimuth[1])} {compassPoint(tol.azimuth[1])}
          </>
        ) : (
          <> facing any direction</>
        )}
        .
      </p>
      <div className="slices__charts">
        <Slice
          title={`Changing the tilt, facing ${deg(panel.azimuth)} ${compassPoint(panel.azimuth)}`}
          points={tilts}
          xDomain={[0, 90]}
          xTicks={[0, 30, 60, 90].map((v) => ({ v, label: `${v}°` }))}
          xLabel={(v) => `${fmt(v, 0)}° tilt`}
          marker={[panel.tilt, here]}
        />
        <Slice
          title={`Changing the direction, tilted ${deg(panel.tilt)}`}
          points={azimuths}
          xDomain={[0, 360]}
          xTicks={[0, 90, 180, 270, 360].map((v) => ({
            v,
            label: ['N', 'E', 'S', 'W', 'N'][v / 90],
          }))}
          xLabel={(v) => `${fmt(v, 0)}° azimuth`}
          marker={[panel.azimuth, here]}
        />
      </div>
    </div>
  );
}
