import { useEffect, useState } from "react";
import ApiGeoJsonLayer from "../ApiGeoJsonLayer";

export default function FireLayer() {
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setReloadKey(k => k + 1), 300000);
    return () => clearInterval(t);
  }, []);

  return (
    <ApiGeoJsonLayer
      key={reloadKey}
      url="http://127.0.0.1:8000/api/fire-weather"
      styleFn={(f) => {
        const p = f?.properties || {};
        const c = typeof p.color_effective === "string" ? p.color_effective : "#efebe9";
        return { fillColor: c, color: "#333", weight: 0.6, fillOpacity: 0.7 };
      }}
      popupFn={(f) => {
        const p = f?.properties || {};
        return `
          <b>Fire prob:</b> ${Number(p.fire_prob ?? 0).toFixed(2)}<br/>
          <b>T_air:</b> ${Number(p.T_air ?? 0).toFixed(1)} °C • <b>RH:</b> ${p.RH ?? "—"}%<br/>
          <b>Wind:</b> ${p.wind_ms ?? "—"} m/s (gust ${p.wind_gust ?? "—"}) • ${p.wind_deg ?? "—"}°
        `;
      }}
    />
  );
}
