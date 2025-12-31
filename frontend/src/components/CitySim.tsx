import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

// ===================== Types =====================
type V3 = THREE.Vector3;

type RoadNode = {
  id: number;
  p: V3;
  edges: RoadEdge[];
};
type RoadEdge = {
  id: number;
  a: RoadNode;
  b: RoadNode;
  poly: V3[]; // دو نقطه: [a, b]
  length: number;
  shadeScore: number; // 0..1
};
type RoadGraph = {
  nodes: RoadNode[];
  edges: RoadEdge[];
};

type AgentOpts = {
  color?: string;
  speed?: number;
  fovHalfAngle?: number; // deg
  fovRadius?: number; // world units
  headingOffsetDeg?: number;
};

type AssetsBase = string | null;

// ===================== Helpers =====================
const CANDIDATES = ["/city-sim/assets", "/assets"];
async function pickBase(paths: string[]): Promise<AssetsBase> {
  for (const p of paths) {
    try {
      const r = await fetch(p + "/Lines_Edges.geojson", { method: "HEAD" });
      if (r.ok) return p;
    } catch {}
  }
  return null;
}

function isLonLat(p: number[]) {
  return Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}
function webMercatorToLonLat(x: number, y: number) {
  const lon = (x / 6378137) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat] as [number, number];
}

function makeLLToLocal(coords: any[]) {
  const ll = coords.map(([x, y]) => (isLonLat([x, y]) ? [x, y] : webMercatorToLonLat(x, y)));
  let lon0 = 0,
    lat0 = 0,
    n = 0;
  for (const [lon, lat] of ll) {
    if (isFinite(lon) && isFinite(lat)) {
      lon0 += lon;
      lat0 += lat;
      n++;
    }
  }
  lon0 /= n || 1;
  lat0 /= n || 1;
  const mLat = 111320,
    mLon = 111320 * Math.cos(THREE.MathUtils.degToRad(lat0 || 35));
  return (lon: number, lat: number) => new THREE.Vector3((lon - lon0) * mLon, 0, -(lat - lat0) * mLat);
}

function getXZBox(obj: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(obj);
  return {
    minX: box.min.x,
    maxX: box.max.x,
    minZ: box.min.z,
    maxZ: box.max.z,
    centerX: (box.min.x + box.max.x) / 2,
    centerZ: (box.min.z + box.max.z) / 2,
  };
}

function makeAsphaltCanvas(size = 512, seed = 1337, base = "#c8c8c8") {
  const rnd = (() => {
    let x = seed >>> 0;
    return () => ((x = (1664525 * x + 1013904223) >>> 0) / 0xffffffff);
  })();
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const octaves = 3;
  for (let o = 0; o < octaves; o++) {
    const step = Math.pow(2, o + 3),
      amp = 14 / (o + 1);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const nx = Math.floor(x / step),
          ny = Math.floor(y / step);
        const v = ((nx * 928371 + ny * 364479 + o * 1337) % 9973);
        const nVal = (v / 9973 - 0.5) * 2;
        const i = (y * size + x) * 4;
        d[i] += nVal * amp;
        d[i + 1] += nVal * amp;
        d[i + 2] += nVal * amp;
      }
  }
  const speckles = Math.floor(size * size * 0.0025);
  for (let k = 0; k < speckles; k++) {
    const x = Math.floor(rnd() * size),
      y = Math.floor(rnd() * size);
    const i = (y * size + x) * 4;
    const s = (rnd() < 0.5 ? -1 : +1) * (20 + rnd() * 35);
    d[i] += s;
    d[i + 1] += s;
    d[i + 2] += s;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tubeFromPoints(points: V3[], r = 0.5) {
  if (points.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0);
  const segs = Math.max(80, Math.floor(points.length * 3));
  const geom = new THREE.TubeGeometry(curve, segs, r, 12, false);
  const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8, metalness: 0 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = 0.06;
  ;(mesh as any).userData.isRoad = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, curve };
}

function enableShadowOn(obj: THREE.Object3D) {
  obj.traverse((n) => {
    const m = n as THREE.Mesh;
    if ((m as any).isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
}

// ===================== Sun (Ladybug-style-ish) =====================
function solarPositionUTC(lat: number, lon: number, date: Date) {
  const rad = Math.PI / 180,
    deg = 180 / Math.PI;
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const dayOfYear = Math.floor(
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000
  ) || 1;
  const decl = 23.45 * Math.sin(rad * ((360 / 365) * (dayOfYear - 81)));
  const solarTimeOffset = (lon / 15 - 12) * 15; // تقریب
  const hourAngle = (utcHours - 12) * 15 + solarTimeOffset;
  const altitude = Math.asin(
    Math.sin(lat * rad) * Math.sin(decl * rad) + Math.cos(lat * rad) * Math.cos(decl * rad) * Math.cos(hourAngle * rad)
  ) * deg;
  const azimuth = Math.atan2(
    -Math.sin(hourAngle * rad),
    Math.tan(decl * rad) * Math.cos(lat * rad) - Math.sin(lat * rad) * Math.cos(hourAngle * rad)
  ) * deg;
  const x = Math.sin(azimuth * rad) * Math.cos(altitude * rad);
  const y = Math.sin(altitude * rad);
  const z = Math.cos(azimuth * rad) * Math.cos(altitude * rad);
  return { azimuth, altitude, vector: new THREE.Vector3(x, y, z).normalize() };
}

// ===================== FOV =====================
function coneFOVMeshSafe(length = 10, halfAngleDeg = 36, color = "#00ffd5", opacity = 0.28, radialSegments =32) {
  const L = Math.max(0.1, length);
  const hDeg = Math.max(1, Math.min(85, halfAngleDeg));
  const segs = Math.max(8, radialSegments | 0);
  const r = Math.tan(THREE.MathUtils.degToRad(hDeg)) * L;
  let geo: THREE.BufferGeometry;
  try {
    const g = new THREE.ConeGeometry(r, L, segs, 1, false);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, L / 2);
    geo = g;
  } catch {
    const g = new THREE.CylinderGeometry(0, r, L, segs, 1, false);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, L / 2);
    geo = g;
  }
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(geo, mat);
  (cone.material as THREE.Material).depthTest = true;
  (cone.material as THREE.Material).depthWrite =true;
  cone.renderOrder = 21;
  return cone;
}

// ===================== Graph / Routing (A* with shade) =====================
const ROAD_SAMPLE_DENSITY = 8;
const MERGE_EPS = 1.0;
const SHADE_SAMPLES_PER_EDGE = 6;
const SHADE_LOOKAHEAD = 1.2;

function distV(a: V3, b: V3) {
  return a.distanceTo(b);
}
function spacedPointsFromCurve(curve: THREE.Curve<V3>) {
  const L = Math.max(1, curve.getLength());
  const n = Math.max(10, Math.floor((L / 100) * ROAD_SAMPLE_DENSITY) + 2);
  return curve.getSpacedPoints(n).map((p) => p.clone());
}
function findOrCreateNode(nodes: RoadNode[], p: V3): RoadNode {
  for (const n of nodes) {
    if (distV(n.p, p) <= MERGE_EPS) return n;
  }
  const node: RoadNode = { id: nodes.length, p: p.clone(), edges: [] };
  nodes.push(node);
  return node;
}
function nearestPointOnEdge(e: RoadEdge, p: V3) {
  const a = e.poly[0],
    b = e.poly[1];
  const ab = new THREE.Vector3().subVectors(b, a);
  const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(p, a).dot(ab) / ab.lengthSq(), 0, 1);
  const q = a.clone().addScaledVector(ab, t);
  return { q, t, d: distV(p, q) };
}

