/**
 * The annual analysis as one pure function, used by the Web Worker (and by a main-thread
 * fallback if workers are unavailable).
 */
import {
  ViewGrid,
  buildYearTable,
  compareStrategies,
  computeHeatMap,
  integrateFixed,
  periodRanges,
  pvEstimate,
  refineOptimum,
  resolvePeriod,
} from './solar/annual';
import type {
  HeatMap,
  MonthlyTriple,
  Optimum,
  PeriodSpec,
  PvParams,
  PvResult,
  StrategyResult,
  YearTable,
} from './solar/annual';
import type { ClimateFactors, ClimateNormals } from './solar/climate';
import { SiteModel } from './solar/model';
import type { Orientation, SiteSpec } from './solar/model';

/** Time step of the annual integration, minutes (sampled at step midpoints). */
export const ANNUAL_STEP_MINUTES = 15;

export interface SiteJob {
  site: SiteSpec;
  year: number;
  climate: ClimateNormals | null;
  ambient: number;
  period: PeriodSpec;
  panel: Orientation;
  pv: PvParams;
}

export interface PanelJob {
  panel: Orientation;
  pv: PvParams;
  /** Air temperature for clear-sky mode, °C (ignored when climate normals are used) */
  ambient: number;
}

export interface SiteResult {
  heat: HeatMap;
  optimum: Optimum;
  strategies: StrategyResult[];
  /** Optimum and strategies without the skyline, to show what shading costs */
  optimumUnshaded: Optimum | null;
  strategiesUnshaded: StrategyResult[] | null;
  pv: PvResult;
  /** Energy on the job's panel over the period, kWh/m² (same basis as the optimum) */
  panelEnergy: number;
  /** PV estimate at the optimum orientation */
  pvAtOptimum: PvResult;
  clearMonthly: MonthlyTriple;
  usedMonthly: MonthlyTriple;
  factors: ClimateFactors | null;
  steps: number;
  millis: number;
}

export type Progress = (fraction: number, stage: string) => void;

export interface PanelResult {
  pv: PvResult;
  /** Energy on the panel over the analysed period, kWh/m² */
  periodEnergy: number;
}

export class AnalysisEngine {
  private key = '';
  private model: SiteModel | null = null;
  private table: YearTable | null = null;
  private climate = false;
  private ranges: Int32Array | null = null;

  /** Full analysis for a site and period. Reuses the year table when only the period changed. */
  runSite(job: SiteJob, progress: Progress = () => {}): SiteResult {
    const t0 = performance.now();
    const key = JSON.stringify([job.site, job.year, job.climate]);
    if (key !== this.key || !this.table || !this.model) {
      progress(0.02, 'Tracing the Sun through the year');
      this.model = new SiteModel(job.site);
      this.table = buildYearTable(
        this.model,
        job.year,
        ANNUAL_STEP_MINUTES,
        job.climate,
        job.ambient,
      );
      this.climate = job.climate !== null;
      this.key = key;
    }
    const model = this.model;
    const table = this.table;
    const shaded = !model.horizon.flat;
    const window = resolvePeriod(job.period, job.site.lat);
    const ranges = periodRanges(table, window);
    this.ranges = ranges;
    const views = new ViewGrid(model.horizon);

    progress(0.1, 'Mapping tilt × azimuth');
    const heat = computeHeatMap(table, ranges, views, true, (done, total) =>
      progress(0.1 + 0.7 * (done / total), 'Mapping tilt × azimuth'),
    );
    progress(0.82, 'Refining the optimum');
    const optimum = refineOptimum(table, ranges, heat, views, true, job.site.lat);
    progress(0.88, 'Comparing strategies');
    const strategies = compareStrategies(table, window, ranges, optimum, views, true);
    let strategiesUnshaded: StrategyResult[] | null = null;
    let optimumUnshaded: Optimum | null = null;
    if (shaded) {
      progress(0.9, 'Comparing with an open horizon');
      const flatViews = new ViewGrid({ ...model.horizon, flat: true });
      const heatU = computeHeatMap(table, ranges, flatViews, false);
      optimumUnshaded = refineOptimum(table, ranges, heatU, flatViews, false, job.site.lat);
      strategiesUnshaded = compareStrategies(
        table,
        window,
        ranges,
        optimumUnshaded,
        flatViews,
        false,
      );
    }
    progress(0.96, 'Estimating PV yield');
    const ambient = job.climate ? null : job.ambient;
    const pv = pvEstimate(table, job.panel, shaded ? model.view(job.panel) : null, job.pv, ambient);
    const optO = { tilt: optimum.tilt, azimuth: optimum.azimuth };
    const pvAtOptimum = pvEstimate(table, optO, shaded ? model.view(optO) : null, job.pv, ambient);
    const panelEnergy = integrateFixed(
      table,
      job.panel,
      shaded ? model.view(job.panel) : null,
      ranges,
      true,
    );
    progress(1, 'Done');
    return {
      heat,
      optimum,
      strategies,
      optimumUnshaded,
      strategiesUnshaded,
      pv,
      panelEnergy,
      pvAtOptimum,
      clearMonthly: table.clearMonthly,
      usedMonthly: table.usedMonthly,
      factors: table.factors,
      steps: table.count,
      millis: performance.now() - t0,
    };
  }

  /** PV estimate and period energy for another orientation, reusing the cached table. */
  runPanel(job: PanelJob): PanelResult | null {
    if (!this.table || !this.model || !this.ranges) return null;
    const shaded = !this.model.horizon.flat;
    const view = shaded ? this.model.view(job.panel) : null;
    return {
      pv: pvEstimate(this.table, job.panel, view, job.pv, this.climate ? null : job.ambient),
      periodEnergy: integrateFixed(this.table, job.panel, view, this.ranges, true),
    };
  }
}
