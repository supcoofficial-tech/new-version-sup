// src/pages/UrbanDevelopment.tsx
import React, { useCallback, useMemo, useState } from "react";
import MapView from "../components/MapView";
import Indicators from "../components/Indicators";

type ScenarioMode = "all" | "demolition" | "vertical" | "landuse";

const UrbanDevelopment: React.FC = () => {
  const center = useMemo(() => ({ lat: 34.3193, lon: 47.0742 }), []);
  const [showBase, setShowBase] = useState<boolean>(true);
  const [showRoads, setShowRoads] = useState<boolean>(true);
  const [runAnalysis, setRunAnalysis] = useState<boolean>(false);

  const [scenarioMode, setScenarioMode] = useState<ScenarioMode>("all");

  const [selectedFeature, setSelectedFeature] = useState<any>(null);
  const [allFeatures, setAllFeatures] = useState<any[]>([]);
  const [showCompare, setShowCompare] = useState<boolean>(false);

  const onFeatureClick = useCallback((props: any) => {
    setSelectedFeature(props);
  }, []);

  const onFeaturesLoad = useCallback((features: any[]) => {
    setAllFeatures(features || []);
  }, []);

  return (
    <div className="flex h-[100vh] bg-gray-50">
      {/* پنل کنترلی چپ */}
      <aside className="w-80 p-4 border-r border-gray-200 bg-white text-gray-800 overflow-y-auto">
        <div className="font-bold text-lg mb-3">توسعه شهری (تحلیل و آنالیز)</div>

        {/* کلیدهای لایه‌ها */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowBase(v => !v)}
            className={`w-full p-2.5 rounded-xl border text-sm transition ${
              showBase
                ? "bg-blue-50 border-blue-300 text-blue-900"
                : "bg-white border-gray-300 hover:bg-blue-50"
            }`}
            title="نمایش/پنهان نقشه پایه"
          >
            🗺️ نقشه پایه — {showBase ? "نمایش" : "پنهان"}
          </button>

          <button
            type="button"
            onClick={() => setShowRoads(v => !v)}
            className={`w-full p-2.5 rounded-xl border text-sm transition ${
              showRoads
                ? "bg-purple-50 border-purple-300 text-purple-900"
                : "bg-white border-gray-300 hover:bg-purple-50"
            }`}
            title="نمایش/پنهان راه‌ها"
          >
            🛣️ نقشه راه‌ها — {showRoads ? "نمایش" : "پنهان"}
          </button>

          <button
            type="button"
            onClick={() => setRunAnalysis(v => !v)}
            className={`w-full p-2.5 rounded-xl border text-sm transition ${
              runAnalysis
                ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                : "bg-white border-gray-300 hover:bg-emerald-50"
            }`}
            title="اجرای تحلیل (انیمیشن و بارگذاری استایل)"
          >
            🔍 اجرای تحلیل — {runAnalysis ? "فعال" : "غیرفعال"}
          </button>
        </div>

        {/* فیلتر سناریوها */}
        <div className="mt-4">
          <div className="text-sm text-gray-600 mb-1">فیلتر سناریو</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`py-2 rounded border ${
                scenarioMode === "all"
                  ? "bg-blue-50 border-blue-300 text-blue-700"
                  : "bg-white hover:bg-blue-50 border-gray-300"
              }`}
              onClick={() => setScenarioMode("all")}
            >
              همه تغییرات
            </button>
            <button
              className={`py-2 rounded border ${
                scenarioMode === "demolition"
                  ? "bg-rose-50 border-rose-300 text-rose-700"
                  : "bg-white hover:bg-rose-50 border-gray-300"
              }`}
              onClick={() => setScenarioMode("demolition")}
            >
              بازسازی/نوسازی
            </button>
            <button
              className={`py-2 rounded border ${
                scenarioMode === "vertical"
                  ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                  : "bg-white hover:bg-indigo-50 border-gray-300"
              }`}
              onClick={() => setScenarioMode("vertical")}
            >
              توسعه عمودی
            </button>
            <button
              className={`py-2 rounded border ${
                scenarioMode === "landuse"
                  ? "bg-amber-50 border-amber-300 text-amber-700"
                  : "bg-white hover:bg-amber-50 border-gray-300"
              }`}
              onClick={() => setScenarioMode("landuse")}
            >
              تغییر کاربری
            </button>
          </div>
        </div>

        {/* راهنمای کوتاه */}
        <div className="mt-4 text-[12px] text-gray-600 space-y-1">
          <div>• روی هر قطعه کلیک کن تا جزئیات بیاد.</div>
          <div>• «نمایش جدول مقایسه‌ای» برای دیدن قبل/بعد.</div>
        </div>
      </aside>

      {/* نقشه وسط */}
      <section className="flex-1 border-x border-gray-200 bg-white">
        <MapView
          showBase={showBase}
          showRoads={showRoads}
          runAnalysis={runAnalysis}
          onFeatureClick={onFeatureClick}
          onFeaturesLoad={onFeaturesLoad}
          selectedFeature={selectedFeature}
          scenarioMode={scenarioMode}
        />
      </section>

      {/* پنل اطلاعات راست */}
      <aside className="w-96 p-4 bg-white border-l border-gray-200 text-gray-800 overflow-y-auto">
        <Indicators selectedFeature={selectedFeature} allFeatures={allFeatures} />

        {selectedFeature && (
          <div className="mt-4 p-3 bg-white rounded border border-gray-200 max-h-[28rem] overflow-y-auto space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800">📊 جدول اطلاعات قطعه</h2>
              <button
                className="px-3 py-1 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white"
                onClick={() => setShowCompare(prev => !prev)}
                title="نمایش/پنهان مقایسه قبل/بعد"
              >
                {showCompare ? "✖ بستن مقایسه" : "🔁 نمایش مقایسه"}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border border-gray-300 text-sm bg-white rounded">
                <thead>
                  <tr className="bg-gray-100 text-gray-700">
                    <th className="px-3 py-2 border border-gray-300">ویژگی</th>
                    <th className="px-3 py-2 border border-gray-300">مقدار</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(selectedFeature).map(([key, value], idx) => (
                    <tr
                      key={idx}
                      className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                    >
                      <td className="px-3 py-2 border border-gray-200">{key}</td>
                      <td className="px-3 py-2 border border-gray-200">
                        {String(value) !== "null" && String(value) !== "undefined"
                          ? String(value)
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {showCompare && (
              <CompareTable feature={selectedFeature} scenarioMode={scenarioMode} />
            )}
          </div>
        )}
      </aside>
    </div>
  );
};

/* ------------------------------------------------
   جدول مقایسه‌ای (قبل/بعد) — همون منطق Simulation
------------------------------------------------- */
const CompareTable: React.FC<{
  feature: Record<string, any>;
  scenarioMode: ScenarioMode;
}> = ({ feature, scenarioMode }) => {
  if (!feature) return null;
  const F = feature || {};
  const val = (k: string) =>
    F[k] !== undefined && F[k] !== null && String(F[k]) !== "undefined"
      ? F[k]
      : undefined;
  const norm2 = (x: any) => (x == null ? undefined : String(x).padStart(2, "0"));
  const toNum = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : undefined);
  const changed = (a: any, b: any) =>
    a !== undefined && b !== undefined && String(a) !== String(b);

  const luBefore =
    norm2(val("landuse_code_initial")) ??
    norm2(val("initial_la")) ??
    norm2(val("Landuse")) ??
    norm2(val("landuse"));
  const luAfter =
    norm2(val("landuse_code_final")) ??
    norm2(val("final_land")) ??
    norm2(val("LND_FIN")) ??
    luBefore;

  const floorsBefore = toNum(val("base_floors") ?? val("Floors_Num") ?? val("floors"));
  const floorsAfter = toNum(val("final_floors") ?? val("floors") ?? floorsBefore);
  const heightBefore = toNum(val("base_height") ?? val("height"));
  const heightAfter = toNum(val("final_height") ?? val("height") ?? heightBefore);

  const condBefore = val("condition");
  const condAfter = val("final_condition");
  const redevelopB = val("redevelop");
  const redevelopA = val("final_redevelop");
  const demoFlagB = val("demo_flag") ?? val("Demolition");
  const demoFlagA = val("final_demo_flag");

  type Row = { label: string; before?: any; after?: any; show: boolean };
  const rows: Row[] = [
    {
      label: "landuse",
      before: luBefore,
      after: luAfter,
      show: scenarioMode === "all" || scenarioMode === "landuse",
    },
    {
      label: "floors",
      before: floorsBefore,
      after: floorsAfter,
      show: scenarioMode === "all" || scenarioMode === "vertical",
    },
    {
      label: "height",
      before: heightBefore,
      after: heightAfter,
      show: scenarioMode === "all" || scenarioMode === "vertical",
    },
    {
      label: "condition",
      before: condBefore,
      after: condAfter,
      show: scenarioMode === "all" || scenarioMode === "demolition",
    },
    {
      label: "redevelop",
      before: redevelopB,
      after: redevelopA,
      show: scenarioMode === "all" || scenarioMode === "demolition",
    },
    {
      label: "demo_flag",
      before: demoFlagB,
      after: demoFlagA,
      show: scenarioMode === "all" || scenarioMode === "demolition",
    },
  ];

  const finalRows = rows.filter(
    (r) => r.show && (r.before !== undefined || r.after !== undefined)
  );

  return (
    <div className="overflow-x-auto">
      <h3 className="text-base font-bold mb-2 text-sky-700">🔁 مقایسه (قبل / بعد)</h3>
      <table className="min-w-full border border-sky-300 text-sm bg-white rounded">
        <thead>
          <tr className="bg-sky-100 text-sky-900">
            <th className="px-3 py-2 border border-sky-300">ویژگی</th>
            <th className="px-3 py-2 border border-sky-300">قبل</th>
            <th className="px-3 py-2 border border-sky-300">بعد</th>
          </tr>
        </thead>
        <tbody>
          {finalRows.length ? (
            finalRows.map((r, i) => {
              const isChanged = changed(r.before, r.after);
              return (
                <tr
                  key={r.label + i}
                  className={
                    isChanged
                      ? "bg-amber-50/60"
                      : i % 2 === 0
                      ? "bg-white"
                      : "bg-gray-50"
                  }
                >
                  <td className="px-3 py-2 border border-sky-200">{r.label}</td>
                  <td className="px-3 py-2 border border-sky-200">
                    {r.before !== undefined ? String(r.before) : "-"}
                  </td>
                  <td
                    className={
                      "px-3 py-2 border border-sky-200 " +
                      (isChanged ? "font-bold text-amber-700" : "")
                    }
                  >
                    {r.after !== undefined ? String(r.after) : "-"}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td className="px-3 py-2 border border-sky-200 text-center" colSpan={3}>
                مورد قابل مقایسه‌ای برای این سناریو یافت نشد.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default UrbanDevelopment;
