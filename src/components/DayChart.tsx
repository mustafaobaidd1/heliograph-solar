/** Irradiance over the selected day: on the panel (area) and on the ground (GHI, dashed). */
import { scaleLinear } from 'd3-scale';
import { area, line } from 'd3-shape';
import { useId, useMemo } from 'react';
import { fmt } from '../lib/format';
import type { DayPoint } from '../lib/solar/model';

const W = 420;
const H = 132;
const M = { l: 34, r: 8, t: 10, b: 22 };

export function DayChart({
  points,
  minute,
  color,
}: {
  points: DayPoint[];
  minute: number;
  color: string;
}) {
  const uid = useId().replace(/:/g, '');
  const span = points.length ? points[points.length - 1].minute : 1440;
  const yMax = Math.max(400, ...points.map((p) => Math.max(p.poa, p.ghi, p.poaUnshaded)));
  const top = Math.ceil(yMax / 200) * 200;
  const x = useMemo(
    () =>
      scaleLinear()
        .domain([0, span])
        .range([M.l, W - M.r]),
    [span],
  );
  const y = useMemo(
    () =>
      scaleLinear()
        .domain([0, top])
        .range([H - M.b, M.t]),
    [top],
  );

  const poaArea = useMemo(
    () =>
      area<DayPoint>()
        .x((p) => x(p.minute))
        .y0(y(0))
        .y1((p) => y(p.poa))(points) ?? '',
    [points, x, y],
  );
  const poaLine = useMemo(
    () =>
      line<DayPoint>()
        .x((p) => x(p.minute))
        .y((p) => y(p.poa))(points) ?? '',
    [points, x, y],
  );
  const ghiLine = useMemo(
    () =>
      line<DayPoint>()
        .x((p) => x(p.minute))
        .y((p) => y(p.ghi))(points) ?? '',
    [points, x, y],
  );
  const lostArea = useMemo(() => {
    if (!points.some((p) => p.poaUnshaded - p.poa > 1)) return '';
    return (
      area<DayPoint>()
        .x((p) => x(p.minute))
        .y0((p) => y(p.poa))
        .y1((p) => y(p.poaUnshaded))(points) ?? ''
    );
  }, [points, x, y]);

  const at = points.reduce<DayPoint | null>(
    (best, p) =>
      best === null || Math.abs(p.minute - minute) < Math.abs(best.minute - minute) ? p : best,
    null,
  );
  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24].filter((h) => h * 60 <= span);

  return (
    <svg
      className="daychart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Irradiance over the day on the panel and on level ground, peaking at ${fmt(Math.max(0, ...points.map((p) => p.poa)), 0)} watts per square metre on the panel.`}
    >
      <defs>
        <pattern
          id={`lost-${uid}`}
          patternUnits="userSpaceOnUse"
          width="5"
          height="5"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--vermilion)" strokeWidth="1" />
        </pattern>
      </defs>
      {y.ticks(4).map((t) => (
        <g key={t} className="axis">
          <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
          <text x={M.l - 5} y={y(t)} textAnchor="end" dominantBaseline="central">
            {t}
          </text>
        </g>
      ))}
      {hours.map((h) => (
        <text key={h} x={x(h * 60)} y={H - 6} className="axis-label" textAnchor="middle">
          {String(h).padStart(2, '0')}
        </text>
      ))}
      <path d={poaArea} className="daychart__area" style={{ fill: color }} />
      {lostArea && <path d={lostArea} fill={`url(#lost-${uid})`} className="daychart__lost" />}
      <path d={ghiLine} className="daychart__ghi" />
      <path d={poaLine} className="daychart__poa" />
      {at && (
        <g className="daychart__now">
          <line x1={x(minute)} x2={x(minute)} y1={M.t} y2={H - M.b} />
          <circle cx={x(at.minute)} cy={y(at.poa)} r="3.5" />
        </g>
      )}
      <text x={M.l + 4} y={M.t + 2} className="axis-unit" dominantBaseline="hanging">
        W/m²
      </text>
    </svg>
  );
}
