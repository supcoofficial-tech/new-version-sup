import React, { memo } from "react";
import { FaCloudSun, FaMap, FaRoad, FaChartLine, FaCubes, FaLeaf } from "react-icons/fa";
import { useNavigate } from "react-router-dom";

export interface SidebarProps {
  onToggleWeather: () => void;
  onToggleBase: () => void;
  onToggleAnalysis: () => void;
  onToggleRoads: () => void;
  showBase: boolean;
  runAnalysis: boolean;
  showWeather: boolean;
  showRoads: boolean;
  onOpen3D: () => void;
  onOpenResilience: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  onToggleWeather,
  onToggleBase,
  onToggleAnalysis,
  onToggleRoads,
  showBase,
  showWeather,
  runAnalysis,
  showRoads,
  onOpen3D,
  onOpenResilience,
}) => {
  const navigate = useNavigate();

  const baseBtn =
    "group w-full p-2.5 md:p-3 text-sm rounded-xl shadow-md transition-all duration-300 " +
    "flex items-center justify-between hover:-translate-y-0.5 hover:shadow-lg " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

  const StatusChip: React.FC<{ text: string }> = ({ text }) => (
    <span className="px-2 py-0.5 rounded-md text-[11px] md:text-xs bg-gray-200 text-gray-700" aria-hidden>
      {text}
    </span>
  );

  return (
    <aside
      dir="rtl"
      className="flex flex-col gap-3 bg-white p-4 md:p-5 rounded-xl shadow-xl text-gray-800 overflow-y-auto overflow-x-hidden w-full border border-gray-200"
    >
      {/* نقشه پایه */}
      <button
        type="button"
        onClick={onToggleBase}
        aria-pressed={showBase}
        title="نمایش / پنهان نقشه پایه"
        className={`${baseBtn} bg-gradient-to-r from-blue-100 to-blue-300 hover:from-blue-200 hover:to-blue-400 text-blue-900`}
      >
        <span className="flex items-center gap-2">
          <FaMap className="text-base" />
          <span>نقشه پایه</span>
        </span>
        <StatusChip text={showBase ? "✖ پنهان" : "✓ نمایش"} />
      </button>

      {/* نقشه راه‌ها */}
      <button
        type="button"
        onClick={onToggleRoads}
        aria-pressed={showRoads}
        title="نمایش / پنهان راه‌ها"
        className={`${baseBtn} bg-gradient-to-r from-purple-100 to-purple-300 hover:from-purple-200 hover:to-purple-400 text-purple-900`}
      >
        <span className="flex items-center gap-2">
          <FaRoad className="text-base" />
          <span>نقشه راه‌ها</span>
        </span>
        <StatusChip text={showRoads ? "✖ پنهان" : "✓ نمایش"} />
      </button>

      {/* تحلیل و آنالیز */}
      <button
        type="button"
        onClick={onToggleAnalysis}
        aria-pressed={runAnalysis}
        title="تحلیل و آنالیز"
        className={`${baseBtn} bg-gradient-to-r from-green-100 to-emerald-300 hover:from-green-200 hover:to-emerald-400 text-green-900`}
      >
        <span className="flex items-center gap-2">
          <FaChartLine className="text-base" />
          <span>تحلیل و آنالیز</span>
        </span>
        <StatusChip text={runAnalysis ? "✖ توقف" : "🔍 اجرا"} />
      </button>

      {/* تحلیل سایت */}
      <button
        type="button"
        onClick={onToggleWeather}
        aria-pressed={showWeather}
        title="تحلیل سایت"
        className={`${baseBtn} bg-gradient-to-r from-yellow-100 to-orange-200 hover:from-yellow-200 hover:to-orange-300 text-amber-900`}
      >
        <span className="flex items-center gap-2 font-medium">
          <FaCloudSun className="text-base md:text-lg transition-transform duration-500 group-hover:rotate-180" />
          <span>تحلیل سایت</span>
        </span>
        <StatusChip text={showWeather ? "✖ بستن" : "✓ نمایش"} />
      </button>

      {/* 3D */}
      <button
        type="button"
        onClick={onOpen3D}
        title="نمایش شبیه‌سازی سه‌بعدی در نقشه"
        className={`${baseBtn} bg-gradient-to-r from-cyan-100 to-sky-200 hover:from-cyan-200 hover:to-sky-300 text-sky-900`}
      >
        <span className="flex items-center gap-2">
          <FaCubes className="text-base" />
          <span>شبیه‌سازی سه بعدی</span>
        </span>
      </button>

      {/* تاب‌آوری اقلیمی */}
      <button
        type="button"
        onClick={onOpenResilience}
        title="تاب‌آوری اقلیمی"
        className={`${baseBtn} bg-gradient-to-r from-pink-100 to-violet-200 hover:from-pink-200 hover:to-violet-300 text-fuchsia-900`}
      >
        <span className="flex items-center gap-2">
          <FaLeaf className="text-base" />
          <span>تاب‌آوری اقلیمی</span>
        </span>
      </button>
    </aside>
  );
};

export default memo(Sidebar);
