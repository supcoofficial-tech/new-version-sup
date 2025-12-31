import { useEffect, useState } from "react";
import ApiGeoJsonLayer from "../ApiGeoJsonLayer";

export default function HeatRiskLayer() {
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setReloadKey(k => k + 1), 300000);
    return () => clearInterval(t);
  }, []);

  return (
    <ApiGeoJsonLayer
      key={reloadKey}
      url="http://127.0.0.1:8000/api/heat-lst"
      styleFn={(f) => {
        const p = f?.properties || {};
        const c = typeof p.color_effective === "string" ? p.color_effective : "#fff5eb";
        return { fillColor: c, color: "#444", weight: 0.6, fillOpacity: 0.65 };
      }}
      popupFn={(f) => {
        const p = f?.properties || {};
        return `
          <b>LST risk:</b> ${Number(p.heat_risk ?? 0).toFixed(2)}<br/>
          <b>T_air:</b> ${Number(p.T_air ?? 0).toFixed(1)} °C • <b>RH:</b> ${p.RH ?? "—"}%<br/>
          <b>Wind:</b> ${p.wind_ms ?? "—"} m/s (gust ${p.wind_gust ?? "—"}) • ${p.wind_deg ?? "—"}°
        `;
      }}
    />
  );
}
