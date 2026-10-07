import { useEffect, useState } from 'react';
import { AnalysisEngine } from './analysis';
import type { PanelJob, PanelResult, SiteJob, SiteResult } from './analysis';
import type { PvResult } from './solar/annual';

export type AnalysisStatus = 'idle' | 'running' | 'done' | 'error';

export interface AnalysisState {
  status: AnalysisStatus;
  progress: number;
  stage: string;
  result: SiteResult | null;
  /** PV estimate for the current panel (updates without re-running the whole analysis) */
  pv: PvResult | null;
  /** Current panel's energy over the analysed period, kWh/m² */
  panelEnergy: number | null;
  error: string | null;
  /** True when the analysis runs on the main thread because workers are unavailable */
  fallback: boolean;
}

type Outgoing =
  | { type: 'progress'; id: number; fraction: number; stage: string }
  | { type: 'site'; id: number; result: SiteResult }
  | { type: 'panel'; id: number; panel: PanelResult | null }
  | { type: 'error'; id: number; message: string };

type SetState = (fn: (s: AnalysisState) => AnalysisState) => void;

const INITIAL: AnalysisState = {
  status: 'idle',
  progress: 0,
  stage: '',
  result: null,
  pv: null,
  panelEnergy: null,
  error: null,
  fallback: false,
};

/**
 * Owns the worker. A new site job while one is running terminates the worker and starts a
 * fresh one, so the latest inputs win without waiting for stale work. Panel jobs reuse the
 * worker's cached year table and are cheap.
 */
class AnalysisController {
  private worker: Worker | null = null;
  private engine: AnalysisEngine | null = null;
  private busy = false;
  private nextId = 0;
  private siteId = 0;
  private jobPanelKey = '';
  private panel: PanelJob | null = null;
  private panelKey = '';
  private readonly set: SetState;

  constructor(set: SetState) {
    this.set = set;
  }

  private ensure(): void {
    if (this.worker || this.engine) return;
    try {
      const w = new Worker(new URL('../worker/analysis.worker.ts', import.meta.url), {
        type: 'module',
      });
      w.onmessage = (e: MessageEvent<Outgoing>) => this.handle(e.data);
      w.onerror = (e) => {
        e.preventDefault();
        this.busy = false;
        this.set((s) => ({
          ...s,
          status: 'error',
          error: e.message || 'The analysis worker stopped unexpectedly',
        }));
      };
      this.worker = w;
    } catch {
      this.engine = new AnalysisEngine();
      this.set((s) => ({ ...s, fallback: true }));
    }
  }

  private handle(m: Outgoing): void {
    if (m.type === 'panel') {
      const r = m.panel;
      if (r) this.set((s) => ({ ...s, pv: r.pv, panelEnergy: r.periodEnergy }));
      return;
    }
    if (m.id !== this.siteId) return;
    if (m.type === 'progress') {
      this.set((s) => ({ ...s, progress: m.fraction, stage: m.stage }));
    } else if (m.type === 'site') {
      this.busy = false;
      this.set((s) => ({
        ...s,
        status: 'done',
        progress: 1,
        stage: 'Done',
        result: m.result,
        pv: m.result.pv,
        panelEnergy: m.result.panelEnergy,
        error: null,
      }));
      if (this.panel && this.panelKey !== this.jobPanelKey)
        this.runPanel(this.panel, this.panelKey);
    } else {
      this.busy = false;
      this.set((s) => ({ ...s, status: 'error', error: m.message }));
    }
  }

  runSite(job: SiteJob, panel: PanelJob, panelKey: string): void {
    this.panel = panel;
    this.panelKey = panelKey;
    if (this.busy && this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.ensure();
    const id = ++this.nextId;
    this.siteId = id;
    this.jobPanelKey = panelKey;
    this.busy = true;
    const full: SiteJob = { ...job, panel: panel.panel, pv: panel.pv };
    this.set((s) => ({ ...s, status: 'running', progress: 0, stage: 'Starting', error: null }));
    if (this.worker) {
      this.worker.postMessage({ type: 'site', id, job: full });
    } else if (this.engine) {
      const engine = this.engine;
      window.setTimeout(() => {
        if (id !== this.siteId) return;
        try {
          this.handle({ type: 'site', id, result: engine.runSite(full) });
        } catch (err) {
          this.handle({
            type: 'error',
            id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }, 30);
    }
  }

  runPanel(panel: PanelJob, panelKey: string): void {
    this.panel = panel;
    this.panelKey = panelKey;
    if (this.busy) return; // handled when the running site job finishes
    const id = ++this.nextId;
    if (this.worker) {
      this.worker.postMessage({ type: 'panel', id, job: panel });
    } else if (this.engine) {
      const r = this.engine.runPanel(panel);
      if (r) this.set((s) => ({ ...s, pv: r.pv, panelEnergy: r.periodEnergy }));
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
  }
}

export function useAnalysis(
  siteJob: SiteJob,
  siteKey: string,
  panelJob: PanelJob,
  panelKey: string,
): AnalysisState {
  const [state, setState] = useState<AnalysisState>(INITIAL);
  const [controller] = useState(() => new AnalysisController(setState));

  useEffect(() => {
    const t = window.setTimeout(() => controller.runSite(siteJob, panelJob, panelKey), 160);
    return () => window.clearTimeout(t);
    // Site work re-runs only when its inputs (siteKey) change; the latest panel is sent along.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, siteKey]);

  useEffect(() => {
    const t = window.setTimeout(() => controller.runPanel(panelJob, panelKey), 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, panelKey]);

  useEffect(() => () => controller.dispose(), [controller]);

  return state;
}
