import { useEffect, useId, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export function Card({
  fig,
  title,
  id,
  actions,
  children,
  className = '',
  headingLevel = 2,
}: {
  fig?: string;
  title: ReactNode;
  id: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={`card ${className}`} aria-labelledby={`${id}-title`} id={id}>
      <header className="card__head">
        <div className="card__titles">
          {fig && (
            <span className="card__fig" aria-hidden="true">
              {fig}
            </span>
          )}
          <H id={`${id}-title`} className="card__title">
            {title}
          </H>
        </div>
        {actions && <div className="card__actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** Radio group styled as a segmented control (arrow keys move between options). */
export function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
  name,
  hideLegend = false,
  size = 'md',
}: {
  legend: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  name: string;
  hideLegend?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <fieldset className={`segmented segmented--${size}`}>
      <legend className={hideLegend ? 'visually-hidden' : 'field__label'}>{legend}</legend>
      <div className="segmented__track">
        {options.map((o) => (
          <label key={o.value} className="segmented__option" title={o.title}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Text input for a number with a unit. Commits on Enter or blur; invalid or out-of-range
 * input shows an inline message and keeps the last valid value.
 */
export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  unit,
  digits = 2,
  hint,
  disabled = false,
  width = 'md',
}: {
  label: ReactNode;
  value: number;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  unit?: string;
  digits?: number;
  hint?: ReactNode;
  disabled?: boolean;
  width?: 'sm' | 'md' | 'lg';
}) {
  const id = useId();
  const show = (v: number) => String(Number(v.toFixed(digits)));
  const [text, setText] = useState(show(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(show(value));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = () => {
    const normalised = text.trim().replace(',', '.').replace('−', '-');
    const v = Number(normalised);
    if (normalised === '' || !Number.isFinite(v)) {
      setError('Enter a number');
      return;
    }
    if (v < min || v > max) {
      setError(`Between ${show(min)} and ${show(max)}${unit ? ` ${unit}` : ''}`);
      return;
    }
    setError(null);
    onCommit(v);
  };

  return (
    <div className={`field field--${width} ${error ? 'field--invalid' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__control">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={text}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              setText(show(value));
              setError(null);
            }
          }}
        />
        {unit && <span className="field__unit">{unit}</span>}
      </div>
      {error ? (
        <p className="field__error" id={`${id}-err`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Labelled native range input with a live value. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  valueText,
  className = '',
  marks,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: ReactNode;
  valueText?: string;
  className?: string;
  marks?: { value: number; label: string }[];
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={`slider ${className}`}>
      <div className="slider__top">
        <label htmlFor={id} className="field__label">
          {label}
        </label>
        <output htmlFor={id} className="slider__value">
          {display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {marks && (
        <div className="slider__marks" aria-hidden="true">
          {marks.map((m) => (
            <span key={m.value} style={{ left: `${((m.value - min) / (max - min)) * 100}%` }}>
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <span style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, value))})` }} />
    </div>
  );
}
