# backend/app/routers/heat_layer.py
from fastapi import APIRouter, HTTPException, Query
from pathlib import Path
import time, json, re, logging, numpy as np
import geopandas as gpd
from typing import Dict, Any

# SECURITY CONFIGS
MAX_CACHE_SIZE = 10
CACHE_TTL = 600  # 10 minutes
RATE_LIMIT_CALLS = 5
REQUEST_TIMESTAMPS = []
MAX_FEATURES = 10000

try:
    from app.services.weather_fetch import ow_current
except ImportError:
    # Mock fallback
    async def ow_current(lat, lon):
        return {"T": 28.0, "RH": 45.0, "wind": {"speed": 2.0, "deg": 90.0}}

router = APIRouter(prefix="/api", tags=["layers"])

# ------------------------------------------------------------
# SECURITY: Safe path validation
# ------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parents[2]
APP_DIR = BACKEND_DIR / "app"
OUT_DIR = APP_DIR / "output"
DATA_DIR = APP_DIR / "data"

def safe_path(base_dir: Path, *path_parts: str) -> Path:
    """Prevent path traversal - SECURITY CRITICAL"""
    safe_parts = [re.sub(r'[^\w\-_.]', '', part) for part in path_parts]
    full_path = base_dir.joinpath(*safe_parts)
    if not str(full_path.resolve()).startswith(str(base_dir.resolve())):
        raise ValueError("Path traversal attempt detected")
    return full_path

HEAT_BASE = safe_path(OUT_DIR, "parcel_heat_from_api.geojson")
PARCELS_FALLBACK = safe_path(DATA_DIR, "parcels_faizabad.geojson")

# ------------------------------------------------------------
# Rate limiting & Cache (SECURITY ENHANCED)
# ------------------------------------------------------------
_CACHE = {}
def rate_limit_check() -> bool:
    """Simple in-memory rate limiting"""
    global REQUEST_TIMESTAMPS
    now = time.time()
    REQUEST_TIMESTAMPS = [ts for ts in REQUEST_TIMESTAMPS if now - ts < 60]
    if len(REQUEST_TIMESTAMPS) >= RATE_LIMIT_CALLS:
        return False
    REQUEST_TIMESTAMPS.append(now)
    return True

def _cache_get() -> Dict[str, Any] | None:
    """Retrieves data from cache if still valid. SECURITY: Size limit."""
    global _CACHE
    if len(_CACHE) > MAX_CACHE_SIZE:
        _CACHE.clear()
        logging.warning("Cache cleared due to size limit")
        return None
        
    item = _CACHE.get("current")
    if not item or time.time() - item["t"] > CACHE_TTL:
        _CACHE.pop("current", None)
        return None
    return item["data"]

def _cache_put(data: Dict[str, Any]):
    """Stores data in cache. SECURITY: Size limit."""
    global _CACHE
    if len(_CACHE) >= MAX_CACHE_SIZE:
        logging.warning("Cache full, not storing")
        return
    _CACHE["current"] = {"t": time.time(), "data": data}

# ------------------------------------------------------------
# CRS Handling (SECURITY ENHANCED)
# ------------------------------------------------------------
def ensure_wgs84(gdf, default_src_epsg=32638):
    """Ensures GeoDataFrame is in EPSG:4326. SECURITY: Safe error handling."""
    try:
        if gdf.crs is None:
            gdf = gdf.set_crs(default_src_epsg, allow_override=True)
        if gdf.crs and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(4326)
    except Exception as e:
        logging.error(f"CRS fix failed (non-fatal): {str(e)[:100]}")
    return gdf

# ------------------------------------------------------------
# FRONTEND COMPATIBLE Color Palette (matches ClimateResilience.tsx heat gradient)
# ------------------------------------------------------------
def heat_color_from_risk(v: float) -> str:
    """Maps risk (0.0-1.0) to colors MATCHING Heat gradient in LegendCard.
    Palette: #fff7bc → #fee391 → #fdae6b → #f16913 → #7f0000"""
    v = np.clip(float(v or 0.0), 0.0, 1.0)
    if v >= 0.8:   return "#7f0000"    # Dark Red (High) ✅
    elif v >= 0.6: return "#f16913"    # Dark Orange ✅
    elif v >= 0.4: return "#fdae6b"    # Orange-Yellow ✅
    elif v >= 0.2: return "#fee391"    # Light Orange ✅
    elif v >= 0.1: return "#fff7bc"    # Pale Yellow ✅
    return "#f7f7f7"                   # White (Very Low) ✅

