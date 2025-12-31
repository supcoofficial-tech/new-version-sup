# backend/app/routers/flood_layer.py
from fastapi import APIRouter, Query
from pathlib import Path
import geopandas as gpd
import numpy as np

from ..services.weather_fetch import ow_forecast_sum  # همانی که قبلاً ساختیم

router = APIRouter(prefix="/api", tags=["layers"])

# وزن‌ها مطابق اسکریپت تو
SLOPE_W, RIVER_W, FLAG_W, RAIN_W = 0.30, 0.30, 0.25, 0.15

# مسیرها (ریشه = backend/)
BACKEND_DIR = Path(__file__).resolve().parents[2]
APP_DIR     = BACKEND_DIR / "app"
OUT_DIR     = APP_DIR / "output"
DATA_DIR    = APP_DIR / "data"

# فایل پایه‌ی پارسل‌ها (می‌تواند همان خروجی اسکریپت قبلی باشد)
# اگر فقط هندسه و ستون‌های پایه داری، همین فایل را بده
PARCELS_BASE = OUT_DIR / "parcel_flood_risk.geojson"     # یا: DATA_DIR / "parcels_faizabad.geojson"

def _minmax(a):
    a = np.asarray(a, dtype="float64")
    if a.size == 0 or np.all(~np.isfinite(a)):
        return np.zeros_like(a, dtype="float64")
    vmin, vmax = np.nanmin(a), np.nanmax(a)
    if vmax - vmin == 0:
        return np.zeros_like(a)
    return (a - vmin) / (vmax - vmin)

@router.get("/flood-risk", response_model=None)
def flood_risk(hours: int = Query(24, ge=3, le=120)):
    """
    GeoJSON پارسل‌ها + rain_mm (جمع بارش آینده) + risk_flood به‌روز شده.
    hours: چند ساعت آینده (۳، ۶، ۱۲، ۲۴، ...); حداکثر ۱۲۰
    """
    if not PARCELS_BASE.exists():
        # اگر فایل دیگری داری، این پیام را می‌بینی؛ مسیر بالا را اصلاح کن
        return {"error": f"Base parcels not found: {PARCELS_BASE}"}

    gdf = gpd.read_file(PARCELS_BASE)

    # حتماً به WGS84 برای گرفتن lat/lon
    gdf = gdf.to_crs(4326)

    # نقطه نماینده‌ی هر پلیگون (از centroid امن‌تر)
    reps = gdf.geometry.representative_point()

    # گرفتن بارش از OpenWeather forecast (جمع mm برای N ساعت آینده)
    rains = []
    for p in reps:
        j = ow_forecast_sum(lat=p.y, lon=p.x, hours=hours)
        rains.append(float(j["precip_mm"]))
    gdf["rain_mm"] = rains

    # ستون‌های پایه (اگر نبودند، صفر بگذار تا فرمول بشکند نشود)
    slope_inv   = gdf["slope_inv"].astype("float64").values if "slope_inv"   in gdf.columns else np.zeros(len(gdf))
    river_prox  = gdf["river_prox"].astype("float64").values if "river_prox"  in gdf.columns else np.zeros(len(gdf))
    auto_flag   = gdf["auto_flag"].astype("float64").values if "auto_flag"   in gdf.columns else np.zeros(len(gdf))

    # فاکتور بارش (همان منطق اسکریپت تو: mm/10 → 0..1)
    rain_factor = np.clip(np.asarray(gdf["rain_mm"], dtype="float64") / 10.0, 0.0, 1.0)

    # ریسک نهایی
    risk = np.clip(
        SLOPE_W * slope_inv +
        RIVER_W * river_prox +
        FLAG_W  * auto_flag +
        RAIN_W  * rain_factor,
        0.0, 1.0
    )
    gdf["risk_flood"] = risk

    # خروجی GeoJSON برای فرانت
    return gdf.__geo_interface__
