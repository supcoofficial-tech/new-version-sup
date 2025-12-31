import React, { useEffect, useRef, useState, useMemo } from "react";
import { MapContainer, TileLayer, Circle, GeoJSON, LayersControl, useMap, Pane } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { useFBX } from "@react-three/drei";
import { createPortal } from "react-dom";

type ScenarioMode = "all" | "demolition" | "vertical" | "landuse";
const { BaseLayer } = LayersControl;

type FBXFile = {
  name: string;
  url: string;
  opacity?: number;
  color?: string;
  offset?: [number, number, number];
};

interface MapViewProps {
  runAnalysis: boolean;
  showBase: boolean;
  showRoads: boolean;
  onFeatureClick: (properties: any) => void;
  onFeaturesLoad: (features: any[]) => void;
  show3D?: boolean;
  fbxFiles?: FBXFile[];
  selectedFeature?: any;
  show3DOnFeature?: boolean;
  onAnimationStep?: (current: number, total: number) => void;
  onAnimationEnd?: () => void;
  scenarioMode?: ScenarioMode;
  show3DFull?: boolean;
  show3DBounds?: boolean;
  bounds?: [[number, number], [number, number]];
}

const LANDUSE_COLORS: Record<string, string> = {
  "01": "#FFFFBE","02": "#FF0000","03": "#64B5F6","04": "#267300","05": "#895A44",
  "06": "#FF00C5","07": "#66BB6A","08": "#90A4AE","09": "#005CE6","10": "#FFB74D","11": "#A3FF73",
};
const lockedLanduses = new Set<string>(["03","04","06","07","09"]);

const normCode = (v: any): string | undefined => {
  if (v==null) return;
  const s=String(v).trim(); if(!s) return;
  const n=Number(s);
  if(!Number.isNaN(n)){ const iv=Math.trunc(n); if(iv>=0&&iv<=99) return iv.toString().padStart(2,"0"); }
  if(/^\d{2}$/.test(s)) return s;
  return s;
};
const pickInitialCode = (p: any)=> normCode(p?.landuse_code_initial)||normCode(p?.initial_la)||normCode(p?.Initial_la)||normCode(p?.Landuse)||normCode(p?.landuse);
const pickFinalCode   = (p: any)=> normCode(p?.landuse_code_final)||normCode(p?.final_land)||normCode(p?.final_landuse)||normCode(p?.final_land_use)||normCode(p?.LND_FIN);
const colorFor = (code?:string)=> code? (LANDUSE_COLORS[code]||"#ffffff") : "#ffffff";

const isDemolitionTop = (p: any): boolean => {
  const act = String(p?.last_action || "").toLowerCase();
  const demo = Number(p?.demo_flag || p?.Demolition) === 1;
  return act.includes("rebuild") || demo;
};
const isVerticalTop = (p: any): boolean => {
  const act = String(p?.last_action || "").toLowerCase();
  const added = Number(p?.added_floors || 0) > 0;
  const baseFloors = Number(p?.base_floors || p?.Floors_Num || p?.floors || 0);
  const finalFloors = Number(p?.final_floors || p?.floors || baseFloors);
  return act.includes("addfloors") || added || finalFloors > baseFloors;
};
const isLanduseChangeTop = (p: any): boolean => {
  const init = (p?.landuse_code_initial ?? p?.initial_la ?? p?.Landuse ?? p?.landuse);
  const fin  = (p?.landuse_code_final   ?? p?.final_land   ?? p?.LND_FIN  ?? init);
  const n = (x:any)=> (x==null? undefined : String(x).padStart(2,"0"));
  return !!n(init) && !!n(fin) && n(init) !== n(fin);
};

