import json
import time
import logging
import asyncio
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional
import os
import re

import geopandas as gpd
import pandas as pd
import numpy as np
from fastapi import APIRouter, HTTPException, status
from pyproj import CRS, Transformer
from shapely.geometry import shape, Point

# --- Fixed import path for OWSException ---
# --- Fixed import path for OWSException ---
class OWSException(Exception):
    """Custom OWS Exception (fallback, since owslib.owscommon is removed)"""
    pass


# --- SECURITY CONFIGS ---
MAX_CACHE_SIZE = 1000  # Prevent disk DoS
CACHE_TTL = 900  # 15 minutes
RATE_LIMIT_CALLS = 5  # per minute
REQUEST_TIMESTAMPS = []  # Simple rate limiting

# --- Paths (SECURITY: Path validation) ---
BACKEND_DIR = Path(__file__).resolve().parents[2]
APP_DIR = BACKEND_DIR / "app"
OUT_DIR = APP_DIR / "output"
DATA_DIR = APP_DIR / "data"

# Ensure output directory exists (with path validation)
try:
    OUT_DIR.mkdir(exist_ok=True)
    DATA_DIR.mkdir(exist_ok=True)
except Exception:
    raise RuntimeError("Cannot create required directories")

# Security: Validate paths are within app directory
def safe_path(base_dir: Path, *path_parts: str) -> Path:
    """Prevent path traversal"""
    safe_parts = [re.sub(r'[^\w\-_.]', '', part) for part in path_parts]
    full_path = base_dir.joinpath(*safe_parts)
    if not str(full_path.resolve()).startswith(str(base_dir.resolve())):
        raise ValueError("Path traversal attempt detected")
    return full_path

CACHE_FILE = safe_path(OUT_DIR, "weather_cache.json")
FIRE_BASE = safe_path(OUT_DIR, "parcel_fire_prob.geojson")
PARCELS_FALLBACK = safe_path(DATA_DIR, "parcels_faizabad.geojson")

DEFAULT_WEATHER = {
    "T": 25.0, 
    "RH": 45.0, 
    "wind": {"speed": 2.0, "deg": 90.0, "gust": 3.0}
}

# --- Logging setup ---
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO) 

router = APIRouter(
    prefix="/api/fire-weather",
    tags=["Fire Weather Layer"],
    responses={404: {"description": "Not Found"}},
)

# --- Rate limiting ---
def rate_limit_check() -> bool:
    """Simple in-memory rate limiting (5 calls per minute)"""
    global REQUEST_TIMESTAMPS
    now = time.time()
    REQUEST_TIMESTAMPS = [ts for ts in REQUEST_TIMESTAMPS if now - ts < 60]
    if len(REQUEST_TIMESTAMPS) >= RATE_LIMIT_CALLS:
        return False
    REQUEST_TIMESTAMPS.append(now)
    return True

# --- Cache handling functions (SECURITY ENHANCED) ---
def _cache_get(lat_key: float, lon_key: float) -> Optional[Dict[str, Any]]:
    """Retrieve weather data from cache if still valid. SECURITY: Size limits."""
    try:
        if not CACHE_FILE.exists():
            return None
        with open(CACHE_FILE, 'r') as f:
            cache_data = json.load(f)
        
        # SECURITY: Prevent oversized cache
        if len(cache_data) > MAX_CACHE_SIZE:
            logger.warning("Cache size exceeded, clearing")
            return None
            
    except (FileNotFoundError, json.JSONDecodeError, Exception):
        return None

    key = f"{lat_key:.2f},{lon_key:.2f}"
    if key in cache_data:
        entry = cache_data[key]
        if time.time() - entry['timestamp'] < CACHE_TTL:
            logger.info(f"Cache hit for coords: {key}")
            return entry['data']
        else:
            logger.info(f"Cache expired for coords: {key}")
    return None

def _cache_put(lat_key: float, lon_key: float, data: Dict[str, Any]):
    """Store new weather data in cache. SECURITY: Size limits + validation."""
    key = f"{lat_key:.2f},{lon_key:.2f}"
    try:
        if CACHE_FILE.exists():
            with open(CACHE_FILE, 'r') as f:
                cache_data = json.load(f)
        else:
            cache_data = {}

        # SECURITY: Size limit check
        if len(cache_data) >= MAX_CACHE_SIZE:
            logger.warning("Cache full, not storing new data")
            return
            
        cache_data[key] = {
            'timestamp': time.time(),
            'data': data
        }
        
        # Write atomically
        temp_file = CACHE_FILE.with_suffix('.tmp')
        with open(temp_file, 'w') as f:
            json.dump(cache_data, f, indent=4)
        temp_file.replace(CACHE_FILE)
        
        logger.info(f"Cache updated for coords: {key}")
    except Exception as e:
        logger.error(f"Cache write failed: {e}")

