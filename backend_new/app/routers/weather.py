# backend/app/routers/weather.py
from fastapi import APIRouter, HTTPException, Query
import os, time, requests
from typing import Optional, Dict, Any, Tuple
from pathlib import Path
from dotenv import load_dotenv

# .env در پوشه backend
ENV_PATH = Path(__file__).resolve().parents[1] / ".env"  # -> backend/.env
load_dotenv(dotenv_path=ENV_PATH)

router = APIRouter(prefix="/api/weather", tags=["weather"])
OW_BASE = "https://api.openweathermap.org/data/2.5"

# --- cache ساده در حافظه ---
_CACHE: Dict[str, Dict[str, Any]] = {}
TTL_SECONDS = 600  # 10 دقیقه

def _cache_get(key: str):
    it = _CACHE.get(key)
    if not it: return None
    if time.time() - it["t"] > TTL_SECONDS:
        _CACHE.pop(key, None); return None
    return it["data"]

def _cache_put(key: str, data: Any):
    _CACHE[key] = {"t": time.time(), "data": data}

def _api_key() -> str:
    k = os.getenv("OPENWEATHER_API_KEY")
    if not k:
        raise HTTPException(500, "OPENWEATHER_API_KEY در .env تنظیم نشده")
    return k

# ---------- helpers ----------
def _sum_precip(lst) -> float:
    tot = 0.0
    for it in lst:
        tot += float(it.get("rain", {}).get("3h", 0.0))
        tot += float(it.get("snow", {}).get("3h", 0.0))
    return round(tot, 3)

def _max_wind(lst) -> float:
    mx = 0.0
    for it in lst:
        mx = max(mx, float(it.get("wind", {}).get("speed", 0.0)))
    return round(mx, 2)

def _minmax_temp(lst) -> Tuple[Optional[float], Optional[float]]:
    if not lst: return None, None
    tmins = [it.get("main", {}).get("temp_min") for it in lst if it.get("main")]
    tmaxs = [it.get("main", {}).get("temp_max") for it in lst if it.get("main")]
    if not tmins or not tmaxs: return None, None
    return round(min(map(float, tmins)), 1), round(max(map(float, tmaxs)), 1)

# ---------- endpoints ----------

@router.get("/current")
def current(
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    city: Optional[str] = None,
    units: str = "metric",
    lang: str = "fa",
):
    """وضعیت فعلی هوا: یکی از (lat/lon) یا city را بده."""
    if (lat is None or lon is None) and not city:
        raise HTTPException(400, "lat/lon یا city الزامی است")

    key = f"now:{lat},{lon},{city},{units},{lang}"
    if (c := _cache_get(key)): return c

    params = {"appid": _api_key(), "units": units, "lang": lang}
    url = f"{OW_BASE}/weather"
    if city: params["q"] = city
    else:    params.update({"lat": lat, "lon": lon})

    try:
        r = requests.get(url, params=params, timeout=12); r.raise_for_status()
    except requests.RequestException as e:
        raise HTTPException(502, f"OpenWeather error: {e}")

    j = r.json()
    out = {
        "temp": j["main"]["temp"],
        "humidity": j["main"]["humidity"],
        "pressure": j["main"]["pressure"],
        "wind_speed": j["wind"]["speed"],
        "wind_deg": j["wind"].get("deg"),
        "wind_gust": j["wind"].get("gust", 0.0),
        "description": j["weather"][0]["description"],
        "icon": j["weather"][0]["icon"],
        "visibility": j.get("visibility"),
        "sunrise": j["sys"].get("sunrise"),
        "sunset": j["sys"].get("sunset"),
        "city": j.get("name"),
        "coord": j.get("coord"),
    }
    _cache_put(key, out)
    return out

@router.get("/forecast_summary")
def forecast_summary(
    lat: float = Query(...),
    lon: float = Query(...),
    hours: int = 24,
    units: str = "metric",
    lang: str = "fa",
):
    """
    خلاصهٔ پیش‌بینی برای N ساعت آینده:
    precip_mm (جمع بارش)، wind_max_ms (بیشینهٔ باد)، temp_min_c/temp_max_c
    """
    if hours <= 0: hours = 24

    key = f"sum:{lat},{lon},{hours},{units}"
    if (c := _cache_get(key)): return c

    try:
        r = requests.get(
            f"{OW_BASE}/forecast",
            params={"lat": lat, "lon": lon, "appid": _api_key(), "units": units, "lang": lang},
            timeout=20,
        ); r.raise_for_status()
    except requests.RequestException as e:
        raise HTTPException(502, f"OpenWeather error: {e}")

    j = r.json()
    lst = j.get("list", [])
    # هر آیتم 3ساعته است → به اندازه‌ی hours برش بزن
    slots = min(len(lst), max(1, hours // 3 + (1 if hours % 3 else 0)))
    sub = lst[:slots]

    tmin, tmax = _minmax_temp(sub)
    out = {
        "lat": lat, "lon": lon, "hours": hours,
        "precip_mm": _sum_precip(sub),
        "wind_max_ms": _max_wind(sub),
        "temp_min_c": tmin,
        "temp_max_c": tmax,
    }
    _cache_put(key, out)
    return out
