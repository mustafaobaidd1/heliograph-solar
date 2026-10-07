/**
 * Stereographic sun-path diagram (zenith at the centre, horizon on the rim, north up) with
 * monthly day lines, hour analemmas in local standard time, the selected day, the current
 * sun, and a skyline the user can draw by dragging.
 */
import { line } from 'd3-shape';
import { useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PALETTE, seasonColor } from '../lib/color';
import { fmt } from '../lib/format';
import { EraserIcon, PencilIcon } from './icons';
import { binsToPoints, paintBins, pointsToBins } from '../lib/skylineDraw';
import { horizonElevationAt } from '../lib/solar/horizon';
import type { HorizonPoint } from '../lib/solar/horizon';
import { DEG } from '../lib/solar/math';
import { sunTimes } from '../lib/solar/sunPosition';
import { MONTH_SHORT } from '../lib/solar/time';
import type { CalendarDate } from '../lib/solar/time';
import { analemmas, dayPath, invertStereo, projectStereo, seasonFraction } from '../lib/sunpath';
import type { PathPoint, SkyPoint } from '../lib/sunpath';

const SIZE = 560;
const C = SIZE / 2;
const R = 228;

type Mode = 'view' | 'draw' | 'erase';

const P = (p: SkyPoint): [number, number] => projectStereo(p.az, Math.max(p.el, 0), R, C, C);
const pathOf = line<[number, number]>();

/** Splits a path into above-horizon runs, inserting the horizon crossing points. */
function aboveHorizon<T extends SkyPoint>(pts: T[]): SkyPoint[][] {
  const runs: SkyPoint[][] = [];
  let cur: SkyPoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[i - 1];
    if (prev && prev.el <= 0 !== p.el <= 0) {
      const t = prev.el / (prev.el - p.el);
      let daz = p.az - prev.az;
      if (daz > 180) daz -= 360;
      if (daz < -180) daz += 360;
      const cross = { az: prev.az + daz * t, el: 0 };
      if (p.el > 0) {
        cur = [cross];
      } else {
        cur.push(cross);
        runs.push(cur);
        cur = [];
      }
    }
    if (p.el > 0) cur.push(p);
  }
  if (cur.length > 1) runs.push(cur);
  return runs.filter((r) => r.length > 1);
}

/** Splits an above-horizon run by skyline visibility. */
function byVisibility(
  run: SkyPoint[],
  horizon: HorizonPoint[],
): { pts: SkyPoint[]; visible: boolean }[] {
  if (!horizon.length) return [{ pts: run, visible: true }];
  const out: { pts: SkyPoint[]; visible: boolean }[] = [];
  let cur: SkyPoint[] = [];
  let vis: boolean | null = null;
  for (const p of run) {
    const v = p.el > horizonElevationAt(horizon, p.az);
    if (vis === null) vis = v;
    if (v !== vis) {
      cur.push(p);
      out.push({ pts: cur, visible: vis });
      cur = [p];
      vis = v;
    } else cur.push(p);
  }
  if (cur.length > 1 && vis !== null) out.push({ pts: cur, visible: vis });
  return out;
}

export interface SunPathProps {
  lat: number;
  lon: number;
  timeZone: string;
  date: CalendarDate;
  selectedPath: PathPoint[];
  sun: { az: number; el: number };
  declination: number;
  horizon: HorizonPoint[];
  onHorizonChange: (points: HorizonPoint[]) => void;
  timeLabel: string;
}

