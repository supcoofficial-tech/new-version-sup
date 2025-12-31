// City Sim — Agents + FOV + Shadows (API Sun) — TypeScript Port
// Usage: import { initCitySim } from "./lib/citySim"; then call initCitySim(hostDiv)
// Deps: npm i three

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// ---------------------- DOM + CSS bootstrap ----------------------
function mountUI(parent: HTMLElement = document.body) {
  const style = document.createElement('style');
  style.textContent = `
    html,body{margin:0;height:100%;overflow:hidden;background:#0b1120;color:#e5e7eb;font-family:IRANSans,system-ui}
    #toast{position:fixed;top:10px;right:10px;background:#111827;color:#fee2e2;padding:8px 12px;border-radius:8px;border:1px solid #7f1d1d;display:none;white-space:pre-wrap;z-index:20}
    #ui{position:fixed;left:10px;bottom:10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;z-index:15}
    .btn{padding:8px 12px;border-radius:10px;border:1px solid #0f172a;background:#111827;color:#e5e7eb;cursor:pointer}
    label{display:inline-flex;align-items:center;gap:6px}
    input[type="range"]{width:140px}
    input[type="number"], input[type="text"]{width:140px}
  `;
  document.head.appendChild(style);

  const toast = document.createElement('div');
  toast.id = 'toast';
  parent.appendChild(toast);

  const ui = document.createElement('div');
  ui.id = 'ui';
  ui.innerHTML = `
    <button id="recenter" class="btn">مرکز</button>
    <button id="zoomfit" class="btn">🔍 فیت صحنه</button>
    <button id="changeRoutes" class="btn">🔁 مسیر جدید</button>
    <button id="pause" class="btn">⏯️ توقف</button>

    <label>سرعت
      <input id="speed" type="range" min="0.3" max="5.0" step="0.1" value="1.0">
    </label>
    <label>زوم
      <input id="zoom" type="range" min="30" max="600" step="10" value="180">
    </label>
    <label>زاویه دید
      <input id="fov" type="range" min="80" max="100" step="5" value="100">
    </label>
    <label>عمق دید
      <input id="viewDepth" type="range" min="0" max="40" step="2" value="40">
    </label>

    <label>چرخش
      <input id="cityRot" type="range" min="-30" max="30" step="0.5" value="0">
    </label>
    <label>مقیاس افقی
      <input id="cityScale" type="range" min="0.85" max="1.10" step="0.005" value="1.00">
    </label>
    <label>جابجایی X
      <input id="cityTX" type="range" min="-12" max="12" step="0.1" value="0">
    </label>
    <label>جابجایی Z
      <input id="cityTZ" type="range" min="-12" max="12" step="0.1" value="0">
    </label>
    <button id="autoTighten" class="btn">اتو-جمع ⤵️</button>
    <button id="toggleLU" class="btn">کاربری ☐/☑</button>
    <button id="togglePercept" class="btn">👁️ حالت ادراکی: خاموش</button>

    <label>lat
      <input id="lat" type="number" step="0.0001" value="35.6892">
    </label>
    <label>lon
      <input id="lon" type="number" step="0.0001" value="51.3890">
    </label>
    <label>زمان (ISO)
      <input id="whenISO" type="text" value="2025-10-11T12:00:00Z">
    </label>
    <button id="sunApi" class="btn">☀️ خورشید از API</button>
    <button id="sunApply" class="btn">↘️ خورشید دستی</button>

    <label>FOV Mesh
      <input id="toggleFOVSurf" type="checkbox" checked>
    </label>
    <label>وزن سایه
      <input id="shadeW" type="range" min="0" max="1" step="0.05" value="0.8">
    </label>
  `;
  parent.appendChild(ui);
}

function $(id: string) { return document.getElementById(id)!; }
function $input(id: string) { return document.getElementById(id) as HTMLInputElement; }

// ---------------------- ASSET PATHS ----------------------
const CANDIDATES = ['/city-sim/assets', '/assets'];
async function pickBase(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    try { const r = await fetch(p + '/Lines_Edges.geojson', { method: 'HEAD' }); if (r.ok) return p; }
    catch { /* noop */ }
  }
  return null;
}
let ASSET_BASE: string | null = null;

// ---------------------- Scene / Renderer ----------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b1120');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 5000);
camera.position.set(0, 180, 360);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 30;
controls.maxDistance = 600;

// ---------------------- Lights ----------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const dir = new THREE.DirectionalLight(0xffffff, 1.65);
dir.position.set(160, 300, 160);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.near = 1;
dir.shadow.camera.far = 3000;
dir.shadow.camera.left = -800;
dir.shadow.camera.right = 800;
dir.shadow.camera.top = 800;
dir.shadow.camera.bottom = -800;
scene.add(dir);
scene.add(dir.target);

