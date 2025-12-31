// src/pages/transport.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L, { LatLngExpression, LatLngTuple, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";

// اگر اسم کامپوننت سایه‌زن توی پروژه فرق داره، مسیر/نام رو مطابق فایل خودت تغییر بده.
// اگر هنوز نساختی، همین import رو موقتاً با کامنت غیرفعال کن.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import RouteShadowLayer from "../components/RouteShadowLayer";

// ───────── types ─────────
type GJPoint = [number, number]; // [lng,lat]
type GJFeature = { type: "Feature"; properties?: any; geometry: any };
type GJFC = { type: "FeatureCollection"; features: GJFeature[] };
type ApiResponse = { routes_final: GJFC; meta?: any };
type DestInfo = { Id: number; coord: LatLngTuple; landuse?: string };

// ───────── رنگ‌های کاربری (1..9) ─────────
const LANDUSE_COLORS: Record<string, string> = {
  "1": "#FFFFBE",
  "2": "#FF0000",
  "3": "#A3FF73",
  "4": "#267300",
  "5": "#895A44",
  "6": "#FF00C5",
  "7": "#828282",
  "8": "#00E6A9",
  "9": "#005CE6",
};

// فقط این شناسه‌ها زرد شوند
const YELLOW_AGENT_IDS: number[] = [999, 971, 438];
const YELLOW_COLOR = "#facc15";

// ───────── helpers ─────────
const pickLanduse = (props: any): string => {
  const v =
    props?.Landuse ?? props?.landuse ?? props?.LANDUSE ??
    props?.initial_la ?? props?.Initial_La ?? props?.INITIAL_LA;
  return v != null ? String(v) : "";
};

const distLL = (a: LatLngTuple, b: LatLngTuple) => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lat1, lon1] = a, [lat2, lon2] = b;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const A =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A));
};

const pickTargetIds = (dests: DestInfo[]): number[] =>
  [1, 2, 3, 4].filter((id) => dests.some((d) => d.Id === id));

