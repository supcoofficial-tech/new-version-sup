// src/three/CitySimOverlay.tsx
import React from "react";
import CitySim from "../components/CitySim";

type Props = {
  onClose: () => void;
  title?: string;
};

const CitySimOverlay: React.FC<Props> = ({ onClose, title = "پنجرهٔ 3D" }) => {
  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div
        className="relative w-[92vw] h-[88vh] rounded-2xl overflow-hidden shadow-2xl border"
        style={{
          borderColor: "rgba(255,255,255,0.15)",
          background:
            "linear-gradient(180deg, rgba(11,17,32,0.92), rgba(11,17,32,0.88))",
          backdropFilter: "blur(6px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-2 bg-black/30 border-b border-white/10">
          <div className="text-sm text-white/80">{title}</div>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white"
          >
            ✖ بستن
          </button>
        </div>

        {/* 3D container */}
        <div
          className="absolute inset-0"
          style={{ top: "40px" /* زیر هدر */, height: "calc(100% - 40px)" }}
        >
          {/* CitySim کل فضا را می‌گیرد */}
          <CitySim />
        </div>
      </div>
    </div>
  );
};

export default CitySimOverlay;
