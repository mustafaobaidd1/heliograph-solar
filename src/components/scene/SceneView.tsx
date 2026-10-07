import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CompassIcon } from '../icons';
import type { HeliographScene, SceneState } from './heliographScene';
import { PlanView } from './PlanView';

type Status = 'loading' | 'ready' | 'fallback';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function SceneView({
  state,
  caption,
  overlay,
  notice,
  inset,
  onReady,
}: {
  state: SceneState;
  caption: ReactNode;
  overlay: ReactNode;
  notice?: ReactNode;
  inset?: ReactNode;
  onReady?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HeliographScene | null>(null);
  const stateRef = useRef(state);
  const [status, setStatus] = useState<Status>('loading');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const readyRef = useRef(onReady);

  useEffect(() => {
    stateRef.current = state;
    readyRef.current = onReady;
  });

  useEffect(() => {
    let cancelled = false;
    if (!webglAvailable()) {
      setReason('WebGL is not available in this browser.');
      setStatus('fallback');
      readyRef.current?.();
      return;
    }
    import('./heliographScene')
      .then(({ HeliographScene }) => {
        if (cancelled || !hostRef.current) return;
        const scene = new HeliographScene(hostRef.current);
        scene.onContextLost = () => {
          setReason('The 3D view lost its graphics context.');
          setStatus('fallback');
        };
        scene.setState(stateRef.current);
        sceneRef.current = scene;
        setStatus('ready');
        readyRef.current?.();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReason(
          err instanceof Error && /webgl/i.test(err.message)
            ? 'WebGL could not start.'
            : 'The 3D view could not load.',
        );
        setStatus('fallback');
        readyRef.current?.();
      });
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setState(state);
  }, [state]);

  useEffect(() => {
    if (status === 'fallback') {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    }
  }, [status]);

  return (
    <div className="scene" data-status={status}>
      <div
        className="scene__host"
        ref={hostRef}
        onPointerDown={() => setTouched(true)}
        onWheel={() => setTouched(true)}
      >
        {status === 'loading' && (
          <div className="scene__skeleton" role="status">
            <svg viewBox="0 0 400 240" aria-hidden="true">
              <ellipse cx="200" cy="170" rx="170" ry="52" />
              <path d="M150 168 v-46 l44 -16 l52 14 v48 M150 122 l52 14 l44 -16 M202 136 v46" />
              <path d="M40 120 Q200 -10 360 120" className="arc" />
            </svg>
            <span>Building the massing model…</span>
          </div>
        )}
        {status === 'fallback' && (
          <div className="scene__fallback">
            <PlanView
              sunAz={state.sunAz}
              sunEl={state.sunEl}
              panelTilt={state.panelTilt}
              panelAz={state.panelAz}
              horizon={state.horizon}
            />
            <p className="scene__note" role="note">
              {reason} Showing a site plan with the same shadows instead — every calculation still
              works.
            </p>
          </div>
        )}
      </div>
      <div className="scene__caption">{caption}</div>
      <div className="scene__overlay">{overlay}</div>
      {notice && <div className="scene__notice">{notice}</div>}
      {inset && <div className="scene__inset">{inset}</div>}
      {status === 'ready' && (
        <>
          <p className={`scene__hint ${touched || notice ? 'is-gone' : ''}`} aria-hidden="true">
            Drag to orbit · scroll or pinch to zoom
          </p>
          <button
            type="button"
            className="btn btn--ghost btn--sm scene__reset"
            onClick={() => sceneRef.current?.resetView()}
          >
            <CompassIcon /> <span className="scene__reset-text">Reset view</span>
          </button>
        </>
      )}
    </div>
  );
}
