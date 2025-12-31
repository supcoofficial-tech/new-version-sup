// src/components/sun.ts
import { useEffect, useMemo, useState } from "react";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function clamp(x: number, a: number, b: number) { return Math.max(a, Math.min(b, x)); }

/** محاسبهٔ موقعیت خورشید (ارتفاع و آزیموت) با فرمول‌های استاندارد تقریبی NOAA */
export function solarPosition(date: Date, latDeg: number, lonDeg: number) {
  // زمان به UTC
  const t = date.getTime();
  const tzOffsetMin = date.getTimezoneOffset(); // دقیقه
  const tUTC = new Date(t + tzOffsetMin * 60_000);

  // روز ژولیَن (JD)
  const JD = tUTC.getTime() / 86400000 + 2440587.5;
  const T = (JD - 2451545.0) / 36525; // قرن‌های ژولیَن از J2000.0

  // پارامترهای خورشید
  const L0 = (280.46646 + 36000.76983 * T + 0.0003032 * T * T) % 360; // میانگین لانگتیود ظاهری
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;          // آنومالی میانگین
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;     // خروج از مرکز مدار
  const Mrad = M * DEG;

  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mrad)
          + (0.019993 - 0.000101 * T) * Math.sin(2 * Mrad)
          + 0.000289 * Math.sin(3 * Mrad);                             // معادلهٔ مرکز
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG); // لانگتیود ظاهری

  // مایل‌بودن محور زمین (میل دایره‌البروج)
  const eps0 = 23.439291 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T;
  const eps = eps0 + 0.00256 * Math.cos(omega * DEG);

  // میل خورشید (declination) و معادلهٔ زمان برای ساعت خورشیدی
  const lambdaRad = lambda * DEG;
  const epsRad = eps * DEG;
  const sinDec = Math.sin(epsRad) * Math.sin(lambdaRad);
  const dec = Math.asin(sinDec); // رادیان

  // معادلهٔ زمان (به دقیقه)
  const y = Math.tan(epsRad / 2) ** 2;
  const L0rad = L0 * DEG;
  const Etime = RAD * 4 * (
    y * Math.sin(2 * L0rad)
    - 2 * e * Math.sin(Mrad)
    + 4 * e * y * Math.sin(Mrad) * Math.cos(2 * L0rad)
    - 0.5 * y * y * Math.sin(4 * L0rad)
    - 1.25 * e * e * Math.sin(2 * Mrad)
  );

  // ساعت خورشیدی حقیقی محل (درجه)
  const minutes = tUTC.getUTCHours() * 60 + tUTC.getUTCMinutes() + tUTC.getUTCSeconds() / 60;
  const trueSolarTimeMin = (minutes + Etime + 4 * lonDeg) % 1440;
  const hourAngleDeg = (trueSolarTimeMin / 4) - 180;
  const H = hourAngleDeg * DEG;

  const lat = latDeg * DEG;
  const cosZenith = Math.sin(lat) * sinDec + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const zenith = Math.acos(clamp(cosZenith, -1, 1));
  let elevation = (Math.PI / 2 - zenith) * RAD; // درجه

  // تصحیح شکست نور در نزدیکی افق
  const refraction = (elevation > -0.575)
    ? 1.02 / Math.tan((elevation + 10.3 / (elevation + 5.11)) * DEG)
    : 0;
  elevation += refraction / 60;

  // آزیموت (درجه، از شمال به شرق)
  const sinAz = -(Math.sin(H) * Math.cos(dec)) / Math.sin(zenith);
  const cosAz = (Math.sin(dec) - Math.sin(lat) * Math.cos(zenith)) / (Math.cos(lat) * Math.sin(zenith));
  let azimuth = Math.atan2(sinAz, cosAz) * RAD;
  azimuth = (azimuth + 360) % 360;

  return { elevation, azimuth };
}

/** نگاشت ارتفاع خورشید به شدت نور DirectionalLight */
export function elevationToIntensity(elevDeg: number) {
  // 0° → 0.05 (تقریباً شب) ، 60° → ~1.0 ، 90° → 1.2
  const n = clamp((elevDeg - 0) / 60, 0, 1);
  return 0.05 + n * 1.15;
}

/** هوک React: ارتفاع خورشید برای lat/lon فعلی (به‌روزرسانی هر 60s) */
export function useSolarElevation(lat: number, lon: number, intervalMs = 60_000) {
  const [elev, setElev] = useState<number | null>(null);

  const compute = useMemo(() => {
    return () => {
      const { elevation } = solarPosition(new Date(), lat, lon);
      setElev(elevation);
    };
  }, [lat, lon]);

  useEffect(() => {
    compute();
    const id = setInterval(compute, intervalMs);
    return () => clearInterval(id);
  }, [compute, intervalMs]);

  return elev; // ممکنه در اولین رندر null باشه
}

/** (اختیاری) هوک آزیموت */
export function useSolarAzimuth(lat: number, lon: number, intervalMs = 60_000) {
  const [az, setAz] = useState<number | null>(null);

  const compute = useMemo(() => {
    return () => {
      const { azimuth } = solarPosition(new Date(), lat, lon);
      setAz(azimuth);
    };
  }, [lat, lon]);

  useEffect(() => {
    compute();
    const id = setInterval(compute, intervalMs);
    return () => clearInterval(id);
  }, [compute, intervalMs]);

  return az;
}
