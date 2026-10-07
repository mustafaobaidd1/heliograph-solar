/**
 * The 3D "architect's massing model": clay geometry on an engraved compass plate under a sky
 * dome, with the Sun's daily arc, hatched ground shadows and the skyline as blocks.
 * Renders on demand (only when something changes) and pauses with the tab.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { HorizonPoint } from '../../lib/solar/horizon';
import type { SkyPoint } from '../../lib/sunpath';
import { DISC_R, DOME_R, HOUSE, PANEL, skylineBoxes } from './siteModel';
import type { Box } from './siteModel';

const DEG = Math.PI / 180;
const INK = new THREE.Color('#1d1a16');
const CLAY = new THREE.Color('#f2ede3');
const CLAY_SHADE = new THREE.Color('#e3dac9');
const PLATE = new THREE.Color('#ffffff');

export interface SceneState {
  sunAz: number;
  sunEl: number;
  dayPath: SkyPoint[];
  hourMarks: SkyPoint[];
  pathColor: string;
  guides: { points: SkyPoint[]; color: string; dashed: boolean }[];
  panelTilt: number;
  panelAz: number;
  horizon: HorizonPoint[];
  southern: boolean;
}

/** Direction (azimuth clockwise from north, elevation) to a three.js vector (x E, y up, z S). */
function dir(az: number, el: number, r = 1): THREE.Vector3 {
  const ce = Math.cos(el * DEG);
  return new THREE.Vector3(
    r * ce * Math.sin(az * DEG),
    r * Math.sin(el * DEG),
    -r * ce * Math.cos(az * DEG),
  );
}