// محدودهٔ منطقی برای مختصات شهر (برای جلوگیری از سنجاق اشتباه)
const BBOX = { minLng: 45.0, maxLng: 48.5, minLat: 33.5, maxLat: 36.0 };
const isValidLL = (lat: number, lng: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= BBOX.minLat &&
  lat <= BBOX.maxLat &&
  lng >= BBOX.minLng &&
  lng <= BBOX.maxLng;

// سنجاق‌کردن امن انتهای مسیر به مقصد هم‌Id
const snapRoutesToDestinations = (
  routes: GJFC | null,
  dests: DestInfo[],
  meterTol = 3
): GJFC | null => {
  if (!routes) return null;

  const destById: Record<number, DestInfo> = {};
  dests.forEach((d) => (destById[d.Id] = { ...d }));

  const feats = (routes.features || []).map((f) => {
    const id = Number(f.properties?.agentId) || 0;
    const dest = destById[id];
    const cs = (f.geometry?.coordinates || []) as [number, number][];

    if (!dest || cs.length < 1) return f;

    const lastLL: LatLngTuple = [cs[cs.length - 1][1], cs[cs.length - 1][0]];
    let dLL: LatLngTuple = dest.coord;

    // sanity check مقصد
    if (!isValidLL(dLL[0], dLL[1])) {
      // شاید lat/lng جابجا ذخیره شده باشد → یکبار swap امتحان کن
      const swapped: LatLngTuple = [dLL[1], dLL[0]];
      if (isValidLL(swapped[0], swapped[1])) {
        dLL = swapped;
        dest.coord = swapped;
      } else {
        // هنوز نامعتبر → سنجاق نکن
        return f;
      }
    }

    const dMeters = distLL(lastLL, dLL);
    if (dMeters > 800) return f; // خیلی دور: رها کن
    if (dMeters > meterTol) {
      const appended = [...cs, [dLL[1], dLL[0]]]; // [lng,lat]
      return { ...f, geometry: { ...f.geometry, coordinates: appended } };
    }
    return f;
  });

  return { type: "FeatureCollection", features: feats };
};

// ───────── datasets ─────────
function useDestinations(): DestInfo[] {
  const [dests, setDests] = useState<DestInfo[]>([]);
  useEffect(() => {
    let aborted = false;
    fetch("/destinations.geojson")
      .then((r) => {
        if (!r.ok) throw new Error(`destinations HTTP ${r.status}`);
        return r.json();
      })
      .then((fc: GJFC) => {
        if (aborted) return;
        const list: DestInfo[] = [];
        for (const f of fc.features) {
          if (f.geometry?.type !== "Point") continue;
          const [lng, lat] = f.geometry.coordinates as GJPoint;
          const Id = Number(
            f.properties?.Id ?? f.properties?.id ?? f.properties?.ID
          );
          const landuse = pickLanduse(f.properties);
          if (Number.isFinite(Id)) list.push({ Id, coord: [lat, lng], landuse });
        }
        const filtered = pickTargetIds(list)
          .map((i) => list.find((d) => d!.Id === i)!)
          .filter(Boolean) as DestInfo[];
        setDests(filtered);
      })
      .catch((e) => {
        console.error("destinations error:", e);
        setDests([]);
      });
    return () => {
      aborted = true;
    };
  }, []);
  return dests;
}

// ───────── لایه‌های پایه ─────────
function UnderlayLineEdge() {
  const map = useMap();
  const ref = useRef<L.GeoJSON | null>(null);
  useEffect(() => {
    if (!map.getPane("underlay")) map.createPane("underlay").style.zIndex = "350";
    let aborted = false;
    fetch("/Lines_Edges.geojson")
      .then((r) => {
        if (!r.ok) throw new Error(`Lines_Edges HTTP ${r.status}`);
        return r.json();
      })
      .then((gj) => {
        if (aborted) return;
        ref.current = L.geoJSON(gj as any, {
          pane: "underlay",
          style: () => ({ color: "#002223", weight: 2, opacity: 0.25 }),
        }).addTo(map);
      })
      .catch((e) => console.error("UnderlayLineEdge error:", e));
    return () => {
      aborted = true;
      ref.current?.remove();
      ref.current = null;
    };
  }, [map]);
  return null;
}

function BasePolygons() {
  const map = useMap();
  const ref = useRef<L.GeoJSON | null>(null);

  // نگاشت رنگ برای هر Id از پلیگون‌های BasePLIGON.geojson
  // قبلی‌ها (1005/1000/445) زرد بمانند؛ موارد جدید طبق درخواست:
  const HIGHLIGHT_COLORS: Record<number, string> = {
    999: "#facc15", // زرد
    971: "#facc15", // زرد
    43:  "#facc15", // زرد
    24:   "#ef4444", // قرمز
    19:   "#ef4444", // قرمز
    631:  "#14532d", // سبز تیره
    195:  "#7c3aed", // بنفش
  214:  "#7c3aed", // بنفش
  };

  useEffect(() => {
    if (!map.getPane("basepoly")) {
      const p = map.createPane("basepoly");
      p.style.zIndex = "300";
      p.style.pointerEvents = "none";
    }

    let aborted = false;
    fetch("/BasePLIGON.geojson")
      .then((r) => {
        if (!r.ok) throw new Error(`BasePLIGON HTTP ${r.status}`);
        return r.json();
      })
      .then((gj) => {
        if (aborted) return;
        ref.current = L.geoJSON(gj as any, {
          pane: "basepoly",
          style: (f: any) => {
            const pid = Number(f?.properties?.Id ?? f?.properties?.ID ?? f?.properties?.id);
            const color = Number.isFinite(pid) ? HIGHLIGHT_COLORS[pid as number] : undefined;

            if (color) {
              return {
                color,           // خط دور
                weight: 2,
                opacity: 0.9,
                fillColor: color, // رنگ پر
                fillOpacity: 0.35,
              };
            }

            // حالت پیش‌فرض
            return {
              color: "#003738",
              weight: 1,
              opacity: 0.6,
              fillColor: "#003738",
              fillOpacity: 0.12,
            };
          },
          interactive: false,
        }).addTo(map);
      })
      .catch((e) => console.error("BasePolygons error:", e));

    return () => {
      aborted = true;
      ref.current?.remove();
      ref.current = null;
    };
  }, [map]);

  return null;
}

// ───────── انیمیشن ایجنت‌ها + خروجی pos/bearing ─────────
function AgentsLayer({
  features,
  colorsByAgent,
  animate,
  onAgentsUpdate,
}: {
  features: GJFeature[];
  colorsByAgent: Record<number, string>;
  animate: boolean;
  onAgentsUpdate?: (m: Record<number, { pos: LatLngTuple; bearing: number }>) => void;
}) {
  const map = useMap();
  const groupRef = useRef<LayerGroup | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);

  type Agent = {
    id: number;
    marker: L.CircleMarker;
    path: LatLngTuple[];
    segLengths: number[];
    totalLen: number;
    speedMps: number;
    progress: number;
  };
  const agents = useRef<Agent[]>([]);

  useEffect(() => {
    if (!animate) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    groupRef.current?.clearLayers();
    groupRef.current?.remove();
    agents.current = [];
    lastTsRef.current = 0;

    const group = L.layerGroup().addTo(map);
    groupRef.current = group;

    features.forEach((f) => {
      const id = Number(f.properties?.agentId) || 0;
      const cs = (f.geometry?.coordinates || []) as GJPoint[];
      if (!id || cs.length < 2) return;

      const path: LatLngTuple[] = cs.map(([lng, lat]) => [lat, lng]);
      const seg: number[] = [];
      let total = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const l = distLL(path[i], path[i + 1]);
        seg.push(l);
        total += l;
      }
      if (total <= 0) return;

      const c = colorsByAgent[id] || "#10b981";
      const speedMps = 14 + ((id - 1) % 4) * 0.4;
      const marker = L.circleMarker(path[0], {
        radius: 6,
        weight: 2,
        color: c,
        fillColor: c,
        fillOpacity: 0.95,
      }).addTo(group);

      agents.current.push({
        id,
        marker,
        path,
        segLengths: seg,
        totalLen: total,
        speedMps,
        progress: 0,
      });
    });

    const tick = (ts: number) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      const out: Record<number, { pos: LatLngTuple; bearing: number }> = {};

      agents.current.forEach((a) => {
        if (a.totalLen <= 0) return;
        a.progress = (a.progress + a.speedMps * dt) % a.totalLen;

        let acc = 0,
          si = 0;
        while (si < a.segLengths.length && acc + a.segLengths[si] < a.progress) {
          acc += a.segLengths[si];
          si++;
        }
        if (si >= a.path.length - 1) si = a.path.length - 2;

        const p0 = a.path[si];
        const p1 = a.path[si + 1];
        const segLen = a.segLengths[si] || 1;
        const t = Math.max(0, Math.min(1, (a.progress - acc) / segLen));
        const lat = p0[0] + (p1[0] - p0[0]) * t;
        const lng = p0[1] + (p1[1] - p0[1]) * t;

        // bearing از p0 → p1
        const lat1 = (p0[0] * Math.PI) / 180;
        const lat2 = (p1[0] * Math.PI) / 180;
        const dLon = ((p1[1] - p0[1]) * Math.PI) / 180;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x =
          Math.cos(lat1) * Math.sin(lat2) -
          Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        const brg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

        const pos: LatLngTuple = [lat, lng];
        a.marker.setLatLng(pos);
        out[a.id] = { pos, bearing: brg };
      });

      onAgentsUpdate?.(out);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      groupRef.current?.clearLayers();
      groupRef.current?.remove();
      groupRef.current = null;
      agents.current = [];
    };
  }, [features, colorsByAgent, animate, map, onAgentsUpdate]);

  return null;
}