// ---------------------- Ground (procedural) ----------------------
function makeAsphaltCanvas(size = 512, seed = 1337, base = '#c0c0c0'): HTMLCanvasElement {
  const rnd = (() => { let x = seed >>> 0; return () => (x = (1664525 * x + 1013904223) >>> 0) / 0xFFFFFFFF; })();
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size); const d = img.data; const octaves = 3;
  for (let o = 0; o < octaves; o++) {
    const step = Math.pow(2, o + 3), amp = 14 / (o + 1);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const nx = Math.floor(x / step), ny = Math.floor(y / step);
      const v = (nx * 928371 + ny * 364479 + o * 1337) % 9973; const n = ((v / 9973) - 0.5) * 2; const i = (y * size + x) * 4;
      d[i] += n * amp; d[i + 1] += n * amp; d[i + 2] += n * amp;
    }
  }
  const speckles = Math.floor(size * size * 0.0025);
  for (let k = 0; k < speckles; k++) {
    const x = Math.floor(rnd() * size), y = Math.floor(rnd() * size); const i = (y * size + x) * 4; const s = (rnd() < 0.5 ? -1 : +1) * (20 + rnd() * 35);
    d[i] += s; d[i + 1] += s; d[i + 2] += s;
  }
  ctx.putImageData(img, 0, 0); return c;
}

const asphaltCanvas = makeAsphaltCanvas(512, 2025, '#c8c8c8');
const asphaltTex = new THREE.CanvasTexture(asphaltCanvas);
asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
asphaltTex.repeat.set(80, 80);
asphaltTex.colorSpace = THREE.SRGBColorSpace;

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.9, metalness: 0.03 })
);
ground.rotation.x = -Math.PI / 2; ground.position.y = 0;
ground.receiveShadow = true;
scene.add(ground);

// ---------------------- Utils ----------------------
const toast = () => $('toast');
const oops = (msg: string) => { toast().textContent = msg; (toast().style as any).display = 'block'; console.error(msg); };

const isLonLat = (p: [number, number]) => Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const webMercatorToLonLat = (x: number, y: number) => { const lon = x / 6378137 * 180 / Math.PI; const lat = (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI; return [lon, lat] as [number, number]; };
const makeLLToLocal = (coords: Array<[number, number]>) => {
  const ll = coords.map(([x, y]) => isLonLat([x, y]) ? [x, y] as [number, number] : webMercatorToLonLat(x, y) as [number, number]);
  let lon0 = 0, lat0 = 0, n = 0; for (const [lon, lat] of ll) { if (isFinite(lon) && isFinite(lat)) { lon0 += lon; lat0 += lat; n++; } } lon0 /= n || 1; lat0 /= n || 1;
  const mLat = 111320, mLon = 111320 * Math.cos(THREE.MathUtils.degToRad(lat0 || 35));
  return (lon: number, lat: number) => new THREE.Vector3((lon - lon0) * mLon, 0, -(lat - lat0) * mLat);
};

function getXZBox(obj: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(obj);
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, centerX: (box.min.x + box.max.x) / 2, centerZ: (box.min.z + box.max.z) / 2 };
}

// ---------------------- Roads ----------------------
const roadMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0.0 });
function tubeFromPoints(points: THREE.Vector3[], r = 0.5) {
  if (points.length < 2) return null as any;
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0);
  const segs = Math.max(80, Math.floor(points.length * 3));
  const geom = new THREE.TubeGeometry(curve, segs, r, 12, false);
  const mesh = new THREE.Mesh(geom, roadMat);
  mesh.position.y = 0.06; (mesh as any).userData.isRoad = true; mesh.castShadow = true; mesh.receiveShadow = true; return { mesh, curve };
}

// ---------------------- Landuse (palette) ----------------------
const LU_COLORS: Record<string, string> = { "01": "#e31a1c", "02": "#fb9a99", "03": "#1f78b4", "04": "#a6cee3", "05": "#33a02c", "06": "#b2df8a", "07": "#ff7f00", "08": "#fdbf6f", "09": "#6a3d9a", "10": "#cab2d6", "11": "#b15928" };
const LU_FALLBACK = '#d9d9d9';

function polygonToShapes(polyCoordsLL: number[][][], N: (v: THREE.Vector3) => THREE.Vector3, llToLocal: (lon: number, lat: number) => THREE.Vector3) {
  const rings = polyCoordsLL.map(ring => {
    const pts = ring.map(([lon, lat]) => {
      const ll = isLonLat([lon, lat]) ? [lon, lat] : webMercatorToLonLat(lon, lat);
      const p3 = N(llToLocal(ll[0], ll[1]));
      return new THREE.Vector2(p3.x, p3.z);
    });
    return pts;
  });
  const shape = new THREE.Shape(rings[0]);
  for (let i = 1; i < rings.length; i++) shape.holes.push(new THREE.Path(rings[i]));
  return [shape];
}

function drawLanduse(gj: any, N: (v: THREE.Vector3) => THREE.Vector3, llToLocal: (lon: number, lat: number) => THREE.Vector3) {
  const group = new THREE.Group();
  for (const f of (gj.features || []) as any[]) {
    const g = f.geometry; if (!g) continue;
    const codeRaw = f.properties?.Landuse ?? f.properties?.code ?? f.properties?.final ?? f.properties?.LanduseFinal ?? "";
    const code = String(codeRaw).padStart(2, '0');
    const col = LU_COLORS[code] || LU_COLORS[codeRaw] || LU_FALLBACK;
    const polys = (g.type === 'Polygon') ? [g.coordinates] : (g.type === 'MultiPolygon') ? g.coordinates : [];
    for (const poly of polys) {
      const shapes = polygonToShapes(poly, N, llToLocal);
      for (const sh of shapes) {
        const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.18, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat); mesh.position.y = 0.01; mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
        const edges = new THREE.EdgesGeometry(geo);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#ffffff' }));
        line.position.copy(mesh.position); group.add(line);
      }
    }
  }
  group.renderOrder = 1; return group;
}

