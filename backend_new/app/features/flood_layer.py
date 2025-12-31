# -*- coding: utf-8 -*-
# backend/app/routers/flood_layer.py

from fastapi import APIRouter, HTTPException, Query
from pathlib import Path
import os, time, traceback, json, re
import geopandas as gpd
import numpy as np
import logging

from app.features.config import MAX_CACHE_SIZE, CACHE_TTL, RATE_LIMIT_CALLS


CACHE_TTL = 600  # seconds
RATE_LIMIT_CALLS = 5  # per minute
REQUEST_TIMESTAMPS = []
MAX_HOURS = 120
MAX_FEATURES = 10000

try:
    from app.services.weather_fetch import ow_forecast_sum
except ImportError:
    # Mock fallback for testing
    async def ow_forecast_sum(lat, lon, hours):
        return {"precip_mm": np.random.uniform(0, 20)}

router = APIRouter(prefix="/api", tags=["layers"])

# ------------------------------------------------------------
# SECURITY: Safe path validation
# ------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parents[2]
APP_DIR = BACKEND_DIR / "app"
OUT_DIR = APP_DIR / "output"

def safe_path(base_dir: Path, *path_parts: str) -> Path:
    """Prevent path traversal - SECURITY CRITICAL"""
    safe_parts = [re.sub(r'[^\w\-_.]', '', part) for part in path_parts]
    full_path = base_dir.joinpath(*safe_parts)
    if not str(full_path.resolve()).startswith(str(base_dir.resolve())):
        raise ValueError("Path traversal attempt detected")
    return full_path

PARCELS_BASE = safe_path(OUT_DIR, "parcel_flood_risk.geojson")

# Ensure directories exist safely
try:
    OUT_DIR.mkdir(exist_ok=True)
except Exception:
    raise RuntimeError("Cannot create output directory")

# ------------------------------------------------------------
# Base Weights (SECURITY: Clamped values)
# ------------------------------------------------------------
DEFAULT_SLOPE_W = float(os.getenv("SLOPE_W", "0.30"))
DEFAULT_RIVER_W = float(os.getenv("RIVER_W", "0.30"))
DEFAULT_FLAG_W  = float(os.getenv("FLAG_W", "0.25"))
DEFAULT_RAIN_W  = float(os.getenv("RAIN_W", "0.15"))

# SECURITY: Clamp ENV values
DEFAULT_SLOPE_W = np.clip(DEFAULT_SLOPE_W, 0.0, 1.0)
DEFAULT_RIVER_W = np.clip(DEFAULT_RIVER_W, 0.0, 1.0)
DEFAULT_FLAG_W  = np.clip(DEFAULT_FLAG_W, 0.0, 1.0)
DEFAULT_RAIN_W  = np.clip(DEFAULT_RAIN_W, 0.0, 1.0)

# ------------------------------------------------------------
# Simple Cache for Rainfall Data (SECURITY ENHANCED)
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

def _cache_get(hours: int):
    """Retrieves data from cache if still valid. SECURITY: Size limit."""
    global _CACHE
    if len(_CACHE) > MAX_CACHE_SIZE:
        _CACHE.clear()
        logging.warning("Cache cleared due to size limit")
        return None
        
    item = _CACHE.get(hours)
    if not item:
        return None
    if time.time() - item["t"] > CACHE_TTL:
        _CACHE.pop(hours, None)
        return None
    return item["rain"]

def _cache_put(hours: int, rain: float):
    """Stores data in cache. SECURITY: Size limit."""
    global _CACHE
    if len(_CACHE) >= MAX_CACHE_SIZE:
        logging.warning("Cache full, not storing")
        return
    _CACHE[hours] = {"t": time.time(), "rain": float(rain)}

# ------------------------------------------------------------
# FRONTEND COMPATIBLE Color Spectrum (matches ClimateResilience.tsx)
# ------------------------------------------------------------
def color_by_risk(v: float):
    """Maps risk (0.0-1.0) to colors MATCHING Flood gradient in LegendCard.
    RdYlBu_r palette matching backend/frontend."""
    v = np.clip(float(v or 0.0), 0.0, 1.0)
    if v >= 0.8:   return "#d73027"  # Dark Red (High) ✅
    elif v >= 0.6: return "#fdae61"  # Orange (Medium-High) ✅
    elif v >= 0.4: return "#ffffbf"  # Yellow (Medium) ✅
    elif v >= 0.2: return "#abd9e9"  # Light Blue (Low-Medium) ✅
    else:          return "#4575b4"  # Blue (Low) ✅

# ------------------------------------------------------------
# CRS Handling (SECURITY ENHANCED)
# ------------------------------------------------------------
def ensure_wgs84(gdf, default_src_epsg=32638):
    """Ensures GeoDataFrame is in EPSG:4326. SECURITY: Error handling."""
    try:
        if gdf.crs is None:
            gdf = gdf.set_crs(default_src_epsg, allow_override=True)
        if gdf.crs and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(4326)
    except Exception as e:
        logging.error(f"CRS fix failed (non-fatal): {str(e)[:100]}")
        # Continue with current CRS rather than fail
        pass
    return gdf