function buildRoadGraphFromCurves(
  curves: THREE.Curve<V3>[],
  worldGroupForFit: THREE.Object3D,
  raycaster: THREE.Raycaster,
  LIGHT_TO_POS: V3
): RoadGraph {
  const nodes: RoadNode[] = [];
  const edges: RoadEdge[] = [];
  for (const c of curves) {
    const pts = spacedPointsFromCurve(c);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i],
        p1 = pts[i + 1];
      const n0 = findOrCreateNode(nodes, p0);
      const n1 = findOrCreateNode(nodes, p1);
      if (n0 === n1) continue;
      let exists = false;
      for (const e of n0.edges) {
        if ((e.a === n0 && e.b === n1) || (e.a === n1 && e.b === n0)) {
          exists = true;
          break;
        }
      }
      if (exists) continue;
      const poly = [p0.clone(), p1.clone()];
      const L = distV(p0, p1);
      const e: RoadEdge = { id: edges.length, a: n0, b: n1, poly, length: L, shadeScore: 0 };
      edges.push(e);
      n0.edges.push(e);
      n1.edges.push(e);
    }
  }

  const approximateEdgeShade = (poly: V3[]) => {
    if (poly.length < 2) return 0;
    let shaded = 0,
      total = 0;
    for (let i = 0; i < SHADE_SAMPLES_PER_EDGE; i++) {
      const t = (i + 0.5) / SHADE_SAMPLES_PER_EDGE;
      const q = poly[0].clone().lerp(poly[1], t);
      const origin = new THREE.Vector3(q.x, q.y + SHADE_LOOKAHEAD, q.z);
      raycaster.set(origin, LIGHT_TO_POS);
      const hit = raycaster.intersectObject(worldGroupForFit, true)[0];
      if (hit && hit.distance < 500) shaded++;
      total++;
    }
    return total > 0 ? shaded / total : 0;
  };

  for (const e of edges) e.shadeScore = approximateEdgeShade(e.poly);
  return { nodes, edges };
}

function snapToGraph(g: RoadGraph, p: V3) {
  let best: { edge: RoadEdge; q: V3; t: number; d: number } | null = null;
  for (const e of g.edges) {
    const s = nearestPointOnEdge(e, p);
    if (!best || s.d < best.d) best = { edge: e, q: s.q, t: s.t, d: s.d };
  }
  return best;
}

function heur(a: RoadNode, b: RoadNode) {
  return distV(a.p, b.p);
}

function aStar(g: RoadGraph, start: RoadNode, goal: RoadNode, costFn: (e: RoadEdge) => number) {
  const open = new Set<RoadNode>([start]);
  const came = new Map<RoadNode, RoadNode>();
  const gScore = new Map<RoadNode, number>([[start, 0]]);
  const fScore = new Map<RoadNode, number>([[start, heur(start, goal)]]);
  while (open.size) {
    let current: RoadNode | null = null,
      bestF = Infinity;
    for (const n of open) {
      const f = fScore.get(n) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        current = n;
      }
    }
    if (!current) break;
    if (current === goal) {
      const path = [current];
      while (came.has(current)) {
        current = came.get(current)!;
        path.push(current);
      }
      path.reverse();
      return path;
    }
    open.delete(current);
    for (const e of current.edges) {
      const nb = e.a === current ? e.b : e.a;
      const tentative = (gScore.get(current) ?? Infinity) + costFn(e);
      if (tentative < (gScore.get(nb) ?? Infinity)) {
        came.set(nb, current);
        gScore.set(nb, tentative);
        fScore.set(nb, tentative + heur(nb, goal));
        open.add(nb);
      }
    }
  }
  return null;
}

function nodesPathToPolyline(path: RoadNode[]) {
  return path.map((n) => n.p.clone());
}

