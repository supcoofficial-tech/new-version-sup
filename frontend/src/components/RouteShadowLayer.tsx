// RouteShadowLayer.tsx
import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L, { LayerGroup } from "leaflet";

type GJFC = { type: "FeatureCollection"; features: any[] };
type Props = {
  routes: GJFC | null;
  bufferMeters?: number;   // پهنای کریدور
  opacity?: number;        // شفافیت
  color?: string;          // رنگ سایه
};

export default function RouteShadowLayer({
  routes,
  bufferMeters = 20,
  opacity = 0.18,
  color = "#111827",
}: Props) {
  const map = useMap();
  const groupRef = useRef<LayerGroup | null>(null);

  // خطوط مسیرها به صورت آرایه‌ای از مختصات [lat,lng]
  const polylines = useMemo(() => {
    const out: [number, number][][] = [];
    (routes?.features ?? []).forEach((f) => {
      if (f?.geometry?.type !== "LineString") return;
      const coords = (f.geometry.coordinates || []).map(
        ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
      );
      if (coords.length >= 2) out.push(coords);
    });
    return out;
  }, [routes]);

  useEffect(() => {
    // پاکسازی قبلی
    groupRef.current?.clearLayers();
    groupRef.current?.remove();
    if (!polylines.length) return;

    // پن مخصوص زیر مسیرها
    if (!map.getPane("shadowpane")) {
      const p = map.createPane("shadowpane");
      p.style.zIndex = "420";         // زیر خود مسیرها (مسیرها معمولا 500+ اند)
      p.style.pointerEvents = "none";
    }

    const group = L.layerGroup().addTo(map);
    groupRef.current = group;

    // تلاش برای استفاده از turf (بافر متری واقعی)
    const tryRenderWithTurf = async () => {
      try {
        const [{ default: buffer }, { default: lineString }, { default: featureCollection }] =
          await Promise.all([
            import("@turf/buffer"),
            import("@turf/helpers").then(m => ({ default: m.lineString })),
            import("@turf/helpers").then(m => ({ default: m.featureCollection })),
          ]);

        // تبدیل هر مسیر به LineString (lng,lat) و بافر متری
        const feats = polylines.map((pl) =>
          lineString(pl.map(([lat, lng]) => [lng, lat]))
        );
        const fc = featureCollection(feats as any);
        const buff = buffer(fc as any, bufferMeters, { units: "meters" });

        L.geoJSON(buff as any, {
          pane: "shadowpane",
          style: {
            color,
            weight: 1,
            opacity: Math.min(opacity * 1.2, 0.35),
            fillColor: color,
            fillOpacity: opacity,
          },
        }).addTo(group);
        return true;
      } catch {
        return false;
      }
    };

    const renderPixelFallback = () => {
      // اگر turf نبود: یک پلی‌لاین ضخیم پیکسلی با شفافیت پایین (تقریب سرعتی)
      // تبدیل متر به پیکسل برای زوم فعلی (تقریبی)
      const center = map.getCenter();
      const metersPerPixel =
        (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) /
        Math.pow(2, map.getZoom());
      const px = Math.max(6, Math.round((bufferMeters * 2) / metersPerPixel));

      polylines.forEach((pl) => {
        L.polyline(pl, {
          pane: "shadowpane",
          weight: px,
          color,
          opacity: opacity,   // چون stroke ضخیم است مانند بافر دیده می‌شود
          lineCap: "round",
          lineJoin: "round",
        }).addTo(group);
      });
    };

    (async () => {
      const ok = await tryRenderWithTurf();
      if (!ok) renderPixelFallback();
    })();

    // روی تغییر زوم، fallback را بازنقاشی کن تا ضخامت درست بماند
    const onZoom = () => {
      if (!groupRef.current) return;
      // اگر با turf کشیده شده باشد هم مشکلی نیست؛ صرفاً پاک و دوباره بکش
      groupRef.current.clearLayers();
      renderPixelFallback();
    };
    map.on("zoomend", onZoom);

    return () => {
      map.off("zoomend", onZoom);
      groupRef.current?.clearLayers();
      groupRef.current?.remove();
      groupRef.current = null;
    };
  }, [map, polylines, bufferMeters, opacity, color]);

  return null;
}
