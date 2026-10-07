/**
 * The tilt × azimuth landscape of period energy, with isolines at fractions of the optimum.
 * Click or drag to set the panel; arrow keys do the same when focused.
 */
import { contours } from 'd3-contour';
import { scaleLinear } from 'd3-scale';
import { useEffect, useId, useMemo, useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { SiteResult } from '../lib/analysis';
import { rampRgb } from '../lib/color';
import { compassPoint, fmt } from '../lib/format';
import type { PeriodSpec } from '../lib/solar/annual';
import { GRID_AZ_STEP, GRID_TILT_STEP } from '../lib/solar/annual';
import { clamp, wrap360 } from '../lib/solar/math';
import { formatIsoDate, parseIsoDate } from '../lib/solar/time';
import type { AnalysisStatus } from '../lib/useAnalysis';
import { RefreshIcon } from './icons';
import { Card, ProgressBar, Segmented } from './ui';

const W = 640;
const H = 300;
const M = { l: 46, r: 12, t: 12, b: 40 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;
const LEVELS = [0.5, 0.7, 0.8, 0.9, 0.95, 0.98];

export function periodLabel(p: PeriodSpec, lat: number): string {
  const north = lat >= 0;
  switch (p.kind) {
    case 'year':
      return 'whole year';
    case 'summer':
      return north ? 'June–August' : 'December–February';
    case 'winter':
      return north ? 'December–February' : 'June–August';
    case 'custom': {
      const f = (md: number) =>
        new Date(Date.UTC(2001, Math.floor(md / 100) - 1, md % 100)).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        });
      return `${f(p.from ?? 101)} – ${f(p.to ?? 1231)}`;
    }
  }
}

