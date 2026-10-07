/**
 * Small world map (Natural Earth 1:110m land via world-atlas, rendered locally with d3-geo).
 * Shows the night side at the selected instant; click to choose a place.
 */
import { geoCircle, geoEquirectangular, geoGraticule, geoPath } from 'd3-geo';
import type { GeoPermissibleObjects } from 'd3-geo';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { PLACES } from '../lib/places';

const W = 360;
const H = 180;

export function WorldMap({
  lat,
  lon,
  utc,
  declination,
  eqTime,
  onPick,
  variant,
}: {
  variant: 'inset' | 'card';
  lat: number;
  lon: number;
  utc: number;
  declination: number;
  eqTime: number;
  onPick: (lat: number, lon: number) => void;
}) {
  const [land, setLand] = useState<GeoPermissibleObjects | null>(null);
  const [failed, setFailed] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let alive = true;
    import('world-atlas/land-110m.json')
      .then((m) => {
        if (!alive) return;
        const topo = (m.default ?? m) as unknown as Topology;
        setLand(feature(topo, topo.objects.land) as unknown as GeoPermissibleObjects);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const projection = useMemo(
    () =>
      geoEquirectangular()
        .scale(W / (2 * Math.PI))
        .translate([W / 2, H / 2])
        .precision(0.2),
    [],
  );
  const path = useMemo(() => geoPath(projection), [projection]);
  const graticule = useMemo(() => path(geoGraticule().step([30, 30])()) ?? '', [path]);

  const night = useMemo(() => {
    const minutesUtc = (((utc / 60000) % 1440) + 1440) % 1440;
    let subLon = (720 - minutesUtc - eqTime) / 4;
    subLon = ((subLon + 540) % 360) - 180;
    const anti: [number, number] = [subLon > 0 ? subLon - 180 : subLon + 180, -declination];
    return {
      night: path(geoCircle().center(anti).radius(90).precision(2)()) ?? '',
      twilight: path(geoCircle().center(anti).radius(96).precision(2)()) ?? '',
      sun: projection([subLon, declination]),
    };
  }, [utc, declination, eqTime, path, projection]);

  const here = projection([lon, lat]);

  const onClick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const ll = projection.invert?.([x, y]);
    if (!ll) return;
    const [lo, la] = ll;
    if (la < -90 || la > 90 || lo < -180 || lo > 180) return;
    onPick(Math.round(la * 100) / 100, Math.round(lo * 100) / 100);
  };

  return (
    <figure className={`worldmap worldmap--${variant}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="World map: click anywhere to choose that place. The shaded area is where it is night at the selected time."
        onPointerUp={onClick}
      >
        <rect width={W} height={H} className="wm-sea" />
        <path d={graticule} className="wm-grat" />
        {land ? (
          <path d={path(land) ?? ''} className="wm-land" />
        ) : (
          !failed && (
            <text x={W / 2} y={H / 2} className="wm-loading" textAnchor="middle">
              Loading map…
            </text>
          )
        )}
        <path d={night.twilight} className="wm-twilight" />
        <path d={night.night} className="wm-night" />
        {PLACES.map((p) => {
          const q = projection([p.lon, p.lat]);
          return q ? <circle key={p.id} cx={q[0]} cy={q[1]} r={1.6} className="wm-preset" /> : null;
        })}
        {night.sun && <circle cx={night.sun[0]} cy={night.sun[1]} r={3.2} className="wm-sun" />}
        {here && (
          <g className="wm-here" transform={`translate(${here[0]} ${here[1]})`}>
            <circle r={5.5} />
            <path d="M-9 0h5M4 0h5M0 -9v5M0 4v5" />
          </g>
        )}
      </svg>
      <figcaption>
        {failed
          ? 'The map outline could not load; coordinates and presets still work.'
          : variant === 'inset'
            ? 'Key map · click to move · shade = night'
            : 'Tap the map to pick a place · shaded = night now · dot = subsolar point'}
      </figcaption>
    </figure>
  );
}
