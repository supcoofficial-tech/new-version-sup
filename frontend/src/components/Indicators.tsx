import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// رنگ‌ها بر اساس کد کاربری اراضی (همخوان با نقشه)
const LANDUSE_COLORS: Record<string, string> = {
  "1": "#FFFFBE",
  "2": "#FF0000",
  "3": "#A3FF73",
  "4": "#267300",
  "5": "#895A44",
  "6": "#FF00C5",
  "7": "#828282",
  "8": "#00E6A9",
  "9": "#005CE6",
};

// helper برای گرفتن کد کاربری
const getLU = (props: any) =>
  props?.initial_la ??
  props?.Initial_la ??
  props?.Landuse ??
  props?.landuse;

interface IndicatorsProps {
  selectedFeature: any;
  allFeatures: any[];
}

const Indicators: React.FC<IndicatorsProps> = ({
  selectedFeature,
  allFeatures,
}) => {
  const handleDownload = () => {
    if (!allFeatures || allFeatures.length === 0) return;

    const geoJson = {
      type: "FeatureCollection",
      features: allFeatures,
    };

    const blob = new Blob([JSON.stringify(geoJson, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "updated-map.geojson";
    a.click();
    URL.revokeObjectURL(url);
  };

  // اطمینان از انتخاب فیچر
  const selectedLU = getLU(selectedFeature || {});
  if (!selectedFeature || selectedLU == null) {
    return (
      <p className="p-4 text-center text-gray-600">
        برای نمایش نمودار، ابتدا یک منطقه را از نقشه انتخاب کنید.
      </p>
    );
  }

  // آمار کاربری از کل فیچرها
  const landuseCounts = allFeatures.reduce(
    (acc: Record<string, number>, f: any) => {
      const lu = getLU(f?.properties || {});
      if (lu != null) {
        const key = String(lu);
        acc[key] = (acc[key] || 0) + 1;
      }
      return acc;
    },
    {}
  );

  const barData = Object.entries(landuseCounts).map(([key, value]) => ({
    name: `initial_la ${key}`,
    value,
    color: LANDUSE_COLORS[key] || "#8884d8",
  }));

  return (
    <div className="p-4">
      {/* کارت شیشه‌ای طوسی برای نمودار */}
      <div className="mb-6 rounded-xl border border-gray-400 bg-white/20 backdrop-blur-md shadow-[0_6px_20px_rgba(0,0,0,0.08)] p-3 transition hover:bg-white/50">
        <div style={{ width: "100%", height: 250 }}>
          <ResponsiveContainer>
            <BarChart data={barData}>
              <XAxis dataKey="name" hide />
              <YAxis hide />
              <Tooltip cursor={false} />
              <Legend iconSize={0} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {barData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* دکمه دانلود با تم هماهنگ */}
      <button
        className="mt-4 w-full rounded-lg bg-pink-500 hover:bg-pink-600 text-white px-4 py-2 font-medium shadow-md transition-all"
        onClick={handleDownload}
      >
        💾 دانلود فایل با تغییرات
      </button>
    </div>
  );
};

export default Indicators;