export function Optimizer({
  result,
  status,
  progress,
  stage,
  error,
  onRetry,
  panel,
  onPanel,
  period,
  onPeriod,
  lat,
  year,
  sourceLabel,
}: {
  result: SiteResult | null;
  status: AnalysisStatus;
  progress: number;
  stage: string;
  error: string | null;
  onRetry: () => void;
  panel: { tilt: number; azimuth: number };
  onPanel: (p: { tilt: number; azimuth: number }) => void;
  period: PeriodSpec;
  onPeriod: (p: PeriodSpec) => void;
  lat: number;
  year: number;
  sourceLabel: string;
}) {
  const uid = useId().replace(/:/g, '');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const heat = result?.heat ?? null;

  const x = useMemo(
    () =>
      scaleLinear()
        .domain([0, 360])
        .range([M.l, M.l + PW]),
    [],
  );
  const y = useMemo(
    () =>
      scaleLinear()
        .domain([0, 90])
        .range([M.t + PH, M.t]),
    [],
  );

  // Grid with the azimuth seam duplicated (360° = 0°) so the image and contours wrap.
  const grid = useMemo(() => {
    if (!heat) return null;
    const na = heat.azimuths.length;
    const nt = heat.tilts.length;
    const n = na + 1;
    const vals = new Float64Array(n * nt);
    for (let j = 0; j < nt; j++) {
      for (let i = 0; i < n; i++) vals[j * n + i] = heat.values[j * na + (i % na)];
    }
    return { n, m: nt, vals, max: heat.max };
  }, [heat]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !grid) return;
    c.width = grid.n;
    c.height = grid.m;
    const g = c.getContext('2d');
    if (!g) return;
    const img = g.createImageData(grid.n, grid.m);
    const lo = 0.4;
    for (let j = 0; j < grid.m; j++) {
      for (let i = 0; i < grid.n; i++) {
        const f = grid.vals[j * grid.n + i] / grid.max;
        const [r, gg, b] = rampRgb((f - lo) / (1 - lo));
        const row = grid.m - 1 - j; // tilt 0 at the bottom
        const k = (row * grid.n + i) * 4;
        img.data[k] = r;
        img.data[k + 1] = gg;
        img.data[k + 2] = b;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }, [grid]);

  const isolines = useMemo(() => {
    if (!grid) return [];
    const gen = contours()
      .size([grid.n, grid.m])
      .thresholds(LEVELS.map((l) => l * grid.max));
    const polys = gen(Array.from(grid.vals));
    return polys.map((p, k) => {
      let label: [number, number] | null = null;
      let best = -Infinity;
      const d = p.coordinates
        .map((poly) =>
          poly
            .map(
              (ring) =>
                ring
                  .map(([cx, cy], idx) => {
                    const az = (cx - 0.5) * GRID_AZ_STEP;
                    const tilt = (cy - 0.5) * GRID_TILT_STEP;
                    const inside = az > 4 && az < 356 && tilt > 3 && tilt < 86;
                    if (inside && tilt > best) {
                      best = tilt;
                      label = [x(az), y(tilt)];
                    }
                    return `${idx === 0 ? 'M' : 'L'}${x(az).toFixed(1)},${y(tilt).toFixed(1)}`;
                  })
                  .join('') + 'Z',
            )
            .join(''),
        )
        .join('');
      return { level: LEVELS[k], d, label: label as [number, number] | null };
    });
  }, [grid, x, y]);

  const fromPointer = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = overlayRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * H;
    const az = wrap360(clamp(x.invert(px), 0, 359.9));
    const tilt = clamp(y.invert(py), 0, 90);
    return { tilt: Math.round(tilt * 2) / 2, azimuth: Math.round(az * 2) / 2 };
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    let { tilt, azimuth } = panel;
    if (e.key === 'ArrowLeft') azimuth = wrap360(azimuth - step);
    else if (e.key === 'ArrowRight') azimuth = wrap360(azimuth + step);
    else if (e.key === 'ArrowUp') tilt = clamp(tilt + step, 0, 90);
    else if (e.key === 'ArrowDown') tilt = clamp(tilt - step, 0, 90);
    else return;
    e.preventDefault();
    onPanel({ tilt, azimuth });
  };

  const opt = result?.optimum ?? null;
  const optU = result?.optimumUnshaded ?? null;
  const running = status === 'running';

  const fixed = result?.strategies.find((s) => s.id === 'fixed');
  const panelX = x(panel.azimuth);
  const panelY = y(panel.tilt);

  return (
    <Card fig="Fig. 3" title="Orientation landscape" id="optimizer" className="card--optimizer">
      <div className="opt__controls">
        <Segmented<PeriodSpec['kind']>
          legend="Period"
          name="period"
          value={period.kind}
          size="sm"
          onChange={(k) =>
            onPeriod(
              k === 'custom'
                ? { kind: 'custom', from: period.from ?? 401, to: period.to ?? 930 }
                : { kind: k },
            )
          }
          options={[
            { value: 'year', label: 'Year' },
            { value: 'summer', label: 'Summer', title: periodLabel({ kind: 'summer' }, lat) },
            { value: 'winter', label: 'Winter', title: periodLabel({ kind: 'winter' }, lat) },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        {period.kind === 'custom' && (
          <div className="opt__range">
            {(['from', 'to'] as const).map((k) => {
              const md = period[k] ?? (k === 'from' ? 401 : 930);
              return (
                <label key={k} className="field field--sm">
                  <span className="field__label">{k === 'from' ? 'From' : 'To'}</span>
                  <input
                    type="date"
                    className="input input--date"
                    min={`${year}-01-01`}
                    max={`${year}-12-31`}
                    value={formatIsoDate({ year, month: Math.floor(md / 100), day: md % 100 })}
                    onChange={(e) => {
                      const d = parseIsoDate(e.target.value);
                      if (d) onPeriod({ ...period, [k]: d.month * 100 + d.day });
                    }}
                  />
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div
        className={`heat ${running ? 'is-running' : ''} ${!heat ? 'is-empty' : ''}`}
        tabIndex={heat ? 0 : -1}
        role="group"
        aria-label="Energy landscape: tilt (vertical) against the direction the panel faces (horizontal). Click, drag, or use the arrow keys to move the panel."
        onKeyDown={onKey}
      >
        <div
          className="heat__plot"
          style={{
            left: `${(M.l / W) * 100}%`,
            top: `${(M.t / H) * 100}%`,
            width: `${(PW / W) * 100}%`,
            height: `${(PH / H) * 100}%`,
          }}
        >
          <canvas
            ref={canvasRef}
            className="heat__canvas"
            aria-hidden="true"
            style={{
              left: `${(-GRID_AZ_STEP / 2 / 360) * 100}%`,
              width: `${((360 + GRID_AZ_STEP) / 360) * 100}%`,
              top: `${(-GRID_TILT_STEP / 2 / 90) * 100}%`,
              height: `${((90 + GRID_TILT_STEP) / 90) * 100}%`,
            }}
          />
        </div>
        <svg
          ref={overlayRef}
          className="heat__overlay"
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden="true"
          onPointerDown={(e) => {
            if (!heat) return;
            dragging.current = true;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            const p = fromPointer(e);
            if (p) onPanel(p);
          }}
          onPointerMove={(e) => {
            if (!dragging.current) return;
            const p = fromPointer(e);
            if (p) onPanel(p);
          }}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          <defs>
            <clipPath id={`hp-${uid}`}>
              <rect x={M.l} y={M.t} width={PW} height={PH} />
            </clipPath>
          </defs>
          <g clipPath={`url(#hp-${uid})`}>
            {isolines.map((c) => (
              <path key={c.level} d={c.d} className={`iso iso--${Math.round(c.level * 100)}`} />
            ))}
          </g>
          {isolines.map((c) =>
            c.label ? (
              <text
                key={c.level}
                x={c.label[0]}
                y={c.label[1] - 3}
                className="iso-label"
                textAnchor="middle"
              >
                {Math.round(c.level * 100)}%
              </text>
            ) : null,
          )}
          <rect x={M.l} y={M.t} width={PW} height={PH} className="heat__frame" />
          {[0, 45, 90, 135, 180, 225, 270, 315, 360].map((az) => (
            <g key={az}>
              <line x1={x(az)} x2={x(az)} y1={M.t + PH} y2={M.t + PH + 5} className="tick" />
              <text x={x(az)} y={M.t + PH + 17} textAnchor="middle" className="axis-label">
                {az % 90 === 0 ? ['N', 'E', 'S', 'W', 'N'][az / 90] : `${az}°`}
              </text>
            </g>
          ))}
          {[0, 15, 30, 45, 60, 75, 90].map((t) => (
            <g key={t}>
              <line x1={M.l - 5} x2={M.l} y1={y(t)} y2={y(t)} className="tick" />
              <text
                x={M.l - 8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="central"
                className="axis-label"
              >
                {t}°
              </text>
            </g>
          ))}
          <text x={M.l + PW / 2} y={H - 4} textAnchor="middle" className="axis-title">
            Direction the panel faces (azimuth)
          </text>
          <text
            transform={`translate(12 ${M.t + PH / 2}) rotate(-90)`}
            textAnchor="middle"
            className="axis-title"
          >
            Tilt
          </text>
          {optU && (
            <g
              transform={`translate(${x(optU.azimuth)} ${y(optU.tilt)})`}
              className="mark mark--open"
            >
              <circle r="7" />
            </g>
          )}
          {opt && (
            <g
              transform={`translate(${x(opt.azimuth)} ${y(opt.tilt)})`}
              className="mark mark--opt"
              data-testid="optimum-marker"
            >
              <circle r="6" />
              <path d="M-12 0h6M6 0h6M0 -12v6M0 6v6" />
            </g>
          )}
          {heat && (
            <g transform={`translate(${panelX} ${panelY})`} className="mark mark--panel">
              <rect x="-6" y="-6" width="12" height="12" transform="rotate(45)" />
            </g>
          )}
        </svg>
        {!heat && status !== 'error' && (
          <div className="heat__empty" role="status">
            <ProgressBar value={progress} label="Optimiser progress" />
            <span>{stage || 'Preparing'}…</span>
          </div>
        )}
        {heat && running && (
          <div className="heat__busy" role="status">
            <ProgressBar value={progress} label="Optimiser progress" />
            <span>{stage}…</span>
          </div>
        )}
        {status === 'error' && (
          <div className="heat__error" role="alert">
            <p>The optimiser stopped: {error}</p>
            <button type="button" className="btn btn--sm" onClick={onRetry}>
              <RefreshIcon /> Run again
            </button>
          </div>
        )}
      </div>

      <div className="heat__legend" aria-hidden="true">
        <span>{heat ? `${fmt(heat.max * 0.4, 0)}` : ''}</span>
        <span className="heat__ramp" />
        <span>{heat ? `${fmt(heat.max, 0)} kWh/m²` : ''}</span>
        <span className="heat__keys">
          <span className="key key--opt" /> optimum <span className="key key--panel" /> your panel
          {optU && (
            <>
              <span className="key key--open" /> without skyline
            </>
          )}
        </span>
      </div>

      <div className="opt__summary" aria-live="polite">
        {opt && fixed ? (
          <p>
            Best fixed panel for the {periodLabel(period, lat)}:{' '}
            <strong>tilt {fmt(opt.tilt, 1)}°</strong>, facing{' '}
            <strong>
              {fmt(opt.azimuth, 1)}° {compassPoint(opt.azimuth)}
            </strong>{' '}
            — <span data-testid="optimum-energy">{fmt(opt.energy, 0)}</span> kWh/m² ({sourceLabel}).
            {optU && (
              <>
                {' '}
                With an open horizon it would be {fmt(optU.tilt, 1)}° / {fmt(optU.azimuth, 0)}° and{' '}
                {fmt(optU.energy, 0)} kWh/m².
              </>
            )}
          </p>
        ) : status === 'error' ? null : (
          <p>Integrating {sourceLabel} irradiance over 15-minute steps for every orientation…</p>
        )}
        {result && (
          <p className="opt__meta">
            Grid {heat?.tilts.length}×{heat?.azimuths.length} orientations, refined by
            golden-section search · {fmt(result.steps, 0)} daylight steps ·{' '}
            {fmt(result.millis / 1000, 2)} s
          </p>
        )}
      </div>
    </Card>
  );
}