function compassTexture(): THREE.CanvasTexture {
  const size = 2048;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const mid = size / 2;
  const R = size / 2;
  g.fillStyle = '#f3ede2';
  g.fillRect(0, 0, size, size);
  const ink = (a: number) => `rgba(29, 26, 22, ${a})`;
  g.translate(mid, mid);
  // concentric rings: plate rim, tick band, the dome's horizon circle, faint inner rings
  const domeFrac = DOME_R / DISC_R;
  for (const [r, a, w] of [
    [0.975, 0.55, 3],
    [0.95, 0.3, 2],
    [domeFrac, 0.42, 2.5],
    [domeFrac * 0.62, 0.13, 2],
    [domeFrac * 0.3, 0.13, 2],
  ] as const) {
    g.beginPath();
    g.strokeStyle = ink(a);
    g.lineWidth = w;
    g.arc(0, 0, R * r, 0, Math.PI * 2);
    g.stroke();
  }
  // ticks every 5° in the outer band, longer every 15° and 45°
  for (let a = 0; a < 360; a += 5) {
    const major = a % 45 === 0;
    const mid15 = a % 15 === 0;
    const r0 = R * (major ? 0.895 : mid15 ? 0.91 : 0.925);
    const r1 = R * 0.95;
    const t = a * DEG;
    g.beginPath();
    g.strokeStyle = ink(major ? 0.62 : mid15 ? 0.42 : 0.26);
    g.lineWidth = major ? 4 : mid15 ? 3 : 2;
    g.moveTo(r0 * Math.sin(t), -r0 * Math.cos(t));
    g.lineTo(r1 * Math.sin(t), -r1 * Math.cos(t));
    g.stroke();
  }
  // cardinal spokes, faint
  g.setLineDash([10, 14]);
  g.strokeStyle = ink(0.12);
  g.lineWidth = 2;
  for (let a = 0; a < 360; a += 45) {
    const t = a * DEG;
    g.beginPath();
    g.moveTo(R * 0.3 * Math.sin(t), -R * 0.3 * Math.cos(t));
    g.lineTo(R * (domeFrac - 0.02) * Math.sin(t), -R * (domeFrac - 0.02) * Math.cos(t));
    g.stroke();
  }
  g.setLineDash([]);
  // engraved north arrow on the tick band
  g.fillStyle = ink(0.75);
  g.beginPath();
  g.moveTo(0, -R * 0.965);
  g.lineTo(-R * 0.022, -R * 0.885);
  g.lineTo(R * 0.022, -R * 0.885);
  g.closePath();
  g.fill();
  // azimuth numbers between the dome circle and the tick band
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '30px "Instrument Sans Variable", system-ui, sans-serif';
  g.fillStyle = ink(0.48);
  for (let a = 30; a < 360; a += 30) {
    if (a % 90 === 0) continue;
    g.save();
    g.rotate(a * DEG);
    g.fillText(`${a}°`, 0, -R * 0.862);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function panelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const g = c.getContext('2d')!;
  g.fillStyle = '#26303d';
  g.fillRect(0, 0, 512, 320);
  g.strokeStyle = 'rgba(214, 223, 235, 0.35)';
  g.lineWidth = 3;
  const cols = 10;
  const rows = 6;
  for (let i = 1; i < cols; i++) {
    g.beginPath();
    g.moveTo((512 / cols) * i, 0);
    g.lineTo((512 / cols) * i, 320);
    g.stroke();
  }
  for (let j = 1; j < rows; j++) {
    g.beginPath();
    g.moveTo(0, (320 / rows) * j);
    g.lineTo(512, (320 / rows) * j);
    g.stroke();
  }
  g.strokeStyle = '#d9d3c7';
  g.lineWidth = 14;
  g.strokeRect(0, 0, 512, 320);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(240, 180, 70, 0.55)');
  grad.addColorStop(0.35, 'rgba(240, 180, 70, 0.22)');
  grad.addColorStop(1, 'rgba(240, 180, 70, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** ShadowMaterial drawn as ink hatching in screen space (constant line width at any zoom). */
function hatchedShadowMaterial(pixelRatio: number): THREE.ShadowMaterial {
  const m = new THREE.ShadowMaterial({
    color: INK,
    opacity: 1,
    transparent: true,
    depthWrite: false,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSpacing = { value: 7 * pixelRatio };
    shader.uniforms.uWidth = { value: 1.1 * pixelRatio };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'uniform float opacity;',
        'uniform float opacity;\nuniform float uSpacing;\nuniform float uWidth;',
      )
      .replace(
        'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
        `float shade = 1.0 - getShadowMask();
         float t = (gl_FragCoord.x + gl_FragCoord.y) / uSpacing;
         float d = abs(fract(t) - 0.5) * uSpacing;
         float line = 1.0 - smoothstep(uWidth * 0.5 - 0.5, uWidth * 0.5 + 0.6, d);
         gl_FragColor = vec4( color, opacity * shade * (0.09 + 0.5 * line) );`,
      );
  };
  return m;
}

export class HeliographScene {
  readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly moon: THREE.DirectionalLight;
  private readonly sun: THREE.Mesh;
  private readonly glow: THREE.Sprite;
  private readonly panelPivot = new THREE.Group();
  private readonly pathGroup = new THREE.Group();
  private readonly skylineGroup = new THREE.Group();
  private readonly lineMaterials: LineMaterial[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  private lastPath: SkyPoint[] | null = null;
  private lastGuides: SceneState['guides'] | null = null;
  private lastHorizon: HorizonPoint[] | null = null;
  private southern: boolean | null = null;
  private disposed = false;
  private userMoved = false;
  private readonly labelLayer: HTMLDivElement;
  private readonly labels: { el: HTMLSpanElement; pos: THREE.Vector3 }[] = [];
  onContextLost: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    if (!renderer.getContext()) throw new Error('WebGL context unavailable');
    this.renderer = renderer;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 0);
    this.canvas = renderer.domElement;
    this.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(this.canvas);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost?.();
    });

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.enablePan = false;
    this.controls.minDistance = 17;
    this.controls.maxDistance = 58;
    this.controls.maxPolarAngle = 84 * DEG;
    this.controls.minPolarAngle = 8 * DEG;
    this.controls.target.set(0, 2.2, 0);
    // On touch screens keep vertical swipes for scrolling the page; horizontal drags orbit.
    if (window.matchMedia?.('(pointer: coarse)').matches) this.canvas.style.touchAction = 'pan-y';
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => {
      this.userMoved = true;
    });

    // Cardinal letters as HTML so they stay upright and crisp from any viewpoint.
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'scene__labels';
    this.labelLayer.setAttribute('aria-hidden', 'true');
    for (const [text, az] of [
      ['N', 0],
      ['E', 90],
      ['S', 180],
      ['W', 270],
    ] as const) {
      const el = document.createElement('span');
      el.textContent = text;
      el.className = `scene__cardinal scene__cardinal--${text}`;
      this.labelLayer.appendChild(el);
      this.labels.push({ el, pos: dir(az, 0, DISC_R + 1.05) });
    }
    host.appendChild(this.labelLayer);

    // Lights: soft warm sky fill + the Sun as a shadow-casting key light.
    this.hemi = new THREE.HemisphereLight(0xfff8ec, 0xd9ccb5, 1.15);
    this.scene.add(this.hemi);
    // Soft, shadowless fill after sunset so the paper model reads as moonlit, not dark.
    this.moon = new THREE.DirectionalLight(0xd3dcea, 0);
    this.moon.position.copy(dir(150, 58, 40));
    this.scene.add(this.moon);
    this.sunLight = new THREE.DirectionalLight(0xfff3df, 2.6);
    this.sunLight.castShadow = true;
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.sunLight.shadow.mapSize.set(small ? 1536 : 2048, small ? 1536 : 2048);
    const sc = this.sunLight.shadow.camera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 14;
    sc.bottom = -14;
    sc.near = 1;
    sc.far = 80;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.03;
    this.sunLight.shadow.radius = 3;
    this.scene.add(this.sunLight, this.sunLight.target);

    this.buildPlate(dpr);
    this.buildHouse();
    this.buildDome();
    this.scene.add(this.pathGroup, this.skylineGroup);

    // Sun disc and glow.
    const sunGeo = new THREE.SphereGeometry(0.42, 32, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xe3a22a, toneMapped: false });
    this.sun = new THREE.Mesh(sunGeo, sunMat);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture(),
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
    this.glow = new THREE.Sprite(glowMat);
    this.glow.scale.set(4.2, 4.2, 1);
    this.scene.add(this.sun, this.glow);
    this.disposables.push(sunGeo, sunMat, glowMat, glowMat.map!);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = () => {
    if (document.visibilityState === 'visible') this.requestRender();
  };

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private buildPlate(dpr: number): void {
    const thickness = 0.55;
    const sideGeo = this.track(
      new THREE.CylinderGeometry(DISC_R, DISC_R + 0.08, thickness, 128, 1, true),
    );
    const sideMat = this.track(
      new THREE.MeshStandardMaterial({ color: CLAY_SHADE, roughness: 0.95 }),
    );
    const side = new THREE.Mesh(sideGeo, sideMat);
    side.position.y = -thickness / 2;
    side.receiveShadow = true;

    const topGeo = this.track(new THREE.CircleGeometry(DISC_R, 128));
    const topTex = this.track(compassTexture());
    const topMat = this.track(
      new THREE.MeshStandardMaterial({ color: PLATE, map: topTex, roughness: 0.97 }),
    );
    const top = new THREE.Mesh(topGeo, topMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;

    const hatchMat = this.track(hatchedShadowMaterial(dpr));
    const hatch = new THREE.Mesh(topGeo, hatchMat);
    hatch.rotation.x = -Math.PI / 2;
    hatch.position.y = 0.004;
    hatch.receiveShadow = true;
    hatch.renderOrder = 1;

    const rimMat = this.track(
      new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.35 }),
    );
    const ring = new THREE.LineLoop(
      this.track(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 256 }, (_, i) => dir((i * 360) / 256, 0, DISC_R)),
        ),
      ),
      rimMat,
    );
    ring.position.y = 0.002;
    const ring2 = ring.clone();
    ring2.position.y = -thickness;
    this.scene.add(side, top, hatch, ring, ring2);
  }

  private boxMesh(b: Box, mat: THREE.Material, edgeMat: THREE.LineBasicMaterial): THREE.Group {
    const g = new THREE.Group();
    const geo = this.track(new THREE.BoxGeometry(b.w, b.h, b.d));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const edges = new THREE.LineSegments(this.track(new THREE.EdgesGeometry(geo)), edgeMat);
    g.add(mesh, edges);
    g.position.set(b.x, b.y0 + b.h / 2, b.z);
    if (b.rot) g.rotation.y = b.rot;
    return g;
  }

  private buildHouse(): void {
    const clay = this.track(new THREE.MeshStandardMaterial({ color: CLAY, roughness: 0.9 }));
    const roof = this.track(new THREE.MeshStandardMaterial({ color: 0xf6f2ea, roughness: 0.88 }));
    const edge = this.track(
      new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.6 }),
    );
    for (const b of HOUSE) this.scene.add(this.boxMesh(b, b.kind === 'roof' ? roof : clay, edge));

    // Openings: shallow dark insets on the main volume suggest windows without colour.
    const insetMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x6f675c, roughness: 0.6 }),
    );
    const insetGeo = this.track(new THREE.BoxGeometry(0.7, 1.1, 0.04));
    const southZ = 0.1 + 3.4 / 2 + 0.005;
    for (const x of [-2.0, -0.9, 0.2]) {
      const m = new THREE.Mesh(insetGeo, insetMat);
      m.position.set(x, 1.35, southZ);
      m.receiveShadow = true;
      this.scene.add(m);
    }
    const doorGeo = this.track(new THREE.BoxGeometry(0.85, 1.25, 0.04));
    const door = new THREE.Mesh(doorGeo, insetMat);
    door.position.set(2.35, 0.63, 0.75 + 2.3 / 2 + 0.005);
    this.scene.add(door);

    // Panel on a pedestal mount so any tilt/azimuth is physically plausible.
    const metal = this.track(
      new THREE.MeshStandardMaterial({ color: 0xbfb8ab, roughness: 0.55, metalness: 0.2 }),
    );
    const postGeo = this.track(new THREE.CylinderGeometry(0.07, 0.09, PANEL.post, 16));
    const post = new THREE.Mesh(postGeo, metal);
    post.position.set(PANEL.x, 2.84 + PANEL.post / 2, PANEL.z);
    post.castShadow = true;
    const baseGeo = this.track(new THREE.CylinderGeometry(0.28, 0.32, 0.08, 24));
    const base = new THREE.Mesh(baseGeo, metal);
    base.position.set(PANEL.x, 2.88, PANEL.z);
    base.castShadow = true;
    base.receiveShadow = true;
    this.scene.add(post, base);

    const panelGeo = this.track(new THREE.BoxGeometry(PANEL.w, 0.07, PANEL.d));
    const panelTex = this.track(panelTexture());
    const face = this.track(
      new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.35, metalness: 0.1 }),
    );
    const frame = this.track(new THREE.MeshStandardMaterial({ color: 0xd9d3c7, roughness: 0.6 }));
    // Box faces: +x, −x, +y (top), −y, +z, −z
    const panel = new THREE.Mesh(panelGeo, [frame, frame, face, frame, frame, frame]);
    panel.castShadow = true;
    panel.receiveShadow = true;
    const pEdges = new THREE.LineSegments(this.track(new THREE.EdgesGeometry(panelGeo)), edge);
    this.panelPivot.add(panel, pEdges);
    this.panelPivot.position.set(PANEL.x, PANEL.y, PANEL.z);
    this.scene.add(this.panelPivot);
  }

  private buildDome(): void {
    const mat = this.track(
      new THREE.LineDashedMaterial({
        color: INK,
        transparent: true,
        opacity: 0.2,
        dashSize: 0.32,
        gapSize: 0.26,
      }),
    );
    const solid = this.track(
      new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.16 }),
    );
    const add = (pts: THREE.Vector3[], dashed: boolean) => {
      const geo = this.track(new THREE.BufferGeometry().setFromPoints(pts));
      const line = new THREE.Line(geo, dashed ? mat : solid);
      if (dashed) line.computeLineDistances();
      this.scene.add(line);
    };
    for (const el of [30, 60]) {
      add(
        Array.from({ length: 181 }, (_, i) => dir(i * 2, el, DOME_R)),
        true,
      );
    }
    for (const az of [0, 90]) {
      add(
        Array.from({ length: 91 }, (_, i) => {
          const t = i * 2; // 0..180 across the sky
          return t <= 90 ? dir(az, t, DOME_R) : dir(az + 180, 180 - t, DOME_R);
        }),
        true,
      );
    }
  }

  private makeLine(
    points: SkyPoint[],
    color: string,
    width: number,
    dashed: boolean,
    opacity = 1,
  ): Line2 | null {
    const visible = points.filter((p) => p.el > -0.5);
    if (visible.length < 2) return null;
    const pos: number[] = [];
    for (const p of visible) {
      const v = dir(p.az, Math.max(p.el, 0), DOME_R);
      pos.push(v.x, v.y, v.z);
    }
    const geo = new LineGeometry();
    geo.setPositions(pos);
    const mat = new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth: width,
      dashed,
      dashSize: 0.35,
      gapSize: 0.28,
      transparent: opacity < 1,
      opacity,
      worldUnits: false,
    });
    mat.resolution.set(this.renderer.domElement.width, this.renderer.domElement.height);
    const line = new Line2(geo, mat);
    if (dashed) line.computeLineDistances();
    this.lineMaterials.push(mat);
    return line;
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mt of mats) {
          const i = this.lineMaterials.indexOf(mt as LineMaterial);
          if (i >= 0) this.lineMaterials.splice(i, 1);
          mt.dispose();
        }
      });
    }
  }

  private updatePaths(s: SceneState): void {
    if (s.dayPath === this.lastPath && s.guides === this.lastGuides) return;
    this.lastPath = s.dayPath;
    this.lastGuides = s.guides;
    this.clearGroup(this.pathGroup);
    for (const g of s.guides) {
      const l = this.makeLine(g.points, g.color, 1.15, g.dashed, 0.55);
      if (l) this.pathGroup.add(l);
    }
    const main = this.makeLine(s.dayPath, s.pathColor, 3.2, false);
    if (main) this.pathGroup.add(main);
    const dotGeo = new THREE.SphereGeometry(0.11, 12, 8);
    const dotMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(s.pathColor),
      toneMapped: false,
    });
    for (const h of s.hourMarks) {
      if (h.el <= 0) continue;
      const m = new THREE.Mesh(dotGeo, dotMat);
      m.position.copy(dir(h.az, h.el, DOME_R));
      this.pathGroup.add(m);
    }
  }

  private updateSkyline(points: HorizonPoint[]): void {
    if (points === this.lastHorizon) return;
    this.lastHorizon = points;
    this.clearGroup(this.skylineGroup);
    const boxes = skylineBoxes(points);
    if (!boxes.length) return;
    // Context massing is drawn ghosted so it never hides the model; it still casts real shadows.
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd9cfbd,
      roughness: 0.95,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const edge = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.5 });
    for (const b of boxes) {
      const g = new THREE.Group();
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh, new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge));
      g.position.set(b.x, b.h / 2, b.z);
      g.rotation.y = b.rot ?? 0;
      this.skylineGroup.add(g);
    }
  }

  /** Key points that must stay in frame: the plate rim (top and bottom edge) and the dome. */
  private framePoints(): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    for (let a = 0; a < 360; a += 22.5) {
      pts.push(dir(a, 0, DISC_R + 1.4));
      const low = dir(a, 0, DISC_R);
      low.y = -0.6;
      pts.push(low);
      pts.push(dir(a, 45, DOME_R));
    }
    pts.push(new THREE.Vector3(0, DOME_R + 0.6, 0));
    return pts;
  }

  /** Places the camera on a viewing direction at the smallest distance that frames the model. */
  private fitCamera(az: number, el: number): void {
    const target = new THREE.Vector3(0, 2.3, 0);
    const d0 = dir(az, el, 1);
    const pts = this.framePoints();
    const v = new THREE.Vector3();
    const fits = (dist: number): boolean => {
      this.camera.position.copy(target).addScaledVector(d0, dist);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      for (const p of pts) {
        v.copy(p).project(this.camera);
        if (v.z > 1 || Math.abs(v.x) > 0.93 || Math.abs(v.y) > 0.88) return false;
      }
      return true;
    };
    let lo = 12;
    let hi = 160;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    fits(hi);
    this.controls.target.copy(target);
    this.controls.minDistance = hi * 0.5;
    this.controls.maxDistance = hi * 1.7;
    this.controls.update();
  }

  private placeCamera(southern: boolean): void {
    // Look from the equator side, a little west of it, so lit facades and shadows both show.
    this.fitCamera(southern ? 28 : 208, 29);
  }

  resetView(): void {
    this.userMoved = false;
    this.placeCamera(this.southern ?? false);
    this.requestRender();
  }

  setState(s: SceneState): void {
    if (this.disposed) return;
    if (this.southern !== s.southern) {
      this.southern = s.southern;
      this.placeCamera(s.southern);
    }
    // Sun, light and sky colour
    const up = s.sunEl > -0.3;
    const sunPos = dir(s.sunAz, Math.max(s.sunEl, -2), DOME_R);
    this.sun.position.copy(sunPos);
    this.glow.position.copy(sunPos);
    this.sun.visible = s.sunEl > -0.6;
    this.glow.visible = this.sun.visible;
    const lightDir = dir(s.sunAz, Math.max(s.sunEl, 0.5), 40);
    this.sunLight.position.copy(lightDir);
    this.sunLight.target.position.set(0, 0, 0);
    const lowSun = THREE.MathUtils.clamp(s.sunEl / 25, 0, 1);
    const warm = new THREE.Color(0xffb46e).lerp(new THREE.Color(0xfff4e2), lowSun);
    this.sunLight.color.copy(warm);
    this.sunLight.intensity = up ? 2.65 * THREE.MathUtils.smoothstep(s.sunEl, -0.3, 6) : 0;
    this.sunLight.castShadow = up;
    const day = THREE.MathUtils.smoothstep(s.sunEl, -8, 4);
    this.hemi.intensity = 1.35 - 0.2 * day;
    this.moon.intensity = 1.5 * (1 - day);
    this.hemi.color.set(0xd9e0ec).lerp(new THREE.Color(0xfff8ec), day);
    this.hemi.groundColor.set(0xa49d92).lerp(new THREE.Color(0xd9ccb5), day);
    this.host.dataset.night = s.sunEl < -0.3 ? 'true' : 'false';

    // Panel orientation: tilt about local x, then heading about y (see docs in siteModel).
    this.panelPivot.rotation.set(s.panelTilt * DEG, (180 - s.panelAz) * DEG, 0, 'YXZ');

    this.updatePaths(s);
    this.updateSkyline(s.horizon);
    this.requestRender();
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.fov = 30;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved && this.southern !== null) this.placeCamera(this.southern);
    for (const m of this.lineMaterials) m.resolution.set(this.canvas.width, this.canvas.height);
    this.requestRender();
  }

  requestRender(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    this.frame = 0;
    if (this.disposed) return;
    const moving = this.controls.update();
    for (const m of this.lineMaterials) m.resolution.set(this.canvas.width, this.canvas.height);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    if (moving) this.requestRender();
  };

  private readonly tmp = new THREE.Vector3();

  private updateLabels(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    for (const l of this.labels) {
      this.tmp.copy(l.pos).project(this.camera);
      const visible = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.1 && Math.abs(this.tmp.y) < 1.1;
      l.el.style.opacity = visible ? '1' : '0';
      l.el.style.transform = `translate(${((this.tmp.x + 1) / 2) * w}px, ${((1 - this.tmp.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearGroup(this.pathGroup);
    this.clearGroup(this.skylineGroup);
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.labelLayer.remove();
  }
}
