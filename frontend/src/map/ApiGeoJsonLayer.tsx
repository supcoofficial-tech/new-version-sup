import { GeoJSON, useMap } from "react-leaflet";
import type { Feature, FeatureCollection } from "geojson";
import type { PathOptions } from "leaflet";
import { useEffect, useMemo, useState } from "react";

// اگر خودت util داری می‌تونی حذفش کنی. اینجا برای اطمینان خودمون fetch می‌کنیم.
async function fetchGeoJSONNoCache(u: string): Promise<FeatureCollection> {
  const url = u + (u.includes("?") ? "&" : "?") + "_ts=" + Date.now(); // جلوگیری از کش
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
  return (await res.json()) as FeatureCollection;
}

function getFeatureCollectionBounds(fc: FeatureCollection) {
  // bound ساده برای Polygon/MultiPolygon؛ کافی برای کار ما
  let minX =  1e9, minY =  1e9, maxX = -1e9, maxY = -1e9;
  const scan = (coords: any) => {
    if (typeof coords[0] === "number") {
      const [x, y] = coords as number[];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      return;
    }
    for (const c of coords) scan(c);
  };
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    scan((g as any).coordinates);
  }
  return [[minY, minX], [maxY, maxX]] as [[number, number],[number, number]];
}

type Props = {
  /** آدرس API/فایل GeoJSON */
  url: string;
  /** تابع استایل هر فیچر – باید حتماً PathOptions برگرداند */
  styleFn: (feat: Feature) => PathOptions;
  /** محتوای پاپ‌آپ (اختیاری) */
  popupFn?: (feat: Feature) => string;
  /** فیت کردن دید پس از لود (پیش‌فرض: بله) */
  fitOnLoad?: boolean;
  /** هر چند میلی‌ثانیه یک‌بار رفرش شود (اختیاری) – مثال: 300000 برای هر 5 دقیقه */
  refreshMs?: number;
};

export default function ApiGeoJsonLayer({
  url,
  styleFn,
  popupFn,
  fitOnLoad = true,
  refreshMs,
}: Props) {
  const map = useMap();
  const [fc, setFc] = useState<FeatureCollection | null>(null);

  // لود داده (با امکان رفرش دوره‌ای)
  useEffect(() => {
    let cancelled = false;
    let timer: any;

    const load = async () => {
      try {
        const data = await fetchGeoJSONNoCache(url);
        // بررسی داده‌ها
        if (!cancelled) {
          if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
            console.error("Invalid GeoJSON format:", data);
            return;
          }
          setFc(data);
        }
      } catch (e) {
        console.error("ApiGeoJsonLayer fetch error:", e);
      }
    };

    load();
    if (refreshMs && refreshMs > 0) {
      timer = setInterval(load, refreshMs);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [url, refreshMs]);

  // فیت‌روی داده بعد از لود
  useEffect(() => {
    if (!fc || !fitOnLoad) return;
    try {
      const b = getFeatureCollectionBounds(fc);
      // padding کوچک برای زیبایی
      map.fitBounds(b as any, { padding: [20, 20] });
    } catch (e) {
      console.error("Error fitting map bounds:", e);
    }
  }, [fc, fitOnLoad, map]);

  // onEachFeature برای پاپ‌آپ
  const onEach = useMemo(
    () =>
      (feature: Feature, layer: any) => {
        if (!popupFn) return;
        try {
          layer.bindPopup(popupFn(feature));
        } catch (err) {
          console.error("Popup error:", err);
        }
      },
    [popupFn]
  );

  // برای دیباگ یکبار نمونه‌ی properties را چاپ کن
  useEffect(() => {
    if (!fc || (window as any).__geojson_debug_once__) return;
    (window as any).__geojson_debug_once__ = true;
    const p = fc.features[0]?.properties;
    if (p) console.log("ApiGeoJsonLayer sample properties:", p);
  }, [fc]);

  if (!fc) return null;

  // لاگ برای بررسی داده‌های GeoJSON
  console.log("GeoJSON loaded:", fc);

  return (
    <GeoJSON
      key={(fc as any)._ts ?? Date.now()}     // رندر مطمئن بعد از رفرش
      data={fc as any}
      style={styleFn as any}                  // تابع استایل
      onEachFeature={onEach as any}           // پاپ‌آپ
    />
  );
}
