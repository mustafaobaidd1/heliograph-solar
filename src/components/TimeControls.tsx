import { useId } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import {
  MONTH_NAMES,
  dateFromDayOfYear,
  dayOfYear,
  formatClock,
  formatIsoDate,
  parseIsoDate,
} from '../lib/solar/time';
import type { CalendarDate } from '../lib/solar/time';
import { PauseIcon, PlayIcon } from './icons';

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export interface TimeControlsProps {
  minutes: number;
  onMinutes: (m: number) => void;
  date: CalendarDate;
  onDate: (d: CalendarDate) => void;
  daysInYear: number;
  /** Local clock minutes of sunrise / sunset, or null on polar days/nights */
  rise: number | null;
  set: number | null;
  polar: 'day' | 'night' | null;
  solarTime: string;
  playing: boolean;
  onTogglePlay: () => void;
  onNow: () => void;
  todayDate: CalendarDate;
  live: string;
  showHint: boolean;
  sunUpNow: boolean;
}

export function TimeControls(p: TimeControlsProps) {
  const id = useId();
  const doy = dayOfYear(p.date);
  const pct = (m: number) => `${Math.min(100, Math.max(0, (m / 1440) * 100))}%`;
  const trackStyle = {
    '--rise': p.polar === 'day' ? '0%' : p.polar === 'night' ? '100%' : pct(p.rise ?? 0),
    '--set': p.polar === 'day' ? '100%' : p.polar === 'night' ? '100%' : pct(p.set ?? 1440),
    '--pct': pct(p.minutes),
  } as CSSProperties;
  const riseWraps = p.rise !== null && p.set !== null && p.set > 1440;

  const onTimeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const big = e.shiftKey || e.key === 'PageUp' || e.key === 'PageDown';
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown'
          ? -1
          : 0;
    if (dir !== 0 && big) {
      e.preventDefault();
      p.onMinutes(Math.min(1439, Math.max(0, p.minutes + dir * 60)));
    }
  };

  const jumps: { label: string; date: CalendarDate }[] = [
    { label: 'Mar equinox', date: { year: p.date.year, month: 3, day: 20 } },
    { label: 'Jun solstice', date: { year: p.date.year, month: 6, day: 21 } },
    { label: 'Sep equinox', date: { year: p.date.year, month: 9, day: 22 } },
    { label: 'Dec solstice', date: { year: p.date.year, month: 12, day: 21 } },
  ];
  const isToday =
    p.date.year === p.todayDate.year &&
    p.date.month === p.todayDate.month &&
    p.date.day === p.todayDate.day;

  return (
    <div className="timecontrols">
      <div className="timebar">
        <button
          type="button"
          className="btn btn--play"
          onClick={p.onTogglePlay}
          aria-pressed={p.playing}
          aria-label={p.playing ? 'Pause the day' : 'Play the day'}
        >
          {p.playing ? <PauseIcon /> : <PlayIcon />}
          <span className="btn--play__text">{p.playing ? 'Pause' : 'Play the day'}</span>
        </button>
        <div className="timebar__clock">
          <span className="timebar__time" aria-hidden="true">
            {formatClock(p.minutes)}
          </span>
          <span className="timebar__solar">solar {p.solarTime}</span>
        </div>
        <div className="timebar__slider" style={trackStyle} data-wraps={riseWraps || undefined}>
          {p.showHint && (
            <span className="timebar__hint" aria-hidden="true">
              Drag to move the sun
            </span>
          )}
          <label htmlFor={`${id}-time`} className="visually-hidden">
            Time of day (local clock)
          </label>
          <input
            id={`${id}-time`}
            className="range range--time"
            type="range"
            min={0}
            max={1439}
            step={5}
            value={p.minutes}
            aria-valuetext={`${formatClock(p.minutes)} local time, ${p.sunUpNow ? 'sun up' : 'sun below the horizon'}`}
            onChange={(e) => p.onMinutes(Number(e.target.value))}
            onKeyDown={onTimeKey}
          />
          <div className="timebar__ticks" aria-hidden="true">
            {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
              <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
                {String(h).padStart(2, '0')}
              </span>
            ))}
          </div>
        </div>
        <span className="timebar__live" aria-hidden="true">
          {p.live}
        </span>
        <button type="button" className="btn btn--sm btn--ghost timebar__now" onClick={p.onNow}>
          Now
        </button>
      </div>

      <div className="daybar">
        <div className="daybar__date">
          <label htmlFor={`${id}-date`} className="field__label">
            Date
          </label>
          <input
            id={`${id}-date`}
            className="input input--date"
            type="date"
            min="1900-01-01"
            max="2100-12-31"
            value={formatIsoDate(p.date)}
            onChange={(e) => {
              const d = parseIsoDate(e.target.value);
              if (d) p.onDate(d);
            }}
          />
        </div>
        <div className="daybar__slider">
          <label htmlFor={`${id}-day`} className="visually-hidden">
            Day of the year
          </label>
          <input
            id={`${id}-day`}
            className="range range--day"
            type="range"
            min={1}
            max={p.daysInYear}
            step={1}
            value={doy}
            aria-valuetext={`${p.date.day} ${MONTH_NAMES[p.date.month - 1]} ${p.date.year}`}
            style={{ '--pct': `${((doy - 1) / (p.daysInYear - 1)) * 100}%` } as CSSProperties}
            onChange={(e) => p.onDate(dateFromDayOfYear(p.date.year, Number(e.target.value)))}
          />
          <div className="daybar__months" aria-hidden="true">
            {MONTH_INITIALS.map((m, i) => {
              const start = dayOfYear({ year: p.date.year, month: i + 1, day: 1 });
              return (
                <span key={i} style={{ left: `${((start - 1) / (p.daysInYear - 1)) * 100}%` }}>
                  {m}
                </span>
              );
            })}
          </div>
        </div>
        <div className="daybar__jumps" role="group" aria-label="Jump to a date">
          {jumps.map((j) => {
            const active = j.date.month === p.date.month && j.date.day === p.date.day;
            return (
              <button
                key={j.label}
                type="button"
                className={`chip ${active ? 'is-active' : ''}`}
                aria-pressed={active}
                onClick={() => p.onDate(j.date)}
              >
                {j.label}
              </button>
            );
          })}
          <button
            type="button"
            className={`chip ${isToday ? 'is-active' : ''}`}
            aria-pressed={isToday}
            onClick={() => p.onDate(p.todayDate)}
          >
            Today
          </button>
        </div>
      </div>
    </div>
  );
}
