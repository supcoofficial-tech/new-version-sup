import { useEffect, useState, useMemo } from "react";
import ApiGeoJsonLayer from "../ApiGeoJsonLayer";

export default function FloodRiskLayer() {
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setReloadKey(k => k + 1), 300000); // هر 5 دقیقه
    return () => clearInterval(t);
  }, []);

  const styleFn = useMemo(() => (f: any) => {
    const p = f?.properties || {};
    const fillColor = typeof p.color_effective === "string" ? p.color_effective : "#fffde7";
    return {
      fillColor,
      color: "#666",
      weight: 0.6,
      fillOpacity: 0.7,
    };
  }, []);

  const popupFn = (f: any) => {
    const p = f?.properties || {};
    return `
      <b>Flood risk:</b> ${Number(p.risk_flood ?? 0).toFixed(2)}<br/>
      <b>Rain (${p.hours ?? 24}h):</b> ${p.rain_mm ?? "—"} mm<br/>
      <b>River dist (m):</b> ${p.river_distm ?? "—"}<br/>
      <b>Slope proxy:</b> ${p.slope_est ?? "—"}
    `;
  };

  return (
    <ApiGeoJsonLayer
      key={reloadKey}
      url="http://127.0.0.1:8000/api/flood-risk"
      styleFn={styleFn}
      popupFn={popupFn}
    />
  );
}
