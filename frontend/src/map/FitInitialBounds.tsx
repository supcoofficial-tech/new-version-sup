import { useEffect } from "react";
import { useMap } from "react-leaflet";

export default function FitInitialBounds() {
  const map = useMap();
  useEffect(() => {
    const bounds: [[number, number], [number, number]] = [
      [34.31518, 47.070146], // SW
      [34.323338, 47.078256], // NE
    ];
    map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 });
    map.setMaxBounds(bounds); // اختیاری: جلوگیری از خروج از محدوده
  }, [map]);
  return null;
}
