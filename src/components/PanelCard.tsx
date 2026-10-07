import { compassPoint, compassWords, fmt } from '../lib/format';
import { DEG } from '../lib/solar/math';
import { TargetIcon } from './icons';
import { Card, Slider } from './ui';

function OrientationGlyph({ tilt, azimuth }: { tilt: number; azimuth: number }) {
  const t = tilt * DEG;
  const a = azimuth * DEG;
  return (
    <svg className="orient" viewBox="0 0 168 72" aria-hidden="true">
      {/* side view: ground, panel, tilt arc */}
      <g transform="translate(14 58)">
        <line x1="-6" y1="0" x2="78" y2="0" className="orient__ground" />
        <path
          d={`M28 0 A28 28 0 0 0 ${28 * Math.cos(t)} ${-28 * Math.sin(t)}`}
          className="orient__arc"
        />
        <line
          x1="0"
          y1="0"
          x2={62 * Math.cos(t)}
          y2={-62 * Math.sin(t)}
          className="orient__panel"
        />
        <text x="34" y="-6" className="orient__text">
          {fmt(tilt, 0)}°
        </text>
      </g>
      {/* plan view: compass and heading */}
      <g transform="translate(130 36)">
        <circle r="27" className="orient__dial" />
        {[0, 90, 180, 270].map((d) => (
          <line
            key={d}
            x1={0}
            y1={-27}
            x2={0}
            y2={-22}
            transform={`rotate(${d})`}
            className="orient__tick"
          />
        ))}
        <text y="-31" className="orient__n" textAnchor="middle">
          N
        </text>
        <line
          x1="0"
          y1="0"
          x2={22 * Math.sin(a)}
          y2={-22 * Math.cos(a)}
          className="orient__heading"
        />
        <circle r="2.6" className="orient__hub" />
      </g>
    </svg>
  );
}

export function PanelCard({
  tilt,
  azimuth,
  onChange,
  lat,
  optimum,
  pctOfOptimum,
  periodLabel,
}: {
  tilt: number;
  azimuth: number;
  onChange: (o: { tilt: number; azimuth: number }) => void;
  lat: number;
  optimum: { tilt: number; azimuth: number } | null;
  pctOfOptimum: number | null;
  periodLabel: string;
}) {
  const equator = lat >= 0 ? 180 : 0;
  const facingEquator = Math.abs(azimuth - equator) < 0.01;
  return (
    <Card fig="Panel" title="Panel orientation" id="panel" className="card--panel">
      <div className="panel__layout">
        <div className="panel__sliders">
          <Slider
            label="Tilt"
            value={tilt}
            min={0}
            max={90}
            step={0.5}
            onChange={(v) => onChange({ tilt: v, azimuth })}
            display={`${fmt(tilt, 1)}°`}
            valueText={`${fmt(tilt, 1)} degrees from horizontal`}
            marks={[
              { value: 0, label: 'flat' },
              { value: 45, label: '45°' },
              { value: 90, label: 'wall' },
            ]}
          />
          <Slider
            label="Facing"
            value={azimuth}
            min={0}
            max={359.5}
            step={0.5}
            onChange={(v) => onChange({ tilt, azimuth: v })}
            display={`${fmt(azimuth, 1)}° ${compassPoint(azimuth)}`}
            valueText={`${fmt(azimuth, 1)} degrees, facing ${compassWords(azimuth)}`}
            marks={[
              { value: 0, label: 'N' },
              { value: 90, label: 'E' },
              { value: 180, label: 'S' },
              { value: 270, label: 'W' },
            ]}
          />
        </div>
        <OrientationGlyph tilt={tilt} azimuth={azimuth} />
      </div>
      <div className="panel__actions">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => onChange({ tilt, azimuth: equator })}
          disabled={facingEquator}
        >
          Face the equator
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={!optimum}
          onClick={() =>
            optimum &&
            onChange({
              tilt: Math.round(optimum.tilt * 10) / 10,
              azimuth: Math.round(optimum.azimuth * 10) / 10,
            })
          }
        >
          <TargetIcon /> Use optimum
        </button>
        <span className="panel__pct" aria-live="polite">
          {pctOfOptimum !== null ? (
            <>
              <strong>{fmt(pctOfOptimum, 1)}%</strong> of the optimum · {periodLabel}
            </>
          ) : (
            'Optimum not computed yet'
          )}
        </span>
      </div>
    </Card>
  );
}
