import os, time, requests
from pathlib import Path
from dotenv import load_dotenv

# .env را از ریشه‌ی backend لود کن
BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_DIR / ".env"
if ENV_FILE.exists():
    load_dotenv(ENV_FILE)

OW_BASE = "https://api.openweathermap.org/data/2.5"
API_KEY = os.getenv("OPENWEATHER_API_KEY")

# کش ساده برای جلوگیری از کوئری زیاد
_CACHE = {}
def _get(url, params, cache_key=None, ttl=600):
    if cache_key and cache_key in _CACHE and time.time() - _CACHE[cache_key]["t"] < ttl:
        return _CACHE[cache_key]["data"]
    r = requests.get(url, params=params, timeout=10)
    j = r.json()
    if cache_key:
        _CACHE[cache_key] = {"t": time.time(), "data": j}
    return j

def _ensure_key():
    if not API_KEY:
        raise RuntimeError("OPENWEATHER_API_KEY not set. Put it in backend/.env")

def ow_current(lat: float, lon: float) -> dict:
    """برگشت: {'T':float,'RH':float,'wind':{'speed':float,'deg':float,'gust':float}}"""
    _ensure_key()
    j = _get(
        f"{OW_BASE}/weather",
        {"lat": lat, "lon": lon, "appid": API_KEY, "units": "metric"},
        cache_key=f"cur:{round(lat,3)},{round(lon,3)}",
        ttl=600,
    )
    # اگر خطا بود، پیام بده
    if "main" not in j:
        code = j.get("cod"); msg = j.get("message")
        print("⚠️ OpenWeather current error:", code, msg)
        return {
            "T": float("nan"),
            "RH": float("nan"),
            "wind": {"speed": float("nan"), "deg": float("nan"), "gust": float("nan")},
        }
    T  = float(j["main"].get("temp", float("nan")))
    RH = float(j["main"].get("humidity", float("nan")))
    wind = j.get("wind", {})
    return {
        "T": T,
        "RH": RH,
        "wind": {
            "speed": float(wind.get("speed", float("nan"))),
            "deg":   float(wind.get("deg",   float("nan"))),
            "gust":  float(wind.get("gust",  float("nan"))),
        },
    }

def ow_forecast_sum(lat: float, lon: float, hours: int) -> dict:
    """جمع بارش پیش‌بینی (mm)"""
    _ensure_key()
    j = _get(
        f"{OW_BASE}/forecast",
        {"lat": lat, "lon": lon, "appid": API_KEY, "units": "metric"},
        cache_key=f"fc:{round(lat,3)},{round(lon,3)}",
        ttl=600,
    )
    if "list" not in j:
        code = j.get("cod"); msg = j.get("message")
        print("⚠️ OpenWeather forecast error:", code, msg)
        return {"precip_mm": 0.0}
    total = 0.0
    for it in j["list"]:
        total += float(it.get("rain", {}).get("3h", 0.0))
        total += float(it.get("snow", {}).get("3h", 0.0))
    # فقط یک جمع تقریبی؛ اگر خواستی به برش hours محدودش کن
    return {"precip_mm": round(total, 3)}

# ---------------------------
# 📍 اجرای مستقیم برای کرمانشاه
# ---------------------------
if __name__ == "__main__":
    # مختصات کرمانشاه
    lat, lon = 34.3142, 47.0650

    print("---- وضعیت فعلی کرمانشاه ----")
    cur = ow_current(lat, lon)
    print(f"دمای فعلی: {cur['T']}°C")
    print(f"رطوبت نسبی: {cur['RH']}%")
    print(f"سرعت باد: {cur['wind']['speed']} m/s")
    print(f"جهت باد: {cur['wind']['deg']}°")
    print(f"باد لحظه‌ای (gust): {cur['wind']['gust']} m/s")

    print("\n---- پیش‌بینی جمع بارش (۵ روز آینده) ----")
    fc = ow_forecast_sum(lat, lon, 24)
    print(f"جمع بارش پیش‌بینی‌شده: {fc['precip_mm']} میلی‌متر")
