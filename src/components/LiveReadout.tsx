import type { ReactNode } from 'react';
import { deg, fmt, signed } from '../lib/format';
import type { SkySource } from '../lib/state';
import type { DayPoint } from '../lib/solar/model';
import { formatDuration } from '../lib/solar/time';
import { RefreshIcon } from './icons';
import { DayChart } from './DayChart';
import { Card, Segmented, TabularNumber } from './ui';

export type ClimateStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; origin: 'bundled' | 'cache' | 'network' }
  | { kind: 'error'; message: string };

export interface SunFacts {
  elevation: number;
  azimuth: number;
  declination: number;
  eqTime: number;
  rise: string | null;
  set: string | null;
  noon: string;
  dayLength: number;
  polar: 'day' | 'night' | null;
  polarNote: string | null;
  setNote: string | null;
}

export function LiveReadout({
  poaNow,
  beam,
  diffuse,
  ground,
  aoi,
  sunVisible,
  dayTotal,
  dayGhi,
  dayLoss,
  blockedMinutes,
  dayPoints,
  minute,
  pathColor,
  facts,
  source,
  onSource,
  climate,
  onRetryClimate,
  dateLabel,
}: {
  poaNow: number;
  beam: number;
  diffuse: number;
  ground: number;
  aoi: number;
  sunVisible: boolean;
  dayTotal: number;
  dayGhi: number;
  dayLoss: number;
  blockedMinutes: number;
  dayPoints: DayPoint[];
  minute: number;
  pathColor: string;
  facts: SunFacts;
  source: SkySource;
  onSource: (s: SkySource) => void;
  climate: ClimateStatus;
  onRetryClimate: () => void;
  dateLabel: string;
}) {
  const up = facts.elevation > 0;
  let status: ReactNode;
  if (source === 'clear') {
    status = (
      <>
        <strong>Clear-sky upper bound.</strong> A cloudless, average-haze sky; real days deliver
        less.
      </>
    );
  } else if (climate.kind === 'loading') {
    status = 'Loading long-term averages from NASA POWER…';
  } else if (climate.kind === 'ready') {
    status = (
      <>
        <strong>Average day</strong> from NASA POWER monthly normals (2001–2020,{' '}
        {climate.origin === 'bundled'
          ? 'bundled with the app'
          : climate.origin === 'cache'
            ? 'cached on this device'
            : 'fetched live'}
        ). An expectation, not a forecast.
      </>
    );
  } else if (climate.kind === 'error') {
    status = (
      <>
        <strong>Long-term averages unavailable:</strong> {climate.message} Showing clear-sky values.{' '}
        <button type="button" className="btn btn--link" onClick={onRetryClimate}>
          <RefreshIcon /> Try again
        </button>
      </>
    );
  }
  const usingClimate = source === 'climate' && climate.kind === 'ready';

  return (
    <Card fig="Now" title={<>On the panel · {dateLabel}</>} id="readout" className="card--readout">
      <Segmented<SkySource>
        legend="Sky"
        name="sky-source"
        value={source}
        onChange={onSource}
        size="sm"
        options={[
          { value: 'clear', label: 'Clear sky (upper bound)' },
          { value: 'climate', label: 'Long-term average' },
        ]}
      />
      <p
        className={`status ${source === 'climate' && climate.kind === 'error' ? 'status--warn' : ''}`}
      >
        {status}
      </p>

      <div className="bigs">
        <div className="big">
          <span className="big__label">{usingClimate ? 'Average now' : 'Right now'}</span>
          <span className="big__value" data-testid="poa-now">
            <TabularNumber text={fmt(poaNow, 0)} />
            <span className="big__unit">W/m²</span>
          </span>
          <span className="big__sub">
            {up ? (
              sunVisible ? (
                <>
                  beam {fmt(beam, 0)} · sky {fmt(diffuse, 0)} · ground {fmt(ground, 0)}
                </>
              ) : (
                <span className="tag tag--warn">
                  Sun behind the skyline · diffuse {fmt(diffuse + ground, 0)}
                </span>
              )
            ) : (
              'Sun below the horizon'
            )}
          </span>
        </div>
        <div className="big">
          <span className="big__label">{usingClimate ? 'Average day' : 'Today, clear sky'}</span>
          <span className="big__value" data-testid="day-total">
            <TabularNumber text={fmt(dayTotal, 2)} />
            <span className="big__unit">kWh/m²</span>
          </span>
          <span className="big__sub">
            level ground {fmt(dayGhi, 2)}
            {dayLoss > 0.005 && (
              <>
                {' '}
                · <span className="tag tag--warn">skyline −{fmt(dayLoss, 2)}</span>
              </>
            )}
          </span>
        </div>
      </div>

      <DayChart points={dayPoints} minute={minute} color={pathColor} />

      <dl className="facts">
        <div>
          <dt>Elevation</dt>
          <dd>{deg(facts.elevation, 1)}</dd>
        </div>
        <div>
          <dt>Azimuth</dt>
          <dd>{deg(facts.azimuth, 1)}</dd>
        </div>
        <div>
          <dt>Incidence</dt>
          <dd>
            {up ? deg(aoi, 0) : '–'}
            {up && aoi > 90 && <small> behind</small>}
          </dd>
        </div>
        <div>
          <dt>Sunrise</dt>
          <dd>{facts.rise ?? '—'}</dd>
        </div>
        <div>
          <dt>Solar noon</dt>
          <dd>{facts.noon}</dd>
        </div>
        <div>
          <dt>Sunset</dt>
          <dd>
            {facts.set ?? '—'}
            {facts.setNote && <small> {facts.setNote}</small>}
          </dd>
        </div>
        <div>
          <dt>Day length</dt>
          <dd>{formatDuration(facts.dayLength)}</dd>
        </div>
        <div>
          <dt>Declination</dt>
          <dd>{deg(facts.declination, 2)}</dd>
        </div>
        <div>
          <dt>Eq. of time</dt>
          <dd>{signed(facts.eqTime, 1)} min</dd>
        </div>
      </dl>
      {facts.polarNote && (
        <p className="note note--polar" role="note">
          {facts.polarNote}
        </p>
      )}
      {blockedMinutes > 0 && (
        <p className="note note--soft">
          The skyline hides the Sun for {formatDuration(blockedMinutes)} of daylight on this date.
        </p>
      )}
    </Card>
  );
}