# --- Helper functions (SECURITY ENHANCED) ---
def ensure_wgs84(gdf: gpd.GeoDataFrame, default_src_epsg: int = 32638) -> gpd.GeoDataFrame:
    """Ensures the GeoDataFrame is in WGS84 (EPSG:4326)."""
    if gdf.crs != CRS.from_epsg(4326):
        if gdf.crs is None:
            logger.warning(f"CRS is None, setting default to EPSG:{default_src_epsg}")
            gdf.set_crs(CRS.from_epsg(default_src_epsg), inplace=True)
        
        logger.info(f"Transforming CRS from {gdf.crs.to_epsg()} to 4326.")
        gdf = gdf.to_crs(CRS.from_epsg(4326))
    return gdf

# --- Fire color mapping (TẠP CHIỀU VỚI FRONTEND) ---
def fire_color_from_index(v: float) -> str:
    """
    Map fire probability (0–1) to frontend colors (ClimateResilience.tsx):
    Low → Green (#2ecc71)
    Medium → Yellow (#f1c40f) 
    High → Red (#e74c3c)
    """
    if v < 0.33:
        return "#2ecc71"  # Low risk (green) ✅
    elif v < 0.67:
        return "#f1c40f"  # Medium risk (yellow) ✅
    else:
        return "#e74c3c"  # High risk (red) ✅

# --- Fire Index calculation ---
def compute_fire_index(T: float, RH: float, W: float) -> float:
    """
    Calculates Fire Index using a sigmoid-based function over T, RH, and wind speed.
    Adjusted parameters for desired 0.33 / 0.67 thresholds.
    """
    exponent = 0.05 * T - 0.1 * RH + 0.15 * W
    fi = 1.0 / (1.0 + np.exp(-exponent))
    return float(np.clip(fi, 0.0, 1.0))  # SECURITY: Clamp to valid range

# --- Dependency: Mock API Call ---
async def ow_current(lat: float, lon: float) -> Dict[str, Any]:
    """Mock function to simulate an OpenWeatherMap call. SECURITY: Input validation."""
    # SECURITY: Validate coordinates
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Invalid coordinates")
        
    await asyncio.sleep(0.1)  # Simulate network latency
    np.random.seed(int(lat * lon * 1000) % 10000)
    return

