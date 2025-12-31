import { useEffect, useState } from "react";
import api from "../../services/api";


interface Simulation {
  id: number;
  scenario_id: number;
  status: string;
  results?: {
    summary?: { ticks: number; agents: number };
    metrics?: Record<string, number>;
  };
}

export default function Reports() {
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      api.get("/simulation/"),
      api.get("/analytics/summary"),
    ]).then(([simsRes, summaryRes]) => {
      setSimulations(simsRes.data ?? []);
      setSummary(summaryRes.data ?? null);
    });
  }, []);

  const handleDownload = (type: string) => {
    window.open(`${import.meta.env.VITE_API_BASE_URL}/reports/${type}`, "_blank");
  };

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-bold">📊 گزارش‌ها و خروجی‌ها</h1>

      {summary && (
        <div className="bg-white p-4 shadow rounded">
          <h2 className="font-bold mb-2">📈 خلاصه شاخص‌ها</h2>
          <ul>
            <li>👥 عامل‌ها: {summary.counts?.agents}</li>
            <li>📑 سناریوها: {summary.counts?.scenarios}</li>
            <li>⚙️ شبیه‌سازی‌ها: {summary.counts?.simulations}</li>
          </ul>
        </div>
      )}


      <div className="bg-white p-4 shadow rounded">
        <h2 className="font-bold mb-2">⚙️ نتایج شبیه‌سازی‌ها</h2>
        <ul className="list-disc list-inside">
          {simulations.map((s) => (
            <li key={s.id}>
              Simulation {s.id} → {s.status}
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white p-4 shadow rounded">
        <h2 className="font-bold mb-2">⬇️ دانلود خروجی‌ها</h2>
        <div className="flex gap-2">
          <button
            onClick={() => handleDownload("csv")}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            📄 CSV
          </button>
          <button
            onClick={() => handleDownload("geojson")}
            className="bg-green-600 text-white px-4 py-2 rounded"
          >
            🗺️ GeoJSON
          </button>
          <button
            onClick={() => handleDownload("pdf")}
            className="bg-red-600 text-white px-4 py-2 rounded"
          >
            📑 PDF
          </button>
        </div>
      </div>
    </div>
  );
}
