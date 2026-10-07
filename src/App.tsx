import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Atmosphere } from './components/Atmosphere';
import { Footer, Masthead } from './components/Chrome';
import { Comparison } from './components/Comparison';
import { ExportShare } from './components/ExportShare';
import { HowItWorks } from './components/HowItWorks';
import { LiveReadout } from './components/LiveReadout';
import type { ClimateStatus, SunFacts } from './components/LiveReadout';
import { LocationCard } from './components/LocationCard';
import { Optimizer, periodLabel } from './components/Optimizer';
import { PanelCard } from './components/PanelCard';
import { PvEstimate } from './components/PvEstimate';
import { SceneView } from './components/scene/SceneView';
import type { SceneState } from './components/scene/heliographScene';
import { SkylineEditor } from './components/SkylineEditor';
import { SunPathDiagram } from './components/SunPathDiagram';
import { TimeControls } from './components/TimeControls';
import { Card } from './components/ui';
import type { PanelJob, SiteJob } from './lib/analysis';
import { loadClimate } from './lib/climateSource';
import { seasonColor } from './lib/color';
import { csvFileName, hourlyCsv } from './lib/csv';
import { fmt } from './lib/format';
import { decodeState, defaultState, encodeState, mirrorAzimuth } from './lib/state';
import type { AppState, PlaceState, PvState, SkyState } from './lib/state';
import { climateFactorsFor } from './lib/solar/annual';
import type { ClimateNormals } from './lib/solar/climate';
import type { HorizonPoint } from './lib/solar/horizon';
import { SiteModel, dayProfile } from './lib/solar/model';
import type { SiteSpec } from './lib/solar/model';
import { nextOrdinaryDay, sunPosition } from './lib/solar/sunPosition';
import { MONTH_SHORT, daysInYear, formatClock, formatLongDate } from './lib/solar/time';
import type { CalendarDate } from './lib/solar/time';
import { utcToZoned, zonedTimeToUtc } from './lib/solar/zone';
import { dayPath, seasonFraction, sunTimesForLocalDate } from './lib/sunpath';
import { useAnalysis } from './lib/useAnalysis';

const PLAY_RATE = 90; // simulated minutes per second
const HINT_KEY = 'heliograph:scrubbed';

function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // private mode: the hint simply shows again next time
  }
}

interface Boot {
  state: AppState;
  nightNote: string | null;
  urlHadTime: boolean;
}

/** Initial state from the URL; if it is dark at the place right now, open on a daytime moment. */
function boot(now: number): Boot {
  const search = window.location.search;
  const state = decodeState(search, defaultState(now));
  const urlHadTime = new URLSearchParams(search).has('time');
  let nightNote: string | null = null;
  if (!urlHadTime) {
    const { lat, lon, timeZone, name } = state.place;
    const utc = zonedTimeToUtc(state.date, state.minutes, timeZone);
    const el = sunPosition(utc, lat, lon).elevation;
    const t = sunTimesForLocalDate(state.date, lat, lon, timeZone);
    if (el < 3 && t.polar !== 'night') {
      const noon = utcToZoned(t.solarNoonUtc, timeZone).minutes;
      const rise = t.sunriseUtc !== null ? utcToZoned(t.sunriseUtc, timeZone).minutes : noon - 360;
      const target = Math.round(Math.max(rise + 120, noon - 150) / 5) * 5;
      nightNote = `It is ${el < -6 ? 'night' : 'twilight'} in ${name} now (${formatClock(state.minutes)}), so the model opens at ${formatClock(target)}.`;
      state.minutes = target;
    }
  }
  return { state, nightNote, urlHadTime };
}

function localDate(d: Date, timeZone: string): CalendarDate {
  const z = utcToZoned(d.getTime(), timeZone);
  return { year: z.year, month: z.month, day: z.day };
}

