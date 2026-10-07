import { scaleLinear } from 'd3-scale';
import { compassPoint, fmt, signed } from '../lib/format';
import type { StrategyResult } from '../lib/solar/annual';
import { Card } from './ui';

const NAMES: Record<StrategyResult['id'], string> = {
  rule: 'Rule of thumb',
  fixed: 'Optimum fixed',
  retilt2: 'Re-tilt twice a year',
  retilt4: 'Re-tilt four times a year',
  single: 'Single-axis tracker',
  dual: 'Two-axis tracker',
};

function detail(s: StrategyResult, lat: number): string {
  const t = (x: number) => (Number.isFinite(x) ? `${fmt(x, 0)}°` : '–');
  // Seasonal tilts, with the facing direction when a season tips the panel the other way.
  const season = (i: number) => {
    const az = s.azimuths?.[i];
    const flipped =
      az !== undefined && s.azimuth !== null && Math.abs(((az - s.azimuth + 540) % 360) - 180) > 90;
    return `${t(s.tilts[i])}${flipped ? ` ${compassPoint(az)}` : ''}`;
  };
  switch (s.id) {
    case 'rule':
      return `tilt = |latitude| = ${t(s.tilts[0])}, facing ${lat >= 0 ? 'south' : 'north'}`;
    case 'fixed':
      return `${t(s.tilts[0])}, ${fmt(s.azimuth ?? 0, 0)}° ${compassPoint(s.azimuth ?? 0)}`;
    case 'retilt2':
      return `${season(0)} from 20 Mar, ${season(1)} from 22 Sep`;
    case 'retilt4':
      return `${s.tilts.map((_, i) => season(i)).join(' · ')} (from 4 Feb, 6 May, 7 Aug, 6 Nov)`;
    case 'single':
      return 'horizontal N–S axis, ±60°, no backtracking';
    case 'dual':
      return 'always facing the Sun';
  }
}

export function Comparison({
  strategies,
  unshaded,
  yourPanel,
  lat,
  periodText,
  sourceLabel,
}: {
  strategies: StrategyResult[] | null;
  unshaded: StrategyResult[] | null;
  yourPanel: number | null;
  lat: number;
  periodText: string;
  sourceLabel: string;
}) {
  const fixed = strategies?.find((s) => s.id === 'fixed')?.energy ?? 0;
  const maxV = Math.max(
    1,
    ...(strategies ?? []).map((s) => s.energy),
    ...(unshaded ?? []).map((s) => s.energy),
    yourPanel ?? 0,
  );
  const x = scaleLinear()
    .domain([0, maxV * 1.04])
    .range([0, 100]);
  const rows: {
    key: string;
    name: string;
    detail: string;
    energy: number;
    gain: number;
    ghost?: number;
    you?: boolean;
  }[] = [];
  if (strategies) {
    if (yourPanel !== null)
      rows.push({
        key: 'you',
        name: 'Your panel',
        detail: 'current tilt and direction',
        energy: yourPanel,
        gain: fixed > 0 ? (yourPanel / fixed - 1) * 100 : 0,
        you: true,
      });
    for (const s of strategies) {
      rows.push({
        key: s.id,
        name: NAMES[s.id],
        detail: detail(s, lat),
        energy: s.energy,
        gain: s.gainPct,
        ghost: unshaded?.find((u) => u.id === s.id)?.energy,
      });
    }
  }
  return (
    <Card fig="Fig. 4" title="Fixed, re-tilted or tracking?" id="compare" className="card--compare">
      <p className="card__lede">
        Plane-of-array energy over the {periodText} ({sourceLabel}), relative to the best fixed
        panel.
      </p>
      {!strategies ? (
        <div className="bars bars--loading" aria-hidden="true">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="bar-skeleton" />
          ))}
        </div>
      ) : (
        <ol className="bars" aria-label="Strategy comparison">
          {rows.map((r) => (
            <li
              key={r.key}
              className={`bar ${r.key === 'fixed' ? 'bar--base' : ''} ${r.you ? 'bar--you' : ''}`}
            >
              <div className="bar__label">
                <span className="bar__name">{r.name}</span>
                <span className="bar__detail">{r.detail}</span>
              </div>
              <div className="bar__track">
                {r.ghost !== undefined && r.ghost > r.energy + 0.5 && (
                  <span className="bar__ghost" style={{ width: `${x(r.ghost)}%` }} />
                )}
                <span className="bar__fill" style={{ width: `${x(r.energy)}%` }} />
              </div>
              <div className="bar__value">
                <span className="bar__kwh">{fmt(r.energy, 0)}</span>
                <span
                  className={`bar__gain ${r.gain > 0.05 ? 'up' : r.gain < -0.05 ? 'down' : ''}`}
                >
                  {r.key === 'fixed' ? 'baseline' : `${signed(r.gain, 1)} %`}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="card__foot">
        kWh/m² on the panel surface.
        {unshaded ? ' Outlined bars: the same strategy with an open horizon.' : ''} Trackers here
        ignore row-to-row shading and the extra land they need.
      </p>
    </Card>
  );
}