// ---------------------- Sun helpers (API/local) ----------------------
const raycaster = new THREE.Raycaster();
const LIGHT_TO_POS = new THREE.Vector3();
function computeLightDir() {
  const toScene = new THREE.Vector3().copy(dir.target.position).sub(dir.position).normalize();
  LIGHT_TO_POS.copy(toScene).negate();
}
computeLightDir();

function setSunByAzAlt(azDeg: number, altDeg: number) {
  const az = THREE.MathUtils.degToRad(azDeg);
  const alt = THREE.MathUtils.degToRad(altDeg);
  const R = 1200;
  const x = R * Math.cos(alt) * Math.sin(az);
  const y = R * Math.sin(alt);
  const z = R * Math.cos(alt) * Math.cos(az);
  dir.position.set(x, y, z);
  dir.target.position.set(0, 0, 0);
  dir.target.updateMatrixWorld();
  computeLightDir();
}

function enableShadowOn(obj: THREE.Object3D) {
  (obj as any).traverse?.((n: any) => {
    if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; }
  });
}

async function fetchSunAzAltFromAPI(lat: number, lon: number, whenISO: string): Promise<{ azimuth: number, altitude: number } | null> {
  // Placeholder for real API
  return null;
}

function solarPositionLocal(lat: number, lon: number, whenISO: string) {
  const d = new Date(whenISO);
  if (isNaN(d as any)) return { azimuth: 160, altitude: 45 };
  const time = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate() + time / 24;
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  const JDN = day + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
  const JD = JDN;
  const T = (JD - 2451545.0) / 36525.0;

  const L0 = (280.46646 + 36000.76983 * T + 0.0003032 * T * T) % 360;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(THREE.MathUtils.degToRad(M))
    + (0.019993 - 0.000101 * T) * Math.sin(THREE.MathUtils.degToRad(2 * M))
    + 0.000289 * Math.sin(THREE.MathUtils.degToRad(3 * M));
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(THREE.MathUtils.degToRad(omega));

  const epsilon0 = 23.439291 - 0.0130042 * T;
  const epsilon = epsilon0 + 0.00256 * Math.cos(THREE.MathUtils.degToRad(omega));

  const sinDec = Math.sin(THREE.MathUtils.degToRad(epsilon)) * Math.sin(THREE.MathUtils.degToRad(lambda));
  const decl = Math.asin(sinDec);

  const yE = Math.tan(THREE.MathUtils.degToRad(epsilon / 2));
  const yE2 = yE * yE;
  let EoT = 4 * THREE.MathUtils.radToDeg(
    yE2 * Math.sin(2 * THREE.MathUtils.degToRad(L0))
    - 2 * e * Math.sin(THREE.MathUtils.degToRad(M))
    + 4 * e * yE2 * Math.sin(THREE.MathUtils.degToRad(M)) * Math.cos(2 * THREE.MathUtils.degToRad(L0))
    - 0.5 * yE2 * yE2 * Math.sin(4 * THREE.MathUtils.degToRad(L0))
    - 1.25 * e * e * Math.sin(2 * THREE.MathUtils.degToRad(M))
  );
  const trueSolarTimeMin = (((d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60) + (EoT + 4 * lon)) % (1440));
  const H = THREE.MathUtils.degToRad((trueSolarTimeMin / 4 < 0 ? trueSolarTimeMin / 4 + 180 : trueSolarTimeMin / 4 - 180));

  const latR = THREE.MathUtils.degToRad(lat);
  const alt = Math.asin(Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(H));
  const az = Math.acos((Math.sin(decl) - Math.sin(alt) * Math.sin(latR)) / (Math.cos(alt) * Math.cos(latR)));
  let azDeg = THREE.MathUtils.radToDeg(az);
  if (Math.sin(H) > 0) azDeg = 360 - azDeg; // north-clockwise
  const altDeg = THREE.MathUtils.radToDeg(alt);
  return { azimuth: azDeg, altitude: altDeg };
}

async function applySunFromInputs(useAPI = true) {
  const lat = parseFloat($input('lat').value);
  const lon = parseFloat($input('lon').value);
  const whenISO = $input('whenISO').value;
  let res: { azimuth: number, altitude: number } | null = null;
  if (useAPI) { try { res = await fetchSunAzAltFromAPI(lat, lon, whenISO); } catch {} }
  if (!res) { res = solarPositionLocal(lat, lon, whenISO); }
  setSunByAzAlt(res.azimuth, res.altitude);
}

// ---------------------- Perception & openness ----------------------
function illuminationAt(pos: THREE.Vector3) {
  const origin = new THREE.Vector3(pos.x, pos.y + 1.5, pos.z);
  raycaster.set(origin, LIGHT_TO_POS);
  const hits = raycaster.intersectObject(worldGroupForFit, true);
  const occluded = hits.length > 0 && hits[0].distance < 500;
  const base = 0.35;
  return occluded ? base : 1.0;
}