// ───────── FOV ─────────
function FOVLayer({
  enabled,
  agentStates,
  radiusM = 60,
  fovDeg = 60,
  buildingsUrl = "/buildings.geojson",
  updateHz = 4,
}: {
  enabled: boolean;
  agentStates: Record<number, { pos: LatLngTuple; bearing: number }>;
  radiusM?: number;
  fovDeg?: number;
  buildingsUrl?: string;
  updateHz?: number;
}) {
  const map = useMap();
  const groupRef = useRef<LayerGroup | null>(null);
  const timerRef = useRef<any>(null);
  const buildingsRef = useRef<GJFC>({ type: "FeatureCollection", features: [] });
  const agentsRef = useRef<Record<number, { pos: LatLngTuple; bearing: number }>>({});
  const perAgentLayersRef = useRef<Map<number, { sector?: L.GeoJSON; interGroup?: L.LayerGroup }>>(new Map());

  useEffect(() => { agentsRef.current = agentStates; }, [agentStates]);

  const metersToDeg = (lat: number, dx: number, dy: number) => {
    const dLat = dy / 111320;
    const dLon = dx / (111320 * Math.cos((lat * Math.PI) / 180) || 1e-9);
    return { dLat, dLon };
  };
  const sectorPolygon = (center: LatLngTuple, rM: number, bearing: number, fov: number, steps = 48) => {
    const [lat0, lng0] = center;
    const half = fov / 2;
    const start = bearing - half;
    const end = bearing + half;
    const pts: [number, number][] = [[lng0, lat0]];
    for (let a = start; a <= end; a += Math.max(1, fov / steps)) {
      const rad = (a * Math.PI) / 180;
      const dx = Math.sin(rad) * rM;
      const dy = Math.cos(rad) * rM;
      const { dLat, dLon } = metersToDeg(lat0, dx, dy);
      pts.push([lng0 + dLon, lat0 + dLat]);
    }
    pts.push([lng0, lat0]);
    return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } };
  };
  const bboxAround = (lat: number, lng: number, rM: number) => {
    const { dLat, dLon } = metersToDeg(lat, rM, rM);
    return [lng - dLon, lat - dLat, lng + dLon, lat + dLat];
  };
  const geomInBbox = (feat: any, bbox: number[]) => {
    const [minX, minY, maxX, maxY] = bbox;
    const [fx, fy] = feat?.bbox ? [feat.bbox, true] : [[minX - 9999, minY - 9999, maxX + 9999, maxY + 9999], false];
    if (!fy) return true;
    return !(fx[0] > maxX || fx[2] < minX || fx[1] > maxY || fx[3] < minY);
  };

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      groupRef.current?.remove();
      groupRef.current = null;
      perAgentLayersRef.current.forEach((v) => v.interGroup?.remove());
      perAgentLayersRef.current.clear();
      return;
    }

    (async () => {
      const group = L.layerGroup().addTo(map);
      groupRef.current = group;
      if (!map.getPane("fovpane")) {
        const p = map.createPane("fovpane");
        p.style.zIndex = "530";
      }

      try {
        const bFC: GJFC = await fetch(buildingsUrl).then((r) => r.json());
        buildingsRef.current = bFC || { type: "FeatureCollection", features: [] };
      } catch (e) {
        console.warn("buildings load failed", e);
        buildingsRef.current = { type: "FeatureCollection", features: [] };
      }

      let turfIntersect: any = null, turfBoolIntersects: any = null;
      try {
        const [{ default: intersect }, { default: booleanIntersects }] = await Promise.all([
          import("@turf/intersect"), import("@turf/boolean-intersects")
        ]);
        turfIntersect = intersect; turfBoolIntersects = booleanIntersects;
      } catch {}

      const period = Math.max(1000 / Math.max(1, updateHz), 120);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        const states = agentsRef.current;
        const bFC = buildingsRef.current;

        Object.entries(states).forEach(([sid, st]) => {
          const id = Number(sid);
          const entry = perAgentLayersRef.current.get(id) || {};
          entry.sector?.remove();
          entry.interGroup?.clearLayers?.();
          entry.interGroup?.remove();

          const sec = sectorPolygon(st.pos, radiusM, st.bearing, fovDeg);
          const sectorLayer = L.geoJSON(sec as any, {
            pane: "fovpane",
            style: { color: "#b0133d", weight: 1, opacity: 0.6, fillColor: "#b0133d", fillOpacity: 0.15 },
          }).addTo(group);

          let interGroup: L.LayerGroup | undefined;
          if (turfBoolIntersects && turfIntersect && bFC.features.length) {
            interGroup = L.layerGroup().addTo(group);
            const [lng, lat] = [st.pos[1], st.pos[0]];
            const bb = bboxAround(lat, lng, radiusM * 1.3);
            bFC.features.forEach((b: any) => {
              const gt = b.geometry?.type;
              if (gt !== "Polygon" && gt !== "MultiPolygon") return;
              if (!geomInBbox(b, bb)) return;
              try {
                if (!turfBoolIntersects(sec as any, b as any)) return;
                const inter = turfIntersect(sec as any, b as any);
                if (inter) {
                  L.geoJSON(inter as any, {
                    pane: "fovpane",
                    style: { color: "#ef4444", weight: 1.5, opacity: 0.95, fillColor: "#ef4444", fillOpacity: 0.3 },
                  }).addTo(interGroup!);
                }
              } catch {}
            });
          }

          perAgentLayersRef.current.set(id, { sector: sectorLayer, interGroup });
        });

      }, period);
    })();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      groupRef.current?.remove(); groupRef.current = null;
      perAgentLayersRef.current.forEach((v) => v.interGroup?.remove());
      perAgentLayersRef.current.clear();
    };
  }, [enabled, radiusM, fovDeg, buildingsUrl, map, updateHz]);

  return null;
}