function findRouteOnRoads(g: RoadGraph, worldStart: V3, worldGoal: V3, shadeBias: number) {
  const s = snapToGraph(g, worldStart);
  const t = snapToGraph(g, worldGoal);
  if (!s || !t) return null;

  const nearestNodeToPoint = (pt: V3) => {
    let best: RoadNode | null = null,
      bd = Infinity;
    for (const n of g.nodes) {
      const d = distV(n.p, pt);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best!;
  };
  const nS = nearestNodeToPoint(s.q);
  const nG = nearestNodeToPoint(t.q);

  const cost = (e: RoadEdge) => {
    const factor = Math.max(0.2, 1 - shadeBias * e.shadeScore);
    return e.length * factor;
  };

  const nodePath = aStar(g, nS, nG, cost);
  if (!nodePath) return null;
  return nodesPathToPolyline(nodePath);
}

// ===================== Agent =====================
// ===================== Agent =====================
class Agent {
  root: THREE.Group;
  mesh: THREE.Object3D;
  yaw = 0;
  baseSpeed: number;
  speed: number;
  fovHalfAngle: number;
  fovRadius: number;
  headingOffset = 0;
  fov: THREE.Mesh;
  fovSurf: THREE.Mesh;
  private occlCap: THREE.Mesh;   // 🔴 کلاهک برخورد
  hitGroup: THREE.Group;
  bodyYOffset = 0.45;
  headOffset = 1.0;
finalGoal: V3 | null = null;         // مقصد نهایی مسیر فعلی
rerouteCooldown = 0;                 // جلوگیری از ریرَوت پشت سر هم
stuckAcc = 0;                        // تشخیص گیرکردن
_lastPos = new THREE.Vector3();      // برای بررسی پیشرفت ایجنت

  private route: V3[] = [];
  private routeIdx = 0;

  constructor(scene: THREE.Scene, model: THREE.Object3D, opts: AgentOpts = {}) {
    const { color = "#ef4444", speed = 22, fovHalfAngle = 30, fovRadius = 10, headingOffsetDeg = 0 } = opts;
    this.baseSpeed = speed;
    this.speed = speed;
    this.fovHalfAngle = fovHalfAngle;
    this.fovRadius = fovRadius;
    this.headingOffset = THREE.MathUtils.degToRad(headingOffsetDeg);

    this.root = new THREE.Group();
    scene.add(this.root);

    this.mesh = model;
   (this.mesh as any).traverse((n: any) => {
  if (n.isMesh && n.material) {
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    mats.forEach((m: any) => {
      if (!m) return;
      // 👇 ایجنت‌ها پشت دیوار پنهان شوند (سالید شدن)
      m.transparent = false;
      m.opacity = 1.0;
      m.depthTest = true;
      m.depthWrite = true;
      // اگر لازم نیست، دوطرفه نباشد تا آرتیفکت کمتر شود
      if (m.side !== THREE.FrontSide) m.side = THREE.FrontSide;
    });
  }
});
// بهتره این رو هم حذف/کاهش کنی تا نره بالای پشته
      
    const preBox = new THREE.Box3().setFromObject(this.mesh);
    const preCent = preBox.getCenter(new THREE.Vector3());
    (this.mesh as any).position.set(-preCent.x, -preBox.min.y, -preCent.z);
    (this.mesh as any).scale.setScalar(0.6);
    (this.mesh as any).position.y += this.bodyYOffset;
this.root.position.y = 0.01;  // کمی پایین‌تر از سطح جاده

  
   // try head size
try {
  const box2 = new THREE.Box3().setFromObject(this.mesh);
  const size2 = box2.getSize(new THREE.Vector3());
  if (isFinite(size2.y) && size2.y > 0) {
    // 🔹 ارتفاع سر ایجنت (کمی بالاتر از قدش)
    this.headOffset = Math.max(0.5, size2.y * 1.3);
  }
} catch {}

this.root.add(this.mesh);

// 🔹 مخروط دید (FOV)
this.fov = coneFOVMeshSafe(this.fovRadius, this.fovHalfAngle, "#fffff", 0.28, 32);
this.fov.position.set(0, this.headOffset, 0);   // 👈 بالای سر ایجنت
this.fov.rotation.set(0, 0, 0);
this.root.add(this.fov);

// 🔹 سطح زرد FOV (برای دیدن محدوده‌ی دید)
this.fovSurf = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({
    color: "#fffff",
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
  })
);
(this.fovSurf as any).renderOrder = 22;
this.fovSurf.visible = true;
this.fovSurf.position.set(0, this.headOffset, 0); // 👈 هم‌ارتفاع با سر
this.root.add(this.fovSurf);

this.occlCap = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({
    color: "#fffff",
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthTest: true,      // ✅ روی بدن ایجنت نمی‌افته
    depthWrite: false,    // ✅ فقط تِینت می‌کنه، عمق نمی‌نویسه
    blending: THREE.NormalBlending, // می‌تونی Additive/Multiply تست کنی
  })
);
// بعد از دنیا رندر بشه تا روی سطوح دیده بشه، ولی با depthTest
(this.occlCap as any).renderOrder = 23;

this.occlCap.visible = false;
this.occlCap.position.set(0, this.headOffset, 0); // 👈 روی سر
this.root.add(this.occlCap);

this.hitGroup = new THREE.Group();
this.root.add(this.hitGroup);

  }

  private _placeFOV() {
    if (!this.fov) return;
    (this.fov as any).position.set(0, this.headOffset, 0);
    (this.fov as any).rotation.set(0, 0, 0);
  }

  private _markHit(worldPos: V3, color = "#fffff", r = 0.12) {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(r, 12, 12),
      new THREE.MeshBasicMaterial({ color })
    );
    sphere.position.copy(worldPos.clone().sub(this.root.position));
    this.hitGroup.add(sphere);
    if (this.hitGroup.children.length > 20) {
      const x = this.hitGroup.children.shift() as THREE.Mesh;
      x.geometry.dispose();
      (x.material as THREE.Material).dispose();
    }
  }

  // ✅ FOV + کلاهک برخورد
  private _updateFOVSurface(raycaster: THREE.Raycaster, world: THREE.Object3D) {
    const fanSegs = 28;
    const verts: number[] = [];
    const indices: number[] = [];
    const origin = new THREE.Vector3(0, this.headOffset, 0); // راس FOV روی سر
    verts.push(0, origin.y, 0);

    const half = THREE.MathUtils.degToRad(this.fovHalfAngle);
    let minHit = Infinity; // نزدیک‌ترین فاصله‌ی برخورد داخل FOV

    for (let i = 0; i <= fanSegs; i++) {
      const t = (i / fanSegs - 0.5) * 2 * half;
      const ang = this.yaw + t;
      const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
      const start = this.root.position.clone().add(origin);

      raycaster.set(start, dir);
      const hits = raycaster.intersectObject(world, true);
      const hit = hits.find(h => (h.object as any).userData?.isObstacle);

      let end = this.root.position.clone().addScaledVector(dir, this.fovRadius).add(origin);
      if (hit && hit.distance < this.fovRadius) {
        end = start.clone().addScaledVector(dir, hit.distance);
  

        // مارکر در برخورد نزدیک (اختیاری)
        if (hit.distance < 1.0) this._markHit(end, "#fffff", 0.14);
      }

      verts.push(end.x - this.root.position.x, end.y - this.root.position.y, end.z - this.root.position.z);
      if (i > 0) indices.push(0, i, i + 1);
    }

  
    // 🔴 کلاهک قرمز در فاصله‌ی نزدیک‌ترین برخورد
    if (isFinite(minHit) && minHit < this.fovRadius) {
      const r = Math.tan(half) * minHit; // شعاع کلاهک روی صفحه‌ی برخورد
      const capVerts: number[] = [];
      const capIdx: number[] = [];

      // مرکز کلاهک (محلیِ ایجنت، جلوی سر)
      const center = new THREE.Vector3(0, origin.y, minHit);
      capVerts.push(center.x, center.y, center.z);

      for (let i = 0; i <= fanSegs; i++) {
        const t = (i / fanSegs - 0.5) * 2 * half;
        const x = Math.sin(t) * r;
        const y = origin.y;
        const z = minHit;
        capVerts.push(x, y, z);
        if (i > 0) capIdx.push(0, i, i + 1);
      }

      const capGeo = new THREE.BufferGeometry();
      capGeo.setAttribute("position", new THREE.Float32BufferAttribute(capVerts, 3));
      capGeo.setIndex(capIdx);
      (this.occlCap.geometry as THREE.BufferGeometry).dispose?.();
      this.occlCap.geometry = capGeo;

      // هم‌راستا با جهت فعلی
      this.occlCap.position.set(0, 0, 0);
      this.occlCap.rotation.set(0, this.yaw, 0);
      this.occlCap.visible = true;
    } else {
      this.occlCap.visible = false;
    }
  }

  setSpeedFactor(k: number) {
    this.speed = (this.baseSpeed || 1) * (k || 1);
  }
  setFOVTotalDeg(d: number) {
    this.fovHalfAngle = d / 2;
    this.root.remove(this.fov);
    this.fov = coneFOVMeshSafe(this.fovRadius, this.fovHalfAngle, "#00ffd5", 0.28, 32);
    this.root.add(this.fov);
    this._placeFOV();
  }
  setFOVRadius(r: number) {
    this.fovRadius = r;
    this.root.remove(this.fov);
    this.fov = coneFOVMeshSafe(this.fovRadius, this.fovHalfAngle, "#00ffd5", 0.28, 32);
    this.root.add(this.fov);
    this._placeFOV();
  }

  setPolylineRoute(poly: V3[]) {
    this.route = poly.map((p) => p.clone());
    this.routeIdx = 0;
    if (this.route.length) this.root.position.copy(this.route[0]);
 this.root.position.y = 0.05;
this.route.forEach(p => (p.y = 0.05));
this.finalGoal = this.route[this.route.length - 1].clone();


  }

  currentPosition() {
    return this.root.position.clone();
  }
private _trySmartReroute(roadGraph: any, shadeBias: number) {
  if (!roadGraph || !this.finalGoal || this.rerouteCooldown > 0) return false;

  const from = this.currentPosition();
  const poly = findRouteOnRoads(roadGraph, from, this.finalGoal, shadeBias);
  if (poly && poly.length > 1) {
    this.setPolylineRoute(poly);
    this.rerouteCooldown = 2.5;   // تا ۲.۵ ثانیه دوباره ریرَوت نکن
    return true;
  }
  return false;
}



  update(
  dt: number,
  raycaster: THREE.Raycaster,
  worldGroupForFit: THREE.Object3D,
  roadGraph?: any,
  shadeBias: number = 0
) {
  const delta = Math.min(0.033, dt || 0);
this.rerouteCooldown = Math.max(0, this.rerouteCooldown - delta);

if (!this.route.length) return;
if (!this._lastPos.lengthSq()) this._lastPos.copy(this.root.position);

const pos = this.root.position;
const idx = Math.min(this.routeIdx, this.route.length - 1);
const target = this.route[idx];

const to = target.clone().sub(pos); to.y = 0;
const d = to.length();

if (d < 0.5) {
  if (this.routeIdx < this.route.length - 1) this.routeIdx++;
} else {
  const dirMove = to.clone().normalize();
  this.yaw = Math.atan2(dirMove.x, dirMove.z);

  // ری‌کست از ارتفاع چشم
  const start = pos.clone().add(new THREE.Vector3(0, 1.5, 0));
  raycaster.set(start, dirMove);
  const hits = raycaster.intersectObject(worldGroupForFit, true);
  const hit = hits.find(h => (h.object as any).userData?.isObstacle);

  const AVOID_DIST = 0.9;   // فاصلهٔ امن
  const STOP_DIST  = 0.25;  // خیلی نزدیک = کند و ریرَوت
  const STEP = (this.speed || this.baseSpeed || 20) * delta;

  if (hit) {
    if (hit.distance < STOP_DIST) {
      // خیلی نزدیک → کمی جلو آرام + تلاش برای ریرَوت
      pos.addScaledVector(dirMove, STEP * 0.1);
      this._trySmartReroute(roadGraph, shadeBias);
    } else if (hit.distance < AVOID_DIST) {
      // در آستانهٔ برخورد → لغزش به پهلو + حرکت کم جلو
      const side = new THREE.Vector3(-dirMove.z, 0, dirMove.x);
      pos.addScaledVector(side, (AVOID_DIST - hit.distance) * 0.4);
      pos.addScaledVector(dirMove, STEP * 0.6);

      // اگر پیشرفتی نبود، پس از 0.8s ریرَوت
      const prog = pos.distanceTo(this._lastPos);
      if (prog < 0.03) this.stuckAcc += delta;
      else { this.stuckAcc = 0; this._lastPos.copy(pos); }
      if (this.stuckAcc > 0.8) {
        if (this._trySmartReroute(roadGraph, shadeBias)) this.stuckAcc = 0;
      }
    } else {
      pos.addScaledVector(dirMove, Math.min(STEP, d));
    }
  } else {
    pos.addScaledVector(dirMove, Math.min(STEP, d));
  }

  this.root.rotation.set(0, this.yaw, 0);
  (this.mesh as any).rotation.set(0, this.yaw + this.headingOffset, 0);
}

// FOV + کلاهک برخورد
this._updateFOVSurface(raycaster, worldGroupForFit);

// ارتفاع ثابت روی زمین
if (this.root.position.y !== 0.05) this.root.position.y = 0.05;
}}

