# -*- coding: utf-8 -*-
# Flood Risk – FeizAbad (Elevation + Rain Forecast API, fixed distance join)
# Output: output/parcel_flood_risk.geojson  (risk_flood, rain_mm, risk_color, rain_color)

from pathlib import Path
import numpy as np
import geopandas as gpd
from shapely.strtree import STRtree

# ✅ سرویس مشترک برای گرفتن جمع بارش N ساعت آینده از OpenWeather
# (کلید از backend/.env خوانده می‌شود)
from app.services.weather_fetch import ow_forecast_sum

# ---------------- Paths ----------------
BACKEND_DIR = Path(__file__).resolve().parents[2]  # .../backend
APP_DIR     = BACKEND_DIR / "app"
DATA_DIR    = APP_DIR / "data"
OUT_DIR     = APP_DIR / "output"
PARCELS_FP  = DATA_DIR / "parcels_faizabad.geojson"
ELEV_FP     = DATA_DIR / "geojson_Elevation_tif.geojson"   # ستون Elevation
DIST_FP     = DATA_DIR / "lu_river_distance.geojson"       # ستون distance (km)
OUT_FP      = OUT_DIR / "parcel_flood_risk.geojson"

# ---------------- Config ----------------
EPSG_TARGET    = 32638
CENTER_LAT, CENTER_LON = 34.3190415, 47.073882
FORECAST_HOURS = 24  # جمع بارش چند ساعت آینده

# weights
SLOPE_W, RIVER_W, FLAG_W, RAIN_W = 0.30, 0.30, 0.25, 0.15
NEAR_RIVER_M = 200.0
FLAT_THRESH  = 0.60
RIVER_CAP_M  = 1000.0

OUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------------- Helpers ----------------
def minmax(a):
    a = np.asarray(a, dtype="float64")
    if a.size == 0 or np.all(~np.isfinite(a)):
        return np.zeros_like(a, dtype="float64")
    vmin, vmax = np.nanmin(a), np.nanmax(a)
    if vmax - vmin == 0:
        return np.zeros_like(a)
    out = (a - vmin) / (vmax - vmin)
    return np.where(np.isfinite(out), out, 0.0)

def fetch_rain_mm(lat=CENTER_LAT, lon=CENTER_LON, hours=FORECAST_HOURS) -> float:
    """
    جمع بارش (باران+برف) برای N ساعت آینده (mm)، از OpenWeather /forecast
    """
    j = ow_forecast_sum(lat=lat, lon=lon, hours=hours)
    rain = float(j.get("precip_mm", 0.0))
    print(f"Forecast rain → {rain} mm / next {hours}h")
    return rain

def nearest_attr(parcels_gdf, layer_gdf, col, maxd=100):
    """
    نزدیک‌ترین فیچر از لایه‌ی layer_gdf را به هر پارسل پیدا می‌کند و مقدار ستون col را می‌گیرد.
    نال‌ها با میانه پُر می‌شوند.
    """
    if col not in layer_gdf.columns:
        raise ValueError(f"ستون {col} در لایه وجود ندارد.")
    joined = gpd.sjoin_nearest(
        parcels_gdf[["geometry"]],
        layer_gdf[[col, "geometry"]],
        how="left",
        max_distance=maxd,
        distance_col="dist"
    )
    vals = joined[col].astype("float64")
    med = float(np.nanmedian(vals)) if np.isfinite(np.nanmedian(vals)) else 0.0
    return np.where(np.isfinite(vals), vals, med)

def slope_proxy(parcels_gdf, elev_gdf, elev_col="Elevation", radius_m=60):
    """شیب تقریبی از اختلاف ارتفاع همسایگی"""
    cents = parcels_gdf.geometry.centroid.values
    tree  = STRtree(elev_gdf.geometry.values)
    zvals = elev_gdf[elev_col].astype("float64").values
    out   = np.zeros(len(parcels_gdf), dtype="float64")
    for i, c in enumerate(cents):
        buf = c.buffer(radius_m)
        cand_idx = tree.query(buf.envelope)
        vals = []
        for j in cand_idx:
            gj = elev_gdf.geometry.values[j]
            if gj.intersects(buf):
                z = zvals[j]
                if np.isfinite(z):
                    vals.append(z)
        if len(vals) >= 2:
            out[i] = (np.max(vals) - np.min(vals)) / float(radius_m)
    return out

