// src/pages/ClimateResilience.tsx
import React, { useMemo, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import FitInitialBounds from "../map/FitInitialBounds";
import WeatherFloodMini from "../components/WeatherFloodMini";

// لایه‌ها (مسیرها رو مطابق پروژه‌ی خودت نگه دار)
import FloodRiskLayer from "../map/layers/FloodRiskLayer";
import HeatRiskLayer from "../map/layers/HeatRiskLayer";
import FireLayer from "../map/layers/FireLayer";
import QuakeLayer from "../map/layers/QuakeLayer";
import MergeLayer from "../map/layers/MergeLayer";

/* ---------------------------------------------
   کارت لِجند گرادیانی (مثل صفحه‌ی اصلی)
---------------------------------------------- */
type DiscreteLegendItem = { label: string; color: string };
const LegendCard: React.FC<{
  title: string;
  gradient?: string | null;
  labels?: [string, string, string];
  discrete?: DiscreteLegendItem[];
}> = ({ title, gradient, labels, discrete }) => {
  const isDiscrete = !!discrete?.length;
  return (
    <div className="w-56 rounded-xl p-3 text-gray-800 shadow-sm border border-gray-200 backdrop-blur-md bg-white/80">
      <div className="font-bold mb-2">{title}</div>
      {isDiscrete ? (
        <div className="flex justify-between">
          {discrete!.map((d) => (
            <div key={d.label} className="flex items-center gap-2 text-xs">
              <span
                className="inline-block w-3.5 h-3.5 rounded-full border border-gray-300"
                style={{ background: d.color }}
              />
              <span>{d.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="h-3 rounded-md ring-1 ring-gray-200" style={{ background: gradient || "transparent" }} />
          <div className="flex justify-between text-[11px] text-gray-500 mt-1">
            <span>{labels?.[0]}</span>
            <span>{labels?.[1]}</span>
            <span>{labels?.[2]}</span>
          </div>
        </>
      )}
    </div>
  );
};

/* ---------------------------------------------
   لِجندهای تب‌ها (گرادیان/عنوان)
---------------------------------------------- */
type ResilienceTab = "flood" | "heat" | "fire" | "quake" | "merge" | null;

function legendFor(tab: Exclude<ResilienceTab, null>) {
  switch (tab) {
    case "merge":
      return {
        title: "نقشه جامع",
        gradient: null,
        labels: undefined,
        discrete: [
          { label: "کم", color: "#2ecc71" },
          { label: "متوسط", color: "#f1c40f" },
          { label: "زیاد", color: "#e74c3c" },
        ] as DiscreteLegendItem[],
      };
    case "flood":
      // مطابق بک‌اند (RdYlBu_r): قرمز ← زرد ← آبی
      return {
        title: "تحلیل سیلاب",
        gradient: "linear-gradient(to left,#d73027,#fdae61,#ffffbf,#abd9e9,#4575b4)",
        labels: ["کم", "متوسط", "زیاد"] as [string, string, string],
        discrete: undefined,
      };
    case "heat":
      return {
        title: "تحلیل گرما",
        gradient: "linear-gradient(to left,#fff7bc,#fee391,#fdae6b,#f16913,#7f0000)",
        labels: ["کم", "متوسط", "زیاد"] as [string, string, string],
        discrete: undefined,
      };
    case "fire":
      return {
        title: "تحلیل آتش‌سوزی",
        gradient: "linear-gradient(to left,#efebe9,#bcaaa4,#8d6e63,#6d4c41,#4e342e)",
        labels: ["کم", "متوسط", "زیاد"] as [string, string, string],
        discrete: undefined,
      };
    case "quake":
      return {
        title: "تحلیل زلزله",
        gradient: "linear-gradient(to left,#fdd49e,#fc8d59,#e34a33,#b30000)",
        labels: ["کم", "متوسط", "زیاد"] as [string, string, string],
        discrete: undefined,
      };
  }
}

/* ---------------------------------------------
   داک لِجندِ سیلاب (بدون Leaflet Control)
   — کارت ریسک + HTML بارش کنار هم
---------------------------------------------- */
const FloodLegendsDock: React.FC<{
  rainHtml: string;
  riskTitle?: string;
  riskGradient?: string;
  labels?: [string, string, string];
}> = ({
  rainHtml,
  riskTitle = "تحلیل سیلاب",
  riskGradient = "linear-gradient(to left,#d73027,#fdae61,#ffffbf,#abd9e9,#4575b4)",
  labels = ["کم", "متوسط", "زیاد"],
}) => {
  return (
    <div
      className="absolute bottom-4 left-4 z-[999] flex gap-4 items-end"
      style={{ pointerEvents: "auto" }}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <LegendCard title={riskTitle} gradient={riskGradient} labels={labels} />
      <div
        className="rounded-xl p-2 shadow-sm border border-gray-200 bg-white/90"
        dangerouslySetInnerHTML={{ __html: rainHtml }}
      />
    </div>
  );
};

/* ---------------------------------------------
   لِجند ثابت بارش (همونی که خودت دادی)
---------------------------------------------- */
const FLOOD_RAIN_HTML = `
  <div style="font-weight:600;margin-bottom:6px;direction:rtl;text-align:right">بارش (mm / 24h)</div>
  <div style="direction:rtl;text-align:right">
    <div><span style="display:inline-block;width:14px;height:14px;background:#deebf7;border:1px solid #999;margin-inline-start:6px"></span>5–0</div>
    <div><span style="display:inline-block;width:14px;height:14px;background:#c6dbef;border:1px solid #999;margin-inline-start:6px"></span>10–5</div>
    <div><span style="display:inline-block;width:14px;height:14px;background:#6baed6;border:1px solid #999;margin-inline-start:6px"></span>20–10</div>
    <div><span style="display:inline-block;width:14px;height:14px;background:#2171b5;border:1px solid #999;margin-inline-start:6px"></span>30–20</div>
    <div><span style="display:inline-block;width:14px;height:14px;background:#08519c;border:1px solid #999;margin-inline-start:6px"></span>50–30</div>
    <div><span style="display:inline-block;width:14px;height:14px;background:#08306b;border:1px solid #999;margin-inline-start:6px"></span>>50</div>
  </div>
`;

/* --------------------------------------------- */

const ClimateResilience: React.FC = () => {
  const [tab, setTab] = useState<ResilienceTab>(null);
  const center = useMemo(() => ({ lat: 34.3193, lon: 47.0742 }), []);
  const cardCfg = tab ? legendFor(tab as Exclude<ResilienceTab, null>) : null;

  return (
    <div className="flex h-[100vh] bg-gray-50">
      {/* نقشه (چپ) */}
      <main className="flex-1 relative">
        {/* ویجت هواشناسی فقط برای سیلاب */}
        {tab === "flood" && (
          <div className="absolute top-4 right-4 z-[999]">
            <WeatherFloodMini lat={center.lat} lon={center.lon} hours={24} />
          </div>
        )}

        <MapContainer center={[center.lat, center.lon]} zoom={14} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url= "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <FitInitialBounds />

          {tab === "flood" && <FloodRiskLayer />}
          {tab === "heat" && <HeatRiskLayer />}
          {tab === "fire" && <FireLayer />}
          {tab === "quake" && <QuakeLayer />}
          {tab === "merge" && <MergeLayer />}
        </MapContainer>

        {/* لِجندها */}
        {tab === "flood" && (
          <FloodLegendsDock
            rainHtml={FLOOD_RAIN_HTML}
            riskTitle="تحلیل سیلاب"
            riskGradient="linear-gradient(to left,#d73027,#fdae61,#ffffbf)"
            labels={["زیاد", "متوسط", "کم"]}
          />
        )}

        {tab && tab !== "flood" && cardCfg && (
          <div className="absolute bottom-4 left-4 z-[999]">
            <LegendCard
              title={cardCfg.title}
              gradient={cardCfg.gradient as any}
              labels={cardCfg.labels as any}
              discrete={cardCfg.discrete as any}
            />
          </div>
        )}

        {!tab && (
          <div className="absolute inset-0 grid place-items-center text-gray-500">
            یک تحلیل را انتخاب کنید
          </div>
        )}
      </main>

      {/* پنل راست (دکمه‌های تب‌ها) */}
      <aside className="w-80 p-4 border-l border-gray-200 bg-white flex flex-col gap-2">
        <div className="font-bold text-gray-800 mb-1">اکولوژی (تاب‌آوری)</div>

        <button className="btn bg-yellow-100 hover:bg-yellow-200" onClick={() => setTab("flood")}>
          تحلیل سیلاب 🌊
        </button>
        <button className="btn bg-amber-100 hover:bg-amber-200" onClick={() => setTab("heat")}>
          تحلیل گرما 🔥
        </button>
        <button className="btn bg-rose-100 hover:bg-rose-200" onClick={() => setTab("fire")}>
          تحلیل آتش‌سوزی 🌲
        </button>
        <button className="btn bg-pink-100 hover:bg-pink-200" onClick={() => setTab("quake")}>
          تحلیل زلزله 🪨
        </button>
        <button className="btn bg-emerald-100 hover:bg-emerald-200" onClick={() => setTab("merge")}>
          نقشه جامع 🧩
        </button>

        <div className="text-xs text-gray-500 mt-2">
          تب فعال:{" "}
          <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-800 font-semibold">
            {tab
              ? { flood: "سیلاب", heat: "گرما", fire: "آتش‌سوزی", quake: "زلزله", merge: "نقشه جامع" }[
                  tab as Exclude<ResilienceTab, null>
                ]
              : "—"}
          </span>
        </div>

        <button className="mt-auto btn bg-gray-100 hover:bg-gray-200" onClick={() => setTab(null)}>
          بستن تاب‌آوری ❌
        </button>
      </aside>
    </div>
  );
};

export default ClimateResilience;