// ===================== Component =====================
const CitySimIsometric: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);

  // UI state
  const [speedK, setSpeedK] = useState(1.0);
  const [zoomDist, setZoomDist] = useState(180);
  const [lat, setLat] = useState(35.6892);
  const [lon, setLon] = useState(51.389);
  const [whenISO, setWhenISO] = useState("2025-10-11T12:00:00Z");
  const [shadeBias, setShadeBias] = useState(0.5);
  const [paused, setPaused] = useState(false);

  // NEW: feature toggles & params
  const [agentCount, setAgentCount] = useState(4);
  const [autoReroute, setAutoReroute] = useState(true);
  const [routeEditMode, setRouteEditMode] = useState<"off" | "source" | "dest">("off");
  const [showFOV, setShowFOV] = useState(true);

  // Keep latest values in refs so we don't have to recreate the 3D scene on every state change
  const speedRef = useRef(speedK);
  const zoomRef = useRef(zoomDist);
  const latRef = useRef(lat);
  // قطر لوله‌ی جاده‌ها (هرچی کمتر، باریک‌تر)
const ROAD_RADIUS = 0.25;

  const lonRef = useRef(lon);
  const whenRef = useRef(whenISO);
  const shadeRef = useRef(shadeBias);
  const pausedRef = useRef(paused);
  const agentCountRef = useRef(agentCount);
  const autoRerouteRef = useRef(autoReroute);
  const showFOVRef = useRef(showFOV);
// refs برای دسترسی به camera / controls داخل JSX
const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
const controlsRef = useRef<OrbitControls | null>(null);
const worldRef = useRef<THREE.Object3D | null>(null);
const placeCamRef = React.useCallback((yawDeg: number, pitchDeg: number, dist: number) => {
  const cam = cameraRef.current, ctr = controlsRef.current;
  if (!cam || !ctr) return;
  const target = ctr.target;
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pitchDeg, 1, 89));
  const r = Math.max(0.5, dist);
  const x = target.x + r * Math.sin(yaw) * Math.cos(pitch);
  const y = target.y + r * Math.sin(pitch);
  const z = target.z + r * Math.cos(yaw) * Math.cos(pitch);
  cam.position.set(x, y, z);
  cam.up.set(0, 1, 0);
  cam.lookAt(target);
  ctr.update();
}, []);

const zoomStepRef = React.useCallback((delta: number) => {
  const cam = cameraRef.current, ctr = controlsRef.current;
  if (!cam || !ctr) return;

  // به‌روز کردن مقدار کلی
  const next = Math.max(0.5, (zoomRef.current || 1) + delta);
  zoomRef.current = next;
  setZoomDist(next); // 👈 اسلایدر هم آپدیت می‌شود

  // قرار دادن دوربین روی شعاع جدید
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  cam.position.copy(ctr.target.clone().addScaledVector(dir.negate(), next));
  ctr.update();
}, []);


const rotateAroundTargetRef = React.useCallback((deltaYawDeg: number) => {
  const cam = cameraRef.current, ctr = controlsRef.current;
  if (!cam || !ctr) return;
  const t = ctr.target.clone();
  const v = cam.position.clone().sub(t);
  const yaw = Math.atan2(v.x, v.z) * 180 / Math.PI + deltaYawDeg;
  const pitch = Math.atan2(v.y, Math.sqrt(v.x * v.x + v.z * v.z)) * 180 / Math.PI;
  placeCamRef(yaw, pitch, v.length());
}, [placeCamRef]);

const tiltRef = React.useCallback((deltaPitchDeg: number) => {
  const cam = cameraRef.current, ctr = controlsRef.current;
  if (!cam || !ctr) return;
  const t = ctr.target.clone();
  const v = cam.position.clone().sub(t);
  const yaw = Math.atan2(v.x, v.z) * 180 / Math.PI;
  const pitch = THREE.MathUtils.clamp(
    Math.atan2(v.y, Math.sqrt(v.x * v.x + v.z * v.z)) * 180 / Math.PI + deltaPitchDeg, 5, 85
  );
  placeCamRef(yaw, pitch, v.length());
}, [placeCamRef]);
  useEffect(() => {
    speedRef.current = speedK;
  }, [speedK]);
  useEffect(() => {
    zoomRef.current = zoomDist;
  }, [zoomDist]);
  useEffect(() => {
    latRef.current = lat;
  }, [lat]);
  useEffect(() => {
    lonRef.current = lon;
  }, [lon]);
  useEffect(() => {
    whenRef.current = whenISO;
  }, [whenISO]);
  useEffect(() => {
    shadeRef.current = shadeBias;
  }, [shadeBias]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    agentCountRef.current = agentCount;
  }, [agentCount]);
  useEffect(() => {
    autoRerouteRef.current = autoReroute;
  }, [autoReroute]);
  useEffect(() => {
    showFOVRef.current = showFOV;
  }, [showFOV]);

  useEffect(() => {
    if (!mountRef.current) return;
    let disposed = false;

    // Scene & Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b1120");

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance", failIfMajorPerformanceCaveat: false, preserveDrawingBuffer: true });
    const setRendererSize = () => {
const w = Math.max(1, mountRef.current!.clientWidth);
const h = Math.max(1, mountRef.current!.clientHeight);
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    };
    setRendererSize();
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);

    // Camera / Controls
    const camera = new THREE.PerspectiveCamera(45, (mountRef.current.clientWidth || window.innerWidth) / (mountRef.current.clientHeight || window.innerHeight), 0.1, 5000);
    camera.position.set(0,10, 20);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 0.5;
    controls.maxDistance =2000;
    controls.maxPolarAngle = Math.PI * 0.49;
cameraRef.current = camera;
controlsRef.current = controls;
    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 1.65);
    dir.position.set(160, 300, 160);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.01;
    dir.shadow.camera.far = 3000;
    dir.shadow.camera.left = -800;
    dir.shadow.camera.right = 800;
    dir.shadow.camera.top = 800;
    dir.shadow.camera.bottom = -800;
    scene.add(dir);
    scene.add(dir.target);
// ===== Camera helpers =====
const camTarget = controls.target;            // مرکز نگاه
function placeCam(yawDeg: number, pitchDeg: number, dist: number) {
  // yaw: 0 = جلو (در راستای +Z)، 90 = راست (+X)
  // pitch: 0 = افق، 90 = نگاه از بالا
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pitchDeg, 1, 89));

  const r = Math.max(5, dist);
  const x = camTarget.x + r * Math.sin(yaw) * Math.cos(pitch);
  const y = camTarget.y + r * Math.sin(pitch);
  const z = camTarget.z + r * Math.cos(yaw) * Math.cos(pitch);

  camera.position.set(x, y, z);
  camera.lookAt(camTarget);
  controls.update();
}