# ---------------- Colors ----------------
# برای ریسک: آبی (امن) → زرد → قرمز (پرخطر)
import matplotlib
def flood_color(val: float) -> str:
    cmap = matplotlib.cm.get_cmap("RdYlBu_r")
    rgb = cmap(float(val))[:3]
    return matplotlib.colors.to_hex(rgb)

# برای بارش 24h: آبی ملایم → آبی تیره
def rain_color(mm: float) -> str:
    if mm >= 50: return "#08306b"
    if mm >= 30: return "#08519c"
    if mm >= 20: return "#2171b5"
    if mm >= 10: return "#6baed6"
    if mm >= 5:  return "#c6dbef"
    return "#deebf7"

# ---------------- Main ----------------
def main():
    print(">>> Flood Risk – FeizAbad (Elevation + Rain Forecast API, fixed join)")

    # خواندن داده‌ها
    parcels = gpd.read_file(PARCELS_FP)
    elev    = gpd.read_file(ELEV_FP)
    distlyr = gpd.read_file(DIST_FP)

    for g in (parcels, elev, distlyr):
        if g.crs is None:
            raise ValueError("یکی از لایه‌ها CRS ندارد. همه را به EPSG:32638 تنظیم کن.")
        g.to_crs(epsg=EPSG_TARGET, inplace=True)

    n = len(parcels)
    print("Parcels:", n)

    # --- شیب از ارتفاع ---
    slope_est = slope_proxy(parcels, elev, "Elevation", radius_m=60)
    slope_inv = 1.0 - minmax(slope_est)

    # --- فاصله تا رودخانه (km → m) ---
    river_dist_km = nearest_attr(parcels, distlyr, "distance", maxd=500)
    river_dist_m  = river_dist_km * 1000.0
    river_prox    = 1.0 - minmax(np.clip(river_dist_m, 0, RIVER_CAP_M))

    # تطبیق طول‌ها
    if len(river_prox) != n:
        print(f"⚠️ اصلاح طول river_prox: {len(river_prox)} → {n}")
        river_prox = np.resize(river_prox, n)
    if len(river_dist_m) != n:
        river_dist_m = np.resize(river_dist_m, n)

    # --- نواحی صاف و نزدیک رود ---
    near      = (river_dist_m <= NEAR_RIVER_M)
    very_flat = (slope_inv    >= FLAT_THRESH)
    in_flag   = (near & very_flat).astype("float64")

    # --- بارش (جمع N ساعت آینده) ---
    rain_mm     = fetch_rain_mm()
    # اگر اثر بارش را قوی‌تر می‌خواهی، تقسیم‌گر را کوچک‌تر کن (مثلاً 5)
    rain_factor = np.clip(rain_mm / 10.0, 0.0, 1.0)

    # --- شاخص نهایی ---
    risk = np.clip(
        SLOPE_W*slope_inv + RIVER_W*river_prox + FLAG_W*in_flag + RAIN_W*rain_factor,
        0, 1
    )

    # --- خروجی ---
    out = parcels.copy()
    out["slope_est"]   = slope_est
    out["slope_inv"]   = slope_inv
    out["river_distm"] = river_dist_m
    out["river_prox"]  = river_prox
    out["auto_flag"]   = in_flag
    out["rain_mm"]     = rain_mm
    out["risk_flood"]  = risk

    # رنگ‌ها
    out["risk_color"] = [flood_color(v) for v in out["risk_flood"]]
    out["rain_color"] = [rain_color(mm) for mm in out["rain_mm"]]

    # ذخیره
    out.to_file(OUT_FP, driver="GeoJSON")
    print("✅ Saved:", OUT_FP)
    print("risk_flood → min/mean/max:", float(risk.min()), float(risk.mean()), float(risk.max()))
    print("slope_inv  → min/mean/max:", float(slope_inv.min()), float(slope_inv.mean()), float(slope_inv.max()))
    print("auto_flag count:", int(in_flag.sum()), "/", n)

if __name__ == "__main__":
    main()