function opennessAhead(pos: THREE.Vector3, dirVec: THREE.Vector3, maxDist = 6) {
  const origin = new THREE.Vector3(pos.x, pos.y + 0.6, pos.z);
  const fwd = dirVec.clone().normalize();
  raycaster.set(origin, fwd);
  const hit = raycaster.intersectObject(worldGroupForFit, true)[0];
  if (!hit) return 1.0;
  const d = hit.distance;
  return THREE.MathUtils.clamp(d / maxDist, 0.0, 1.0);
}

function coneFOVMeshSafe(length = 40, halfAngleDeg = 70, color = '#ffff00', opacity = 0.25, radialSegments = 32) {
  const L = Math.max(0.1, parseFloat(String(length)) || 40);
  const hDeg = Math.max(1, Math.min(85, parseFloat(String(halfAngleDeg)) || 70));
  const segs = Math.max(8, (radialSegments | 0) || 32);
  const r = Math.tan(THREE.MathUtils.degToRad(hDeg)) * L;
  let geo: THREE.BufferGeometry;
  try {
    const g = new THREE.ConeGeometry(r, L, segs, 1, false); g.rotateX(-Math.PI / 2); g.translate(0, 0, L / 2); geo = g;
  } catch {
    const g = new THREE.CylinderGeometry(0, r, L, segs, 1, false); g.rotateX(-Math.PI / 2); g.translate(0, 0, L / 2); geo = g;
  }
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(geo, mat); (cone.material as THREE.Material).depthTest = false; (cone.material as THREE.Material).depthWrite = false; (cone as any).renderOrder = 21; return cone;
}

function shadeScoreAlongYaw(pos: THREE.Vector3, yaw: number, samples = 6, lookAhead = 6) {
  const originY = 1.3;
  let shaded = 0, total = 0;
  const dirMove = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  for (let i = 1; i <= samples; i++) {
    total++;
    const t = (i / samples) * lookAhead;
    const sample = new THREE.Vector3().copy(pos).addScaledVector(dirMove, t);
    const rayFrom = new THREE.Vector3(sample.x, sample.y + originY, sample.z);
    raycaster.set(rayFrom, LIGHT_TO_POS);
    const hit = raycaster.intersectObject(worldGroupForFit, true)[0];
    if (hit && hit.distance < 500) shaded++;
  }
  return total > 0 ? shaded / total : 0;
}

// ---------------------- Agents ----------------------
const agents: Agent[] = []; let paused = false;

class Agent {
  public baseSpeed: number;
  public speed: number;
  public fovHalfAngle: number;
  public fovRadius: number;
  public headingOffset: number;
  public curve: any;
  private _curveLength: number;
  public u: number;
  public mode: 'curve' | 'percept';
  public root: THREE.Group;
  public mesh: THREE.Object3D;
  public headOffset: number;
  public fov: THREE.Mesh | null;
  public fovSurf: THREE.Mesh;
  public hitGroup: THREE.Group;
  public yaw: number;
  public perceptPos: THREE.Vector3 | null;
  public bodyYOffset: number;

