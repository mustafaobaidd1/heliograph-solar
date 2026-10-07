import { useState } from 'react';
import { CheckIcon, DownloadIcon, LinkIcon } from './icons';
import { Card } from './ui';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string };

export function ExportShare({
  buildCsv,
  fileName,
  shareUrl,
}: {
  buildCsv: () => string;
  fileName: string;
  shareUrl: string;
}) {
  const [csv, setCsv] = useState<Status>({ kind: 'idle' });
  const [copy, setCopy] = useState<Status>({ kind: 'idle' });

  const download = () => {
    setCsv({ kind: 'busy' });
    // Let the button repaint before the (≈0.1 s) computation.
    window.setTimeout(() => {
      try {
        const text = buildCsv();
        const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
        const rows = text.split('\n').length - 2;
        setCsv({
          kind: 'ok',
          text: `Saved ${fileName} (${rows.toLocaleString('en-GB')} hourly rows).`,
        });
      } catch (err) {
        setCsv({
          kind: 'error',
          text: `Could not build the file: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }, 20);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopy({
        kind: 'ok',
        text: 'Link copied. It restores this place, date, time, panel, skyline and settings.',
      });
    } catch {
      const input = document.getElementById('share-url') as HTMLInputElement | null;
      input?.select();
      setCopy({
        kind: 'error',
        text: 'Copying was blocked; the link is selected — press Ctrl+C (⌘C) to copy it.',
      });
    }
  };

  return (
    <Card fig="Out" title="Export and share" id="export" className="card--export">
      <div className="export__row">
        <div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={download}
            disabled={csv.kind === 'busy'}
          >
            <DownloadIcon /> {csv.kind === 'busy' ? 'Preparing…' : 'Download hourly CSV'}
          </button>
          <p className="field__hint">
            One row per hour of the year for this panel: sun position, GHI/DNI/DHI, plane-of-array
            parts, cell temperature and AC power (hourly means, W/m² = Wh/m²).
          </p>
          {csv.kind === 'ok' || csv.kind === 'error' ? (
            <p className={`note ${csv.kind === 'error' ? 'note--warn' : 'note--ok'}`} role="status">
              {csv.text}
            </p>
          ) : null}
        </div>
        <div>
          <label className="field__label" htmlFor="share-url">
            Link to this exact view
          </label>
          <div className="share">
            <input
              id="share-url"
              className="input share__url"
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="btn" onClick={copyLink}>
              {copy.kind === 'ok' ? <CheckIcon /> : <LinkIcon />}{' '}
              {copy.kind === 'ok' ? 'Copied' : 'Copy link'}
            </button>
          </div>
          {copy.kind === 'ok' || copy.kind === 'error' ? (
            <p
              className={`note ${copy.kind === 'error' ? 'note--warn' : 'note--ok'}`}
              role="status"
            >
              {copy.text}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