// ───────── مارکرها + دایره دسترسی + قرمز برای بدون مسیر ─────────
function MarkersAndAccess({
  routes,
  destById,
  colorsByAgent,
  missingIds,
  showCircles = true, // ← جدید
}: {
  routes: GJFC | null;
  destById: Record<number, DestInfo>;
  colorsByAgent: Record<number, string>;
  missingIds: number[];
  showCircles?: boolean; // ← جدید
}) {
  const map = useMap();
  const groupRef = useRef<LayerGroup | null>(null);

  const radiusForLanduse = (lu?: string): number => {
    const key = String(lu ?? "").trim();
    if (key === "2") return 800;                  // قرمز
    if (key === "6") return 600;                  // بنفش
    if (key === "8" || key === "4") return 500;   // سبزها
    return 40;
  };
  const radiusForDestId = (id: number) => radiusForLanduse(destById[id]?.landuse);

  useEffect(() => {
    groupRef.current?.clearLayers();
    groupRef.current?.remove();
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;

    (routes?.features ?? []).forEach((f: any) => {
      const id = Number(f.properties?.agentId) || 0;
      const col = colorsByAgent[id] || "#0ea5e9";
      const cs = (f.geometry?.coordinates || []) as GJPoint[];
      if (cs.length < 2) return;

      const start: LatLngTuple = [cs[0][1], cs[0][0]];
      const end: LatLngTuple   = [cs[cs.length - 1][1], cs[cs.length - 1][0]];

      const r = radiusForDestId(id);

      L.circleMarker(start, { radius: 5, color: col, weight: 2, fillColor: "#fff", fillOpacity: 0.9 }).addTo(group);
      L.circleMarker(end,   { radius: 5, color: col, weight: 2, fillColor: col,    fillOpacity: 0.9 }).addTo(group);

      if (showCircles) {
        L.circle(end, { radius: r, color: col, weight: 1, opacity: 0.4, fillOpacity: 0.08, fillColor: col }).addTo(group);
      }
    });

    // مقاصد بدون مسیر
    missingIds.forEach((id) => {
      const d = destById[id];
      if (!d) return;
      const r = radiusForDestId(id);

      L.circleMarker(d.coord, { radius: 6, color: "#ffa600", weight: 2, fillColor: "#ffa600", fillOpacity: 0.95 }).addTo(group);

      if (showCircles) {
        L.circle(d.coord, { radius: r, color: "#ffa600", weight: 1, opacity: 0.5, fillOpacity: 0.08, fillColor: "#ffa600" }).addTo(group);
      }
    });

    return () => {
      groupRef.current?.clearLayers();
      groupRef.current?.remove();
      groupRef.current = null;
    };
  }, [map, routes, colorsByAgent, missingIds, destById, showCircles]);

  return null;
}

