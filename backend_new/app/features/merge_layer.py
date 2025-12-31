# -*- coding: utf-8 -*-
from fastapi import APIRouter, Query, HTTPException
from pathlib import Path
import geopandas as gpd
import numpy as np
import matplotlib.cm as cm
import matplotlib.colors as mcolors
import warnings
import logging
import re
import time

warnings.filterwarnings("ignore")

# SECURITY CONFIGS
MAX_PAGE_SIZE = 1000
MAX_FEATURES = 50000
RATE_LIMIT_CALLS = 5
REQUEST_TIMESTAMPS = []
MAX_BBOX_SIZE = 100000  # degrees

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["layers"])

# ------------------------------------------------------------
# SECURITY: Safe path validation
# ------------------------------------------------------------
APP = Path(__file__).resolve().parents[2] / "app"
OUT = APP / "output"
DATA = APP / "data"

def safe_path(base_dir: Path, *path_parts: str) -> Path:
    """Prevent path traversal - SECURITY CRITICAL"""
    safe_parts = [re.sub(r'[^\w\-_.]', '', part) for part in path_parts]
    full_path = base_dir.joinpath(*safe_parts)
    if not str(full_path.resolve()).startswith(str(base_dir.resolve())):
        raise ValueError("Path traversal attempt detected")
    return full_path

# Base files (SECURITY: Path validated)
BASE_VULN = safe_path(OUT, "parcel_vulnerability.geojson")
FLOOD_FP  = safe_path(OUT, "parcel_flood_risk.geojson")
HEAT_FP1  = safe_path(OUT, "parcel_heat_from_api.geojson")
HEAT_FP2  = safe_path(OUT, "parcel_heat_risk.geojson")
QUAKE_FP  = safe_path(OUT, "parcel_quake_risk.geojson")
FIRE_FP1  = safe_path(OUT, "parcel_fire_prob.geojson")

DEFAULT_WEIGHTS = {"flood": 0.30, "heat": 0.25, "quake": 0.25, "fire": 0.20}

# ------------------------------------------------------------
# Rate limiting
# ------------------------------------------------------------
def rate_limit_check() -> bool:
    """Simple in-memory rate limiting"""
    global REQUEST_TIMESTAMPS
    now = time.time()
    REQUEST_TIMESTAMPS = [ts for ts in REQUEST_TIMESTAMPS if now - ts < 60]
    if len(REQUEST_TIMESTAMPS) >= RATE_LIMIT_CALLS:
        return False
    REQUEST_TIMESTAMPS.append(now)
    return True

# -----------------------------
# Base functions (SECURITY ENHANCED)
# -----------------------------
def ensure_wgs84(gdf):
    """Ensures GeoDataFrame in WGS84. SECURITY: Safe error handling."""
    try:
        if gdf.crs is None:
            gdf = gdf.set_crs(4326, allow_override=True)
        elif gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(4326)
    except Exception as e:
        logger.error(f"CRS fix failed (non-fatal): {str(e)[:100]}")
    return gdf

def to01(a):
    """Normalize array to 0-1 range. SECURITY: Input validation."""
    if a is None or len(a) == 0:
        return np.zeros(0)
    a = np.asarray(a, dtype="float64")
    a = np.where(np.isfinite(a), a, np.nan)
    mn, mx = np.nanmin(a), np.nanmax(a)
    if mx - mn < 1e-9:
        return np.zeros_like(a)
    out = (a - mn) / (mx - mn)
    return np.clip(out, 0, 1)

def classify_risk(v):
    """Risk classification for frontend display."""
    v = float(v)
    if v < 0.2:    return "Low"
    elif v < 0.4:  return "Moderate"
    elif v < 0.6:  return "High"
    elif v < 0.8:  return "Very High"
    else:          return "Extreme"

def colormap_hex(value):
    """Viridis colormap for frontend LegendCard (matches merge tab)."""
    # FRONTEND COMPATIBLE: Viridis matches ClimateResilience.tsx merge discrete colors
    rgba = cm.get_cmap("viridis")(value)
    return mcolors.to_hex(rgba)

def safe_read(fp):
    """Safely read GeoJSON file. SECURITY: Path & error handling."""
    try:
        if fp.exists():
            g = gpd.read_file(fp)
            if len(g) > 0:
                return ensure_wgs84(g)
    except Exception as e:
        logger.error(f"Read error {fp.name}: {str(e)[:100]}")
    return None

def extract_metric(base, fps, cols):
    """Extract metric from multiple files with spatial join. SECURITY: Limits."""
    n = len(base)
    if n > MAX_FEATURES:
        logger.warning(f"Base dataset truncated: {n} -> {MAX_FEATURES}")
        base = base.head(MAX_FEATURES)
        n = MAX_FEATURES
        
    result = np.full(n, np.nan)
    
    for fp in fps:
        g = safe_read(fp)
        if g is None:
            continue
            
        c = next((c for c in cols if c in g.columns), None)
        if c is None:
            continue
            
        try:
            # SECURITY: Limit join size
            if len(g) > 10000:
                g = g.head(10000)
                
            joined = gpd.sjoin(base, g[[c, "geometry"]], how="left", predicate="intersects")
            vals = joined[c].astype("float64").fillna(np.nan).values
            mask = ~np.isfinite(result) & np.isfinite(vals)
            result[mask] = vals[mask]
        except Exception as e:
            logger.error(f"Spatial join failed {fp.name}: {str(e)[:100]}")
            continue
    
    # Nearest fallback (limited)
    if np.any(~np.isfinite(result)):
        try:
            g_ref = safe_read(fps[0])  # Use first file only
            if g_ref is not None:
                nearest = gpd.sjoin_nearest(
                    base.copy().head(5000),  # SECURITY: Limit
                    g_ref[[c, "geometry"]].head(5000),
                    how="left", 
                    distance_col="dist_m",
                    max_distance=1000  # SECURITY: Limit distance
                )
                vals = nearest[c].astype("float64").fillna(np.nan).values
                result[~np.isfinite(result)] = vals[~np.isfinite(result)]
        except Exception as e:
            logger.error(f"Nearest join failed: {str(e)[:100]}")
            pass
            
    return to01(result)

