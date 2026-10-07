import { fmt } from '../lib/format';
import { DEFAULT_SKY, LIMITS } from '../lib/state';
import type { SkyState } from '../lib/state';
import type { TranspositionModel } from '../lib/solar/transposition';
import { Card, NumberField, Segmented } from './ui';

/** Surface albedos from pvlib.albedo.SURFACE_ALBEDOS. */
const ALBEDOS: { label: string; value: number }[] = [
  { label: 'Asphalt', value: 0.12 },
  { label: 'Urban', value: 0.18 },
  { label: 'Grass', value: 0.2 },
  { label: 'Concrete', value: 0.3 },
  { label: 'Sand', value: 0.4 },
  { label: 'Snow', value: 0.65 },
];

export function Atmosphere({
  sky,
  onSky,
  altitude,
  onAltitude,
}: {
  sky: SkyState;
  onSky: (s: SkyState) => void;
  altitude: number;
  onAltitude: (m: number) => void;
}) {
  const isDefault =
    sky.aod700 === DEFAULT_SKY.aod700 &&
    sky.pw === DEFAULT_SKY.pw &&
    sky.albedo === DEFAULT_SKY.albedo &&
    sky.transposition === DEFAULT_SKY.transposition;
  return (
    <Card fig="Model" title="Sky and ground" id="atmosphere" className="card--atmos">
      <Segmented<TranspositionModel>
        legend="Diffuse sky on a tilted panel"
        name="transposition"
        value={sky.transposition}
        onChange={(t) => onSky({ ...sky, transposition: t })}
        size="sm"
        options={[
          {
            value: 'perez',
            label: 'Perez 1990',
            title: 'Anisotropic: circumsolar and horizon brightening',
          },
          { value: 'haydavies', label: 'Hay–Davies 1980', title: 'Isotropic plus circumsolar' },
        ]}
      />
      <div className="atmos__grid">
        <NumberField
          label="Aerosol depth (700 nm)"
          value={sky.aod700}
          min={LIMITS.aod700[0]}
          max={LIMITS.aod700[1]}
          digits={3}
          onCommit={(v) => onSky({ ...sky, aod700: v })}
          hint="0.05 very clean · 0.1 typical · 0.3 dusty"
        />
        <NumberField
          label="Precipitable water"
          unit="cm"
          value={sky.pw}
          min={LIMITS.pw[0]}
          max={LIMITS.pw[1]}
          digits={2}
          onCommit={(v) => onSky({ ...sky, pw: v })}
          hint="Dry desert ~1 · humid tropics ~4–5"
        />
        <NumberField
          label="Site altitude"
          unit="m"
          value={altitude}
          min={LIMITS.altitude[0]}
          max={LIMITS.altitude[1]}
          digits={0}
          onCommit={onAltitude}
          hint="Sets air pressure for the clear sky"
        />
        <NumberField
          label="Ground albedo"
          value={sky.albedo}
          min={LIMITS.albedo[0]}
          max={LIMITS.albedo[1]}
          digits={2}
          onCommit={(v) => onSky({ ...sky, albedo: v })}
          hint="Fraction of light the ground reflects"
        />
      </div>
      <div className="chips chips--sm" role="group" aria-label="Ground albedo presets">
        {ALBEDOS.map((a) => (
          <button
            key={a.label}
            type="button"
            className={`chip ${Math.abs(sky.albedo - a.value) < 1e-9 ? 'is-active' : ''}`}
            aria-pressed={Math.abs(sky.albedo - a.value) < 1e-9}
            onClick={() => onSky({ ...sky, albedo: a.value })}
          >
            {a.label} {fmt(a.value, 2)}
          </button>
        ))}
      </div>
      <div className="atmos__foot">
        <p className="field__hint">
          Clear sky: simplified Solis model (Ineichen 2008). Aerosol and water vapour shape the
          clear-sky beam; in “Long-term average” mode monthly totals come from NASA POWER instead.
        </p>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={isDefault}
          onClick={() => onSky({ ...DEFAULT_SKY, source: sky.source })}
        >
          Reset model
        </button>
      </div>
    </Card>
  );
}
