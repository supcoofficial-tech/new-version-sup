
import React, { useState, useEffect, useCallback } from "react";

// کامپوننت‌ها و سرویس‌ها
import Sidebar from "../components/Sidebar2";
import MapView from "../components/MapView";
import Indicators from "../components/Indicators";
import Weather from "../components/Weather";
import api from "../../services/api";
import CitySimOverlay from "../three/CitySimOverlay";

// انواع سناریو و تب تاب‌آوری
type ScenarioMode = "all" | "demolition" | "vertical" | "landuse";
type ResilienceTab = "flood" | "heat" | "fire" | "quake" | "merge" | null;

// برای Legend گسسته
type DiscreteLegendItem = { label: string; color: string };

// ------------------------------------------------------
// تابع تنظیم Legend بر اساس تب تاب‌آوری (خارج از JSX)
// ------------------------------------------------------
function legendFor(tab: ResilienceTab) {
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
      return {
        title: "تحلیل سیلاب",
        gradient:
          "linear-gradient(to left,#fff7bc,#fee391,#fdae6b,#f16913,#7f0000)",
        labels: ["کم", "متوسط", "زیاد"] as [string, string, string],
        discrete: undefined,
      };
    case "heat":
      return {
        title: "تحلیل گرما",
        gradient:
          "linear-gradient(to left,#fff7bc,#fee391,#fdae6b,#f16913,#7f0000)",
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
    default:
      return null;
  }
}

