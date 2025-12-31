# -*- coding: utf-8 -*-
# src/quake_risk_now.py — Earthquake Risk v4 (with Build_Age + Floors_Num)

import os, numpy as np, geopandas as gpd
from shapely.ops import unary_union
from shapely.strtree import STRtree

# ---------------- Settings ----------------
EPSG_TARGET = 32638  # UTM zone 38N (meters)

DATA_DIR   = "data"
OUT_DIR    = "output"
PARCELS_FP = os.path.join(DATA_DIR, "parcels_faizabad.geojson")
FAULTS_FP  = os.path.join(DATA_DIR, "faults_kermanshah.geojson")    # گسل‌ها
QUAKES_FP  = os.path.join(DATA_DIR, "quakes_kermanshah.geojson")    # نقاط زلزله تاریخی
OUT_FP     = os.path.join(OUT_DIR,  "parcel_quake_risk.geojson")

os.makedirs(OUT_DIR, exist_ok=True)

# ---------------- Parameters ----------------
FAULT_DIST_CAP_M = 1500.0   # فاصله تا گسل (اثر تا 1.5km)
QUAKE_RADIUS_M   = 5000.0   # شعاع شمارش رخدادهای تاریخی (5km)
FLOORS_CAP       = 8.0      # سقف نرمال‌سازی تعداد طبقات
AGE_CAP_Y        = 60.0     # سقف نرمال‌سازی قدمت (60 سال)

# وزن‌ها
W_FAULT = 0.40
W_EQHIS = 0.25
W_AGE   = 0.20
W_FLOOR = 0.15

# ---------------- Utils ----------------
def minmax(a):
    a = np.asarray(a, dtype="float64")
    vmin, vmax = np.nanmin(a), np.nanmax(a)
    if not np.isfinite(vmin) or not np.isfinite(vmax) or vmax - vmin == 0:
        return np.zeros_like(a)
    return (a - vmin) / (vmax - vmin)

def load_gdf(path):
    g = gpd.read_file(path)
    if g.crs is None:
        raise ValueError(f"⚠️ فایل {path} سیستم مختصات ندارد (CRS).")
    return g.to_crs(epsg=EPSG_TARGET)

# ---------------- Core calculations ----------------
def fault_distance_norm(parcels, faults_union, cap=FAULT_DIST_CAP_M):
    """نرمال‌سازی فاصله تا نزدیک‌ترین گسل"""
    if faults_union is None:
        return np.zeros(len(parcels))
    d = np.array([geom.distance(faults_union) for geom in parcels.geometry], dtype="float64")
    d = np.clip(d, 0, cap)
    return 1.0 - minmax(d)  # نزدیک‌تر → ریسک بیشتر

def quake_density_norm(parcels, quakes, radius=QUAKE_RADIUS_M):
    """تعداد رخدادهای تاریخی زلزله در شعاع مشخص (با نرمال‌سازی لگاریتمی)"""
    if quakes is None or len(quakes) == 0:
        return np.zeros(len(parcels))
    cents = parcels.geometry.centroid.values
    tree  = STRtree(quakes.geometry.values)
    counts = np.zeros(len(parcels), dtype="float64")
    for i, c in enumerate(cents):
        cand_idx = tree.query(c.buffer(radius).envelope)
        k = 0
        for gi in cand_idx:
            if quakes.geometry.values[gi].distance(c) <= radius:
                k += 1
        counts[i] = k
    return minmax(np.log1p(counts))

def age_norm(parcels):
    """نرمال‌سازی قدمت ساختمان از ستون Build_Age (قدیمی‌تر → ریسک بالاتر)"""
    if "Build_Age" in parcels.columns:
        s = parcels["Build_Age"].astype("float64")
        med = float(np.nanmedian(s)) if np.isfinite(np.nanmedian(s)) else 0.0
        s = s.fillna(med)
        s = np.clip(s, 0, AGE_CAP_Y)
        return (s / AGE_CAP_Y).astype("float64")
    return np.zeros(len(parcels), dtype="float64")

def floors_norm(parcels):
    """نرمال‌سازی تعداد طبقات از ستون Floors_Num"""
    if "Floors_Num" in parcels.columns:
        s = parcels["Floors_Num"].astype("float64")
        med = float(np.nanmedian(s)) if np.isfinite(np.nanmedian(s)) else 0.0
        s = s.fillna(med)
        n = np.clip(s / FLOORS_CAP, 0, 1)
        return n.values.astype("float64")
    return np.zeros(len(parcels), dtype="float64")

# ---------------- Main ----------------
def main():
    print(">>> QUAKE RISK v4 — with Build_Age + Floors_Num")

    # داده‌ها
    parcels = load_gdf(PARCELS_FP)
    faults  = load_gdf(FAULTS_FP)  if os.path.exists(FAULTS_FP)  else None
    quakes  = load_gdf(QUAKES_FP)  if os.path.exists(QUAKES_FP)  else None

    faults_union = None
    if faults is not None and len(faults) > 0:
        faults_union = unary_union(faults.geometry)

    # شاخص‌ها
    fault_r = fault_distance_norm(parcels, faults_union)
    eq_hist = quake_density_norm(parcels, quakes)
    age_n   = age_norm(parcels)
    floor_n = floors_norm(parcels)
    # ترکیب نهایی
    risk = (W_FAULT*fault_r +
            W_EQHIS*eq_hist +
            W_AGE*age_n +
            W_FLOOR*floor_n)
    risk = np.clip(risk, 0, 1)

    # خروجی
    out = parcels.copy()
    out["fault_r"] = fault_r
    out["eq_hist"] = eq_hist
    out["age_n"]   = age_n
    out["floor_n"] = floor_n
    out["risk_quake"] = risk

    os.makedirs(OUT_DIR, exist_ok=True)
    out.to_file(OUT_FP, driver="GeoJSON")

    # گزارش خلاصه
    print("Saved:", OUT_FP)
    print("Parcels:", len(out))
    print("risk_quake → min/mean/max:", float(risk.min()), float(risk.mean()), float(risk.max()))
    print("fault_r → min/max:", float(fault_r.min()), float(fault_r.max()))
    print("eq_hist → min/max:", float(eq_hist.min()), float(eq_hist.max()))
    print("age_n → min/max:", float(age_n.min()), float(age_n.max()))
    print("floor_n → min/max:", float(floor_n.min()), float(floor_n.max()))

if __name__ == "__main__":
    main()