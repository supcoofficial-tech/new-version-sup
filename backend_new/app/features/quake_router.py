import json
import logging
import time
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import re
import numpy as np
import requests
import geopandas as gpd
from shapely.geometry import Point, Polygon
from fastapi import HTTPException

# --- SECURITY CONFIGS ---
RATE_LIMIT_CALLS = 5  # per minute
REQUEST_TIMESTAMPS = []
MAX_FEATURES = 1000  # USGS earthquakes per hour limit

# --- Layer settings and parameters ---
USGS_API_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"

# Geographic filter parameters for Kermanshah region (approximate)
MIN_LAT = 33.5
MAX_LAT = 35.5
MIN_LON = 45.0
MAX_LON = 48.0

# Color mapping settings (FRONTEND COMPATIBLE: matches ClimateResilience.tsx quake gradient)
RISK_LEVELS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
COLOR_MAP = {
    0: "#fdd49e",  # Light yellow-orange (Low) ✅
    1: "#fc8d59",  # Orange (Low-Med) ✅
    2: "#e34a33",  # Red-orange (Medium) ✅
    3: "#b30000",  # Dark red (High) ✅
    4: "#7f0000",  # Very dark red (Extreme) ✅
    5: "#7f0000",  # Extreme ✅
    6: "#7f0000",  # Extreme ✅
    7: "#7f0000",  # Extreme ✅
}

logging.basicConfig(level=logging.INFO)

# ------------------------------------------------------------
# SECURITY: Rate limiting
# ------------------------------------------------------------
def rate_limit_check() -> bool:
    """Simple in-memory rate limiting (5 calls per minute)"""
    global REQUEST_TIMESTAMPS
    now = time.time()
    REQUEST_TIMESTAMPS = [ts for ts in REQUEST_TIMESTAMPS if now - ts < 60]
    if len(REQUEST_TIMESTAMPS) >= RATE_LIMIT_CALLS:
        return False
    REQUEST_TIMESTAMPS.append(now)
    return True