// کارت Legend (استایل روشن)
const LegendCard: React.FC<{
  title: string;
  gradient?: string | null;
  labels?: [string, string, string];
  discrete?: DiscreteLegendItem[];
}> = ({ title, gradient, labels, discrete }) => {
  const isDiscrete = !!discrete?.length;

  return (
    <div
      className="mt-4 w-full rounded-xl p-3 text-gray-800 shadow-sm border border-gray-200 backdrop-blur-md bg-white/80"
    >
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
          <div
            className="h-3 rounded-md ring-1 ring-gray-200"
            style={{ background: gradient || "transparent" }}
          />
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

// ===================================================================================
// کامپوننت اصلی: Simulation (Light)
// ===================================================================================
const Simulation: React.FC = () => {
  const [scenarioMode, setScenarioMode] = useState<ScenarioMode>("all");

  const BOUNDS: [[number, number], [number, number]] = [
    [34.31518, 47.070146],
    [34.323338, 47.078256],
  ];

  const [showResilience, setShowResilience] = useState(false);
  const [resilienceTab, setResilienceTab] = useState<ResilienceTab>(null);

  const [show3D, setShow3D] = useState(false);

  const [showBase, setShowBase] = useState(false);
  const [showRoads, setShowRoads] = useState(false);
  const [showWeather, setShowWeather] = useState(false);
  const [runAnalysis, setRunAnalysis] = useState(false);

  const [show3DOnFeature, setShow3DOnFeature] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<any>(null);
  const [allFeatures, setAllFeatures] = useState<any[]>([]);

  const [agents, setAgents] = useState<any[]>([]);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<number | "">("");
  const [selectedScenario, setSelectedScenario] = useState<number | "">("");

  const [result, setResult] = useState<any>(null);
  const [simFrames, setSimFrames] = useState<any[]>([]);
  const [progress, setProgress] = useState(0);
  const [opCounts, setOpCounts] = useState<{ recolor: number; hide: number; attr: number}>(
    { recolor: 0, hide: 0, attr: 0 }
  );
  const [showJson, setShowJson] = useState(false);
  const [showCompare, setShowCompare] = useState<boolean>(false);

  const [show3DBounds, setShow3DBounds] = useState(false);

  useEffect(() => {
    api.get("/agents/").then((res) => setAgents(res.data || []));
    api.get("/scenarios/").then((res) => setScenarios(res.data || []));
  }, []);

  const runSimulation = async () => {
    if (!selectedAgent || !selectedScenario) {
      alert("لطفاً ایجنت و سناریو را انتخاب کنید.");
      return;
    }
    try {
      const payload = {
        agent_id: Number(selectedAgent),
        scenario_id: Number(selectedScenario),
        steps: 6,
        seed: 42,
        map_name: "Feizabad",
      };
      const res = await api.post("/simulator/run", payload);
      setResult(res.data);
      const frames = res.data?.frames || [];
      setSimFrames(frames);
      const counts = frames.reduce((acc: any, f: any) => {
        acc[f.operation] = (acc[f.operation] || 0) + 1;
        return acc;
      }, {});
      setOpCounts({
        recolor: counts.recolor || 0,
        hide: counts.hide || 0,
        attr: counts.attr || 0,
      });
      setProgress(0);
    
    } catch (err) {
      console.error("خطا در اجرای شبیه‌سازی:", err);
      alert("اجرای شبیه‌سازی ناموفق شد.");
    }
  };

  const onOpen3D = useCallback(() => {
    setShow3DBounds((v) => !v);
  }, []);

  return (
   <div className="flex h-full w-full bg-pink-50">
      {/* سایدبار چپ (روشن) */}
      <div className="w-1/4 bg-pink-50 text-gray-800 p-4 overflow-y-auto relative z-50 border-r border-gray-200 shadow-sm">
        <Sidebar
          onToggleWeather={() => setShowWeather((p) => !p)}
          onToggleBase={() => setShowBase((p) => !p)}
          onToggleAnalysis={() => setRunAnalysis((p) => !p)}
          onOpenResilience={() => setShowResilience(true)}
          onOpen3D={() => setShow3D((v) => !v)}
          onToggleRoads={() => setShowRoads((p) => !p)}
          showBase={showBase}
          showWeather={showWeather}
          runAnalysis={runAnalysis}
          showRoads={showRoads}
        />

        <div className="mt-3" />

        {showWeather && <Weather />}

        {/* هدر کنترلی (روشن) */}
        <div className="mt-4 p-3 rounded-xl bg-pink-50/80 border border-pink-200 space-y-3 text-sm shadow-sm backdrop-blur-[2px]">
  <div className="flex flex-wrap gap-2">
    {/*
      یک بیس کلاس برای دکمه‌ها تا کد تمیزتر شود
      - فوکوس‌رینگ صورتی
      - گوشه‌های نرم و سایه خیلی لطیف
    */}
  
     
  </div>


          {/* انتخاب‌ها */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div>
              <div className="text-gray-500 text-xs mb-1">انتخاب ایجنت</div>
              <select className="w-full bg-white border border-gray-300 p-2 rounded" value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value ? Number(e.target.value) : "") }>
                <option value="">-- انتخاب کنید --</option>
                {agents.map((a: any) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-gray-500 text-xs mb-1">انتخاب سناریو</div>
              <select className="w-full bg-white border border-gray-300 p-2 rounded" value={selectedScenario} onChange={(e) => setSelectedScenario(e.target.value ? Number(e.target.value) : "") }>
                <option value="">-- انتخاب کنید --</option>
                {scenarios.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name || s.title || `Scenario ${s.id}`}</option>
                ))}
              </select>
            </div>
          </div>

          {/* فیلتر سناریو ABM (روشن) */}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className={`py-2 rounded border ${scenarioMode === "all" ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white hover:bg-blue-50 border-gray-300"}`} onClick={() => setScenarioMode("all")}>همه تغییرات</button>
            <button className={`py-2 rounded border ${scenarioMode === "demolition" ? "bg-rose-50 border-rose-300 text-rose-700" : "bg-white hover:bg-rose-50 border-gray-300"}`} onClick={() => setScenarioMode("demolition")}>بازسازی/نوسازی</button>
            <button className={`py-2 rounded border ${scenarioMode === "vertical" ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white hover:bg-indigo-50 border-gray-300"}`} onClick={() => setScenarioMode("vertical")}>توسعه عمودی</button>
            <button className={`py-2 rounded border ${scenarioMode === "landuse" ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-white hover:bg-amber-50 border-gray-300"}`} onClick={() => setScenarioMode("landuse")}>تغییر کاربری</button>
          </div>
        </div>

        {/* دراور تاب‌آوری اقلیمی (روشن) */}
        {showResilience && (
          <div className="fixed top-0 left-0 h-full w-full z-[2000] bg-black/20">
            <div className="absolute top-0 right-0 h-full w-[320px] shadow-2xl p-4 flex flex-col gap-3 text-gray-800 border-l border-gray-200 bg-white/90 backdrop-blur-md" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <div className="font-bold">تاب‌آوری اقلیمی</div>
                <button className="px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-500" onClick={() => setShowResilience(false)} title="بستن پانل">✖</button>
              </div>

              <div className="grid grid-cols-1 gap-2 mt-3 p-3 rounded-xl shadow-inner border border-gray-200 bg-white/80">
                {[
                  { key: null, label: "❌ بستن تاب‌آوری", color: "from-gray-200 to-gray-300" },
                  { key: "flood", label: "🌊 تحلیل سیلاب", color: "from-yellow-300 to-yellow-500" },
                  { key: "heat", label: "🔥 تحلیل گرما", color: "from-amber-300 to-orange-500" },
                  { key: "fire", label: "🌲 تحلیل آتش‌سوزی", color: "from-orange-200 to-red-500" },
                  { key: "quake", label: "🪨 تحلیل زلزله", color: "from-rose-200 to-rose-500" },
                  { key: "merge", label: "🧩 نقشه جامع", color: "from-emerald-300 to-lime-500" },
                ].map((btn) => (
                  <button
                    key={btn.key ?? "none"}
                    onClick={() => {
                      if (btn.key === null) {
                        setResilienceTab(null);
                        setShowResilience(false);
                      } else {
                        setResilienceTab(btn.key as ResilienceTab);
                      }
                    }}
                    className={`relative px-4 py-2 rounded-lg font-medium text-gray-900 shadow transition-all duration-200 bg-gradient-to-r ${btn.color} hover:shadow-md focus:outline-none`}
                    title={String(btn.label)}
                  >
                    {resilienceTab === btn.key && btn.key !== null && (
                      <span className="absolute left-2 top-2 w-2 h-2 rounded-full bg-white animate-pulse" />
                    )}
                    {btn.label}
                  </button>
                ))}
              </div>

              <div className="mt-3 text-xs text-gray-700 flex items-center gap-2">
                <span>تب فعال:</span>
                <span className="px-2 py-0.5 rounded bg-gray-200 text-gray-800 font-semibold">
                  {resilienceTab ? { flood: "سیلاب", heat: "گرما", fire: "آتش‌سوزی", quake: "زلزله", merge: "نقشه جامع" }[resilienceTab] : "—"}
                </span>
              </div>

              {(() => {
                const cfg = legendFor(resilienceTab);
                return cfg ? (
                  <LegendCard title={cfg.title} gradient={(cfg as any).gradient} labels={(cfg as any).labels} discrete={(cfg as any).discrete} />
                ) : null;
              })()}
            </div>
          </div>
        )}

        {result && (
          <div className="mt-4 bg-white p-4 rounded-lg text-sm border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-gray-500">سناریو:</div>
                <div className="font-bold text-gray-800">{result.scenario_name || result.name || "—"}</div>
              </div>
              <div className="text-xs px-2 py-1 rounded bg-emerald-50 border border-emerald-300 text-emerald-700">{simFrames.length} فریم</div>
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>پیشرفت شبیه‌سازی</span>
                <span>%{progress}</span>
              </div>
              <div className="w-full h-2 rounded bg-gray-200 overflow-hidden">
                <div className="h-2 bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded bg-indigo-50 border border-indigo-200 p-2 text-center">
                <div className="text-[11px] text-indigo-700">تغییر رنگ</div>
                <div className="text-lg font-bold text-indigo-800">{opCounts.recolor}</div>
              </div>
              <div className="rounded bg-rose-50 border border-rose-200 p-2 text-center">
                <div className="text-[11px] text-rose-700">حذف/محو</div>
                <div className="text-lg font-bold text-rose-800">{opCounts.hide}</div>
              </div>
              <div className="rounded bg-amber-50 border border-amber-200 p-2 text-center">
                <div className="text-[11px] text-amber-700">تغییر ویژگی</div>
                <div className="text-lg font-bold text-amber-800">{opCounts.attr}</div>
              </div>
            </div>

            {showJson && (
              <pre className="mt-3 max-h-64 overflow-auto bg-gray-50 p-2 rounded border border-gray-200 text-gray-800">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* نقشه / 3D Overlay */}
      <div className="w-2/4 bg-white h-screen border-x border-pink-200">
        <MapView
          showBase={showBase}
          showRoads={showRoads}
          runAnalysis={runAnalysis}
          onCloseAnalysis={() => setRunAnalysis(true)}
          onFeatureClick={(props) => setSelectedFeature(props)}
          onFeaturesLoad={(features) => setAllFeatures(features || [])}
          selectedFeature={selectedFeature}
          scenarioMode={scenarioMode}
          show3DBounds={show3DBounds}
          onClose3D={() => setShow3DBounds(false)}
          bounds={BOUNDS}
          fbxFiles={[{ name: "fbx2", url: "/model.fbx", opacity: 1 }]}
          resilienceTab={resilienceTab}
        />
      </div>

      {/* پنجره‌ی شناور سه‌بعدی */}
      {show3D && (
        <CitySimOverlay
          onClose={() => setShow3D(false)}
        />
      )}

      {/* پنل اطلاعات سمت راست (روشن) */}
      <div className="w-1/4 bg-pink-50 text-gray-800 p-4 overflow-y-auto border-l border-gray-200 shadow-sm">
        <Indicators selectedFeature={selectedFeature} allFeatures={allFeatures} />

        {selectedFeature && (
          <div className="mt-4 p-3 bg-white rounded border border-gray-200 max-h-[28rem] overflow-y-auto space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800">📊 جدول اطلاعات منطقه:</h2>
              <button className="px-3 py-1 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white" onClick={() => setShowCompare((prev) => !prev)} title="نمایش/پنهان جدول مقایسه‌ای">{showCompare ? "✖ بستن مقایسه" : "🔁 نمایش جدول مقایسه‌ای"}</button>
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
                    <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <td className="px-3 py-2 border border-gray-200">{key}</td>
                      <td className="px-3 py-2 border border-gray-200">{String(value) !== "null" && String(value) !== "undefined" ? String(value) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {showCompare && <CompareTable feature={selectedFeature} scenarioMode={scenarioMode} />}
          </div>
        )}
      </div>
    </div>
  );
};

// ===================================================================================
// جدول مقایسه‌ای (قبل/بعد) — نسخه‌ی روشن
// ===================================================================================
const CompareTable: React.FC<{ feature: Record<string, any>; scenarioMode: ScenarioMode; }> = ({ feature, scenarioMode }) => {
  if (!feature) return null;
  const F = feature || {};
  const val = (k: string) => (F[k] !== undefined && F[k] !== null && String(F[k]) !== "undefined" ? F[k] : undefined);
  const norm2 = (x: any) => (x == null ? undefined : String(x).padStart(2, "0"));
  const toNum = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : undefined);
  const changed = (a: any, b: any) => a !== undefined && b !== undefined && String(a) !== String(b);

  const luBefore = norm2(val("landuse_code_initial")) ?? norm2(val("initial_la")) ?? norm2(val("Landuse")) ?? norm2(val("landuse"));
  const luAfter = norm2(val("landuse_code_final")) ?? norm2(val("final_land")) ?? norm2(val("LND_FIN")) ?? luBefore;

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
    { label: "landuse", before: luBefore, after: luAfter, show: scenarioMode === "all" || scenarioMode === "landuse" },
    { label: "floors", before: floorsBefore, after: floorsAfter, show: scenarioMode === "all" || scenarioMode === "vertical" },
    { label: "height", before: heightBefore, after: heightAfter, show: scenarioMode === "all" || scenarioMode === "vertical" },
    { label: "condition", before: condBefore, after: condAfter, show: scenarioMode === "all" || scenarioMode === "demolition" },
    { label: "redevelop", before: redevelopB, after: redevelopA, show: scenarioMode === "all" || scenarioMode === "demolition" },
    { label: "demo_flag", before: demoFlagB, after: demoFlagA, show: scenarioMode === "all" || scenarioMode === "demolition" },
  ];

  const finalRows = rows.filter((r) => r.show && (r.before !== undefined || r.after !== undefined));

  return (
    <div className="overflow-x-auto">
      <h3 className="text-base font-bold mb-2 text-sky-700">🔁 جدول مقایسه‌ای (قبل / بعد)</h3>
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
                <tr key={r.label + i} className={isChanged ? "bg-amber-50/60" : i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="px-3 py-2 border border-sky-200">{r.label}</td>
                  <td className="px-3 py-2 border border-sky-200">{r.before !== undefined ? String(r.before) : "-"}</td>
                  <td className={"px-3 py-2 border border-sky-200 " + (isChanged ? "font-bold text-amber-700" : "")}>{r.after !== undefined ? String(r.after) : "-"}</td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td className="px-3 py-2 border border-sky-200 text-center" colSpan={3}>مورد قابل مقایسه‌ای برای این سناریو یافت نشد.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default Simulation;