# --- Main endpoint (SECURITY ENHANCED) ---
@router.get("/fire-weather")
async def get_fire_weather_layer():
    """SECURITY: Rate limited fire weather layer endpoint."""
    
    # SECURITY: Rate limiting
    if not rate_limit_check():
        raise HTTPException(status_code=429, detail="Rate limit exceeded (5/min)")
    
    gdf = None # Initialize gdf

    # 1. Load base GeoJSON data (SECURITY: Path validated)
    
    # --- Suggested changes in the spatial data loading section (with English comments) ---
    if FIRE_BASE.exists():
        logger.info(f"Attempting to load FIRE_BASE from: {FIRE_BASE}")
        try:
            gdf = gpd.read_file(FIRE_BASE)
            logger.info(f"Successfully loaded {len(gdf)} features from FIRE_BASE.")
        except Exception as e:
            logger.error(f"Error reading FIRE_BASE: {e}")
            gdf = None
    elif PARCELS_FALLBACK.exists():
        logger.info(f"Attempting to load PARCELS_FALLBACK from: {PARCELS_FALLBACK}")
        try:
            gdf = gpd.read_file(PARCELS_FALLBACK)
            logger.info(f"Successfully loaded {len(gdf)} features from PARCELS_FALLBACK.")
        except Exception as e:
            logger.error(f"Error reading PARCELS_FALLBACK: {e}")
            gdf = None
    else:
        logger.error("Neither FIRE_BASE nor PARCELS_FALLBACK files exist!")
        # Define an empty output if no file is found to prevent later errors in to_json
        output_gdf = gpd.GeoDataFrame({'geometry': []}, crs="EPSG:4326")
        return json.loads(output_gdf.to_json()) # RETURN IS INSIDE ELSE BLOCK (OK)

    # --- Continuation of the main code ---
    if gdf is None or gdf.empty:
        logger.warning("GeoDataFrame is empty after loading. Returning empty GeoJSON.")
        # If gdf became empty for any reason, return a standard empty GeoJSON
        output_gdf = gpd.GeoDataFrame({'geometry': []}, crs="EPSG:4326")
        return json.loads(output_gdf.to_json()) # RETURN IS HERE (OK)
        
    # 2. Reproject to WGS84
    try:
        gdf = ensure_wgs84(gdf)
    except Exception as e:
        logger.error(f"CRS transformation failed: {str(e)[:100]}")
        raise HTTPException(status_code=500, detail="CRS processing failed.")
    
    # 3. Compute centroid (SECURITY: Bounds validation)
    try:
        bounds = gdf.total_bounds
        # SECURITY: Validate reasonable bounds
        if any(abs(b) > 1000 for b in bounds):  # Sanity check
            raise ValueError("Invalid bounds detected")
            
        cx = (bounds[0] + bounds[2]) / 2
        cy = (bounds[1] + bounds[3]) / 2
        
        lat_key, lon_key = float(cy), float(cx)
    except Exception as e:
        logger.error(f"Error calculating centroid: {str(e)[:100]}")
        raise HTTPException(status_code=500, detail="Error processing bounds.")

    # 4. Retrieve weather data (using cache)
    weather_data = _cache_get(lat_key, lon_key)
    
    if weather_data is None:
        try:
            weather_response = await ow_current(lat=lat_key, lon=lon_key)
            _cache_put(lat_key, lon_key, weather_response)
            weather_data = weather_response
            logger.info("Weather data fetched successfully and cached.")
        except Exception as e:
            logger.error(f"Weather API call failed: {str(e)[:100]}")
            try:
                # Try using last cached data
                cached = _cache_get(lat_key, lon_key)
                if cached:
                    weather_data = cached
                    logger.warning("Using old weather data from cache.")
                else:
                    weather_data = DEFAULT_WEATHER
                    logger.warning("Using hardcoded default weather data.")
            except:
                weather_data = DEFAULT_WEATHER
    
    # 5. Extract weather parameters (SECURITY: Validation)
    T = np.clip(float(weather_data.get("T", DEFAULT_WEATHER["T"])), -50, 60)
    RH = np.clip(float(weather_data.get("RH", DEFAULT_WEATHER["RH"])), 0, 100)
    wind_data = weather_data.get("wind", DEFAULT_WEATHER["wind"])
    W = np.clip(float(wind_data.get("speed", DEFAULT_WEATHER["wind"]["speed"])), 0, 50)
    
    logger.info(f"Weather used: T={T:.1f}°C, RH={RH:.1f}%, Wind={W:.1f} m/s")

    # 6. Add weather parameters to GeoDataFrame
    gdf['Weather_T'] = T
    gdf['Weather_RH'] = RH
    gdf['Weather_W'] = W
    
    # 7. Compute Fire Index values
    if 'fire_prob' in gdf.columns:
        gdf['fi_calculated'] = gdf['fire_prob']
        logger.info("Using existing 'fire_prob' column.")
    else:
        gdf['fi_calculated'] = gdf.apply(
            lambda row: compute_fire_index(row['Weather_T'], row['Weather_RH'], row['Weather_W']), 
            axis=1
        )
        logger.info("Computed 'fi_calculated' based on central weather data.")

    # 8. Map risk level to color (TẠP CHIỀU VỚI FRONTEND LegendCard)
    gdf['color_effective'] = gdf['fi_calculated'].apply(fire_color_from_index)

    # 9. Prepare GeoJSON output (FRONTEND COMPATIBLE)
    output_gdf = gdf[['color_effective', 'fi_calculated', 'Weather_T', 'Weather_RH', 'Weather_W']].copy()
    output_gdf.geometry = gdf.geometry
    
    # Rename column to match frontend expectations (Leaflet layers)
    output_gdf.rename(columns={'color_effective': 'color'}, inplace=True)

    # SECURITY: Limit output size
    if len(output_gdf) > 10000:
        logger.warning("Large dataset truncated for performance")
        output_gdf = output_gdf.head(10000)

    return json.loads(output_gdf.to_json())