// ───────── صفحه اصلی ─────────
export default function TransportPage() {
  const [routes, setRoutes] = useState<GJFC | null>(null);
  const [loading, setLoading] = useState(false);
  const [agentStates, setAgentStates] = useState<
    Record<number, { pos: LatLngTuple; bearing: number }>
  >({});
const [showAccessCircles, setShowAccessCircles] = useState(true);

  // پیش‌فرض‌ها
  const [showRoutes, setShowRoutes] = useState(true);
  const [showShadow, setShowShadow] = useState(false);
  const [showFOV, setShowFOV] = useState(false);
  const [animateAgents, setAnimateAgents] = useState(true);

  const dests = useDestinations();

  // رنگ ایجنت‌ها: پیش‌فرض بر اساس landuse، اما برای چند ایدی خاص زرد
  const colorsByAgent: Record<number, string> = useMemo(() => {
    const m: Record<number, string> = {};
    const ids = pickTargetIds(dests);
    ids.forEach((id) => {
      const dest = dests.find((d) => d.Id === id);
      const key = String(dest?.landuse ?? "");
      m[id] = LANDUSE_COLORS[key] || "#111827";
    });
    // فقط شناسه‌های تعیین‌شده زرد شوند
    YELLOW_AGENT_IDS.forEach((id) => {
      m[id] = YELLOW_COLOR;
    });
    return m;
  }, [dests]);

 // محاسبه طول یک LineString بر حسب متر
const lineLengthMeters = (coords: GJPoint[]) => {
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a: LatLngTuple = [coords[i][1], coords[i][0]];     // [lat,lng]
    const b: LatLngTuple = [coords[i + 1][1], coords[i + 1][0]];
    sum += distLL(a, b);
  }
  return sum;
};