export function App() {
  const [bootData] = useState(() => boot(Date.now()));
  const [state, setState] = useState<AppState>(bootData.state);
  const [nightNote, setNightNote] = useState(bootData.nightNote);
  const reducedMotion = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [showHint, setShowHint] = useState(() => !readFlag(HINT_KEY));
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  const { place, date, minutes, panel, horizon, sky, pv, period } = state;
  const year = date.year;

  // ---- Climate normals (only when asked for) --------------------------------------------
  const climateKey = `${place.presetId ?? ''}|${place.lat}|${place.lon}`;
  const climateCache = useRef(
    new Map<string, { normals: ClimateNormals; origin: 'bundled' | 'cache' | 'network' }>(),
  );
  const [climate, setClimate] = useState<{
    key: string;
    status: ClimateStatus;
    normals: ClimateNormals | null;
  }>({
    key: '',
    status: { kind: 'idle' },
    normals: null,
  });
  const [climateRetry, setClimateRetry] = useState(0);
  useEffect(() => {
    if (sky.source !== 'climate') return;
    const hit = climateCache.current.get(climateKey);
    if (hit) {
      setClimate({
        key: climateKey,
        status: { kind: 'ready', origin: hit.origin },
        normals: hit.normals,
      });
      return;
    }
    const ac = new AbortController();
    setClimate({ key: climateKey, status: { kind: 'loading' }, normals: null });
    const [presetId, lat, lon] = [place.presetId, place.lat, place.lon];
    loadClimate(presetId, lat, lon, ac.signal)
      .then((r) => {
        climateCache.current.set(climateKey, r);
        setClimate({
          key: climateKey,
          status: { kind: 'ready', origin: r.origin },
          normals: r.normals,
        });
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setClimate({
          key: climateKey,
          status: { kind: 'error', message: err instanceof Error ? err.message : String(err) },
          normals: null,
        });
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sky.source, climateKey, climateRetry]);
  const normals =
    sky.source === 'climate' && climate.key === climateKey && climate.status.kind === 'ready'
      ? climate.normals
      : null;
  const climateStatus: ClimateStatus =
    sky.source === 'climate' && climate.key === climateKey ? climate.status : { kind: 'idle' };
  const usingClimate = normals !== null;
  const sourceLabel = usingClimate ? 'long-term average' : 'clear sky';

  // ---- Models -------------------------------------------------------------------------------
  const siteSpec: SiteSpec = useMemo(
    () => ({
      lat: place.lat,
      lon: place.lon,
      altitude: place.altitude,
      aod700: sky.aod700,
      pw: sky.pw,
      albedo: sky.albedo,
      transposition: sky.transposition,
      horizon,
    }),
    [
      place.lat,
      place.lon,
      place.altitude,
      sky.aod700,
      sky.pw,
      sky.albedo,
      sky.transposition,
      horizon,
    ],
  );
  const model = useMemo(() => new SiteModel(siteSpec), [siteSpec]);
  const factors = useMemo(() => {
    if (!normals) return null;
    const clearModel = new SiteModel({ ...siteSpec, horizon: [] });
    return climateFactorsFor(clearModel, year, normals, 15);
    // Factors do not depend on the skyline, albedo or transposition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normals, year, siteSpec.lat, siteSpec.lon, siteSpec.altitude, siteSpec.aod700, siteSpec.pw]);

  // ---- Instant and day --------------------------------------------------------------------------
  const utc = zonedTimeToUtc(date, minutes, place.timeZone);
  const sample = useMemo(() => model.sample(utc, factors), [model, utc, factors]);
  const poa = useMemo(() => model.plane(sample, panel, true), [model, sample, panel]);
  const times = useMemo(
    () => sunTimesForLocalDate(date, place.lat, place.lon, place.timeZone),
    [date, place.lat, place.lon, place.timeZone],
  );
  const nextDay = useMemo(() => {
    const d = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }, [date]);
  const dayStart = zonedTimeToUtc(date, 0, place.timeZone);
  const dayEnd = zonedTimeToUtc(nextDay, 0, place.timeZone);
  const day = useMemo(
    () => dayProfile(model, dayStart, dayEnd, panel, factors, 5),
    [model, dayStart, dayEnd, panel, factors],
  );
  const path = useMemo(
    () => dayPath(date, place.lat, place.lon, place.timeZone, 5),
    [date, place.lat, place.lon, place.timeZone],
  );
  const pathColor = seasonColor(seasonFraction(times.declination, place.lat));
  const guides = useMemo(() => {
    const mk = (m: number, d: number) => {
      const cd = { year, month: m, day: d };
      const pts = dayPath(cd, place.lat, place.lon, place.timeZone, 10);
      const decl = sunTimesForLocalDate(cd, place.lat, place.lon, place.timeZone).declination;
      return { points: pts, color: seasonColor(seasonFraction(decl, place.lat)), dashed: true };
    };
    return [mk(6, 21), mk(12, 21), mk(3, 20)];
  }, [year, place.lat, place.lon, place.timeZone]);

  const localMin = useCallback(
    (t: number | null) => (t === null ? null : (t - dayStart) / 60000),
    [dayStart],
  );
  const riseMin = localMin(times.sunriseUtc);
  const setMin = localMin(times.sunsetUtc);
  const facts: SunFacts = useMemo(() => {
    let polarNote: string | null = null;
    if (times.polar) {
      const back = nextOrdinaryDay(date, place.lat, place.lon, 1);
      const when = back ? `${back.day} ${MONTH_SHORT[back.month - 1]}` : 'in a few months';
      polarNote =
        times.polar === 'day'
          ? `Midnight sun: on this date the Sun never sets at ${fmt(Math.abs(place.lat), 1)}° ${place.lat >= 0 ? 'N' : 'S'}. It first sets again on ${when}.`
          : `Polar night: the Sun stays below the horizon all day (highest point ${fmt(times.noonElevation, 1)}°). It first rises again on ${when}.`;
    }
    const fmtEvent = (m: number | null) => (m === null ? null : formatClock(m));
    return {
      elevation: sample.sun.elevation,
      azimuth: sample.sun.azimuth,
      declination: sample.sun.declination,
      eqTime: sample.sun.eqTime,
      rise: fmtEvent(riseMin),
      set: fmtEvent(setMin),
      noon: formatClock(localMin(times.solarNoonUtc) ?? 0),
      dayLength: times.dayLength,
      polar: times.polar,
      polarNote,
      setNote: setMin !== null && setMin >= 1440 ? '(next day)' : null,
    };
  }, [times, sample, riseMin, setMin, localMin, date, place.lat, place.lon]);
  const blockedMinutes = useMemo(
    () =>
      horizon.length
        ? day.points.filter((p) => p.elevation > 0 && !p.sunVisible && p.minute < 1440).length * 5
        : 0,
    [day, horizon.length],
  );

  // ---- Annual analysis in the worker ------------------------------------------------------------
  const siteJob: SiteJob = useMemo(
    () => ({ site: siteSpec, year, climate: normals, ambient: pv.ambient, period, panel, pv }),
    [siteSpec, year, normals, pv, period, panel],
  );
  const siteKey = useMemo(
    () => JSON.stringify([siteSpec, year, normals ? climateKey : null, period]),
    [siteSpec, year, normals, climateKey, period],
  );
  const panelJob: PanelJob = useMemo(() => ({ panel, pv, ambient: pv.ambient }), [panel, pv]);
  const panelKey = useMemo(() => JSON.stringify(panelJob), [panelJob]);
  const [runNonce, setRunNonce] = useState(0);
  const analysis = useAnalysis(siteJob, `${siteKey}#${runNonce}`, panelJob, panelKey);
  const result = analysis.result;
  const pctOfOptimum =
    result && analysis.panelEnergy !== null && result.optimum.energy > 0
      ? (analysis.panelEnergy / result.optimum.energy) * 100
      : null;

  // ---- URL sync -------------------------------------------------------------------------------
  const query = useMemo(() => encodeState(state).toString(), [state]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?${query}${window.location.hash}`,
      );
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);
  const shareUrl = `${window.location.origin}${window.location.pathname}?${query}`;

  // ---- Updates ----------------------------------------------------------------------------------
  const introRef = useRef<{ raf: number; done: boolean }>({ raf: 0, done: false });
  const stopIntro = useCallback(() => {
    if (introRef.current.raf) cancelAnimationFrame(introRef.current.raf);
    introRef.current.raf = 0;
    if (!introRef.current.done) {
      introRef.current.done = true;
      document.documentElement.dataset.intro = 'done';
    }
  }, []);

  const userMinutes = useCallback(
    (m: number) => {
      stopIntro();
      setPlaying(false);
      setNightNote(null);
      if (showHint) {
        setShowHint(false);
        writeFlag(HINT_KEY);
      }
      setState((s) => ({ ...s, minutes: m }));
    },
    [showHint, stopIntro],
  );
  const setDate = useCallback(
    (d: CalendarDate) => {
      stopIntro();
      setState((s) => ({ ...s, date: d }));
    },
    [stopIntro],
  );
  const setPlace = useCallback(
    (p: PlaceState) => {
      stopIntro();
      setNightNote(null);
      setState((s) => {
        const flip = s.place.lat >= 0 !== p.lat >= 0;
        return {
          ...s,
          place: p,
          panel: flip ? { ...s.panel, azimuth: mirrorAzimuth(s.panel.azimuth) } : s.panel,
        };
      });
    },
    [stopIntro],
  );
  const setPanel = useCallback(
    (o: { tilt: number; azimuth: number }) => setState((s) => ({ ...s, panel: o })),
    [],
  );
  const setHorizon = useCallback(
    (h: HorizonPoint[]) => setState((s) => ({ ...s, horizon: h })),
    [],
  );
  const setSky = useCallback((k: SkyState) => setState((s) => ({ ...s, sky: k })), []);
  const setPv = useCallback((p: PvState) => setState((s) => ({ ...s, pv: p })), []);
  const goNow = useCallback(() => {
    stopIntro();
    setPlaying(false);
    setNightNote(null);
    const now = new Date();
    setState((s) => {
      const z = utcToZoned(now.getTime(), s.place.timeZone);
      return {
        ...s,
        date: { year: z.year, month: z.month, day: z.day },
        minutes: Math.floor(z.minutes),
      };
    });
  }, [stopIntro]);

  // ---- Play the day ---------------------------------------------------------------------------
  const playRange = useMemo(() => {
    if (times.polar === 'day' || times.polar === 'night') return { start: 0, end: 1439 };
    return {
      start: Math.max(0, Math.ceil(riseMin ?? 0)),
      end: Math.min(1439, Math.floor(setMin ?? 1439)),
    };
  }, [times.polar, riseMin, setMin]);

  const togglePlay = useCallback(() => {
    stopIntro();
    setNightNote(null);
    if (playing) {
      setPlaying(false);
      return;
    }
    const m = stateRef.current.minutes;
    if (m < playRange.start || m >= playRange.end - 1)
      setState((s) => ({ ...s, minutes: playRange.start }));
    setPlaying(true);
  }, [playing, playRange, stopIntro]);

  useEffect(() => {
    if (!playing) return;
    const advance = (delta: number): boolean => {
      const m = stateRef.current.minutes + delta;
      if (m >= playRange.end) {
        setState((s) => ({ ...s, minutes: playRange.end }));
        setPlaying(false);
        return false;
      }
      setState((s) => ({ ...s, minutes: m }));
      return true;
    };
    if (reducedMotion) {
      // Step-wise: one hour per beat, no continuous motion.
      const id = window.setInterval(() => {
        if (!advance(60)) window.clearInterval(id);
      }, 900);
      return () => window.clearInterval(id);
    }
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(t) {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      if (document.visibilityState === 'visible' && !advance(dt * PLAY_RATE)) return;
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, reducedMotion, playRange.end]);

  // ---- Intro: the Sun rises to "now" once the model is on screen --------------------------------
  const onSceneReady = useCallback(() => {
    document.documentElement.dataset.ready = 'true';
    if (bootData.urlHadTime || reducedMotion || introRef.current.done) {
      stopIntro();
      return;
    }
    const target = stateRef.current.minutes;
    const t0 = sunTimesForLocalDate(
      stateRef.current.date,
      stateRef.current.place.lat,
      stateRef.current.place.lon,
      stateRef.current.place.timeZone,
    );
    if (t0.polar || t0.sunriseUtc === null) {
      stopIntro();
      return;
    }
    const start = Math.max(
      0,
      (t0.sunriseUtc - zonedTimeToUtc(stateRef.current.date, 0, stateRef.current.place.timeZone)) /
        60000,
    );
    if (target - start < 30) {
      stopIntro();
      return;
    }
    document.documentElement.dataset.intro = 'running';
    const begin = performance.now();
    const duration = 1800;
    const step = (now: number) => {
      if (introRef.current.done) return;
      const k = Math.min(1, (now - begin) / duration);
      const e = 1 - (1 - k) ** 3;
      setState((s) => ({ ...s, minutes: start + (target - start) * e }));
      if (k < 1) introRef.current.raf = requestAnimationFrame(step);
      else {
        setState((s) => ({ ...s, minutes: target }));
        stopIntro();
      }
    };
    introRef.current.raf = requestAnimationFrame(step);
  }, [bootData.urlHadTime, reducedMotion, stopIntro]);

  useEffect(() => () => stopIntro(), [stopIntro]);

  // ---- Screen-reader summary (debounced) -----------------------------------------------------------
  const [announcement, setAnnouncement] = useState('');
  const poaNow = poa.total;
  useEffect(() => {
    const t = window.setTimeout(() => {
      setAnnouncement(
        `${formatClock(minutes)} in ${place.name}: ${fmt(poaNow, 0)} watts per square metre on the panel, ${fmt(day.total, 2)} kilowatt-hours per square metre over the day (${sourceLabel}).`,
      );
    }, 1000);
    return () => window.clearTimeout(t);
  }, [minutes, poaNow, day.total, place.name, sourceLabel]);

  // ---- Scene ----------------------------------------------------------------------------------
  const sceneState: SceneState = useMemo(
    () => ({
      sunAz: sample.sun.azimuth,
      sunEl: sample.sun.elevation,
      dayPath: path,
      hourMarks: path.filter((p) => p.minute % 60 === 0 && p.minute < 1440),
      pathColor,
      guides,
      panelTilt: panel.tilt,
      panelAz: panel.azimuth,
      horizon,
      southern: place.lat < 0,
    }),
    [sample, path, pathColor, guides, panel, horizon, place.lat],
  );

  const todayDate = localDate(new Date(), place.timeZone);
  const dateLabel = `${date.day} ${MONTH_SHORT[date.month - 1]} ${date.year}`;
  const aoi = (Math.acos(Math.max(-1, Math.min(1, poa.cosAoi))) * 180) / Math.PI;
  const buildCsv = useCallback(
    () =>
      hourlyCsv({
        model,
        year,
        timeZone: place.timeZone,
        panel,
        pv,
        factors,
        climate: normals,
        ambient: pv.ambient,
      }),
    [model, year, place.timeZone, panel, pv, factors, normals],
  );

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to the planner
      </a>
      <Masthead />
      <main id="main">
        <section className="stage" aria-label="Sun study">
          <div className="stage__main">
            <LocationCard
              place={place}
              onPlace={setPlace}
              utc={utc}
              declination={sample.sun.declination}
              eqTime={sample.sun.eqTime}
            />
            <SceneView
              state={sceneState}
              onReady={onSceneReady}
              caption={
                <>
                  <span className="scene__fig">Fig. 1</span>
                  <span>
                    Massing model · {formatLongDate(date)} · {formatClock(minutes)}
                  </span>
                </>
              }
              overlay={
                <div className={`sunchip ${sample.sun.elevation > 0 ? '' : 'is-night'}`}>
                  <span className="sunchip__dot" aria-hidden="true" />
                  {sample.sun.elevation > 0 ? (
                    <>
                      Sun {fmt(sample.sun.elevation, 1)}° up · {fmt(sample.sun.azimuth, 0)}° azimuth
                    </>
                  ) : (
                    <>Sun {fmt(-sample.sun.elevation, 1)}° below the horizon</>
                  )}
                </div>
              }
            />
            {nightNote && (
              <p className="note note--soft stage__note" role="note">
                {nightNote}{' '}
                <button type="button" className="btn btn--link" onClick={goNow}>
                  Show now
                </button>
              </p>
            )}
            <TimeControls
              minutes={minutes}
              onMinutes={userMinutes}
              date={date}
              onDate={setDate}
              daysInYear={daysInYear(year)}
              rise={riseMin}
              set={setMin}
              polar={times.polar}
              solarTime={formatClock(sample.sun.trueSolarTime)}
              playing={playing}
              onTogglePlay={togglePlay}
              onNow={goNow}
              todayDate={todayDate}
              live={`${fmt(poa.total, 0)} W/m²`}
              showHint={showHint}
              sunUpNow={sample.sun.elevation > 0}
            />
          </div>
          <div className="stage__side">
            <LiveReadout
              poaNow={poa.total}
              beam={poa.beam}
              diffuse={poa.skyDiffuse}
              ground={poa.ground}
              aoi={aoi}
              sunVisible={sample.sunVisible}
              dayTotal={day.total}
              dayGhi={day.totalGhi}
              dayLoss={day.totalUnshaded - day.total}
              blockedMinutes={blockedMinutes}
              dayPoints={day.points}
              minute={minutes}
              pathColor={pathColor}
              facts={facts}
              source={sky.source}
              onSource={(src) => setSky({ ...sky, source: src })}
              climate={climateStatus}
              onRetryClimate={() => setClimateRetry((n) => n + 1)}
              dateLabel={dateLabel}
            />
            <PanelCard
              tilt={panel.tilt}
              azimuth={panel.azimuth}
              onChange={setPanel}
              lat={place.lat}
              optimum={result ? result.optimum : null}
              pctOfOptimum={pctOfOptimum}
              periodLabel={`${periodLabel(period, place.lat)}, ${sourceLabel}`}
            />
          </div>
        </section>

        <section className="band" aria-label="Sun path and orientation">
          <Card fig="Fig. 2" title="Sun path and skyline" id="sunpath" className="card--sunpath">
            <SunPathDiagram
              lat={place.lat}
              lon={place.lon}
              timeZone={place.timeZone}
              date={date}
              selectedPath={path}
              sun={{ az: sample.sun.azimuth, el: sample.sun.elevation }}
              declination={times.declination}
              horizon={horizon}
              onHorizonChange={setHorizon}
              timeLabel={formatClock(minutes)}
            />
            <SkylineEditor points={horizon} onChange={setHorizon} />
          </Card>
          <Optimizer
            result={result}
            status={analysis.status}
            progress={analysis.progress}
            stage={analysis.stage}
            error={analysis.error}
            onRetry={() => setRunNonce((n) => n + 1)}
            panel={panel}
            onPanel={setPanel}
            period={period}
            onPeriod={(p) => setState((s) => ({ ...s, period: p }))}
            lat={place.lat}
            year={year}
            sourceLabel={sourceLabel}
          />
        </section>

        <section className="band" aria-label="Strategies and yield">
          <Comparison
            strategies={result?.strategies ?? null}
            unshaded={result?.strategiesUnshaded ?? null}
            yourPanel={analysis.panelEnergy}
            lat={place.lat}
            periodText={periodLabel(period, place.lat)}
            sourceLabel={sourceLabel}
          />
          <PvEstimate
            pv={analysis.pv}
            params={pv}
            onParams={setPv}
            climateTemps={usingClimate}
            isClearSky={!usingClimate}
          />
        </section>

        <section className="band" aria-label="Model settings and export">
          <Atmosphere
            sky={sky}
            onSky={setSky}
            altitude={place.altitude}
            onAltitude={(m) =>
              setState((s) => ({
                ...s,
                place: { ...s.place, altitude: m, presetId: s.place.presetId },
              }))
            }
          />
          <ExportShare
            buildCsv={buildCsv}
            fileName={csvFileName(place.name, year, panel)}
            shareUrl={shareUrl}
          />
        </section>

        <HowItWorks />
      </main>
      <Footer />
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </>
  );
}