def ensure_wgs84(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Convert CRS to WGS84 if needed."""
    try:
        if gdf.crs is None or gdf.crs.to_epsg() != 4326:
            logging.info("Converting CRS to EPSG:4326 (WGS84).")
            return gdf.to_crs(epsg=4326)
    except Exception as e:
        logging.error(f"CRS conversion failed (non-fatal): {str(e)[:100]}")
    return gdf

def quake_color_from_risk(risk_norm: float) -> str:
    """Map normalized risk to color (FRONTEND COMPATIBLE with quake gradient)."""
    risk_norm = np.clip(float(risk_norm), 0.0, 1.0)
    
    # Find corresponding risk level (matches RISK_LEVELS)
    level = 0
    for i in range(1, len(RISK_LEVELS)):
        if risk_norm < RISK_LEVELS[i]:
            level = i - 1
            break
    else:
        level = len(RISK_LEVELS) - 1
        
    return COLOR_MAP.get(level, COLOR_MAP[3])  # Default to medium

def fetch_and_process_usgs_data() -> gpd.GeoDataFrame:
    """
    Fetch USGS API, filter by BBOX and convert to GeoDataFrame.
    SECURITY: Request limits + timeout.
    """
    if not rate_limit_check():
        raise HTTPException(status_code=429, detail="Rate limit exceeded (5/min)")
    
    logging.info(f"Fetching data from USGS API for the last 24 hours...")
    
    # Define structure for empty GeoDataFrame
    empty_gdf_structure = {
        'quake_magnitude_raw': [], 
        'time_utc': [], 
        'geometry': [], 
        'metadata': []
    }
    
    # SECURITY: Safe request with timeout & headers
    try:
        headers = {'User-Agent': 'ResilienceApp/1.0 (contact@example.com)'}
        response = requests.get(USGS_API_URL, timeout=15, headers=headers)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"USGS API error: {str(e)[:100]}")
        raise HTTPException(status_code=503, detail="USGS API temporarily unavailable")

    features = data.get('features', [])
    if not features:
        logging.warning("USGS returned no features.")
        return gpd.GeoDataFrame(empty_gdf_structure, crs=4326)

    points_data = []
    for feature in features:
        try:
            props = feature.get('properties', {})
            geom = feature.get('geometry', {})
            coords = geom.get('coordinates', [])
            
            if len(coords) < 2:
                continue
                
            magnitude = float(props.get('mag', 0.0))
            time_ms = float(props.get('time', 0))
            
            # SECURITY: Filter low-magnitude quakes (<2.0)
            if magnitude < 2.0:
                continue
                
            points_data.append({
                'quake_magnitude_raw': magnitude,
                'time_utc': datetime.fromtimestamp(time_ms / 1000.0).replace(tzinfo=None), 
                'geometry': Point(float(coords[0]), float(coords[1])),
                'metadata': props
            })
        except (ValueError, KeyError, IndexError) as e:
            logging.debug(f"Skipping invalid feature: {str(e)}")
            continue

    # SECURITY: Limit number of features
    if len(points_data) > MAX_FEATURES:
        logging.warning(f"Truncating {len(points_data)} quakes to {MAX_FEATURES}")
        points_data = points_data[:MAX_FEATURES]

    if not points_data:
        return gpd.GeoDataFrame(empty_gdf_structure, crs=4326)

    gdf = gpd.GeoDataFrame(points_data, crs=4326)
    ensure_wgs84(gdf)
    
    # BBOX filtering (SECURITY: Validated bounds)
    logging.info(f"Filtering BBOX: ({MIN_LON},{MIN_LAT}) to ({MAX_LON},{MAX_LAT})")
    
    bbox_poly = Polygon([
        (MIN_LON, MIN_LAT), 
        (MAX_LON, MIN_LAT), 
        (MAX_LON, MAX_LAT), 
        (MIN_LON, MAX_LAT),
        (MIN_LON, MIN_LAT)
    ])
    
    gdf_filtered = gdf[gdf.geometry.intersects(bbox_poly)]
    
    if gdf_filtered.empty:
        logging.warning("No earthquakes found within Kermanshah BBOX.")
        return gpd.GeoDataFrame(empty_gdf_structure, crs=4326)
        
    return gdf_filtered

def process_quake_layer() -> Dict[str, Any]:
    """Process earthquake layer for frontend. FRONTEND COMPATIBLE format."""
    
    try:
        gdf = fetch_and_process_usgs_data()
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Data processing error: {str(e)[:100]}")
        raise HTTPException(status_code=500, detail="Internal processing error")

    if gdf.empty:
        return {
            "status": "success",
            "message": "No significant seismic activity detected in Kermanshah region (last 24h).",
            "quake_data": [],
            "summary": {"count": 0, "min_mag": 0.0, "max_mag": 0.0}
        }

    # Normalize magnitude to risk (0-1)
    min_mag = float(gdf['quake_magnitude_raw'].min())
    max_mag = float(gdf['quake_magnitude_raw'].max())
    
    if max_mag == min_mag or max_mag < 2.0:
        logging.warning("Uniform/low magnitudes, setting normalized risk to 0.5.")
        gdf['quake_risk_norm'] = 0.5
    else:
        gdf['quake_risk_norm'] = (gdf['quake_magnitude_raw'] - min_mag) / (max_mag - min_mag)
        gdf['quake_risk_norm'] = np.clip(gdf['quake_risk_norm'], 0.0, 1.0)
    
    # Color mapping (FRONTEND COMPATIBLE)
    gdf['color'] = gdf['quake_risk_norm'].apply(quake_color_from_risk)

    # Prepare frontend output (GeoJSON FeatureCollection format)
    output_data = gdf[[
        'quake_risk_norm', 
        'color', 
        'quake_magnitude_raw', 
        'time_utc', 
        'metadata'
    ]].copy()
    
    # Convert to GeoJSON FeatureCollection (Leaflet compatible)
    result_json = json.loads(output_data.to_json(default_handler=str))
    
    summary = {
        "min_magnitude_observed": round(min_mag, 2),
        "max_magnitude_observed": round(max_mag, 2),
        "count_in_bbox": len(gdf),
        "time_range": {
            "latest": gdf['time_utc'].max().isoformat(),
            "oldest": gdf['time_utc'].min().isoformat()
        }
    }

    return {
        "status": "success",
        "summary": summary,
        "quake_data": result_json.get('features', [])
    }

# FastAPI Router endpoint
from fastapi import APIRouter
router = APIRouter(prefix="/api", tags=["layers"])

@router.get("/quake")
async def get_quake_layer():
    """Earthquake layer endpoint for QuakeLayer component."""
    if not rate_limit_check():
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    return process_quake_layer()

# --- Test example ---
if __name__ == '__main__':
    print("--- Testing earthquake layer with USGS data (SECURE version) ---")
    try:
        final_result = process_quake_layer()
        print(json.dumps(final_result, indent=2, default=str))
    except HTTPException as e:
        print(f"HTTP Error: {e.status_code} - {e.detail}")
    except Exception as e:
        print(f"Error: {str(e)[:200]}")
