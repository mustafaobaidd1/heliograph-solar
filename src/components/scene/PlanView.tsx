/**
 * 2D fallback when WebGL is unavailable: a site plan (north up) with the same massing model,
 * the panel, skyline blocks and hatched ground shadows computed analytically.
 */
import { useId } from 'react';
import type { HorizonPoint } from '../../lib/solar/horizon';
import { DEG } from '../../lib/solar/math';
import { DISC_R, HOUSE, PANEL, boxShadow, skylineBoxes } from './siteModel';
import type { Box } from './siteModel';

function corners(b: Box): [number, number][] {
  const rot = b.rot ?? 0;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return (
    [
      [-b.w / 2, -b.d / 2],
      [b.w / 2, -b.d / 2],
      [b.w / 2, b.d / 2],
      [-b.w / 2, b.d / 2],
    ] as [number, number][]
  ).map(([u, v]) => [b.x + u * c + v * s, b.z - u * s + v * c]);
}

const pts = (p: [number, number][]) =>
  p.map(([x, z]) => `${x.toFixed(3)},${z.toFixed(3)}`).join(' ');

export function PlanView({
  sunAz,
  sunEl,
  panelTilt,
  panelAz,
  horizon,
}: {
  sunAz: number;
  sunEl: number;
  panelTilt: number;
  panelAz: number;
  horizon: HorizonPoint[];
}) {
  const uid = useId().replace(/:/g, '');
  const blocks = skylineBoxes(horizon);
  const casters = [...HOUSE, ...blocks];
  const shadows = sunEl > 0.5 ? casters.map((b) => boxShadow(b, sunAz, sunEl)).filter(Boolean) : [];
  // Panel footprint: a rectangle foreshortened along its facing direction.
  const pw = PANEL.w / 2;
  const pd = (PANEL.d / 2) * Math.cos(panelTilt * DEG);
  const a = (180 - panelAz) * DEG; // same heading convention as the 3D pivot
  const panelPoly: [number, number][] = (
    [
      [-pw, -pd],
      [pw, -pd],
      [pw, pd],
      [-pw, pd],
    ] as [number, number][]
  ).map(([u, v]) => [
    PANEL.x + u * Math.cos(a) + v * Math.sin(a),
    PANEL.z - u * Math.sin(a) + v * Math.cos(a),
  ]);
  const sx = Math.sin(sunAz * DEG);
  const sz = -Math.cos(sunAz * DEG);
  const up = sunEl > 0;

  return (
    <svg
      className="plan"
      viewBox="-13.5 -13.5 27 27"
      role="img"
      aria-label={`Site plan, north up. ${up ? `Sun at azimuth ${sunAz.toFixed(0)}°, elevation ${sunEl.toFixed(0)}°.` : 'The Sun is below the horizon.'}`}
    >
      <defs>
        <pattern
          id={`hatch-${uid}`}
          patternUnits="userSpaceOnUse"
          width="0.42"
          height="0.42"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="0.42" stroke="var(--ink)" strokeWidth="0.07" />
        </pattern>
        <clipPath id={`plate-${uid}`}>
          <circle r={DISC_R} />
        </clipPath>
      </defs>
      <circle r={DISC_R} className="plan__plate" />
      {[4, 8, 11.2].map((r) => (
        <circle key={r} r={r} className="plan__ring" />
      ))}
      {['N', 'E', 'S', 'W'].map((l, i) => {
        const t = i * 90 * DEG;
        return (
          <text
            key={l}
            x={10 * Math.sin(t)}
            y={-10 * Math.cos(t)}
            className="plan__label"
            dominantBaseline="central"
            textAnchor="middle"
          >
            {l}
          </text>
        );
      })}
      <g clipPath={`url(#plate-${uid})`}>
        {shadows.map((s, i) => (
          <g key={i}>
            <polygon points={pts(s!)} className="plan__shadow" />
            <polygon points={pts(s!)} fill={`url(#hatch-${uid})`} />
          </g>
        ))}
      </g>
      {casters.map((b, i) => (
        <polygon key={i} points={pts(corners(b))} className={`plan__box plan__box--${b.kind}`} />
      ))}
      <polygon points={pts(panelPoly)} className="plan__panel" />
      {up && (
        <g className="plan__sun">
          <line x1={sx * 12.6} y1={sz * 12.6} x2={sx * 7.5} y2={sz * 7.5} />
          <circle cx={sx * 12.6} cy={sz * 12.6} r="0.7" />
        </g>
      )}
    </svg>
  );
}