  constructor(mesh?: THREE.Object3D, curve?: any, baseSpeed?: number, fovHalfAngle = 70, scale = 0.6, fovRadius = 40, headingOffsetDeg = 0) {
    if (!mesh || !(mesh as any).isObject3D) {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 16), new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.6, metalness: 0 }));
    }
    if (!curve || !(curve as any).getPointAt) {
      curve = new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
    }
    this.baseSpeed = baseSpeed || 20;
    this.speed = this.baseSpeed;
    this.fovHalfAngle = fovHalfAngle;
    this.fovRadius = fovRadius;
    this.headingOffset = THREE.MathUtils.degToRad(headingOffsetDeg);
    this.curve = curve;
    this._curveLength = (curve?.getLength?.() || 1);
    this.u = Math.random();
    this.mode = 'curve';

    this.root = new THREE.Group();
    scene.add(this.root);

    (mesh as any).scale?.setScalar(scale);
    (mesh as any).up?.set(0, 1, 0);
    (mesh as any).traverse?.((n: any) => {
      if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; }
      if (n.isMesh && n.material) {
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        mats.forEach((m: any) => { if (m) { m.depthTest = false; m.depthWrite = false; m.transparent = true; } });
      }
      if (n.renderOrder !== undefined) n.renderOrder = 20;
    });

    const preBox = new THREE.Box3().setFromObject(mesh);
    const preCent = preBox.getCenter(new THREE.Vector3());
    (mesh as any).position?.set(-preCent.x, -preBox.min.y, -preCent.z);
    this.bodyYOffset = 0.45; (mesh as any).position.y += this.bodyYOffset;
    this.root.add(mesh); this.mesh = mesh;

    let head = 1.0; try { const box2 = new THREE.Box3().setFromObject(mesh); const size2 = box2.getSize(new THREE.Vector3()); if (isFinite(size2.y) && size2.y > 0) head = Math.max(0.5, size2.y * 0.9); } catch {}
    this.headOffset = head;

    this.fov = this._makeFOV(); this.root.add(this.fov); this._placeFOV();
    this.fovSurf = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#ffee88', transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
    (this.fovSurf as any).renderOrder = 22; this.fovSurf.visible = true; this.root.add(this.fovSurf);
    this.hitGroup = new THREE.Group(); this.root.add(this.hitGroup);

    this.yaw = 0; this.perceptPos = null;
  }

  private _makeFOV() { return coneFOVMeshSafe(this.fovRadius, this.fovHalfAngle, '#ffff00', 0.25, 40); }
  private _placeFOV() { if (!this.fov) return; (this.fov as any).position?.set(0, this.headOffset, 0); (this.fov as any).rotation?.set(0, 0, 0); }
  private _disposeFOV() { if (!this.fov) return; (this.fov as any).traverse?.((n: any) => { if (n.isMesh) { n.geometry?.dispose?.(); const mats = Array.isArray(n.material) ? n.material : [n.material]; mats.forEach((m: any) => m?.dispose?.()); } }); (this.fov as any).removeFromParent?.(); this.fov = null; }

  setSpeedFactor(k: number) { this.speed = (this.baseSpeed || 1) * (parseFloat(String(k)) || 1); }
  setFOVTotalDeg(d: number) { const deg = parseFloat(String(d)); if (!isFinite(deg)) return; this.fovHalfAngle = deg / 2; this._disposeFOV(); this.fov = this._makeFOV(); this.root.add(this.fov); this._placeFOV(); }
  setFOVRadius(r: number) { const rad = parseFloat(String(r)); if (!isFinite(rad)) return; this.fovRadius = rad; this._disposeFOV(); this.fov = this._makeFOV(); this.root.add(this.fov); this._placeFOV(); }
  setCurve(c: any) { if (!c) return; this.curve = c; this._curveLength = (c?.getLength?.() || 1); this.u = Math.random(); }

  enablePerceptual(flag: boolean) {
    this.mode = flag ? 'percept' : 'curve';
    if (flag && !this.perceptPos) {
      const seed = this.curve?.getPointAt ? this.curve.getPointAt(this.u) : new THREE.Vector3();
      this.perceptPos = seed.clone();
      if (this.curve?.getTangentAt) {
        const tan = this.curve.getTangentAt(this.u).normalize();
        this.yaw = Math.atan2(tan.x, tan.z) + this.headingOffset;
      } else { this.yaw = 0; }
    }
  }

  private _updateFOVSurface() {
    const show = ($('toggleFOVSurf') as HTMLInputElement)?.checked ?? true;
    this.fovSurf.visible = !!show;
    if (!show) return;
    const fanSegs = 36;
    const verts: number[] = [];
    const indices: number[] = [];
    const origin = new THREE.Vector3(0, this.headOffset, 0);
    verts.push(0, origin.y, 0);
    const half = THREE.MathUtils.degToRad(this.fovHalfAngle);
    for (let i = 0; i <= fanSegs; i++) {
      const t = (i / fanSegs - 0.5) * 2 * half;
      const ang = this.yaw + t;
      const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
      const start = this.root.position.clone().add(origin);
      raycaster.set(start, dir);
      const hit = raycaster.intersectObject(worldGroupForFit, true)[0];
      let end = this.root.position.clone().addScaledVector(dir, this.fovRadius).add(origin);
      if (hit && hit.distance < this.fovRadius) { end = start.clone().addScaledVector(dir, hit.distance); this._markHit(end); }
      verts.push(end.x - this.root.position.x, end.y - this.root.position.y, end.z - this.root.position.z);
      if (i > 0) { indices.push(0, i, i + 1); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices);
    (geo as any).computeVertexNormals?.();
    (this.fovSurf.geometry as any).dispose?.();
    this.fovSurf.geometry = geo;
  }

  private _markHit(worldPos: THREE.Vector3) {
    if (!this.hitGroup) return;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), new THREE.MeshBasicMaterial({ color: '#ffcc88' }));
    sphere.position.copy(worldPos.clone().sub(this.root.position));
    this.hitGroup.add(sphere);
    if (this.hitGroup.children.length > 30) { const x = this.hitGroup.children.shift() as THREE.Mesh; (x.geometry as any).dispose?.(); (x.material as any).dispose?.(); }
  }

  update(dt: number) {
    const delta = Math.min(0.033, (dt || 0));
    const shadeW = parseFloat(($('shadeW') as HTMLInputElement)?.value || '0.8');

    if (this.mode === 'percept') {
      if (!this.perceptPos) { this.perceptPos = (this.mesh.position as THREE.Vector3).clone(); }
      const samples = 11;
      const totalFOV = THREE.MathUtils.degToRad(this.fovHalfAngle * 2);
      let bestScore = -Infinity, bestYaw = this.yaw;
      for (let i = 0; i < samples; i++) {
        const t = (i / (samples - 1)) - 0.5;
        const ang = this.yaw + t * totalFOV;
        const dir2 = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
        const open = opennessAhead(this.perceptPos, dir2, 6);
        const shade = shadeScoreAlongYaw(this.perceptPos, ang, 6, 6);
        const turnPenalty = 1 - Math.cos(t * Math.PI);
        const score = open * 1.0 + shadeW * shade - turnPenalty * 0.25;
        if (score > bestScore) { bestScore = score; bestYaw = ang; }
      }
      this.yaw = THREE.MathUtils.lerp(this.yaw, bestYaw, 4.0 * delta);
      const v = (this.baseSpeed || 1);
      const step = v * delta;
      const moveDir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const nextPos = (this.perceptPos || new THREE.Vector3()).clone().addScaledVector(moveDir, step);
      nextPos.y = 0; this.perceptPos = nextPos;
      this.root.position.copy(this.perceptPos);
      this.root.rotation.set(0, this.yaw, 0);
      (this.mesh as any).rotation?.set(0, this.yaw + this.headingOffset, 0);
      this._updateFOVSurface();
      return;
    }

    // curve-following mode
    if (!this.curve || !this.curve.getPointAt) return;
    const L = this._curveLength || 1;
    this.u = (this.u + (this.speed * (delta) / L)) % 1.0;
    const pos = this.curve.getPointAt(this.u);
    const tan = this.curve.getTangentAt ? this.curve.getTangentAt(this.u).normalize() : new THREE.Vector3(1, 0, 0);
    const moveYawBase = Math.atan2(tan.x, tan.z);
    const candidates = [moveYawBase, moveYawBase + 0.35, moveYawBase - 0.35, moveYawBase + 0.7, moveYawBase - 0.7];
    let bestYaw = moveYawBase, bestScore = -Infinity;
    for (const y of candidates) {
      const open = opennessAhead(pos, new THREE.Vector3(Math.sin(y), 0, Math.cos(y)), 6);
      const shade = shadeScoreAlongYaw(pos, y, 6, 6);
      const score = open * 1.0 + shadeW * shade;
      if (score > bestScore) { bestScore = score; bestYaw = y; }
    }
    this.root.position.copy(pos);
    this.root.rotation.set(0, bestYaw, 0);
    (this.mesh as any).rotation?.set(0, bestYaw + this.headingOffset, 0);
    this._updateFOVSurface();
  }
}