function LeafletPortal({ pane, children }: { pane: HTMLElement | null; children: React.ReactNode }) {
  if(!pane) return null; return createPortal(children, pane);
}
function FBXModel({ url, opacity=1, scale=0.00005, rotationX=Math.PI/2, color }: {url:string;opacity?:number;scale?:number;rotationX?:number;color?:string;}){
  const fbx = useFBX(url);
  useEffect(()=>{ 
    fbx.traverse((o:any)=>{ 
      if(o.isMesh){ 
        o.material=(o.material as THREE.Material).clone(); 
        (o.material as any).transparent=opacity<1; 
        (o.material as any).opacity=opacity; 
        (o.material as any).side=THREE.DoubleSide; 
        if (color) (o.material as any).color = new THREE.Color(color);
      }
    }); 
    fbx.rotation.x=rotationX; 
    fbx.scale.set(scale,scale,scale); 
  },[fbx,opacity,rotationX,scale,color]);
  return <primitive object={fbx}/>;
}
function FbxOverlay({ files, anchor }: { files: FBXFile[]; anchor: [number, number] }){
  const map = useMap(); 
  const hostRef = useRef<HTMLDivElement>(null); 
  const pane = map.getPanes()?.overlayPane ?? null;

  useEffect(() => {
    const update = () => {
      const el = hostRef.current; 
      if(!el) return; 
      const pt = map.latLngToLayerPoint({lat:anchor[0], lng:anchor[1]}); 
      const zoom = map.getZoom(); 
      const scale = Math.pow(2, zoom-15); 
      el.style.transform=`translate(${pt.x-200}px, ${pt.y-200}px) scale(${scale})`;
    };
    update();
    map.on("move zoom", update);
    return () => { map.off("move zoom", update); };
  }, [map, anchor]);

  return (
    <LeafletPortal pane={pane}>
      <div ref={hostRef} style={{position:"absolute",left:0,top:0,width:400,height:400,pointerEvents:"none",zIndex:650,willChange:"transform"}}>
        <Canvas
          camera={{ position:[0,0,5], fov:60 }}
          style={{ width:"100%", height:"100%", background: "transparent" }}
          gl={{ alpha: true, antialias: true }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <ambientLight intensity={0.9}/><directionalLight position={[5,5,8]} intensity={1}/>
          {files.map((f,i)=>(<group key={f.url} position={f.offset ?? [i===0?-1.2:1.2,0,0]}><FBXModel url={f.url} opacity={f.opacity ?? 1} color={f.color}/></group>))}
        </Canvas>
      </div>
    </LeafletPortal>
  );
}

function FbxOverlayFull({ files }: { files: FBXFile[] }) {
  const map = useMap();
  const hostRef = useRef<HTMLDivElement>(null);
  const pane = map.getPanes()?.overlayPane ?? null;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => {
      const sz = map.getSize();
      el.style.width = `${sz.x}px`;
      el.style.height = `${sz.y}px`;
      el.style.transform = `translate(0px, 0px)`;
    };
    update();
    map.on("move zoom resize", update);
    return () => { map.off("move zoom resize", update); };
  }, [map]);

  function FBXFitViewport({ url, opacity=1, color }: { url:string; opacity?:number; color?:string }) {
    const fbx = useFBX(url);
    useEffect(() => {
      fbx.traverse((o:any) => {
        if (o.isMesh) {
          o.material = (o.material as THREE.Material).clone();
          (o.material as any).transparent = opacity < 1;
          (o.material as any).opacity = opacity;
          (o.material as any).side = THREE.DoubleSide;
          if (color) (o.material as any).color = new THREE.Color(color);
        }
      });
      const box = new THREE.Box3().setFromObject(fbx);
      const size = new THREE.Vector3(); const center = new THREE.Vector3();
      box.getSize(size); box.getCenter(center);
      fbx.position.sub(center);
      const s = 2.5 / Math.max(size.x, size.y, size.z || 1);
      fbx.scale.setScalar(s);
      fbx.rotation.x = Math.PI / 2;
    }, [fbx, opacity, color]);
    return <primitive object={fbx} />;
  }

  return (
    <LeafletPortal pane={pane}>
      <div
        ref={hostRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 650,
          willChange: "transform",
        }}
      >
        <Canvas camera={{ position: [0, 0, 5], fov: 60 }} style={{ width: "100%", height: "100%" }}>
          <ambientLight intensity={0.9} />
          <directionalLight position={[5, 5, 8]} intensity={1} />
          {files.map((f) => (
            <FBXFitViewport key={f.url} url={f.url} opacity={f.opacity ?? 1} color={f.color} />
          ))}
        </Canvas>
      </div>
    </LeafletPortal>
  );
}

