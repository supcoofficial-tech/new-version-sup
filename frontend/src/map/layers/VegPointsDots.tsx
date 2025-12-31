import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

export default function VegPointsDots() {
  const map = useMap();

  useEffect(() => {
    let layer: L.GeoJSON<any> | null = null;
    fetch("http://127.0.0.1:8000/api/veg-points")
      .then(r => r.json())
      .then(data => {
        layer = L.geoJSON(data, {
          pointToLayer: (f, latlng) =>
            L.circleMarker(latlng, {
              radius: 5,
              fillColor: "#2e7d32",
              color: "#1b5e20",
              weight: 0.6,
              fillOpacity: 0.9,
            }).bindPopup("Vegetation Point"),
        }).addTo(map);
      });
    return () => { if (layer) map.removeLayer(layer); };
  }, [map]);

  return null;
}