async function addAgentOnCurve(curve: any, color = '#ef4444', speed = 22) {
  try {
    if (!ASSET_BASE) throw new Error('no-assets');
    const loader = new GLTFLoader(); const draco = new DRACOLoader(); draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/'); loader.setDRACOLoader(draco);
    const gltf: any = await new Promise((res, rej) => loader.load(ASSET_BASE! + '/human.glb', res, undefined as any, rej));
    const model: THREE.Object3D = gltf.scene; (model as any).traverse?.((n: any) => { if (n.isMesh) { n.material = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0 }); n.castShadow = true; n.receiveShadow = true; } });
    const a = new Agent(model, curve, speed, 70, 0.6, 40, 90); agents.push(a as any); return a;
  } catch {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.6 })); const a = new Agent(mesh, curve, speed, 70, 1.0, 40, 90); agents.push(a); return a;
  }
}

function fitCameraTo(object: THREE.Object3D) {
  const { minX, maxX, minZ, maxZ, centerX, centerZ } = getXZBox(object);
  const spanX = maxX - minX, spanZ = maxZ - minZ; const span = Math.max(spanX, spanZ) || 1; const padding = 1.2;
  const dist = (span * padding) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  camera.position.set(centerX + dist * 0.8, dist * 0.9, centerZ + dist * 0.8);
  controls.target.set(centerX, 0, centerZ); controls.update();
}

// ---------------------- Globals ----------------------
let norm: any, llToLocal: (lon: number, lat: number) => THREE.Vector3;
const worldGroupForFit = new THREE.Group(); scene.add(worldGroupForFit);
let ALL_CURVES: any[] = []; let roadsGroupRef: THREE.Group | null = null; let luRef: THREE.Group | null = null; let cityRig: THREE.Group | null = null; let cityModel: THREE.Object3D | null = null; let baseScaleS = 1, baseScaleH = 7.0;