function FbxOverlayBounds({ files, bounds }: { files: FBXFile[]; bounds: [[number, number],[number, number]] }) {
  const map = useMap();
  const hostRef = useRef<HTMLDivElement>(null);
  const pane = map.getPanes()?.overlayPane ?? null;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => {
      const sw = L.latLng(bounds[0][0], bounds[0][1]);
      const ne = L.latLng(bounds[1][0], bounds[1][1]);
      const pSW = map.latLngToLayerPoint(sw);
      const pNE = map.latLngToLayerPoint(ne);
      const x = pSW.x;
      const y = pNE.y;
      const w = pNE.x - pSW.x;
      const h = pSW.y - pNE.y;
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    };
    update();
    map.on("move zoom resize", update);
    return () => { map.off("move zoom resize", update); };
  }, [map, bounds]);

  function FBXFitToBox({ url, opacity=1, color }: { url:string; opacity?:number; color?:string }) {
    const fbx = useFBX(url);
    useEffect(() => {
      fbx.traverse((o:any) => {
        if (o.isMesh) {
          o.material = (o.material as THREE.Material).clone();
          (o.material as any).transparent = opacity < 1;
          (o.material as any).opacity = opacity;
          (o.material as any).side = THREE.DoubleSide;
          if (color) (o.material as any).color = new THREE.Color(color);
        }
      });
      const box = new THREE.Box3().setFromObject(fbx);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      fbx.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z || 1);
      const s = 2.0 / (maxDim || 1);
      fbx.scale.setScalar(s);
      fbx.rotation.x = Math.PI / 2;
    }, [fbx, opacity, color]);

    return <primitive object={fbx} />;
  }

  return (
    <LeafletPortal pane={pane}>
      <div
        ref={hostRef}
        style={{
          position: "absolute",
          left: 0, top: 0,
          width: 10, height: 10,
          pointerEvents: "none",
          zIndex: 650,
          willChange: "transform",
        }}
      >
        <Canvas camera={{ position: [0, 0, 3], fov: 50 }} style={{ width: "100%", height: "100%" }}>
          <ambientLight intensity={0.9} />
          <directionalLight position={[5, 5, 8]} intensity={1} />
          {files.map((f) => (
            <FBXFitToBox key={f.url} url={f.url} opacity={f.opacity ?? 1} color={f.color} />
          ))}
        </Canvas>
      </div>
    </LeafletPortal>
  );
}

const centroidOfCoords = (coords: number[][]): [number, number] => {
  let sx = 0, sy = 0, n = 0;
  for (const c of coords) {
    const x = Array.isArray(c) ? c[0] : undefined;
    const y = Array.isArray(c) ? c[1] : undefined;
    if (typeof x === "number" && typeof y === "number") { sx += x; sy += y; n++; }
  }
  return n ? ([sy / n, sx / n] as [number, number]) : [0, 0];
};
const getFeatureCenter = (feature: any): [number, number] => {
  const geom = feature?.geometry ?? feature?.__feature?.geometry;
  if (!geom) return [0, 0];
  const t = geom.type;
  if (t === "Point") { const [x, y] = geom.coordinates; return [y, x]; }
  if (t === "MultiPoint" || t === "LineString") return centroidOfCoords(geom.coordinates as number[][]);
  if (t === "MultiLineString") { const flat = (geom.coordinates as number[][][]).flat(); return centroidOfCoords(flat as number[][]); }
  if (t === "Polygon") { const outer = (geom.coordinates?.[0] ?? []) as number[][]; return centroidOfCoords(outer); }
  if (t === "MultiPolygon") {
    const all: number[][] = [];
    for (const poly of (geom.coordinates ?? []) as number[][][][]) {
      const outer = (poly?.[0] ?? []) as number[][];
      for (const p of outer) all.push(p);
    }
    return centroidOfCoords(all);
  }
  return [0, 0];
};