export function SunPathDiagram({
  lat,
  lon,
  timeZone,
  date,
  selectedPath,
  sun,
  declination,
  horizon,
  onHorizonChange,
  timeLabel,
}: SunPathProps) {
  const uid = useId().replace(/:/g, '');
  const [mode, setMode] = useState<Mode>('view');
  const [hover, setHover] = useState<SkyPoint | null>(null);
  const [preview, setPreview] = useState<Float32Array | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const stroke = useRef<{ bins: Float32Array; last: SkyPoint } | null>(null);

  const year = date.year;
  const monthLines = useMemo(() => {
    // 21st of each month; Jan–Jun only (Jul–Dec nearly retrace them) plus the solstices.
    const months = [12, 1, 2, 3, 4, 5, 6];
    return months.map((m) => {
      const d = { year, month: m, day: 21 };
      const pts = dayPath(d, lat, lon, timeZone, 8);
      const decl = sunTimes(d, lat, lon).declination;
      return { month: m, runs: aboveHorizon(pts), color: seasonColor(seasonFraction(decl, lat)) };
    });
  }, [lat, lon, timeZone, year]);

  const loops = useMemo(() => analemmas(year, lat, lon, timeZone, 3), [lat, lon, timeZone, year]);

  const drawnHorizon = useMemo(
    () => (preview ? binsToPoints(preview, 0.2) : horizon),
    [preview, horizon],
  );

  const skylinePath = useMemo(() => {
    if (!drawnHorizon.length) return null;
    const outer: string[] = [];
    const inner: string[] = [];
    for (let a = 0; a <= 360; a += 1) {
      const [ox, oy] = projectStereo(a, 0, R, C, C);
      outer.push(`${a === 0 ? 'M' : 'L'}${ox.toFixed(2)},${oy.toFixed(2)}`);
    }
    for (let a = 360; a >= 0; a -= 1) {
      const el = horizonElevationAt(drawnHorizon, a);
      const [x, y] = projectStereo(a, el, R, C, C);
      inner.push(`${a === 360 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return `${outer.join('')}Z${inner.join('')}Z`;
  }, [drawnHorizon]);

  const selected = useMemo(() => {
    const runs = aboveHorizon(selectedPath);
    return runs.flatMap((r) => byVisibility(r, drawnHorizon));
  }, [selectedPath, drawnHorizon]);

  const hourTicks = useMemo(
    () => selectedPath.filter((p) => p.minute % 60 === 0 && p.el > 0 && p.minute < 1440),
    [selectedPath],
  );

  const selColor = seasonColor(seasonFraction(declination, lat));

  const toSky = (e: ReactPointerEvent<SVGSVGElement>): SkyPoint & { outside: boolean } => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * SIZE;
    const s = invertStereo(x, y, R, C, C);
    return { az: s.az, el: Math.max(0, s.el), outside: s.el < 0 };
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (mode === 'view') return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toSky(e);
    const bins = pointsToBins(horizon);
    paintBins(bins, p.az, p.el, p.az, p.el, mode === 'erase' || p.outside ? 'erase' : 'draw');
    stroke.current = { bins, last: p };
    setPreview(bins.slice());
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toSky(e);
    setHover(p.outside ? null : p);
    const s = stroke.current;
    if (!s) return;
    paintBins(
      s.bins,
      s.last.az,
      s.last.el,
      p.az,
      p.el,
      mode === 'erase' || p.outside ? 'erase' : 'draw',
    );
    s.last = p;
    setPreview(s.bins.slice());
  };

  const onUp = () => {
    const s = stroke.current;
    if (!s) return;
    stroke.current = null;
    setPreview(null);
    onHorizonChange(binsToPoints(s.bins));
  };

  const rings = [15, 30, 45, 60, 75];
  const spokes = Array.from({ length: 24 }, (_, i) => i * 15);
  const sunUp = sun.el > 0;
  const [sx, sy] = P(sun);
  const label = `Sun-path diagram for ${date.day} ${MONTH_SHORT[date.month - 1]} ${date.year}. ${
    sunUp
      ? `Sun at ${fmt(sun.el, 0)}° elevation, azimuth ${fmt(sun.az, 0)}°.`
      : 'The Sun is below the horizon.'
  } ${horizon.length ? `A skyline with ${horizon.length} points is drawn.` : 'No skyline drawn.'}`;

  return (
    <div className={`sunpath sunpath--${mode}`}>
      <div className="sunpath__tools" role="toolbar" aria-label="Skyline tools">
        <button
          type="button"
          className={`btn btn--sm ${mode === 'draw' ? 'is-on' : ''}`}
          aria-pressed={mode === 'draw'}
          onClick={() => setMode(mode === 'draw' ? 'view' : 'draw')}
        >
          <PencilIcon /> Draw skyline
        </button>
        <button
          type="button"
          className={`btn btn--sm ${mode === 'erase' ? 'is-on' : ''}`}
          aria-pressed={mode === 'erase'}
          onClick={() => setMode(mode === 'erase' ? 'view' : 'erase')}
          disabled={!horizon.length && mode !== 'erase'}
        >
          <EraserIcon /> Erase
        </button>
        <span className="sunpath__readout" aria-hidden="true">
          {hover
            ? `az ${fmt(hover.az, 0)}° · el ${fmt(hover.el, 0)}°`
            : mode === 'view'
              ? 'Hover to read azimuth and elevation'
              : ''}
        </span>
      </div>
      {mode !== 'view' && (
        <p className="sunpath__instructions" role="status">
          {mode === 'draw'
            ? 'Drag across the diagram along the top of buildings or trees. Drag outside the rim to lower it to the horizon.'
            : 'Drag across the skyline to clear it back to the horizon.'}
        </p>
      )}
      <svg
        ref={svgRef}
        className="sunpath__svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={label}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => {
          setHover(null);
        }}
      >
        <defs>
          <pattern
            id={`sk-${uid}`}
            patternUnits="userSpaceOnUse"
            width="7"
            height="7"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="7"
              stroke={PALETTE.ink}
              strokeWidth="1.1"
              strokeOpacity="0.55"
            />
          </pattern>
          <clipPath id={`clip-${uid}`}>
            <circle cx={C} cy={C} r={R} />
          </clipPath>
        </defs>
        <circle cx={C} cy={C} r={R} className="sp-sky" />
        <g className="sp-grid" clipPath={`url(#clip-${uid})`}>
          {rings.map((el) => (
            <circle key={el} cx={C} cy={C} r={R * Math.tan(((90 - el) / 2) * DEG)} />
          ))}
          {spokes.map((az) => {
            const [x, y] = projectStereo(az, 0, R, C, C);
            return (
              <line key={az} x1={C} y1={C} x2={x} y2={y} className={az % 90 === 0 ? 'major' : ''} />
            );
          })}
        </g>
        {rings.map((el) => {
          const [x, y] = projectStereo(0, el, R, C, C);
          return (
            <text key={el} x={x + 4} y={y - 3} className="sp-ringlabel">
              {el}°
            </text>
          );
        })}
        {spokes
          .filter((az) => az % 30 === 0)
          .map((az) => {
            const [x, y] = projectStereo(az, 0, R + 16, C, C);
            const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[az];
            return (
              <text
                key={az}
                x={x}
                y={y}
                className={cardinal ? 'sp-cardinal' : 'sp-azlabel'}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {cardinal ?? `${az}°`}
              </text>
            );
          })}

        <g className="sp-analemmas">
          {loops.map((a) =>
            aboveHorizon(a.points).map((run, i) => (
              <path key={`${a.hour}-${i}`} d={pathOf(run.map(P)) ?? ''} />
            )),
          )}
        </g>
        <g className="sp-monthlines">
          {monthLines.map((m) =>
            m.runs.map((run, i) => (
              <path
                key={`${m.month}-${i}`}
                d={pathOf(run.map(P)) ?? ''}
                stroke={m.color}
                className={
                  m.month === 6 || m.month === 12 ? 'solstice' : m.month === 3 ? 'equinox' : ''
                }
              />
            )),
          )}
        </g>
        {loops.map((a) => {
          // Label each analemma at its highest point.
          const top = a.points.reduce((x, y) => (y.el > x.el ? y : x));
          if (top.el < 4) return null;
          const [x, y] = P(top);
          return (
            <text key={a.hour} x={x} y={y - 7} className="sp-hourlabel" textAnchor="middle">
              {a.hour}
            </text>
          );
        })}
        {skylinePath && (
          <g className="sp-skyline">
            <path d={skylinePath} fillRule="evenodd" className="fill" />
            <path d={skylinePath} fillRule="evenodd" fill={`url(#sk-${uid})`} />
          </g>
        )}

        <g className="sp-selected">
          {selected.map((seg, i) => (
            <path
              key={i}
              d={pathOf(seg.pts.map(P)) ?? ''}
              stroke={selColor}
              className={seg.visible ? '' : 'blocked'}
            />
          ))}
          {hourTicks.map((p) => {
            const [x, y] = P(p);
            return <circle key={p.minute} cx={x} cy={y} r={2.6} fill={selColor} />;
          })}
        </g>

        <circle cx={C} cy={C} r={R} className="sp-rim" />
        {sunUp && (
          <g className="sp-sun" transform={`translate(${sx} ${sy})`}>
            <circle r="13" className="halo" />
            <circle r="7.5" className="disc" />
            <text x="12" y="-12" className="sp-sunlabel">
              {timeLabel}
            </text>
          </g>
        )}
        {hover && mode !== 'view' && (
          <circle cx={P(hover)[0]} cy={P(hover)[1]} r={4} className="sp-cursor" />
        )}
      </svg>
      <ul className="sunpath__legend" aria-label="Legend">
        <li>
          <span className="swatch swatch--line" style={{ background: selColor }} /> Selected day
        </li>
        <li>
          <span
            className="swatch swatch--line"
            style={{ background: monthLines.find((m) => m.month === 6)?.color }}
          />{' '}
          Jun 21
        </li>
        <li>
          <span
            className="swatch swatch--line"
            style={{ background: monthLines.find((m) => m.month === 3)?.color }}
          />{' '}
          Mar/Sep 21
        </li>
        <li>
          <span
            className="swatch swatch--line"
            style={{ background: monthLines.find((m) => m.month === 12)?.color }}
          />{' '}
          Dec 21
        </li>
        <li>
          <span className="swatch swatch--dash" /> Hour loops (standard time)
        </li>
        <li>
          <span className="swatch swatch--hatch" /> Skyline
        </li>
        {horizon.length > 0 && (
          <li>
            <span className="swatch swatch--blocked" /> Sun behind skyline
          </li>
        )}
      </ul>
    </div>
  );
}