# -----------------------------
# SECURITY ENHANCED Merge API
# -----------------------------
@router.get("/merge")
def merge_map(
    bbox: str = Query(None, description="Optional bounding box as 'minx,miny,maxx,maxy'"),
    page: int = Query(1, ge=1, le=1000),
    page_size: int = Query(500, ge=100, le=MAX_PAGE_SIZE),
    # SECURITY: Weight validation
    w_flood: float = Query(DEFAULT_WEIGHTS["flood"], ge=0.0, le=1.0),
    w_heat: float = Query(DEFAULT_WEIGHTS["heat"], ge=0.0, le=1.0),
    w_quake: float = Query(DEFAULT_WEIGHTS["quake"], ge=0.0, le=1.0),
    w_fire: float = Query(DEFAULT_WEIGHTS["fire"], ge=0.0, le=1.0)
):
    """Merge risk map endpoint. SECURITY: Rate limited + validated."""
    
    # SECURITY: Rate limiting
    if not rate_limit_check():
        raise HTTPException(429, "Rate limit exceeded (5/min)")
    
    # Normalize weights
    wsum = w_flood + w_heat + w_quake + w_fire
    if wsum == 0:
        raise HTTPException(400, "Weights sum must be > 0")
        
    w_flood /= wsum
    w_heat  /= wsum
    w_quake /= wsum
    w_fire  /= wsum

    # Load base parcels (priority order)
    base = safe_read(BASE_VULN) or safe_read(FLOOD_FP)
    if base is None:
        raise HTTPException(404, "No base vulnerability/risk layer found")

    # SECURITY: Dataset size limit
    if len(base) > MAX_FEATURES:
        logger.warning(f"Dataset truncated: {len(base)} -> {MAX_FEATURES}")
        base = base.head(MAX_FEATURES)

    # BBOX filtering (SECURITY: Validation)
    if bbox:
        try:
            minx, miny, maxx, maxy = map(float, bbox.split(","))
            # SECURITY: Bounds validation
            if (maxx - minx) * (maxy - miny) > MAX_BBOX_SIZE:
                raise ValueError("BBOX too large")
            if not (-180 <= minx <= maxx <= 180 and -90 <= miny <= maxy <= 90):
                raise ValueError("Invalid BBOX coordinates")
                
            base = base.cx[minx:maxx, miny:maxy]
        except Exception as e:
            logger.error(f"BBOX parse error: {str(e)[:100]}")
            raise HTTPException(400, "Invalid bbox format: 'minx,miny,maxx,maxy'")

    if base.empty:
        raise HTTPException(400, "No features in selected area")
        
    base = base.reset_index(drop=True)

    # Extract risk metrics (parallel-safe)
    logger.info("Extracting risk metrics...")
    flood = extract_metric(base, [FLOOD_FP], ["risk_flood"])
    heat  = extract_metric(base, [HEAT_FP1, HEAT_FP2], ["heat_risk", "LST_est"])
    quake = extract_metric(base, [QUAKE_FP], ["risk_quake", "quake_risk"])
    fire  = extract_metric(base, [FIRE_FP1], ["fire_prob", "fire_index", "fi_calculated"])

    # Weighted composite risk
    comp = np.clip(
        w_flood * flood + 
        w_heat  * heat + 
        w_quake * quake + 
        w_fire  * fire, 
        0, 1
    )

    # FRONTEND COMPATIBLE output
    df = base.copy()
    df["comp_risk"] = np.round(comp, 3)
    df["risk_class"] = [classify_risk(v) for v in comp]
    df["color_effective"] = [colormap_hex(v) for v in comp]
    
    # Rename for Leaflet layers
    df.rename(columns={'color_effective': 'color'}, inplace=True)

    # Coverage metadata
    coverage = {
        "flood_nonnull_%": float(np.isfinite(flood).sum() / len(flood) * 100),
        "heat_nonnull_%": float(np.isfinite(heat).sum() / len(heat) * 100),
        "quake_nonnull_%": float(np.isfinite(quake).sum() / len(quake) * 100),
        "fire_nonnull_%": float(np.isfinite(fire).sum() / len(fire) * 100),
    }

    # Pagination (SECURITY: Safe bounds)
    start = (page - 1) * page_size
    end = min(start + page_size, len(df))
    subset = df.iloc[start:end].copy()

    logger.info(f"[Merge] features={len(df)}, page={page}, coverage={coverage}")

    return {
        "meta": {
            "crs": str(df.crs),
            "features_total": len(df),
            "page_start": start,
            "page_end": end,
            "page_count": (len(df) + page_size - 1) // page_size,
            "coverage": coverage,
            "weights": {
                "flood": round(w_flood, 3),
                "heat": round(w_heat, 3),
                "quake": round(w_quake, 3),
                "fire": round(w_fire, 3)
            },
        },
        "geojson": subset.__geo_interface__,
    }