const Legend: React.FC = () => {
  const map = useMap();
  useEffect(()=> {
    const div = L.DomUtil.create("div","legend");
    div.style.background="white"; div.style.padding="8px 10px"; div.style.borderRadius="12px"; div.style.boxShadow="0 2px 10px rgba(0,0,0,0.15)"; div.style.font="12px/1.35 system-ui, sans-serif";
    div.innerHTML = `<b>Landuse (Final)</b><br/>` + Object.entries(LANDUSE_COLORS).map(([code,color])=>`<div style="display:flex;align-items:center;margin:4px 0"><span style="background:${color};width:14px;height:14px;border:1px solid #000;margin-inline-end:6px"></span>${code}</div>`).join("");
    const ctrl = (L as any).control({ position: "bottomleft" }) as L.Control; (ctrl as any).onAdd = () => div; ctrl.addTo(map);
    return () => { ctrl.remove(); };
  },[map]);
  return null;
};

function MapView({
  runAnalysis, showBase, showRoads, onFeatureClick, onFeaturesLoad,
  show3D=false, fbxFiles=[], selectedFeature, show3DOnFeature=false,
  onAnimationStep, onAnimationEnd, scenarioMode="all",
  show3DFull=false, show3DBounds=false, bounds,
}: MapViewProps): JSX.Element {
  const [radius,setRadius] = useState(0);
  const [baseData,setBaseData] = useState<any>(null);
  const [roadsData,setRoadsData] = useState<any>(null);
  const [mode,setMode] = useState<"initial"|"final">("final");
  const loadedRef = useRef(false);

  const [baseVisible, setBaseVisible] = useState<boolean>(!!showBase);
  const [roadsVisible, setRoadsVisible] = useState<boolean>(!!showRoads);
  useEffect(() => { setBaseVisible(!!showBase); }, [showBase]);
  useEffect(() => { setRoadsVisible(!!showRoads); }, [showRoads]);

  const isAnimatingRef = useRef(false);
  const hasLoadedBaseRef = useRef(false);

  const stepCbRef = useRef<typeof onAnimationStep | undefined>(onAnimationStep);
  const endCbRef = useRef<typeof onAnimationEnd | undefined>(onAnimationEnd);
  const featuresCbRef = useRef<typeof onFeaturesLoad | undefined>(onFeaturesLoad);

  const rafIdRef = useRef<number | null>(null);
  const cancelRef = useRef(false);

  const center: L.LatLngExpression = [34.319, 47.074];

  const effectiveFbxFiles = useMemo<FBXFile[]>(() => {
    if (fbxFiles && fbxFiles.length > 0) return fbxFiles;
    return [{ name: "default", url: "/model.fbx", opacity: 0.9, color: "#00BCD4" }];
  }, [fbxFiles]);

  useEffect(() => {
    stepCbRef.current = onAnimationStep;
    endCbRef.current = onAnimationEnd;
    featuresCbRef.current = onFeaturesLoad;
  }, [onAnimationStep, onAnimationEnd, onFeaturesLoad]);

  useEffect(()=> {
    if (!runAnalysis && baseVisible && !baseData) {
      fetch("/BasePLIGON.geojson")
        .then(r=>r.json())
        .then(d => { setBaseData(d); d.features && onFeaturesLoad(d.features); })
        .catch(()=>{});
    }
  }, [baseVisible, runAnalysis, baseData, onFeaturesLoad]);

  useEffect(() => {
    if (!runAnalysis) return;
    if (isAnimatingRef.current) return;
    if (typeof window === "undefined" || typeof performance === "undefined") return;

    isAnimatingRef.current = true;
    cancelRef.current = false;

    const duration = 4000;
    const total = 4000;
    const start: number = performance.now();

    const tick = (now: number) => {
      if (cancelRef.current) return;

      const elapsed = Math.min(now - start, duration);
      const t = elapsed / duration;
      const step = Math.round(total * t);

      setRadius(step);
      stepCbRef.current?.(step, total);

      if (elapsed < duration) {
        rafIdRef.current = requestAnimationFrame(tick);
      } else {
        setRadius(0);
        endCbRef.current?.();

        if (!hasLoadedBaseRef.current) {
          hasLoadedBaseRef.current = true;
          fetch("/BasePLIGON_fixed_nodemo0_styled.geojson")
            .then((r) => r.json())
            .then((d) => {
              if (cancelRef.current) return;
              setBaseData(d);
              d?.features && featuresCbRef.current?.(d.features);
            })
            .catch(() => {});
        }

        isAnimatingRef.current = false;
      }
    };

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      cancelRef.current = true;
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
      isAnimatingRef.current = false;
    };
  }, [runAnalysis]);

  useEffect(() => {
    if (runAnalysis) return;
    if (!roadsVisible) return;
    if (loadedRef.current) return;

    const ac = new AbortController();
    Promise.all([
      fetch("/Lines_Edges.geojson", { signal: ac.signal }).then(r => r.json()),
      fetch("/Gereh.geojson", { signal: ac.signal }).then(r => r.json()),
    ])
      .then(([lines, points]) => {
        const features = [ ...(lines?.features ?? []), ...(points?.features ?? []) ];
        setRoadsData({ type: "FeatureCollection", features });
        loadedRef.current = true;
      })
      .catch(()=>{});
    return () => ac.abort();
  }, [roadsVisible, runAnalysis]);

  const styleBaseFeature = (feature: any) => {
    const p = feature?.properties ?? {};
    const changedAll = isDemolitionTop(p) || isVerticalTop(p) || isLanduseChangeTop(p);
    const changedByScenario =
      scenarioMode === "all" ? changedAll :
      scenarioMode === "demolition" ? isDemolitionTop(p) :
      scenarioMode === "vertical"   ? isVerticalTop(p)   :
                                      isLanduseChangeTop(p);

    const init = pickInitialCode(p);
    const fin  = pickFinalCode(p);
    const showCode = mode === "final" ? (init || fin) : (fin || init);
    const color = colorFor(showCode);

    return {
      color: changedByScenario ? "#000" : "#333",
      weight: changedByScenario ? 3 : 1,
      opacity: 1,
      fillColor: color,
      fillOpacity: changedByScenario ? 0.85 : 0.55,
    } as L.PathOptions;
  };

  const onEachBaseFeature = (feature: any, layer: L.Layer) => {
    const p = feature?.properties ?? {};
    const init = pickInitialCode(p);
    const fin  = pickFinalCode(p);
    const canChange = !lockedLanduses.has(init || "");

    const dem  = isDemolitionTop(p);
    const vert = isVerticalTop(p);
    const land = isLanduseChangeTop(p);
    const allTags = [ dem && "بازسازی/نوسازی", vert && "توسعه عمودی", land && "تغییر کاربری" ]
      .filter(Boolean).join(" | ");

    const tag =
      scenarioMode === "demolition" ? (dem  ? "بازسازی/نوسازی ✅" : "—") :
      scenarioMode === "vertical"   ? (vert ? "توسعه عمودی ✅"   : "—") :
      scenarioMode === "landuse"    ? (land ? "تغییر کاربری ✅"   : "—") :
      (allTags ? `${allTags} ✅` : "بدون تغییر");

    (layer as any).bindTooltip(
      `initial: ${init ?? "?"} → final: ${fin ?? init ?? "?"} | ${tag}` +
      (canChange ? " | قابل تغییر ✅" : " | غیرقابل تغییر ❌"),
      { direction:"right", sticky:true, offset:L.point(12,0), className:"lu-tooltip-rtl" }
    );

    layer.on("click", () => {
      const fullProps = { ...p, landuse_code_initial: init, landuse_code_final: fin, canChange , __feature: feature };
      onFeatureClick(fullProps);
    });
  };

  const onEachRoadFeature = (feature: any, layer: L.Layer) => {
    const props = feature?.properties || {};
    const html = Object.entries(props)
      .map(([k, v]) => `<div><strong>${k}:</strong> ${v ?? "-"}</div>`)
      .join("");
    (layer as any).bindTooltip(html || "—");
    layer.on("click", () => onFeatureClick(props));
  };

  const ToggleControl: React.FC = () => {
    const map = useMap();
    useEffect(() => {
      const div = L.DomUtil.create("div", "toggle-mode");
      div.style.background = "linear-gradient(135deg, #ffffffcc, #e0f7fa)";
      div.style.padding = "10px 16px";
      div.style.borderRadius = "16px";
      div.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
      div.style.font = "bold 13px 'IRANSans', system-ui, sans-serif";
      div.style.color = "#222";
      div.style.textAlign = "center";
      div.style.userSelect = "none";
      div.style.minWidth = "140px";
      div.style.transition = "all 0.2s ease";
      div.style.cursor = "pointer";

      const refresh = () => {
        div.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <span style="font-weight:700;font-size:13px;">نمایش:</span>
            <button id="btn-final"
              style="flex:1;padding:6px 10px;border-radius:8px;
                border:none;cursor:pointer;
                font-weight:600;
                background:${mode === "final" ? "#43a047" : "#e0e0e0"};
                color:${mode === "final" ? "#fff" : "#333"};
                box-shadow:${mode === "final" ? "0 2px 6px rgba(67,160,71,0.5)" : "none"};">
              نهایی
            </button>
            <button id="btn-init"
              style="flex:1;padding:6px 10px;border-radius:8px;
                border:none;cursor:pointer;
                font-weight:600;
                background:${mode === "initial" ? "#0288d1" : "#e0e0e0"};
                color:${mode === "initial" ? "#fff" : "#333"};
                box-shadow:${mode === "initial" ? "0 2px 6px rgba(2,136,209,0.5)" : "none"};">
              اولیه
            </button>
          </div>`;
      };

      refresh();

      const ctrl = (L as any).control({ position: "topleft" }) as L.Control;
      (ctrl as any).onAdd = () => div;
      ctrl.addTo(map);

      const onClick = (e: any) => {
        if (e.target?.id === "btn-init") setMode("initial");
        if (e.target?.id === "btn-final") setMode("final");
        setTimeout(refresh, 0);
      };
      div.addEventListener("click", onClick);

      return () => {
        div.removeEventListener("click", onClick);
        ctrl.remove();
      };
    }, [map, mode]);

    return null;
  };

  return (
    <MapContainer center={center} zoom={16} style={{ height: "100%", width: "100%" }}>
      <LayersControl position="topright">
        <BaseLayer checked name="🛰 Satellite">
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
        </BaseLayer>
        <BaseLayer name="🌑 Dark">
          <TileLayer url="https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png" />
        </BaseLayer>
      </LayersControl>

      <Legend />
      <ToggleControl />

      {radius>0 && (<Circle center={center} radius={radius} pathOptions={{ color:"blue", fillColor:"blue", fillOpacity:0.3 }}/>) }

      {baseVisible && baseData && (
        <Pane name="base-pane" style={{ zIndex: 410 }}>
          <GeoJSON
            key={mode}
            data={baseData}
            style={styleBaseFeature}
            onEachFeature={onEachBaseFeature}
          />
        </Pane>
      )}

      {roadsVisible && roadsData && (
        <Pane name="roads-pane" style={{ zIndex: 420 }}>
          <GeoJSON
            key="roads"
            data={roadsData as any}
            style={(f: any) =>
              f.geometry?.type === "LineString"
                ? { color: "white", weight: 2 }
                : { color: "transparent" }
            }
            pointToLayer={(_, latlng) =>
              L.circleMarker(latlng, {
                radius: 6,
                fillColor: "white",
                color: "black",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.9,
              })
            }
            onEachFeature={onEachRoadFeature}
          />
        </Pane>
      )}

      {show3D && effectiveFbxFiles.length > 0 && (
        <FbxOverlay anchor={[center[0] as number, center[1] as number]} files={effectiveFbxFiles} />
      )}
      {show3DOnFeature && selectedFeature && effectiveFbxFiles.length > 0 && (
        <FbxOverlay anchor={getFeatureCenter(selectedFeature.__feature || selectedFeature)} files={effectiveFbxFiles} />
      )}
      {show3DFull && effectiveFbxFiles.length > 0 && (
        <FbxOverlayFull files={effectiveFbxFiles} />
      )}
      {show3DBounds && bounds && effectiveFbxFiles.length > 0 && (
        <FbxOverlayBounds files={effectiveFbxFiles} bounds={bounds} />
      )}
    </MapContainer>
  );
}

export default MapView;
