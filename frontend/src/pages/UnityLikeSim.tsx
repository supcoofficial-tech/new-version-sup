// pages/UnityLikeSim.tsx
import CitySim from "../components/CitySim";

export default function UnityLikeSim() {
  return (
    // پر کردن ناحیه‌ی محتوا، نه کل صفحه:
    <div className="relative w-full h-[calc(100vh-3rem)]"> 
      {/* اگر تو App برای راست صفحه padding گذاشتی، ارتفاع کمتر می‌شود.
          می‌تونی h-[calc(100vh-3rem)] یا h-[85vh] بذاری. */}
      <CitySim />
    </div>
  );
}