function zoomStep(delta: number) {
  const d = Math.max(5, zoomRef.current + delta);
  zoomRef.current = d;
  // جایگذاری مجدد با همان زاویه فعلی
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir); // به جلو نگاه می‌کند
  camera.position.copy(camTarget.clone().addScaledVector(dir.negate(), d));
}

function rotateAroundTarget(deltaYawDeg: number) {
  // یواش‌یواش به دور هدف بچرخ
  const v = camera.position.clone().sub(camTarget);
  const yaw = Math.atan2(v.x, v.z) * 180/Math.PI + deltaYawDeg;
  const pitch = Math.atan2(v.y, Math.sqrt(v.x*v.x + v.z*v.z)) * 180/Math.PI;
  placeCam(yaw, pitch, v.length());
}

function tilt(deltaPitchDeg: number) {
  const v = camera.position.clone().sub(camTarget);
  const yaw = Math.atan2(v.x, v.z) * 180/Math.PI;
  const pitch = THREE.MathUtils.clamp(
    Math.atan2(v.y, Math.sqrt(v.x*v.x + v.z*v.z)) * 180/Math.PI + deltaPitchDeg, 5, 85
  );
  placeCam(yaw, pitch, v.length());
}

// نماهای آماده
const views = {
  front:   () => placeCam(0,   20, zoomRef.current),
  back:    () => placeCam(180, 20, zoomRef.current),
  left:    () => placeCam(-90, 20, zoomRef.current),
  right:   () => placeCam(90,  20, zoomRef.current),
  top:     () => placeCam(0,   85, zoomRef.current),
  isoNE:   () => placeCam(45,  35, zoomRef.current),   // ایزومتریک شمال‌شرق
  isoNW:   () => placeCam(-45, 35, zoomRef.current),
  isoSE:   () => placeCam(135, 35, zoomRef.current),
  isoSW:   () => placeCam(-135,35, zoomRef.current),
};

    // Ground
// Ground (🔹 سطح ساده و یکنواخت بدون بافت)
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshStandardMaterial({
    color: "#006767",     // 🔹 رنگ ساده خاکستری (می‌تونی عوضش کنی مثل "#2a2a2a" یا "#dddddd")
    roughness: 0.9,
    metalness: 0.03
  })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
ground.receiveShadow = true;
scene.add(ground);

    const worldGroupForFit = new THREE.Group();
    scene.add(worldGroupForFit);
