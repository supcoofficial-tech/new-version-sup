// src/map/Legend.tsx
import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L, { Control, ControlPosition } from "leaflet";

type LegendProps = {
  html: string;
  position?: ControlPosition;       // از تایپ خود Leaflet استفاده می‌کنیم
  className?: string;
  stopPointer?: boolean;
};

export default function Legend({
  html,
  position = "bottomleft",
  className,
  stopPointer = true,
}: LegendProps) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    // ظرف لِجند
    const div = L.DomUtil.create("div", "sup-legend");
    div.style.background = "white";
    div.style.padding = "8px 10px";
    div.style.borderRadius = "12px";
    div.style.boxShadow = "0 2px 10px rgba(0,0,0,0.15)";
    div.style.font = "12px/1.35 system-ui, sans-serif";
    div.style.direction = "rtl";
    if (className) div.classList.add(className);

    if (stopPointer) {
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
    }

    try {
      div.innerHTML = html || "";
    } catch {
      div.textContent = "Legend";
    }

    // ✅ به‌جای L.control(...) از سازندهٔ کلاس Control استفاده کن
    const ctrl: Control = new L.Control({ position });
    (ctrl as any).onAdd = () => div;

    map.addControl(ctrl);

    return () => {
      try {
        map.removeControl(ctrl);
      } catch { /* no-op */ }
    };
  }, [map, html, position, className, stopPointer]);

  return null;
}
