/** Keyboard alternative to drawing: a table of (azimuth, elevation) points plus presets. */
import { useId, useState } from 'react';
import {
  HORIZON_PRESETS,
  MAX_HORIZON_ELEVATION,
  MAX_HORIZON_POINTS,
  sanitizeHorizon,
} from '../lib/solar/horizon';
import type { HorizonPoint } from '../lib/solar/horizon';
import { PlusIcon, TrashIcon } from './icons';

function CellInput({
  value,
  label,
  min,
  max,
  onCommit,
}: {
  value: number;
  label: string;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  const [bad, setBad] = useState(false);
  if (prev !== value) {
    setPrev(value);
    setText(String(value));
    setBad(false);
  }
  const commit = () => {
    const v = Number(text.trim().replace(',', '.'));
    if (!Number.isFinite(v) || v < min || v > max) {
      setBad(true);
      return;
    }
    setBad(false);
    if (v !== value) onCommit(v);
  };
  return (
    <input
      className={`cell-input ${bad ? 'is-bad' : ''}`}
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={bad || undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

export function SkylineEditor({
  points,
  onChange,
}: {
  points: HorizonPoint[];
  onChange: (p: HorizonPoint[]) => void;
}) {
  const id = useId();
  const [az, setAz] = useState('');
  const [el, setEl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const a = Number(az.trim().replace(',', '.'));
    const e = Number(el.trim().replace(',', '.'));
    if (az.trim() === '' || !Number.isFinite(a) || a < 0 || a >= 360) {
      setError('Azimuth must be from 0° to 359.9° (clockwise from north).');
      return;
    }
    if (el.trim() === '' || !Number.isFinite(e) || e < 0 || e > MAX_HORIZON_ELEVATION) {
      setError(`Elevation must be from 0° to ${MAX_HORIZON_ELEVATION}°.`);
      return;
    }
    if (points.length >= MAX_HORIZON_POINTS) {
      setError(`At most ${MAX_HORIZON_POINTS} points.`);
      return;
    }
    setError(null);
    onChange(sanitizeHorizon([...points, { az: a, el: e }]));
    setAz('');
    setEl('');
  };

  return (
    <div className="skyline-editor">
      <div className="skyline-editor__row">
        <label className="field__label" htmlFor={`${id}-preset`}>
          Example skylines
        </label>
        <div className="skyline-editor__presets">
          <select
            id={`${id}-preset`}
            className="select"
            value=""
            onChange={(e) => {
              const p = HORIZON_PRESETS.find((h) => h.id === e.target.value);
              if (p) onChange(sanitizeHorizon(p.points));
            }}
          >
            <option value="" disabled>
              Choose an example…
            </option>
            {HORIZON_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => onChange([])}
            disabled={!points.length}
          >
            <TrashIcon /> Clear skyline
          </button>
        </div>
      </div>

      <details className="skyline-editor__table">
        <summary>
          Edit points with the keyboard{' '}
          <span className="count">
            {points.length ? `${points.length} points` : 'flat horizon'}
          </span>
        </summary>
        <p className="field__hint">
          Points are joined by straight lines and wrap through north, the convention of PVGIS
          horizon files. Begin and end an obstruction with 0° points, e.g. 70°/0°, 71°/24°,
          128°/24°, 129°/0°.
        </p>
        {points.length > 0 && (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">Skyline points</caption>
              <thead>
                <tr>
                  <th scope="col">Azimuth (°)</th>
                  <th scope="col">Elevation (°)</th>
                  <th scope="col">
                    <span className="visually-hidden">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {points.map((p, i) => (
                  <tr key={`${p.az}-${i}`}>
                    <td>
                      <CellInput
                        value={p.az}
                        label={`Azimuth of point ${i + 1}`}
                        min={0}
                        max={359.9}
                        onCommit={(v) =>
                          onChange(
                            sanitizeHorizon(points.map((q, j) => (j === i ? { ...q, az: v } : q))),
                          )
                        }
                      />
                    </td>
                    <td>
                      <CellInput
                        value={p.el}
                        label={`Elevation of point ${i + 1}`}
                        min={0}
                        max={MAX_HORIZON_ELEVATION}
                        onCommit={(v) =>
                          onChange(
                            sanitizeHorizon(points.map((q, j) => (j === i ? { ...q, el: v } : q))),
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--icon btn--ghost"
                        aria-label={`Remove point ${i + 1} (${p.az}°, ${p.el}°)`}
                        onClick={() => onChange(points.filter((_, j) => j !== i))}
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form
          className="skyline-editor__add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="field field--sm">
            <label className="field__label" htmlFor={`${id}-az`}>
              Azimuth °
            </label>
            <input
              id={`${id}-az`}
              className="input"
              type="text"
              inputMode="decimal"
              value={az}
              onChange={(e) => setAz(e.target.value)}
              placeholder="e.g. 210"
            />
          </div>
          <div className="field field--sm">
            <label className="field__label" htmlFor={`${id}-el`}>
              Elevation °
            </label>
            <input
              id={`${id}-el`}
              className="input"
              type="text"
              inputMode="decimal"
              value={el}
              onChange={(e) => setEl(e.target.value)}
              placeholder="e.g. 25"
            />
          </div>
          <button type="submit" className="btn btn--sm">
            <PlusIcon /> Add point
          </button>
        </form>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </details>
    </div>
  );
}