// ---------------------- Main ----------------------
async function start() {
  ASSET_BASE = await pickBase(CANDIDATES);

  setSunByAzAlt(160, 45);
  computeLightDir();

  // Roads (or fallback)
  let gj: any;
  try {
    if (!ASSET_BASE) throw new Error('no-assets');
    const r = await fetch(ASSET_BASE + '/Lines_Edges.geojson'); if (!r.ok) throw new Error('HTTP ' + r.status); gj = await r.json();
  } catch {
    oops('⚠️ دارایی راه‌ها پیدا نشد؛ نمونه‌ی ساده بارگذاری شد.');
    gj = { "type": "FeatureCollection", "features": [{ "type": "Feature", "geometry": { "type": "LineString", "coordinates": [[51.377, 35.700], [51.380, 35.703], [51.384, 35.706], [51.388, 35.709], [51.392, 35.712]] } }] };
  }

  const coords: Array<[number, number]> = [];
  for (const f of (gj.features || []) as any[]) {
    const g = f.geometry; if (!g) continue;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const arr of lines) for (const p of arr) coords.push(p);
  }
  llToLocal = makeLLToLocal(coords);
  const localPts = coords.map(([x, y]) => { const ll = isLonLat([x, y]) ? [x, y] as [number, number] : webMercatorToLonLat(x, y) as [number, number]; return llToLocal(ll[0], ll[1]); });
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity; for (const p of localPts) { if (!isFinite(p.x) || !isFinite(p.z)) continue; minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2; const span = Math.max(maxX - minX, maxZ - minZ) || 1; const fit = 80 / span; const N = (v: THREE.Vector3) => new THREE.Vector3((v.x - cx) * fit, 0, (v.z - cz) * fit); const normLocal = { cx, cz, span, fit, N };
  norm = normLocal;

  const roadsGroup = new THREE.Group(); const curves: any[] = [];
  for (const f of (gj.features || []) as any[]) {
    const g = f.geometry; if (!g) continue;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const arr of lines) {
      const pts = arr.map(([lon, lat]: [number, number]) => { const ll = isLonLat([lon, lat]) ? [lon, lat] as [number, number] : webMercatorToLonLat(lon, lat) as [number, number]; return N(llToLocal(ll[0], ll[1])); });
      const t = tubeFromPoints(pts, 0.5); if (t) { roadsGroup.add(t.mesh); curves.push(t.curve); }
    }
  }
  worldGroupForFit.add(roadsGroup); roadsGroupRef = roadsGroup; ALL_CURVES = curves;
  enableShadowOn(roadsGroup);

  // Landuse (optional)
  try {
    if (!ASSET_BASE) throw new Error('no-assets'); const rL = await fetch(ASSET_BASE + '/Landuse.geojson'); if (!rL.ok) throw new Error('HTTP ' + rL.status); const gjL = await rL.json(); luRef = drawLanduse(gjL, N, llToLocal); worldGroupForFit.add(luRef); enableShadowOn(luRef);
  } catch (err) { console.warn('Landuse load skipped:', err); }

  // City (GLB) or fallback mesh
  await loadAndFitCity();

  // Agents on top 4 longest curves
  const byLen = curves.map(c => ({ c, L: c.getLength() })).sort((a, b) => b.L - a.L);
  const chosen = byLen.slice(0, 4).map(o => o.c);
  const agentColors = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7'];
  const agentSpeeds = [26, 22, 18, 14];
  for (let i = 0; i < chosen.length; i++) {
    const a = await addAgentOnCurve(chosen[i], agentColors[i], agentSpeeds[i]);
    (a as any).u = i / chosen.length; (a as any).enablePerceptual(false);
  }

  // Start render
  let last = performance.now();
  renderer.setAnimationLoop((t) => {
    const dt = Math.min(0.033, (t - last) / 1000);
    last = t;
    controls.update();
    if (!paused) agents.forEach(a => { try { a.update(dt); } catch (e) { console.warn(e); } });
    renderer.render(scene, camera);
  });

  // UI bindings (after DOM present)
  bindUI();
}

async function loadAndFitCity() {
  try {
    if (!ASSET_BASE) throw new Error('no-assets');
    const loader = new GLTFLoader(); const draco = new DRACOLoader(); draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/'); loader.setDRACOLoader(draco);
    const gltf: any = await new Promise((res, rej) => loader.load(ASSET_BASE! + '/city.glb', res, undefined as any, rej));
    let model: THREE.Object3D = gltf.scene;

    // ================= BLACK-FIX PATCH =================
    (model as any).traverse?.((o: any) => {
      if (!o.isMesh) return;
      if (o.geometry && !o.geometry.attributes.normal) { o.geometry.computeVertexNormals(); }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) {
        let m = mats[i]; if (!m) { continue; }
        if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; }
        if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
          m.vertexColors = !!o.geometry.attributes.color;
          m.metalness = Math.min(m.metalness ?? 0, 0.1);
          m.roughness = Math.max(m.roughness ?? 1, 0.9);
          m.side = THREE.DoubleSide; m.needsUpdate = true;
        } else {
          m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: !!o.geometry.attributes.color, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
          mats[i] = m;
        }
      }
      o.material = Array.isArray(o.material) ? mats : mats[0];
    });
    // ===================================================

    const preBox = new THREE.Box3().setFromObject(model);
    const preSize = preBox.getSize(new THREE.Vector3());
    const preCenter = preBox.getCenter(new THREE.Vector3());
    const nativeSpan = Math.max(preSize.x, preSize.z) || 1;
    const spanTarget = norm.span * norm.fit;
    const s = (spanTarget * 0.84) / nativeSpan; baseScaleS = s;
    (model as any).position?.set(-preCenter.x, -preBox.min.y, -preCenter.z);
    (model as any).scale?.set(1, baseScaleH, 1);

    cityModel = model; cityRig = new THREE.Group();
    enableShadowOn(model);
    (cityRig as any).scale?.set(s, s, s); (cityRig as any).position.y = 0.05; cityRig.add(model); worldGroupForFit.add(cityRig);
    fitCameraTo(worldGroupForFit);
  } catch (err) {
    oops('⚠️ city.glb پیدا نشد؛ شهر نمونه ساخته شد.');
    cityRig = new THREE.Group(); (cityRig as any).position.y = 0.05;
    const g = new THREE.Group();
    for (let i = 0; i < 60; i++) {
      const w = 2 + Math.random() * 4, d = 2 + Math.random() * 4, h = 1 + Math.random() * 5;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: '#9cc3d5', roughness: 0.9 }));
      (m as any).position?.set((Math.random() - 0.5) * 60, h / 2, (Math.random() - 0.5) * 60); m.castShadow = true; m.receiveShadow = true; g.add(m);
    }
    baseScaleS = 1.0; cityRig.add(g); worldGroupForFit.add(cityRig); fitCameraTo(worldGroupForFit);
  }
}

