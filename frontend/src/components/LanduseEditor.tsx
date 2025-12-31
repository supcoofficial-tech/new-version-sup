import React, { useState } from "react";

// ✅ کاربری‌هایی که اجازه تغییر ندارن
const lockedLanduses = [3, 4, 6, 7, 9];

interface LanduseEditorProps {
  selectedFeature?: any;
}

const LanduseEditor: React.FC<LanduseEditorProps> = ({ selectedFeature }) => {
  const [newLanduse, setNewLanduse] = useState<string>("");

  if (!selectedFeature) {
    return (
      <div className="p-3 bg-gray-700 rounded">
        <p className="text-sm text-gray-300">هیچ منطقه‌ای انتخاب نشده ❌</p>
      </div>
    );
  }

  const oldLanduse = selectedFeature.landuse || "نامشخص";

  const handleSave = () => {
    if (lockedLanduses.includes(Number(oldLanduse))) {
      alert("❌ تغییر این نوع کاربری مجاز نیست.");
      return;
    }
    if (!newLanduse) {
      alert("لطفاً کاربری جدید رو انتخاب کن.");
      return;
    }
    alert(
      `✅ تغییر ذخیره شد:\nاز ${oldLanduse} → به ${newLanduse}`
    );
    // 📌 اینجا بعداً وصل میشه به بک‌اند
    // api.post("/update-landuse", { id: selectedFeature.id, landuse: newLanduse })
  };

  return (
    <div className="bg-gray-700 p-3 rounded mt-4">
      <h3 className="font-bold text-lg mb-2">تغییر کاربری زمین</h3>

      {/* جدول دو ستونه */}
      <table className="w-full text-sm border border-gray-600">
        <thead>
          <tr>
            <th className="border border-gray-600 p-2">وضع موجود</th>
            <th className="border border-gray-600 p-2">وضع جدید</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            {/* ستون قبل */}
            <td className="border border-gray-600 p-2 text-center">
              {oldLanduse}
            </td>
            {/* ستون بعد */}
            <td className="border border-gray-600 p-2 text-center">
              {lockedLanduses.includes(Number(oldLanduse)) ? (
                <span className="text-red-400">غیرقابل تغییر</span>
              ) : (
                <select
                  className="w-full bg-gray-800 p-1 rounded"
                  value={newLanduse}
                  onChange={(e) => setNewLanduse(e.target.value)}
                >
                  <option value="">انتخاب کنید</option>
                  <option value="1">مسکونی</option>
                  <option value="2">تجاری</option>
                  <option value="5">تفریحی</option>
                  <option value="8">انبار</option>
                </select>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {!lockedLanduses.includes(Number(oldLanduse)) && (
        <button
          className="mt-3 w-full bg-blue-600 hover:bg-blue-700 py-1 rounded"
          onClick={handleSave}
        >
          ذخیره تغییرات
        </button>
      )}
    </div>
  );
};

export default LanduseEditor;