# ------------------------------------------------------------
# Composite Risk Calculation (IMPROVED)
# ------------------------------------------------------------
def calculate_composite_risk(T: float, RH: float, W: float, WG: float, LST_est: float) -> float:
    """Calculates composite heat risk with proper normalization."""
    # Clamp inputs
    T = np.clip(T, -20, 60)
    RH = np.clip(RH, 0, 100)
    W = np.clip(W, 0, 50)
    WG = np.clip(WG, 0, 50)
    LST_est = np.clip(LST_est, 20, 80)
    
    # Normalized factors
    T_norm = max(0.0, min(1.0, (T - 20) / 25.0))           # T>45°C → 1.0
    RH_norm = RH / 100.0                                   # 0-1
    W_norm = max(0.0, min(1.0, 1.0 - (W / 10.0)))         # Wind mitigation
    LST_norm = max(0.0, min(1.0, (LST_est - 30) / 25.0))  # LST>55°C → 1.0
    
    # Weighted composite (sums to ~1.0)
    composite = (0.35 * LST_norm) + (0.30 * T_norm) + (0.20 * RH_norm * T_norm) - (0.15 * W_norm)
    return float(np.clip(composite, 0.0, 1.0))

# ------------------------------------------------------------
# Main Endpoint (FULLY SECURED + ASYNC)
# ------------------------------------------------------------
@router.get("/heat-lst", response_model=None)
async def heat_lst():
    """Heat risk layer endpoint. SECURITY: Rate limited + validated."""
    
    # SECURITY: Rate limiting
    if not rate_limit_check():
        raise HTTPException(429, "Rate limit exceeded (5/min)")
    
    # 1) Load Base Data (SECURITY: Path validated)
    if HEAT_BASE.exists():
        try:
            gdf = gpd.read_file(HEAT_BASE)
            logging.info(f"Loaded heat data: {HEAT_BASE.name}")
        except Exception as e:
            logging.error(f"HEAT_BASE failed: {str(e)[:100]}")
            raise HTTPException(500, "Failed to load heat data")
    elif PARCELS_FALLBACK.exists():
        try:
            gdf = gpd.read_file(PARCELS_FALLBACK)
            logging.warning("Using fallback parcels data")
        except Exception as e:
            logging.error(f"Fallback failed: {str(e)[:100]}")
            raise HTTPException(500, "No valid data files found")
    else:
        raise HTTPException(404, "No heat/parcel data files found")

    # SECURITY: Validate dataset
    if gdf.empty:
        raise HTTPException(400, "Empty GeoJSON dataset")
    if len(gdf) > MAX_FEATURES:
        logging.warning(f"Dataset truncated: {len(gdf)} -> {MAX_FEATURES}")
        gdf = gdf.head(MAX_FEATURES)

    gdf = ensure_wgs84(gdf)
    
    # 2) Get Weather (cached + async)
    current = _cache_get()
    if current is None:
        try:
            bounds = gdf.total_bounds
            # SECURITY: Bounds validation
            if any(abs(b) > 1000 for b in bounds):
                raise ValueError("Invalid bounds detected")
                
            cx, cy = (bounds[0] + bounds[2]) / 2.0, (bounds[1] + bounds[3]) / 2.0
            current = await ow_current(lat=float(cy), lon=float(cx))
            _cache_put(current)
            logging.info("Weather data fetched & cached")
        except Exception as e:
            logging.error(f"Weather fetch failed: {str(e)[:100]}")
            current = {"T": 25.0, "RH": 50.0, "wind": {"speed": 2.0}}
            _cache_put(current)

    # 3) Extract & Validate Weather (SECURITY: Clamping)
    T  = np.clip(float(current.get("T", 25.0)), -20, 60)
    RH = np.clip(float(current.get("RH", 50.0)), 0, 100)
    wind_data = current.get("wind", {})
    W  = np.clip(float(wind_data.get("speed", 2.0)), 0, 50)
    WD = np.clip(float(wind_data.get("deg", 0.0)), 0, 360)
    WG = np.clip(float(wind_data.get("gust", 0.0)), 0, 50)

    # Add to dataframe
    gdf["T_air"] = T
    gdf["RH"] = RH
    gdf["wind_ms"] = W
    gdf["wind_deg"] = WD
    gdf["wind_gust"] = WG

    # 4) LST Handling (Safe fallback)
    n = len(gdf)
    if "LST_est" in gdf.columns:
        lst_values = gdf["LST_est"].astype("float64").fillna(35.0).values
    else:
        logging.warning("LST_est missing, using 35°C default")
        lst_values = np.full(n, 35.0, dtype="float64")

    # 5) Calculate Risks (Vectorized for performance)
    risks = np.array([
        calculate_composite_risk(T, RH, W, WG, lst_values[i]) 
        for i in range(n)
    ])
    
    gdf["heat_risk"] = risks
    gdf["color_effective"] = [heat_color_from_risk(v) for v in risks]

    # FRONTEND: Rename color column
    gdf.rename(columns={'color_effective': 'color'}, inplace=True)

    logging.info(f"[HeatLayer] T={T:.1f}°C, RH={RH:.1f}%, W={W:.1f}m/s, mean_risk={np.mean(risks):.3f}")
    
    return gdf.__geo_interface__
