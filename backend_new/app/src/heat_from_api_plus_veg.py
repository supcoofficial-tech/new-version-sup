# backend/app/features/heat_layer.py
from fastapi import APIRouter, Query
from pathlib import Path
import numpy as np
import geopandas as gpd
from shapely.geometry import box
from shapely.validation import make_valid
import matplotlib
from app.services.weather_fetch import ow_current

router = APIRouter(prefix="/api", tags=["layers"])

BACKEND_DIR = Path(__file__).resolve().parents[2]
APP_DIR     = BACKEND_DIR / "app"
DATA_DIR    = APP_DIR / "data"
PARCELS_FP  = DATA_DIR / "parcels_faizabad.geojson"
VEG_FP      = DATA_DIR / "vegetation.geojson"
EPSG_TARGET = 32638

LEFT_LON, RIGHT_LON = 47.069031, 47.078733
TOP_LAT,  BOT_LAT   = 34.323814, 34.314269
CENTER_LAT = (TOP_LAT + BOT_LAT) / 2.0
CENTER_LON = (LEFT_LON + RIGHT_LON) / 2.0

SHADE_DELTA_MAX  = 4.0
FLOORS_DELTA_MAX = 2.0

def minmax(a):
    a = np.asarray(a, dtype="float64")
    if a.size == 0 or np.all(~np.isfinite(a)): return np.zeros_like(a)
    vmin, vmax = np.nanmin(a), np.nanmax(a)
    if vmax - vmin == 0: return np.zeros_like(a)
    x = (a - vmin) / (vmax - vmin)
    return np.where(np.isfinite(x), x, 0.0)

def robust_read_gdf(path: Path, epsg=EPSG_TARGET):
    g = gpd.read_file(path)
    if g.crs is None:
        raise ValueError(f"CRS نامشخص برای {path}")
    g = g.to_crs(epsg=epsg).copy()
    g["geometry"] = g.geometry.apply(lambda geom: make_valid(geom) if geom is not None else None)
    g = g[~g.geometry.is_empty & g.geometry.notna()].copy().reset_index(drop=True)
    return g

def compute_shade_fraction(parcels: gpd.GeoDataFrame, veg: gpd.GeoDataFrame | None):
    if veg is None or len(veg) == 0:
        return np.full(len(parcels), 0.1, dtype="float64")
    vv = veg.copy()
    types = set(vv.geom_type.unique())
    if {"Point","MultiPoint"} & types:
        vv.loc[vv.geom_type.isin(["Point","MultiPoint"]), "geometry"] = \
            vv.loc[vv.geom_type.isin(["Point","MultiPoint"]), "geometry"].buffer(2.0)
    if {"LineString","MultiLineString"} & types:
        vv.loc[vv.geom_type.isin(["LineString","MultiLineString"]), "geometry"] = \
            vv.loc[vv.geom_type.isin(["LineString","MultiLineString"]), "geometry"].buffer(1.5)
    try:
        v_union = vv.unary_union
    except Exception:
        v_union = vv.buffer(0).unary_union
    shade = np.zeros(len(parcels), dtype="float64")
    areas = parcels.area.values
    for i, geom in enumerate(parcels.geometry):
        inter = geom.intersection(v_union)
        a = float(inter.area) if not inter.is_empty else 0.0
        A = float(areas[i]) if areas[i] > 0 else 1.0
        shade[i] = max(0.0, min(1.0, a / A))
    return shade

# 🎨 پالت رنگ گرما (۰..۱ → YlOrRd)
import matplotlib
def heat_color(val: float) -> str:
    cmap = matplotlib.cm.get_cmap("YlOrRd")
    rgb = cmap(float(val))[:3]
    return matplotlib.colors.to_hex(rgb)

@router.get("/heat-lst", response_model=None)
def heat_lst(bbox_clip: bool = True):
    parcels = robust_read_gdf(PARCELS_FP)
    veget = robust_read_gdf(VEG_FP) if VEG_FP.exists() else None

    if bbox_clip:
        bbox_wgs = gpd.GeoSeries([box(LEFT_LON, BOT_LAT, RIGHT_LON, TOP_LAT)], crs="EPSG:4326")
        bbox_utm = bbox_wgs.to_crs(epsg=EPSG_TARGET).iloc[0]
        parcels = parcels[parcels.intersects(bbox_utm)].copy().reset_index(drop=True)

    cur = ow_current(CENTER_LAT, CENTER_LON)
    T_air   = cur["temp"]; RH = cur["humidity"]; W = cur["wind_speed"]
    Wdeg    = cur["wind_deg"]; Wgust = cur["wind_gust"]

    shade = compute_shade_fraction(parcels, veget)
    no_shade = 1.0 - shade

    wind_factor  = 1.0 + 0.5 * np.clip((2.0 - W) / 2.0, 0.0, 1.0)  # 1..1.5
    humid_factor = 1.0 - 0.3 * np.clip(RH / 100.0, 0.0, 1.0)      # 0.7..1.0

    floors_norm = np.zeros(len(parcels), dtype="float64")
    if "Floors_Num" in parcels.columns:
        try: floors_norm = minmax(parcels["Floors_Num"].astype("float64").values)
        except Exception: pass

    delta_shade  = SHADE_DELTA_MAX  * no_shade * wind_factor * humid_factor
    delta_floors = FLOORS_DELTA_MAX * floors_norm
    LST_est      = T_air + delta_shade + delta_floors
    heat_risk    = minmax(LST_est)

    out = parcels.to_crs(4326).copy()
    out["T_air"]      = T_air
    out["RH"]         = RH
    out["wind_ms"]    = W
    out["wind_deg"]   = Wdeg
    out["wind_gust"]  = Wgust
    out["shade_frac"] = shade
    out["LST_est"]    = LST_est
    out["heat_risk"]  = heat_risk
    out["heat_color"] = [heat_color(v) for v in heat_risk]  # 🎨 رنگ آماده

    return out.__geo_interface__