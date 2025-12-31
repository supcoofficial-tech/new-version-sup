import { useEffect, useState } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import api from "../../services/api";

import "leaflet/dist/leaflet.css";

type BaseMapType = "dark" | "light" | "streets" | "satellite";

const BASEMAPS: Record<BaseMapType, { name: string; url: string; attribution: string }> = {
  dark: {
    name: "🖤 Dark",
   // url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
   url:"https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png" ,
    attribution: '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  },
  light: {
    name: "🤍 Light",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OSM &copy; CARTO",
  },
  streets: {
    name: "🛣️ Streets",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
  },
  satellite: {
    name: "🛰️ Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri",
  },
};

export default function BaseMaps() {
  const [data, setData] = useState<any>(null);
  const [activeBase, setActiveBase] = useState<BaseMapType>("dark"); // پیش‌فرض دارک

  useEffect(() => {
    api.get("/base-maps").then((res) => setData(res.data));
  }, []);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">🌍 لایه‌های پایه</h1>

      {/* منوی انتخاب بیس‌مپ */}
      <div className="flex justify-end">
        <div className="relative inline-block text-left">
          <select
            value={activeBase}
            onChange={(e) => setActiveBase(e.target.value as BaseMapType)}
            className="rounded-lg border-gray-300 bg-white dark:bg-gray-800 text-gray-800 dark:text-white shadow px-3 py-2 focus:ring-2 focus:ring-blue-500"
          >
            {Object.entries(BASEMAPS).map(([key, map]) => (
              <option key={key} value={key}>
                {map.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* نقشه */}
      <div className="h-[600px] w-full rounded shadow overflow-hidden">
        <MapContainer
          bounds={[
            [34.314269, 47.069031],
            [34.323814, 47.078733],
          ]}
          className="h-full w-full"
        >
          <TileLayer
            url={BASEMAPS[activeBase].url}
            attribution={BASEMAPS[activeBase].attribution}
          />
          {data && <GeoJSON data={data} />}
        </MapContainer>
      </div>
    </div>
  );
}
