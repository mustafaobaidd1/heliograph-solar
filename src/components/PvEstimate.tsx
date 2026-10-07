import { scaleBand, scaleLinear } from 'd3-scale';
import { fmt } from '../lib/format';
import { LIMITS } from '../lib/state';
import type { PvState } from '../lib/state';
import type { PvResult } from '../lib/solar/annual';
import { MONTH_SHORT } from '../lib/solar/time';
import { Card, NumberField } from './ui';

const W = 420;
const H = 170;
const M = { l: 38, r: 6, t: 14, b: 22 };

function MonthlyBars({ monthly }: { monthly: number[] }) {
  const max = Math.max(1, ...monthly);
  const top = max > 50 ? Math.ceil(max / 50) * 50 : Math.ceil(max / 10) * 10;
  const x = scaleBand<number>()
    .domain(monthly.map((_, i) => i))
    .range([M.l, W - M.r])
    .padding(0.22);
  const y = scaleLinear()
    .domain([0, top])
    .range([H - M.b, M.t]);
  const best = monthly.indexOf(max);
  return (
    <svg
      className="monthly"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Monthly AC energy, highest in ${MONTH_SHORT[best]} at ${fmt(max, 0)} kWh.`}
    >
      {y.ticks(4).map((t) => (
        <g key={t} className="axis">
          <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
          <text x={M.l - 5} y={y(t)} textAnchor="end" dominantBaseline="central">
            {fmt(t, 0)}
          </text>
        </g>
      ))}
      {monthly.map((v, i) => (
        <g key={i}>
          <rect
            x={x(i)}
            y={y(v)}
            width={x.bandwidth()}
            height={Math.max(0, y(0) - y(v))}
            className={`monthly__bar ${i === best ? 'is-best' : ''}`}
          >
            <title>{`${MONTH_SHORT[i]}: ${fmt(v, 0)} kWh`}</title>
          </rect>
          <text
            x={(x(i) ?? 0) + x.bandwidth() / 2}
            y={H - 6}
            textAnchor="middle"
            className="axis-label"
          >
            {MONTH_SHORT[i][0]}
          </text>
        </g>
      ))}
      <text x={M.l + 4} y={M.t - 4} className="axis-unit">
        kWh
      </text>
    </svg>
  );
}

export function PvEstimate({
  pv,
  params,
  onParams,
  climateTemps,
  isClearSky,
}: {
  pv: PvResult | null;
  params: PvState;
  onParams: (p: PvState) => void;
  climateTemps: boolean;
  isClearSky: boolean;
}) {
  const set = (k: keyof PvState) => (v: number) => onParams({ ...params, [k]: v });
  return (
    <Card fig="Fig. 5" title="PV yield estimate" id="pv" className="card--pv">
      <p className="card__lede">
        {isClearSky ? (
          <>
            An <strong>estimate under clear skies</strong>: an upper bound for this panel, not a
            yield guarantee. Switch the sky to “Long-term average” for typical-year numbers.
          </>
        ) : (
          <>
            An estimate for an average year from long-term climate normals. Real years vary by
            several per cent.
          </>
        )}
      </p>
      <div className="pv__grid">
        <div className="pv__inputs">
          <NumberField
            label="Array size"
            unit="kWp"
            value={params.kwp}
            min={LIMITS.kwp[0]}
            max={LIMITS.kwp[1]}
            digits={2}
            onCommit={set('kwp')}
          />
          <NumberField
            label="Temperature coefficient"
            unit="%/°C"
            value={params.gammaPct}
            min={LIMITS.gammaPct[0]}
            max={LIMITS.gammaPct[1]}
            digits={3}
            onCommit={set('gammaPct')}
          />
          <NumberField
            label="NOCT"
            unit="°C"
            value={params.noct}
            min={LIMITS.noct[0]}
            max={LIMITS.noct[1]}
            digits={1}
            onCommit={set('noct')}
          />
          <NumberField
            label="System losses"
            unit="%"
            value={params.lossesPct}
            min={LIMITS.lossesPct[0]}
            max={LIMITS.lossesPct[1]}
            digits={1}
            onCommit={set('lossesPct')}
            hint="Wiring, soiling, mismatch, inverter…"
          />
          <NumberField
            label="Air temperature"
            unit="°C"
            value={params.ambient}
            min={LIMITS.ambient[0]}
            max={LIMITS.ambient[1]}
            digits={1}
            onCommit={set('ambient')}
            disabled={climateTemps}
            hint={
              climateTemps
                ? 'Using NASA POWER monthly means with a daily cycle'
                : 'Constant daytime air temperature'
            }
          />
        </div>
        <div className="pv__results">
          {pv ? (
            <>
              <div className="pv__headline">
                <span className="big__value" data-testid="pv-annual">
                  {fmt(pv.annualKwh, 0)}
                  <span className="big__unit">kWh/yr</span>
                </span>
                <span className="big__sub">
                  {fmt(pv.specificYield, 0)} kWh per kWp · performance ratio{' '}
                  {fmt(pv.performanceRatio * 100, 0)} %
                </span>
              </div>
              <MonthlyBars monthly={pv.monthlyKwh} />
              <dl className="facts facts--compact">
                <div>
                  <dt>On the panel</dt>
                  <dd>{fmt(pv.annualPoa, 0)} kWh/m²</dd>
                </div>
                <div>
                  <dt>Mean cell temp.</dt>
                  <dd>{fmt(pv.meanCellTemp, 1)} °C</dd>
                </div>
                <div>
                  <dt>Shading loss</dt>
                  <dd data-testid="shading-loss">{fmt(pv.shadingLossPct, 1)} %</dd>
                </div>
              </dl>
              <details className="pv__table">
                <summary>Monthly values as a table</summary>
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Monthly values"
                >
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Month</th>
                        <th scope="col">AC energy (kWh)</th>
                        <th scope="col">On panel (kWh/m²)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pv.monthlyKwh.map((v, i) => (
                        <tr key={i}>
                          <th scope="row">{MONTH_SHORT[i]}</th>
                          <td>{fmt(v, 1)}</td>
                          <td>{fmt(pv.monthlyPoa[i], 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <div className="pv__loading" role="status">
              <div className="bar-skeleton" />
              <div className="bar-skeleton" />
              <span>Estimating the year…</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
