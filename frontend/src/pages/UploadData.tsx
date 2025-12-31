import { useState } from "react";
import api from "../../services/api";


export default function UploadData() {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!file || !name) {
      setStatus("❌ لطفاً نام لایه و فایل را وارد کنید");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", name);

    try {
      const res = await api.post("/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setStatus(`✅ آپلود موفق: ${res.data.inserted} رکورد ذخیره شد`);
    } catch (err: any) {
      console.error(err);
      setStatus("❌ خطا در آپلود فایل");
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">📂 بارگذاری لایه جدید</h1>

      <div className="bg-white p-4 shadow rounded space-y-3">
        <input
          type="text"
          placeholder="نام لایه (مثلاً landuse)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="block w-full border p-2 rounded"
        />
        <input
          type="file"
          onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
          className="block w-full border p-2 rounded"
        />
        <button
          onClick={handleUpload}
          className="bg-green-600 text-white px-4 py-2 rounded"
        >
          ⬆️ آپلود
        </button>
        {status && <p className="mt-2">{status}</p>}
      </div>
    </div>
  );
}