worldRef.current = worldGroupForFit;
    const raycaster = new THREE.Raycaster();
    const LIGHT_TO_POS = new THREE.Vector3();
    const computeLightDir = () => {
      const toScene = new THREE.Vector3().copy(dir.target.position).sub(dir.position).normalize();
      LIGHT_TO_POS.copy(toScene).negate();
    };
    // Default sun
    const setSunByAzAlt = (azDeg: number, altDeg: number) => {
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
      if (ROAD_GRAPH) recomputeEdgeShades(ROAD_GRAPH);
    };

    // Fit camera helper
    function fitCameraTo(object: THREE.Object3D) {
      const { minX, maxX, minZ, maxZ, centerX, centerZ } = getXZBox(object);
      const spanX = maxX - minX,
        spanZ = maxZ - minZ;
      const span = Math.max(spanX, spanZ) || 1;
      const padding = 1.2;
      const dist = (span * padding) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      camera.position.set(centerX + dist * 0.8, dist * 0.9, centerZ + dist * 0.8);
      controls.target.set(centerX, 0, centerZ);
      controls.update();
    }

    function tightenCityToRoads(cityRig: THREE.Group, roadsGroup: THREE.Group) {
      const rb = getXZBox(roadsGroup);
      const cb = getXZBox(cityRig);
      const shift = new THREE.Vector3(rb.centerX - cb.centerX, 0, rb.centerZ - cb.centerZ);
      cityRig.position.add(shift);

      let scale = cityRig.scale.x;
      const margin = 0.2; // لبه‌ی امن
      let guard = 0;
      while (guard++ < 220) {
        const c = getXZBox(cityRig);
        const outL = c.minX < rb.minX - margin;
        const outR = c.maxX > rb.maxX + margin;
        const outT = c.minZ < rb.minZ - margin;
        const outB = c.maxZ > rb.maxZ + margin;
        if (!(outL || outR || outT || outB)) break;
        scale *= 0.985; // نرم کوچک کن
        cityRig.scale.set(scale, scale, scale);
      }
    }

    function autoRotateCityToFit(cityRig: THREE.Group, roadsGroup: THREE.Group) {
      const rb = getXZBox(roadsGroup);
      let bestRot = cityRig.rotation.y;
      let bestPenalty = Infinity;

      const penalty = () => {
        const c = getXZBox(cityRig);
        const p = Math.max(0, rb.minX - c.minX) + Math.max(0, c.maxX - rb.maxX) + Math.max(0, rb.minZ - c.minZ) + Math.max(0, c.maxZ - rb.maxZ);
        return p;
      };

      for (let deg = -25; deg <= 25; deg += 0.5) {
        cityRig.rotation.y = THREE.MathUtils.degToRad(deg);
        const p = penalty();
        if (p < bestPenalty) {
          bestPenalty = p;
          bestRot = cityRig.rotation.y;
        }
      }
      cityRig.rotation.y = bestRot;
    }

    // Globals for roads/city
    let norm: { cx: number; cz: number; span: number; fit: number; N: (v: V3) => V3 } | null = null;
    let llToLocal: ((lon: number, lat: number) => V3) | null = null;
    let ALL_CURVES: THREE.Curve<V3>[] = [];
    let roadsGroupRef: THREE.Group | null = null;
    let luRef: THREE.Group | null = null;
    let cityRig: THREE.Group | null = null;
    let baseScaleS = 1,
      baseScaleH = 7.0;
    let ROAD_GRAPH: RoadGraph | null = null;

    function recomputeEdgeShades(g: RoadGraph) {
      // re-evaluate using current light direction
      const approximateEdgeShade = (poly: V3[]) => {
        if (poly.length < 2) return 0;
        let shaded = 0,
          total = 0;
        for (let i = 0; i < SHADE_SAMPLES_PER_EDGE; i++) {
          const t = (i + 0.5) / SHADE_SAMPLES_PER_EDGE;
          const q = poly[0].clone().lerp(poly[1], t);
          const origin = new THREE.Vector3(q.x, q.y + SHADE_LOOKAHEAD, q.z);
          raycaster.set(origin, LIGHT_TO_POS);
          const hit = raycaster.intersectObject(worldGroupForFit, true)[0];
          if (hit && hit.distance < 500) shaded++;
          total++;
        }
        return total > 0 ? shaded / total : 0;
      };
      for (const e of g.edges) e.shadeScore = approximateEdgeShade(e.poly);
    }

    // ===== City & Roads Loaders =====
    (async () => {
      setSunByAzAlt(160, 45); // default
      computeLightDir();

      const ASSET_BASE = await pickBase(CANDIDATES);

      // Roads
      let gj: any;
      try {
        if (!ASSET_BASE) throw new Error("no-assets");
        const r = await fetch(ASSET_BASE + "/Lines_Edges.geojson");
        if (!r.ok) throw new Error("HTTP " + r.status);
        gj = await r.json();
      } catch {
        // fallback
        gj = {
          type: "FeatureCollection",
          features: [
            { type: "Feature", geometry: { type: "LineString", coordinates: [[51.377, 35.7], [51.38, 35.703], [51.384, 35.706], [51.388, 35.709], [51.392, 35.712]] } },
          ],
        };
      }

      const coords: any[] = [];
      for (const f of gj.features || []) {
        const g = f.geometry;
        if (!g) continue;
        const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
        for (const arr of lines) for (const p of arr) coords.push(p);
      }
      llToLocal = makeLLToLocal(coords);
      const localPts = coords.map(([x, y]: any) => {
        const ll = isLonLat([x, y]) ? [x, y] : webMercatorToLonLat(x, y);
        return (llToLocal as any)(ll[0], ll[1]) as V3;
      });
      let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (const p of localPts) {
        if (!isFinite(p.x) || !isFinite(p.z)) continue;
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      const cx = (minX + maxX) / 2,
        cz = (minZ + maxZ) / 2;
      const span = Math.max(maxX - minX, maxZ - minZ) || 1;
      const fit = 80 / span;
      const N = (v: V3) => new THREE.Vector3((v.x - cx) * fit, 0, (v.z - cz) * fit);
      norm = { cx, cz, span, fit, N };

      const roadsGroup = new THREE.Group();
      const curves: THREE.Curve<V3>[] = [];
      for (const f of gj.features || []) {
        const g = f.geometry;
        if (!g) continue;
        const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
        for (const arr of lines) {
          const pts = arr.map(([lon, lat]: any) => {
            const ll = isLonLat([lon, lat]) ? [lon, lat] : webMercatorToLonLat(lon, lat);
            return N((llToLocal as any)(ll[0], ll[1])) as V3;
          });
          const t = tubeFromPoints(pts, ROAD_RADIUS);
          if (t) {
            roadsGroup.add(t.mesh);
            curves.push(t.curve);
          }
        }
      }
      worldGroupForFit.add(roadsGroup);
      roadsGroupRef = roadsGroup;
      ALL_CURVES = curves;

      // Landuse optional
      /*try {
        if (!ASSET_BASE) throw new Error("no-assets");
        const rL = await fetch(ASSET_BASE + "/Landuse.geojson");
        if (!rL.ok) throw new Error("HTTP " + rL.status);
        const gjL = await rL.json();
        const LU_COLORS: Record<string, string> = { "01": "#e31a1c", "02": "#fb9a99", "03": "#1f78b4", "04": "#a6cee3", "05": "#33a02c", "06": "#b2df8a", "07": "#ff7f00", "08": "#fdbf6f", "09": "#6a3d9a", "10": "#cab2d6", "11": "#b15928" };
        const LU_FALLBACK = "#d9d9d9";
        const polygonToShapes = (polyCoordsLL: number[][][], Nf: (v: V3) => V3, ll2local: any) => {
          const rings = polyCoordsLL.map((ring: number[][]) => {
            const pts = ring.map(([lon, lat]) => {
              const ll = isLonLat([lon, lat]) ? [lon, lat] : webMercatorToLonLat(lon, lat);
              const p3 = Nf(ll2local(ll[0], ll[1]));
              return new THREE.Vector2(p3.x, p3.z);
            });
            return pts;
          });
          const shape = new THREE.Shape(rings[0]);
          for (let i = 1; i < rings.length; i++) shape.holes.push(new THREE.Path(rings[i]));
          return [shape];
        };
        const drawLanduse = (gjAny: any, Nf: (v: V3) => V3, ll2local: any) => {
          const group = new THREE.Group();
          for (const f of gjAny.features || []) {
            const g = f.geometry;
            if (!g) continue;
            const codeRaw = f.properties?.Landuse ?? f.properties?.code ?? f.properties?.final ?? f.properties?.LanduseFinal ?? "";
            const code = String(codeRaw).padStart(2, "0");
            const col = (LU_COLORS as any)[code] || (LU_COLORS as any)[codeRaw] || LU_FALLBACK;
            const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
            for (const poly of polys) {
              const shapes = polygonToShapes(poly, N, llToLocal);
              for (const sh of shapes) {
                const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.18, bevelEnabled: false });
                geo.rotateX(-Math.PI / 2);
                const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.y = 0.01;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                group.add(mesh);
                const edges = new THREE.EdgesGeometry(geo);
                const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: "#ffffff" }));
                line.position.copy(mesh.position);
                group.add(line);
              }
            }
          }
          group.renderOrder = 1;
          return group;
        };
        luRef = drawLanduse(gjL, N, llToLocal);
        worldGroupForFit.add(luRef);
      } catch {
        // optional
      }*/

      // City
    async function loadAndFitCity() {
  try {
    if (!ASSET_BASE) throw new Error("no-assets");
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
    loader.setDRACOLoader(draco);
    const gltf = await new Promise<any>((res, rej) =>
      loader.load(ASSET_BASE + "/city.glb", res, undefined, rej)
    );
    let model = gltf.scene;

    model.traverse((o: any) => {
      if (!o.isMesh) return;
      if (o.geometry && !o.geometry.attributes.normal)
        o.geometry.computeVertexNormals();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) {
        let m = mats[i];
        if (!m) continue;
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
          m.vertexColors = !!o.geometry.attributes.color;
          m.metalness = Math.min(m.metalness ?? 0, 0.1);
          m.roughness = Math.max(m.roughness ?? 1, 0.9);
          m.side = THREE.DoubleSide;
          // 👇 فقط این خط اضافه شده برای رنگ آبی فیروزه‌ای
          m.color = new THREE.Color("#7FCBD0");
          m.needsUpdate = true;
        } else {
          m = new THREE.MeshStandardMaterial({
            color: new THREE.Color("#7FCBD0"), // 👈 همینجا هم رنگ اعمال میشه
            vertexColors: !!o.geometry.attributes.color,
            roughness: 0.92,
            metalness: 0.0,
            side: THREE.DoubleSide,
          });
          mats[i] = m;
        }
      }
      o.material = Array.isArray(o.material) ? mats : mats[0];
  


});

          const preBox = new THREE.Box3().setFromObject(model);
          const preSize = preBox.getSize(new THREE.Vector3());
          const preCenter = preBox.getCenter(new THREE.Vector3());
          const nativeSpan = Math.max(preSize.x, preSize.z) || 1;
          const spanTarget = (norm as any).span * (norm as any).fit;
          const s = (spanTarget * 0.84) / nativeSpan;
          baseScaleS = s;
          model.position.set(-preCenter.x, -preBox.min.y, -preCenter.z);
          model.scale.set(1, baseScaleH, 1);

          cityRig = new THREE.Group();
          enableShadowOn(model);
          cityRig.scale.set(s, s, s);
          cityRig.position.y = 0.05;          // --- نادج ثابت برای فیت دقیق محله روی مسیرها ---
       
          cityRig.add(model);
          worldGroupForFit.add(cityRig);
  cityRig.position.x = -0.5;   // حرکت به راست
cityRig.position.z =1;   // حرکت به جلو
cityRig.rotation.y =- 0.07;

        } catch {
          const g = new THREE.Group();
          g.position.y = 0.05;
          for (let i = 0; i < 60; i++) {
            const w = 2 + Math.random() * 4,
              d = 2 + Math.random() * 4,
              h = 1 + Math.random() * 5;
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: "#9cc3d5", roughness: 0.9 }));
            m.position.set((Math.random() - 0.5) * 60, h / 2, (Math.random() - 0.5) * 60);
            m.castShadow = true;
            m.receiveShadow = true;
            g.add(m);
          }
          baseScaleS = 1.0;
          cityRig = g;
          worldGroupForFit.add(cityRig);
          fitCameraTo(worldGroupForFit);
        }
      }


 await loadAndFitCity();

//if (roadsGroupRef && cityRig) autoRotateCityToFit(cityRig, roadsGroupRef);
//if (roadsGroupRef && cityRig) tightenCityToRoads(cityRig, roadsGroupRef);