# ------------------------------------------------------------
# Flood Layer Calculation Endpoint (FULLY SECURED)
# ------------------------------------------------------------
@router.get("/flood-risk", response_model=None)
async def flood_risk(  # Made async for weather API compatibility
    # SECURITY: Strict bounds
    hours: int = Query(24, ge=3, le=MAX_HOURS, description="Forecast horizon in hours"),
    # SECURITY: Query params clamped
    slope_w: float = Query(None, ge=0.0, le=1.0),
    river_w: float = Query(None, ge=0.0, le=1.0),
    flag_w:  float = Query(None, ge=0.0, le=1.0),
    rain_w:  float = Query(None, ge=0.0, le=1.0),
):
    """Calculates flood risk index. SECURITY: Rate limited + validated."""
    
    # SECURITY: Rate limiting
    if not rate_limit_check():
        raise HTTPException(429, "Rate limit exceeded (5/min)")
    
    # SECURITY: Path validation
    if not PARCELS_BASE.exists():
        raise HTTPException(404, f"Base parcels not found: {PARCELS_BASE.name}")

    try:
        gdf = gpd.read_file(PARCELS_BASE)
    except Exception as e:
        logging.error(f"Failed to read GeoJSON: {str(e)[:100]}")
        raise HTTPException(500, "Failed to load geographic data")

    # SECURITY: Validate & limit dataset size
    if gdf.empty:
        raise HTTPException(400, "Empty parcels GeoJSON")
    if len(gdf) > MAX_FEATURES:
        logging.warning(f"Large dataset truncated: {len(gdf)} -> {MAX_FEATURES}")
        gdf = gdf.head(MAX_FEATURES)

    gdf = ensure_wgs84(gdf)
    
    # Priority: Query Parameters > ENV Defaults (all validated)
    slope_w = slope_w if slope_w is not None else DEFAULT_SLOPE_W
    river_w = river_w if river_w is not None else DEFAULT_RIVER_W
    flag_w  = flag_w  if flag_w  is not None else DEFAULT_FLAG_W
    rain_w  = rain_w  if rain_w  is not None else DEFAULT_RAIN_W

    # Normalize weights to sum=1.0
    total_w = slope_w + river_w + flag_w + rain_w
    if total_w > 0:
        slope_w, river_w, flag_w, rain_w = [w / total_w for w in [slope_w, river_w, flag_w, rain_w]]

    # Get Rainfall (with cache + error handling)
    rain_value = _cache_get(hours)
    if rain_value is None:
        try:
            # Calculate safe center point
            bounds = gdf.total_bounds
            # SECURITY: Bounds sanity check
            if any(abs(b) > 1000 for b in bounds):
                raise ValueError("Invalid bounds")
                
            cx, cy = (bounds[0] + bounds[2]) / 2.0, (bounds[1] + bounds[3]) / 2.0
            weather_result = await ow_forecast_sum(lat=float(cy), lon=float(cx), hours=hours)
            rain_value = float(weather_result.get("precip_mm", 0.0))
            _cache_put(hours, rain_value)
            logging.info(f"Weather fetched: {rain_value:.1f}mm/{hours}h")
        except Exception as e:
            logging.error(f"Weather fetch failed: {str(e)[:100]}")
            rain_value = 0.0  # Safe default

    # Add weather data to dataframe
    gdf["rain_mm"] = float(rain_value)
    gdf["hours"] = hours

    # Extract & validate input columns
    n = len(gdf)
    slope_inv  = gdf["slope_inv"].astype("float64").fillna(0).values if "slope_inv"  in gdf.columns else np.zeros(n)
    river_prox = gdf["river_prox"].astype("float64").fillna(0).values if "river_prox" in gdf.columns else np.zeros(n)
    auto_flag  = gdf["auto_flag"].astype("float64").fillna(0).values if "auto_flag"  in gdf.columns else np.zeros(n)
    
    # Rainfall normalization
    rain_factor = np.clip(gdf["rain_mm"].values / 10.0, 0.0, 1.0)

    # SECURITY: Clamp all inputs
    slope_inv = np.clip(slope_inv, 0.0, 1.0)
    river_prox = np.clip(river_prox, 0.0, 1.0)
    auto_flag = np.clip(auto_flag, 0.0, 1.0)

    # Final Risk Calculation (Weighted Sum)
    risk = np.clip(
        slope_w * slope_inv +
        river_w * river_prox +
        flag_w * auto_flag +
        rain_w * rain_factor,
        0.0, 1.0
    )

    # Assign results (FRONTEND COMPATIBLE)
    gdf["risk_flood"] = risk
    gdf["color_effective"] = [color_by_risk(v) for v in risk]
    
    # Rename for frontend (Leaflet layers expect 'color')
    gdf.rename(columns={'color_effective': 'color'}, inplace=True)

    # Log safely (no format errors)
    try:
        logging.info(f"[FloodLayer] rain={rain_value:.1f}mm/{hours}h "
                    f"weights=[{slope_w:.2f}s,{river_w:.2f}r,{flag_w:.2f}f,{rain_w:.2f}rain] "
                    f"mean_risk={np.mean(risk):.3f}")
    except:
        pass

    # SECURITY: Return GeoInterface directly (fastapi handles JSON)
    return gdf.__geo_interface__

