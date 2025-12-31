import React, { useEffect, useState } from "react";

type Summary = {
  precip_mm: number;
  wind_max_ms: number;
  temp_min_c: number | null;
  temp_max_c: number | null;
  hours: number;
};

type Current = {
  temp: number;
  humidity: number;
  pressure: number;
  wind_speed: number;
  wind_deg?: number;
  description: string;
  icon: string;
  city?: string;
};

function windDir(deg?: number) {
  if (deg == null) return "-";
  const dirs = ["شمال","شمال‌شرق","شرق","جنوب‌شرق","جنوب","جنوب‌غرب","غرب","شمال‌غرب"];
  return dirs[Math.round(deg / 45) % 8];
}

export default function WeatherFloodMini({ lat, lon, hours = 24 }:{
  lat: number; lon: number; hours?: number;
}) {
  const [cur, setCur] = useState<Current | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        setErr(null);
        const [r1, r2] = await Promise.all([
          fetch(`/api/weather/current?lat=${lat}&lon=${lon}`),
          fetch(`/api/weather/forecast_summary?lat=${lat}&lon=${lon}&hours=${hours}`),
        ]);
        if (!r1.ok) throw new Error("current failed");
        if (!r2.ok) throw new Error("forecast failed");
        const j1 = await r1.json();
        const j2 = await r2.json();
        setCur({
          temp: j1.temp, humidity: j1.humidity, pressure: j1.pressure,
          wind_speed: j1.wind_speed, wind_deg: j1.wind_deg,
          description: j1.description, icon: j1.icon, city: j1.city,
        });
        setSum(j2);
      } catch (e:any) {
        setErr(e.message || "خطا در دریافت داده‌ها");
      }
    };
    run();
  }, [lat, lon, hours]);

  if (err) return <div className="p-3 text-red-600">خطا: {err}</div>;
  if (!cur || !sum) return <div className="p-3 text-gray-500">در حال دریافت داده…</div>;

  return (
    <div className="bg-white rounded-xl shadow p-4 text-gray-800 w-full max-w-md">
      <div className="flex items-center gap-3">
        <img src={`https://openweathermap.org/img/wn/${cur.icon}@2x.png`} className="w-12 h-12" />
        <div>
          <div className="font-bold">{cur.city ?? "مختصات"} • {Math.round(cur.temp)}°C</div>
          <div className="text-sm text-gray-600">{cur.description}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
        <div className="p-3 rounded-lg bg-gray-50">
          <div className="text-xs text-gray-500">بارش {sum.hours} ساعت آینده</div>
          <div className="text-xl font-bold">{sum.precip_mm} mm</div>
        </div>
        <div className="p-3 rounded-lg bg-gray-50">
          <div className="text-xs text-gray-500">بیشینه باد</div>
          <div className="text-xl font-bold">{sum.wind_max_ms} m/s</div>
          <div className="text-xs text-gray-500">{windDir(cur.wind_deg)}</div>
        </div>
        <div className="p-3 rounded-lg bg-gray-50">
          <div className="text-xs text-gray-500">کمینه/بیشینه دما</div>
          <div className="text-xl font-bold">
            {sum.temp_min_c ?? "-"} / {sum.temp_max_c ?? "-"} °C
          </div>
        </div>
        <div className="p-3 rounded-lg bg-gray-50">
          <div className="text-xs text-gray-500">رطوبت • فشار</div>
          <div className="text-xl font-bold">{cur.humidity}% • {cur.pressure} hPa</div>
        </div>
      </div>
    </div>
  );
}