const fetchWeighted = async () => {
  setLoading(true);
  try {
    const res = await fetch("http://127.0.0.1:8000/transport/compute-weighted");
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Server error ${res.status} - ${JSON.stringify(err)}`);
    }
    const json: ApiResponse = await res.json();

    // فقط LineString‌ها + تبدیل agentId به عدد
    const raw: GJFeature[] = (json.routes_final?.features ?? [])
      .filter((f) => f?.geometry?.type === "LineString")
      .map((f) => ({
        ...f,
        properties: { ...(f.properties || {}), agentId: Number(f.properties?.agentId) || 0 },
      }));

    // گروه‌بندی بر اساس agentId و انتخاب طولانی‌ترین مسیر هر ایجنت
    const byAgent = new Map<number, { f: GJFeature; len: number }[]>();
    for (const f of raw) {
      const id = Number(f.properties?.agentId) || 0;
      const len = lineLengthMeters((f.geometry?.coordinates || []) as GJPoint[]);
      if (!byAgent.has(id)) byAgent.set(id, []);
      byAgent.get(id)!.push({ f, len });
    }

    const feats: GJFeature[] = [];
    byAgent.forEach((list) => {
      // حذف شاخه‌های خیلی کوتاه (مثلاً کمتر از 50 متر) و برداشتن بلندترین
      const candidates = list.filter((x) => x.len >= 100).sort((a, b) => b.len - a.len);
      if (candidates.length) feats.push(candidates[0].f);
    });

    setRoutes({ type: "FeatureCollection", features: feats });
    console.log("✅ routes fetched (deduped):", feats.length);
  } catch (e: any) {
    console.error("fetchWeighted error:", e);
    alert(`خطا در دریافت مسیرها: ${e.message || e}`);
  } finally {
    setLoading(false);
  }
};


  useEffect(() => {
    fetchWeighted();
  }, []);

  const routesFixed: GJFC | null = useMemo(() => {
    const r = snapRoutesToDestinations(routes, dests, 3);
    if (r) console.log("routesFixed:", r.features.length);
    return r;
  }, [routes, dests]);

  const fallbackCenter: LatLngExpression = [34.321, 47.074];
  const mapCenter: LatLngExpression = useMemo(() => {
    const r = routesFixed;
    if (r?.features?.length) {
      const all = r.features.flatMap((f: any) => f.geometry.coordinates);
      const lats = all.map((c: number[]) => c[1]),
        lngs = all.map((c: number[]) => c[0]);
      return [
        (Math.min(...lats) + Math.max(...lats)) / 2,
        (Math.min(...lngs) + Math.max(...lngs)) / 2,
      ] as LatLngExpression;
    }
    return fallbackCenter;
  }, [routesFixed]);

  // مسیرها همیشه سبز ثابت
  const routeStyle: L.StyleFunction<any> = (_feature) => {
    return { color: "#16a34a", weight: 4, opacity: 0.95, lineCap: "round" };
  };

  const missingAgentIds = useMemo(() => {
    const targetIds = pickTargetIds(dests);
    const present = new Set<number>(
      (routesFixed?.features ?? []).map((f: any) => Number(f.properties?.agentId))
    );
    return targetIds.filter((i) => !present.has(i));
  }, [routesFixed, dests]);

  const destById: Record<number, DestInfo> = useMemo(() => {
    const m: Record<number, DestInfo> = {};
    dests.forEach((d) => (m[d.Id] = d));
    return m;
  }, [dests]);

  return (
    <div className="min-h-[calc(100vh-80px)] bg-white px-4 sm:px-6 py-6" dir="rtl">
      <div className="max-w-7xl mx-auto mb-4">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-800 flex items-center gap-2">
          حمل و نقل (2D)
          <span className="text-sm font-normal text-slate-500">Transport Planning</span>
        </h1>
      </div>

      <div className="max-w-7xl mx-auto mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchWeighted}
            className="px-3 py-2 rounded-full bg-white text-slate-700 shadow-sm hover:shadow transition"
          >
            {loading ? "درحال دریافت..." : "دریافت/به‌روزرسانی مسیر وزن‌دار"}
          </button>
          <button
            onClick={() => setShowRoutes((v) => !v)}
            className={`px-3 py-2 rounded-full shadow-sm transition ${
              showRoutes ? "bg-emerald-500 text-white" : "bg-white text-slate-700 hover:shadow"
            }`}
          >
            نمایش مسیرهای پیشنهادی
          </button>
          <button
            onClick={() => setShowShadow((v) => !v)}
            className={`px-3 py-2 rounded-full shadow-sm transition ${
              showShadow ? "bg-slate-700 text-white" : "bg-white text-slate-700 hover:shadow"
            }`}
          >
            فعال شدن سایه
          </button>
          <button
            onClick={() => setShowFOV((v) => !v)}
            className={`px-3 py-2 rounded-full shadow-sm transition ${
              showFOV ? "bg-amber-500 text-white" : "bg-white text-slate-700 hover:shadow"
            }`}
          >
            فعال شدن تلاقی دید
          </button>
          <button
            onClick={() => setAnimateAgents((v) => !v)}
            className={`px-3 py-2 rounded-full shadow-sm transition ${
              animateAgents ? "bg-sky-500 text-white" : "bg-white text-slate-700 hover:shadow"
            }`}
          >
            ایجنت پیاده
          </button>
          <button
  onClick={() => setShowAccessCircles((v) => !v)}
  className={`px-3 py-2 rounded-full shadow-sm transition ${
    showAccessCircles ? "bg-violet-500 text-white" : "bg-white text-slate-700 hover:shadow"
  }`}
>
  هالهٔ دسترسی
</button>
  <div className="flex items-center text-red-500 gap-2">
    <span>مسیر چهارم پیدا نشد</span>
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-exclamation-circle" viewBox="0 0 16 16">
      <path d="M8 0a8 8 0 1 0 8 8A8 8 0 0 0 8 0zm0 14a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm.93-9.537a.75.75 0 0 0-.93-.53L7.5 6.25V8h1V6.25l.43-.318a.75.75 0 0 0 .07-1.066zM8 9a1 1 0 0 0-.992.883l-.008.117V11a1 1 0 0 0 1 1h.007a1 1 0 0 0 .992-.883l.008-.117V9.883a1 1 0 0 0-1-1z"/>
    </svg>
  </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-2xl shadow-md p-3 sm:p-4">
          <div className="h-[72vh] w-full rounded-xl overflow-hidden border border-slate-100">
            <MapContainer center={mapCenter} zoom={15} style={{ width: "100%", height: "100%" }}>
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              />

              {/* پایه */}
              <BasePolygons />
              <UnderlayLineEdge />

              {/* سایه روی کریدور مسیر */}
              {showShadow && routesFixed && typeof RouteShadowLayer !== "undefined" && (
                <RouteShadowLayer routes={routesFixed} bufferMeters={20} />
              )}

              {/* مسیرها */}
              {showRoutes && routesFixed && <GeoJSON data={routesFixed as any} style={routeStyle} />}

              {/* ایجنت‌ها (به‌روزرسانی pos/bearing برای FOV) */}
              {animateAgents && showRoutes && routesFixed && (
                <AgentsLayer
                  features={routesFixed.features}
                  colorsByAgent={colorsByAgent}
                  animate
                  onAgentsUpdate={setAgentStates}
                />
              )}

              {/* FOV روی ایجنت‌ها */}
              {showFOV && (
                <FOVLayer enabled agentStates={agentStates} radiusM={70} fovDeg={65} />
              )}

            <MarkersAndAccess
            routes={routesFixed}
            destById={destById}
           colorsByAgent={colorsByAgent}
             missingIds={missingAgentIds}
            showCircles={showAccessCircles}
             />

            </MapContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