// ---------------------- UI bindings ----------------------
function bindUI() {
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  });

  $('pause').addEventListener('click', () => { paused = !paused; $('pause').textContent = paused ? '▶️ ادامه' : '⏯️ توقف'; });
  $('speed').addEventListener('input', () => { const k = parseFloat(($('speed') as HTMLInputElement).value) || 1.0; agents.forEach(a => a.setSpeedFactor(k)); });
  $('zoom').addEventListener('input', () => { const dist = parseFloat(($('zoom') as HTMLInputElement).value); const dirW = new THREE.Vector3(); camera.getWorldDirection(dirW); const target = controls.target.clone(); camera.position.copy(target.clone().addScaledVector(dirW.negate(), dist)); controls.update(); });
  $('fov').addEventListener('input', () => { const deg = parseFloat(($('fov') as HTMLInputElement).value); agents.forEach(a => a.setFOVTotalDeg(deg)); });
  $('viewDepth').addEventListener('input', () => { const r = parseFloat(($('viewDepth') as HTMLInputElement).value); agents.forEach(a => a.setFOVRadius(r)); });
  $('changeRoutes').addEventListener('click', () => { if (!ALL_CURVES.length) return; agents.forEach(a => { const c = ALL_CURVES[Math.floor(Math.random() * ALL_CURVES.length)] || (a as any).curve; a.setCurve(c); }); });
  $('recenter').addEventListener('click', () => fitCameraTo(worldGroupForFit));
  $('zoomfit').addEventListener('click', () => fitCameraTo(worldGroupForFit));

  const uiState = { rot: 0, scale: 1.00, tx: 0, tz: 0 };
  function applyCityRig() {
    if (!cityRig) return;
    (cityRig as any).scale?.set(baseScaleS * uiState.scale, baseScaleS * uiState.scale, baseScaleS * uiState.scale);
    (cityRig as any).rotation?.set(0, THREE.MathUtils.degToRad(uiState.rot), 0);
    (cityRig as any).position.x = uiState.tx; (cityRig as any).position.z = uiState.tz; (cityRig as any).position.y = 0.05;
  }
  ['cityRot','cityScale','cityTX','cityTZ'].forEach(id=>{
    $(id).addEventListener('input', ()=>{
      const v = parseFloat(($(id) as HTMLInputElement).value);
      if (id==='cityRot') uiState.rot = v;
      if (id==='cityScale') uiState.scale = v;
      if (id==='cityTX') uiState.tx = v;
      if (id==='cityTZ') uiState.tz = v;
      applyCityRig();
    });
  });

  $('autoTighten').addEventListener('click', () => {
    if (!cityRig || !roadsGroupRef) return;
    const rb = getXZBox(roadsGroupRef); const cb = getXZBox(cityRig);
    uiState.tx += (rb.centerX - cb.centerX); uiState.tz += (rb.centerZ - cb.centerZ); applyCityRig();
    let guard = 0; while (guard++ < 120) {
      const r = getXZBox(roadsGroupRef); const c = getXZBox(cityRig); const margin = 0.5;
      const outLeft = c.minX < r.minX - margin; const outRight = c.maxX > r.maxX + margin;
      const outTop = c.minZ < r.minZ - margin; const outBottom = c.maxZ > r.maxZ + margin;
      if (!(outLeft || outRight || outTop || outBottom)) break;
      uiState.scale *= 0.98; applyCityRig();
    }
    fitCameraTo(worldGroupForFit);
  });

  $('toggleLU').addEventListener('click', () => { if (luRef) luRef.visible = !luRef.visible; });

  let perceptualEnabled = false;
  $('togglePercept').addEventListener('click', () => {
    perceptualEnabled = !perceptualEnabled;
    $('togglePercept').textContent = perceptualEnabled ? '👁️ حالت ادراکی: روشن' : '👁️ حالت ادراکی: خاموش';
    agents.forEach(a => a.enablePerceptual(perceptualEnabled));
  });

  $('toggleFOVSurf').addEventListener('change', () => {});
  $('shadeW').addEventListener('input', () => {});

  $('sunApi').addEventListener('click', () => applySunFromInputs(true));
  $('sunApply').addEventListener('click', () => applySunFromInputs(false));
}

// ---------------------- Public API ----------------------
export function initCitySim(host?: HTMLElement) {
  const mount = host ?? document.body;
  mountUI(mount);
  mount.appendChild(renderer.domElement);

  // اندازه‌گیری بر مبنای ظرف
  const w0 = mount.clientWidth || innerWidth;
  const h0 = mount.clientHeight || innerHeight;
  renderer.setSize(w0, h0);
  camera.aspect = w0 / h0;
  camera.updateProjectionMatrix();

  // واکنش به تغییر اندازه‌ی host
  const ro = new ResizeObserver(() => {
    const w = mount.clientWidth || innerWidth;
    const h = mount.clientHeight || innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  });
  ro.observe(mount);

  start();
  const cleanup = () => {
    renderer.setAnimationLoop(null);
    try { ro.disconnect(); } catch {}
    try { mount.removeChild(renderer.domElement); } catch {}
    try { renderer.dispose(); } catch {}
  };
  return cleanup;
}