// ✅ تابع محلی برای تگ کردن مش‌ها به‌عنوان مانع
function markObstacles(obj: THREE.Object3D) {
  const stack: THREE.Object3D[] = [obj];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if ((current as any).isMesh) (current as any).userData.isObstacle = true;
    if (current.children.length > 0) stack.push(...current.children);
  }
}

// 👇 اجرای تگ‌گذاری روی هر دو گروه
if (cityRig) markObstacles(cityRig);
if (luRef) markObstacles(luRef);

      fitCameraTo(worldGroupForFit);
      views.isoNE(); // یا هر نمای دلخواه

if (roadsGroupRef) {
  roadsGroupRef.traverse((o: any) => {
    if (o.isMesh) {
      o.visible = true;          // پنهان از صحنه
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}
const g = cityRig as THREE.Group | null;
if (g) {
  // جابه‌جایی (اختیاری)
  g.position.add(new THREE.Vector3(0, 0, 3));

  // اسکیل: کمی کوچک‌ترش کن
  g.scale.multiplyScalar(0.99); // هرچی کمتر از 1، کوچک‌تر

  // چرخش حول محور Y (درجه → رادیان)
  g.rotation.y += THREE.MathUtils.degToRad(3); // مقدار رو به سلیقه تغییر بده
}

      // Build road graph
      const graph = buildRoadGraphFromCurves(ALL_CURVES, worldGroupForFit, raycaster, LIGHT_TO_POS);
      ROAD_GRAPH = graph;

      // Agents
      async function addAgent(color = "#ef4444", speed = 22) {
        let model: THREE.Object3D;
        try {
          if (!ASSET_BASE) throw new Error("no-assets");
          const loader = new GLTFLoader();
          const draco = new DRACOLoader();
        draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
         loader.setDRACOLoader(draco);
          const gltf = await new Promise<any>((res, rej) => loader.load(ASSET_BASE + "/human.glb", res, undefined, rej));
          model = gltf.scene;
          model.traverse((n: any) => {
            if (n.isMesh) {
              n.material = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0 });
              n.castShadow = true;
              n.receiveShadow = true;
            }
          });
        } catch {
          model = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
        }
        return new Agent(scene, model, { color, speed, fovHalfAngle: 36, fovRadius: 5, headingOffsetDeg: 60 });
      }

      const agents: Agent[] = [];
      const colors = ["#ef4444", "#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#10b981", "#e11d48", "#06b6d4"];
      const speeds = [26, 22, 18, 14, 20, 16, 24, 12];
   
      async function ensureAgentCount(n: number) {
        while (agents.length < n) {
          const a = await addAgent(colors[agents.length % colors.length], speeds[agents.length % speeds.length]);
          agents.push(a);
          seedAgentRoute(a);
        }
        while (agents.length > n) {
          const a = agents.pop()!;
          scene.remove(a.root);
        }
      }

      function randomWorldPointInGraph() {
        if (!ROAD_GRAPH || !ROAD_GRAPH.edges.length) return new THREE.Vector3();
        const e = ROAD_GRAPH.edges[Math.floor(Math.random() * ROAD_GRAPH.edges.length)];
        const t = Math.random();
        return e.poly[0].clone().lerp(e.poly[1], t);
      }

      function seedAgentRoute(a: Agent) {
        if (!ROAD_GRAPH) return;
        const src = randomWorldPointInGraph();
        const dst = randomWorldPointInGraph();
        const poly = findRouteOnRoads(ROAD_GRAPH!, src, dst, shadeRef.current);
        if (poly && poly.length > 1) a.setPolylineRoute(poly);
        a.setSpeedFactor(speedRef.current);
      }

      await ensureAgentCount(agentCountRef.current);

      // Path preview line (for route edit mode)
      const routePreview = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: new THREE.Color("#eab308"), transparent: true, opacity: 0.9 })
      );
      routePreview.renderOrder = 30;
      worldGroupForFit.add(routePreview);
      routePreview.visible = false;

      let pickSource: V3 | null = null;

      function setRoutePreview(poly: V3[] | null) {
        if (!poly || poly.length < 2) {
          routePreview.visible = false;
          return;
        }
        const arr: number[] = [];
        for (const p of poly) arr.push(p.x, p.y + 0.06, p.z);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
        ;(routePreview.geometry as THREE.BufferGeometry).dispose?.();
        routePreview.geometry = geo;
        routePreview.visible = true;
      }

      // Mouse picking for route editing
      function clientToGroundPoint(ev: MouseEvent) {
        const rect = renderer.domElement.getBoundingClientRect();
        const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
        const inter = raycaster.intersectObject(worldGroupForFit, true);
        for (const it of inter) {
          if ((it.object as any).userData?.isRoad || it.object === ground) {
            return it.point.clone();
          }
        }
        return null;
      }

      function onPointerMove(ev: MouseEvent) {
        if (routeEditMode !== "dest" || !pickSource || !ROAD_GRAPH) return;
        const p = clientToGroundPoint(ev);
        if (!p) return;
        const poly = findRouteOnRoads(ROAD_GRAPH, pickSource, p, shadeRef.current);
        setRoutePreview(poly);
      }

      function onClick(ev: MouseEvent) {
        if (!ROAD_GRAPH) return;
        const p = clientToGroundPoint(ev);
        if (!p) return;
        if (routeEditMode === "source") {
          pickSource = p.clone();
          setRoutePreview([p.clone()]);
          setRouteEditMode("dest");
        } else if (routeEditMode === "dest" && pickSource) {
          const poly = findRouteOnRoads(ROAD_GRAPH, pickSource, p, shadeRef.current);
          if (poly && poly.length > 1 && agents[0]) {
            agents[0].setPolylineRoute(poly);
          }
          pickSource = null;
          setRoutePreview(null);
          setRouteEditMode("off");
        }
      }

      renderer.domElement.addEventListener("mousemove", onPointerMove);
      renderer.domElement.addEventListener("click", onClick);

      // reroute timer
      let rerouteAcc = 0;

      // render loop
      let last = performance.now();
     const animate = () => {
  if (disposed) return;
  const t = performance.now();
  const dt = Math.min(0.033, (t - last) / 1000);
  last = t;

  // sun
  try {
    const d = new Date(whenRef.current);
    if (!isNaN(d as any)) {
      const sun = solarPositionUTC(latRef.current, lonRef.current, d);
      dir.position.copy(sun.vector.clone().multiplyScalar(1200));
      dir.target.position.set(0, 0, 0);
      dir.target.updateMatrixWorld();
      computeLightDir();
    }
  } catch {}

  // agents
  for (const a of agents) {
    a.setSpeedFactor(speedRef.current);
    if (!pausedRef.current) a.update(dt, raycaster, worldGroupForFit);
    (a.fov as any).visible = showFOVRef.current;
    a.fovSurf.visible = showFOVRef.current;
  }

  // auto reroute
  if (autoRerouteRef.current && !pausedRef.current) {
    rerouteAcc += dt;
    if (rerouteAcc > 7) {
      rerouteAcc = 0;
      if (ROAD_GRAPH) {
        for (const a of agents) {
          const current = a.currentPosition();
          const dst = randomWorldPointInGraph();
          const poly = findRouteOnRoads(ROAD_GRAPH, current, dst, shadeRef.current);
          if (poly && poly.length > 1) a.setPolylineRoute(poly);
        }
      }
    }
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
};

      requestAnimationFrame(animate);

      // Resize handling via ResizeObserver (more robust than window.resize)
      const ro = new ResizeObserver(() => {
        if (!mountRef.current) return;
        const w = Math.max(1, mountRef.current.clientWidth);
const h = Math.max(1, mountRef.current.clientHeight);
camera.aspect = w / h;
camera.updateProjectionMatrix();
setRendererSize();
      });
 
      // Keyboard shortcuts
      function onKey(e: KeyboardEvent) {
        if (e.key === " ") setPaused((p) => !p);
        if (e.key.toLowerCase() === "f") setShowFOV((v) => !v);
        if (e.key.toLowerCase() === "r") setAutoReroute((v) => !v);
      }
      window.addEventListener("keydown", onKey);

      // Cleanup
      return () => {
        disposed = true;
        ro.disconnect();
         worldRef.current = null;
        window.removeEventListener("keydown", onKey);
        renderer.domElement.removeEventListener("mousemove", onPointerMove);
        renderer.domElement.removeEventListener("click", onClick);
        renderer.dispose();
        mountRef.current?.removeChild(renderer.domElement);
        // dispose simple materials/geometries we created here
        routePreview.geometry.dispose();
        (routePreview.material as THREE.Material).dispose();
      };
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
function fitCameraToUsingRefs(mode:
  "front"|"back"|"left"|"right"|"top"|
  "isoNE"|"isoSE"|"isoSW"|"isoNW" = "isoNE") {

  const camera = cameraRef.current;
  const controls = controlsRef.current;
  const world = worldRef.current;
  if (!camera || !controls || !world) return;

  // محاسبه باکس و مرکز
  const box = new THREE.Box3().setFromObject(world);
  const min = box.min, max = box.max;
  const center = new THREE.Vector3(
    (min.x + max.x) / 2, 0, (min.z + max.z) / 2
  );
  const span = Math.max(max.x - min.x, max.z - min.z) || 1;

  // فاصلهٔ مناسب با توجه به FoV
  const padding = 1.2;
  const dist = (span * padding) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));

  // جهت دوربین بر اساس mode
  const dirs: Record<string, THREE.Vector3> = {
    front: new THREE.Vector3(0, 0.25, 1),
    back:  new THREE.Vector3(0, 0.25, -1),
    left:  new THREE.Vector3(1, 0.25, 0),
    right: new THREE.Vector3(-1, 0.25, 0),
    top:   new THREE.Vector3(0, 1, 0.0001),
    isoNE: new THREE.Vector3(-1, 0.7, -1),
    isoSE: new THREE.Vector3(-1, 0.7,  1),
    isoSW: new THREE.Vector3( 1, 0.7,  1),
    isoNW: new THREE.Vector3( 1, 0.7, -1),
  };
  const dir = dirs[mode].clone().normalize();

  // اعمال روی دوربین/کنترل‌ها
  const target = center;
  camera.position.copy(target.clone().addScaledVector(dir, dist));
  camera.up.set(0, 1, 0);
  controls.target.copy(target);
  controls.update();
}



  // Presets for sun
  const applyPreset = (name: "noon" | "sunset" | "night") => {
    const now = new Date(whenISO);
    if (name === "noon") now.setUTCHours(12, 0, 0, 0);
    if (name === "sunset") now.setUTCHours(18, 0, 0, 0);
    if (name === "night") now.setUTCHours(0, 30, 0, 0);
    setWhenISO(now.toISOString());
  };

  // Screenshot
  const handleScreenshot = () => {
    const cv = mountRef.current?.querySelector("canvas");
    if (!cv) return;
    const a = document.createElement("a");
    a.href = (cv as HTMLCanvasElement).toDataURL("image/png");
    a.download = `citysim_${Date.now()}.png`;
    a.click();
  };

  return (
    <div style={{ height: "100vh", width: "100vw", background: "#0b1120", color: "#e5e7eb", fontFamily: "IRANSans,system-ui", overflow: "hidden" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />

      {/* Controls */}
      <div style={{ position: "absolute", left: 10, bottom: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", zIndex: 15, background: "rgba(17,24,39,0.6)", padding: 8, borderRadius: 10, border: "1px solid #0f172a" }}>
     
<div style={{ display:"flex", gap:6, marginTop:10 }}>
  <button style={btnSm} onClick={() => rotateAroundTargetRef(-10)}>چرخش ⟲</button>
  <button style={btnSm} onClick={() => rotateAroundTargetRef(+10)}>چرخش ⟳</button>
  <button style={btnSm} onClick={() => tiltRef(+5)}>تیلت ↑</button>
  <button style={btnSm} onClick={() => tiltRef(-5)}>تیلت ↓</button>
</div>

<div style={{ display:"flex", gap:6, alignItems:"center", marginTop:10 }}>
  <span>زوم</span>
  <button style={btnSm} onClick={() => zoomStepRef(-10)}>➖</button>
  <input
    type="range" min={2} max={2000} step={5} value={zoomDist}
    onChange={(e) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      setZoomDist(v);
      zoomRef.current = v;
      const cam = cameraRef.current, ctr = controlsRef.current;
      if (cam && ctr) {
        const dir = new THREE.Vector3();
        cam.getWorldDirection(dir);
        cam.position.copy(ctr.target.clone().addScaledVector(dir.negate(), v));
      }
    }}
    style={rng}
  />
  <button style={btnSm} onClick={() => zoomStepRef(+10)}>➕</button>
</div>

        <button onClick={() => setPaused((p) => !p)} style={btn} title="Space">⏯️ {paused ? "ادامه" : "توقف"}</button>
        <button onClick={handleScreenshot} style={btn}>📸 اسکرین‌شات</button>
      
        <label style={lbl}>سرعت
          <input type="range" min={0.3} max={5.0} step={0.1} value={speedK} onChange={(e) => setSpeedK(parseFloat((e.target as HTMLInputElement).value))} style={rng} />
        </label>
      

      
        <div style={{ display: "inline-flex", gap: 6 }}>
          <button style={btnSm} onClick={() => applyPreset("noon")}>🌙 شب</button>
          <button style={btnSm} onClick={() => applyPreset("sunset")}>☀️ ظهر</button>
          <button style={btnSm} onClick={() => applyPreset("night")}>🌇 غروب</button>
        </div>
        <label style={lbl}>وزن سایه
          <input type="range" min={0} max={1} step={0.05} value={shadeBias} onChange={(e) => setShadeBias(parseFloat((e.target as HTMLInputElement).value))} style={rng} />
        </label>
        <label style={lbl}><input type="checkbox" checked={autoReroute} onChange={(e) => setAutoReroute(e.target.checked)} /> مسیر‌یابی خودکار</label>
        <label style={lbl}><input type="checkbox" checked={showFOV} onChange={(e) => setShowFOV(e.target.checked)} /> نمایش FOV</label>
        <button style={btn} onClick={() => setRouteEditMode("source")} disabled={routeEditMode !== "off"}>🧭 مسیر دستی</button>
    
      </div>

      {/* NOTE: scene updates are handled inside rAF loop via refs. Agent count change needs full rebuild, so we sync url & reload. */}
      <StateSync agentCount={agentCount} />
    </div>
    
  );
  
};

// Sync agentCount via URL, and force a soft reload when it changes (to rebuild scene once)
const StateSync: React.FC<{ agentCount: number }> = ({ agentCount }) => {
  const prev = useRef(agentCount);
  useEffect(() => {
    if (prev.current !== agentCount) {
      const url = new URL(window.location.href);
      url.hash = `agents=${agentCount}`;
      history.replaceState(null, "", url.toString());
      // Force remount by tiny hash change (soft):
      setTimeout(() => {
        // In real app consider context/store. For this demo we refresh.
        window.location.hash = `agents=${agentCount}&t=${Date.now()}`;
        window.location.reload();
      }, 150);
    }
    prev.current = agentCount;
  }, [agentCount]);
  return null;
};

const btn: React.CSSProperties = { padding: "8px 12px", borderRadius: 10, border: "1px solid #0f172a", background: "#111827", color: "#e5e7eb", cursor: "pointer" };
const btnSm: React.CSSProperties = { ...btn, padding: "6px 8px", fontSize: 12 };
const lbl: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6 };
const rng: React.CSSProperties = { width: 140 };
const num: React.CSSProperties = { width: 120 };
const txt: React.CSSProperties = { width: 210 };

export default CitySimIsometric;
