import React from "react";

type Props = {
  /** HTML ثابتِ راهنمای بارش (همون که خودت دادی) */
  rainHtml: string;
  /** عنوان و گرادیان کارتِ ریسک سیلاب (همون استایلی که می‌خوای) */
  riskTitle?: string;
  riskGradient?: string; // CSS linear-gradient(...)
  labels?: [string, string, string]; // ["کم","متوسط","زیاد"]
};

const FloodLegendsDock: React.FC<Props> = ({
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
      {/* کارت گرادیانی ریسک (React) */}
      <div className="w-56 rounded-xl p-3 text-gray-800 shadow-sm border border-gray-200 backdrop-blur-md bg-white/80">
        <div className="font-bold mb-2">{riskTitle}</div>
        <div className="h-3 rounded-md ring-1 ring-gray-200" style={{ background: riskGradient }} />
        <div className="flex justify-between text-[11px] text-gray-500 mt-1">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
          <span>{labels[2]}</span>
        </div>
      </div>

      {/* راهنمای بارش (HTML ثابتِ خودت) */}
      <div
        className="rounded-xl p-2 shadow-sm border border-gray-200 bg-white/90"
        dangerouslySetInnerHTML={{ __html: rainHtml }}
      />
    </div>
  );
};

export default FloodLegendsDock;
