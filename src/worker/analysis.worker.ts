/// <reference lib="es2023" />
/**
 * Annual integration and optimisation off the main thread.
 * Messages in: { type: 'site' | 'panel', id, job }. Messages out: progress, site, panel, error.
 */
import { AnalysisEngine } from '../lib/analysis';
import type { PanelJob, SiteJob } from '../lib/analysis';

type Incoming =
  { type: 'site'; id: number; job: SiteJob } | { type: 'panel'; id: number; job: PanelJob };

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<Incoming>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const engine = new AnalysisEngine();

scope.onmessage = (event) => {
  const msg = event.data;
  try {
    if (msg.type === 'site') {
      let last = 0;
      const result = engine.runSite(msg.job, (fraction, stage) => {
        const now = performance.now();
        if (fraction >= 1 || now - last > 40) {
          last = now;
          scope.postMessage({ type: 'progress', id: msg.id, fraction, stage });
        }
      });
      scope.postMessage({ type: 'site', id: msg.id, result }, [result.heat.values.buffer]);
    } else {
      scope.postMessage({ type: 'panel', id: msg.id, panel: engine.runPanel(msg.job) });
    }
  } catch (err) {
    scope.postMessage({
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
