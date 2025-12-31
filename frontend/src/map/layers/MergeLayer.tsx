// MergeLayer.tsx

import { useEffect, useState, useMemo } from "react";
import ApiGeoJsonLayer from "../ApiGeoJsonLayer";

// ✅ رنگ‌های سه‌گانه
const MERGE_COLORS = {
  low:  "#2ecc71", // سبز
  mid:  "#f1c40f", // زرد
  high: "#e74c3c", // قرمز
};

// ✅ آستانه‌ها (اگر لازم شد تغییر بده)
const MERGE_THRESHOLDS = { mid: 0.29, high: 0.47 };

// ⬇️ به‌جای rampFromRisk:
function colorFromBuckets(vRaw: any) {
  const v = Math.max(0, Math.min(1, Number(vRaw ?? 0)));
  if (v <= MERGE_THRESHOLDS.mid)  return MERGE_COLORS.low;  // سبز برای کم خطر
  if (v <= MERGE_THRESHOLDS.high) return MERGE_COLORS.mid; // زرد برای متوسط خطر
  return MERGE_COLORS.high;  // قرمز برای پر خطر
}

export default function MergeLayer() {
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setReloadKey((k) => k + 1), 300000);
    return () => clearInterval(t);
  }, []);

  const styleFn = useMemo(
    () => (f: any) => {
      const p = f?.properties ?? f ?? {};
      // ✅ همیشه سه‌کلاسه — color_effective بک‌اند را نادیده بگیر
      const fill = colorFromBuckets(p.comp_risk);

      if ((window as any).__merge_debug_once__ !== true) {
        (window as any).__merge_debug_once__ = true;
        console.log("merge style sample props:", p);
      }

      return { fillColor: fill, color: "#333", weight: 0.8, fillOpacity: 0.7 };
    },
    []
  );

  const popupFn = (f: any) => {
    const p = f?.properties ?? f ?? {};
    // می‌تونی اینجا دسته را هم بنویسی (کم/متوسط/زیاد) اگر خواستی:
    const v = Number(p.comp_risk ?? 0);
    const bucket = v <= MERGE_THRESHOLDS.mid ? "کم" : v <= MERGE_THRESHOLDS.high ? "متوسط" : "زیاد";
    return `
      <b>Composite risk:</b> ${v.toFixed(2)} (${bucket})<br/>
      flood: ${p.flood_r ?? "—"} • heat: ${p.heat_r ?? "—"} •
      quake: ${p.quake_r ?? "—"} • fire: ${p.fire_r ?? "—"}
    `;
  };

  return (
    <ApiGeoJsonLayer
      key={reloadKey}
      url="http://127.0.0.1:8000/api/merge"
      styleFn={styleFn}
      popupFn={popupFn}
    />
  );
}
