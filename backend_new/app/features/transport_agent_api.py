# backend/app/features/transport_agent_api.py

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
import os
import sys
import json
import shutil
import subprocess
import time
import gc
import datetime as dt
import re
import signal
from typing import List, Tuple, Optional
from contextlib import contextmanager

import geopandas as gpd
import networkx as nx
import fiona
from shapely.geometry import LineString, Point, Polygon, MultiPolygon, GeometryCollection
from shapely.ops import unary_union

router = APIRouter(prefix="/transport", tags=["Transport"])

# ─────────────────────────────────────────────
# Project paths
# ─────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(__file__))  # backend/app
SRC_DIR = os.path.join(BASE_DIR, "src")                # backend/app/src
SRC_DATA = os.path.join(SRC_DIR, "data")               # backend/app/src/data
SRC_OUT = os.path.join(SRC_DIR, "outputs")             # backend/app/src/outputs
DATA_DIR = os.path.join(BASE_DIR, "data")              # backend/app/data
OUT_DIR = os.path.join(BASE_DIR, "output")             # backend/app/output (optional)

# ─────────────────────────────────────────────
# Security configurations
# ─────────────────────────────────────────────
MAX_PAIRS_LIMIT = 50
MAX_ALPHA_LIMIT = 1.0
SUBPROCESS_TIMEOUT = 30  # seconds
RATE_LIMIT_CALLS = 5  # per minute (simplified counter)
REQUEST_TIMESTAMPS = []  # Simple rate limiting store

# ─────────────────────────────────────────────
# General utilities (SECURITY ENHANCED)
# ─────────────────────────────────────────────
def _ensure_dirs() -> None:
    os.makedirs(SRC_DATA, exist_ok=True)
    os.makedirs(SRC_OUT, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)

def safe_basename(name: str) -> str:
    """Sanitize filename to prevent path traversal"""
    # Remove any path separators and dangerous characters
    name = os.path.basename(name)
    name = re.sub(r'[^\w\-\.\_]', '', name)
    return name

def _find_data_file(basename: str) -> str:
    """
    Takes a base name (like 'roads' or 'nodes') and returns existing file from DATA_DIR
    with one of the common extensions. SECURITY: Path traversal protection.
    """
    safe_name = safe_basename(basename)
    data_dir_real = os.path.realpath(DATA_DIR)
    
    candidates = [
        safe_name,
        f"{safe_name}.geojson",
        f"{safe_name}.json",
        f"{safe_name}.GeoJSON",
        f"{safe_name}.JSON",
        f"{safe_name}.gpkg",
    ]
    for name in candidates:
        p = os.path.join(DATA_DIR, name)
        p_real = os.path.realpath(p)
        if os.path.exists(p) and p_real.startswith(data_dir_real):
            return p
    raise FileNotFoundError(f"Missing data file: {basename} (tried: {', '.join(candidates)})")

def _copy(src: str, dst: str) -> None:
    src_real = os.path.realpath(src)
    dst_real = os.path.realpath(dst)
    base_real = os.path.realpath(BASE_DIR)
    if not (src_real.startswith(base_real) and dst_real.startswith(base_real)):
        raise ValueError("Path traversal attempt detected")
    shutil.copyfile(src, dst)

def _write_empty_fc(dst: str) -> None:
    dst_real = os.path.realpath(dst)
    base_real = os.path.realpath(BASE_DIR)
    if not dst_real.startswith(base_real):
        raise ValueError("Invalid output path")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": []}, f, ensure_ascii=False)

def _read_fc(name_base: str) -> gpd.GeoDataFrame:
    """Read feature collection from DATA_DIR with support for geojson/json/gpkg"""
    p = _find_data_file(name_base)
    return gpd.read_file(p)

def _read_weather() -> dict:
    """Read weather_now.json for current temperature; if missing, temp_c=25"""
    p = os.path.join(DATA_DIR, "weather_now.json")
    if not os.path.exists(p):
        return {"temp_c": 25.0}
    try:
        with open(p, "r", encoding="utf-8") as f:
            j = json.load(f)
            temp = j.get("temp_c") or j.get("temperature") or j.get("temp") or 25.0
            try:
                temp = float(temp)
            except Exception:
                temp = 25.0
            return {"temp_c": temp}
    except Exception:
        return {"temp_c": 25.0}

def _to_metric(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """CRS → metric (3857) for length and buffer calculations"""
    if gdf.crs is None:
        gdf = gdf.set_crs(4326)
    return gdf.to_crs(3857)

def _to_wgs84(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return gdf.to_crs(4326)

def _explode_lines(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """MultiLine → Line and remove empty geometries"""
    gdf = gdf[gdf.geometry.notna()].copy()
    gdf = gdf.explode(index_parts=False, ignore_index=True)
    return gdf[gdf.geometry.type.isin(["LineString"])].reset_index(drop=True)

def _err_response(status: int, error: Exception, endpoint: str, extra: Optional[dict] = None) -> JSONResponse:
    """Structured error response for easy frontend consumption. SECURITY: No stack traces in production"""
    if status == 500:
        error_msg = "Internal server error"
    else:
        error_msg = str(error)[:200]  # Truncate long errors
    
    payload = {
        "error": error_msg,
        "type": error.__class__.__name__,
        "endpoint": endpoint,
        "timestamp": dt.datetime.utcnow().isoformat() + "Z",
    }
    if extra:
        payload["meta"] = extra
    return JSONResponse(status_code=status, content=payload)

# ─────────────────────────────────────────────
# Simple rate limiting
# ─────────────────────────────────────────────
def rate_limit_check() -> bool:
    """Simple in-memory rate limiting (5 calls per minute)"""
    global REQUEST_TIMESTAMPS
    now = time.time()
    # Keep only timestamps from last minute
    REQUEST_TIMESTAMPS = [ts for ts in REQUEST_TIMESTAMPS if now - ts < 60]
    if len(REQUEST_TIMESTAMPS) >= RATE_LIMIT_CALLS:
        return False
    REQUEST_TIMESTAMPS.append(now)
    return True

# ─────────────────────────────────────────────
# Subprocess timeout handler
# ─────────────────────────────────────────────
@contextmanager
def timeout(seconds):
    def timeout_handler(signum, frame):
        raise TimeoutError("Subprocess execution timeout")
    
    old_handler = signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old_handler)

# ─────────────────────────────────────────────
# Execute simulate_agent.py (SECURITY ENHANCED)
# ─────────────────────────────────────────────
def _prepare_inputs_for_sim() -> None:
    """
    Copies files from app/data to app/src/data with standard simulate_agent.py names.
    Supports names: roads, nodes/nods, origins, destinations, vegetation, buildings.
    """
    _ensure_dirs()

    # nodes or nods
    nodes_base = "nodes"
    if not os.path.exists(os.path.join(DATA_DIR, "nodes")) and not os.path.exists(os.path.join(DATA_DIR, "nodes.geojson")):
        nodes_base = "nods"

    # Required files
    roads_in = _find_data_file("roads")
    nodes_in = _find_data_file(nodes_base)
    origins_in = _find_data_file("origins")
    destinations_in = _find_data_file("destinations")

    # Optional files
    try:
        vegetation_in = _find_data_file("vegetation")
    except FileNotFoundError:
        vegetation_in = None
    try:
        buildings_in = _find_data_file("buildings")
    except FileNotFoundError:
        buildings_in = None

    # Standard destinations for simulate_agent.py
    roads_dst = os.path.join(SRC_DATA, "roads.geojson")
    nodes_dst = os.path.join(SRC_DATA, "nodes.geojson")
    origins_dst = os.path.join(SRC_DATA, "origins.geojson")
    destinations_dst = os.path.join(SRC_DATA, "destinations.geojson")
    vegetation_dst = os.path.join(SRC_DATA, "vegetation.geojson")
    buildings_dst = os.path.join(SRC_DATA, "buildings.geojson")

    _copy(roads_in, roads_dst)
    _copy(nodes_in, nodes_dst)
    _copy(origins_in, origins_dst)
    _copy(destinations_in, destinations_dst)

    if vegetation_in:
        _copy(vegetation_in, vegetation_dst)
    else:
        _write_empty_fc(vegetation_dst)

    if buildings_in:
        _copy(buildings_in, buildings_dst)
    else:
        _write_empty_fc(buildings_dst)

def _routes_fc_from_gpkg(gpkg_path: str) -> dict:
    """Read routes_final layer from GPKG and return as FeatureCollection (WGS84) with safe file handle closing"""
    gpkg_real = os.path.realpath(gpkg_path)
    src_out_real = os.path.realpath(SRC_OUT)
    data_real = os.path.realpath(DATA_DIR)
    
    if not (gpkg_real.startswith(src_out_real) or gpkg_real.startswith(data_real)):
        raise ValueError("Invalid GPKG path")
        
    if not os.path.exists(gpkg_path):
        raise FileNotFoundError(f"Output file not found: {gpkg_path}")

    with fiona.open(gpkg_path, layer="routes_final") as src:
        gdf = gpd.GeoDataFrame.from_features(src, crs=src.crs)
        if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(4326)
        return json.loads(gdf.to_json())

def _run_simulate_agent() -> None:
    """Execute simulate_agent.py from inside src (no arguments) and handle Windows file locks + SECURITY timeout"""
    script_path = os.path.join(SRC_DIR, "simulate_agent.py")
    script_real = os.path.realpath(script_path)
    src_real = os.path.realpath(SRC_DIR)
    
    if not os.path.exists(script_path) or not script_real.startswith(src_real):
        raise FileNotFoundError(f"Script not found or invalid path: {script_path}")

    # Before execution, try to release lock and remove previous file
    gpkg = os.path.join(SRC_OUT, "results.gpkg")
    try:
        gc.collect()
        if os.path.exists(gpkg):
            removed = False
            for _ in range(12):  # up to ~2.4s with 0.2s intervals
                try:
                    os.remove(gpkg)
                    removed = True
                    break
                except PermissionError:
                    time.sleep(0.2)
            if not removed and os.path.exists(gpkg):
                # If still locked, rename so simulate_agent can unlink
                backup = gpkg.replace(".gpkg", f".bak.{int(time.time())}.gpkg")
                try:
                    os.replace(gpkg, backup)
                except Exception:
                    pass
    except Exception:
        pass

    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    
    # SECURITY: Timeout protection
    try:
        with timeout(SUBPROCESS_TIMEOUT):
            proc = subprocess.run(
                [sys.executable, script_path],
                cwd=SRC_DIR,
                check=False,
                capture_output=True,
                text=True,
                env=env,
                timeout=SUBPROCESS_TIMEOUT,  # Double protection
            )
    except TimeoutError:
        raise RuntimeError("Subprocess execution timeout exceeded")
    except subprocess.TimeoutExpired:
        raise RuntimeError("Subprocess execution timeout exceeded")
    
    if proc.returncode != 0:
        raise RuntimeError(
            "Python script failed (simulate_agent.py)\n"
            f"STDOUT:\n{proc.stdout[:1000]}\n\nSTDERR:\n{proc.stderr[:1000]}"  # Truncated output
        )

# ─────────────────────────────────────────────
# Build weighted graph (dynamic based on weather/buildings) - UNCHANGED
# ─────────────────────────────────────────────
def _build_graph_weighted(
    roads_m: gpd.GeoDataFrame,
    veg_u: Optional[Polygon],
    bldg_u: Optional[Polygon],
    temp_c: float,
    alpha_build_base: float = 0.05,
    alpha_build_heat_coeff: float = 0.02,
    shade_buf_m: float = 0.8,
    bldg_buf_m: float = 6.0,
) -> nx.Graph:
    """
    Edge weight = length × (1 - alpha_shade * shade_ratio) × (1 - alpha_build * near_b_ratio)
    - Shade effect temperature-dependent (heat_scale)
    - Building effect dynamic: alpha_build = alpha_build_base + alpha_build_heat_coeff * heat_scale
    """
    G = nx.Graph()
    heat_scale = max(0.0, (temp_c - 26.0) / 10.0)  # if 36°C → 1.0
    alpha_shade = 0.25 + 0.25 * heat_scale
    alpha_build = max(0.0, alpha_build_base + alpha_build_heat_coeff * heat_scale)

    # Prepare buffers
    veg_u_buf = None
    if veg_u:
        try:
            if hasattr(veg_u, "geoms"):
                veg_u_buf = unary_union([g.buffer(shade_buf_m) for g in veg_u.geoms])
            else:
                veg_u_buf = veg_u.buffer(shade_buf_m)
        except Exception:
            veg_u_buf = None

    bldg_u_buf = None
    if bldg_u:
        try:
            bldg_u_buf = bldg_u.buffer(bldg_buf_m)
        except Exception:
            bldg_u_buf = None

    for _, row in roads_m.iterrows():
        geom: LineString = row.geometry
        if geom is None or geom.is_empty or geom.geom_type != "LineString":
            continue

        coords = list(geom.coords)
        if len(coords) < 2:
            continue

        (x1, y1), (x2, y2) = coords[0], coords[-1]
        u = (round(x1, 3), round(y1, 3))
        v = (round(x2, 3), round(y2, 3))
        length = geom.length
        if length <= 0:
            continue

        # Shade length ratio
        shade_ratio = 0.0
        if veg_u_buf:
            try:
                inter = geom.intersection(veg_u_buf)
                shade_ratio = max(0.0, min(1.0, inter.length / length))
            except Exception:
                shade_ratio = 0.0

        # Near-building length ratio
        near_b_ratio = 0.0
        if bldg_u_buf:
            try:
                inter_b = geom.intersection(bldg_u_buf)
                near_b_ratio = max(0.0, min(1.0, inter_b.length / length))
            except Exception:
                near_b_ratio = 0.0

        weight = length * (1.0 - alpha_shade * shade_ratio) * (1.0 - alpha_build * near_b_ratio)
        weight = max(length * 0.1, weight)  # Safe floor

        if u not in G:
            G.add_node(u, x=u[0], y=u[1])
        if v not in G:
            G.add_node(v, x=v[0], y=v[1])
        G.add_edge(u, v, length=length, weight=weight, geometry=geom)

    return G

def _nearest_graph_node(G: nx.Graph, pt: Point) -> Tuple[float, float]:
    """Nearest graph node to point (simple search)"""
    best = None
    best_d = 1e18
    x, y = pt.x, pt.y
    for n, data in G.nodes(data=True):
        dx = data["x"] - x
        dy = data["y"] - y
        d2 = dx * dx + dy * dy
        if d2 < best_d:
            best_d = d2
            best = n
    return best

def _path_geom_from_nodes(G: nx.Graph, nodes_seq: List[Tuple[float, float]]) -> LineString:
    """Connect edge geometries based on node sequence"""
    lines: List[LineString] = []
    for i in range(len(nodes_seq) - 1):
        u = nodes_seq[i]
        v = nodes_seq[i + 1]
        data = G.get_edge_data(u, v)
        geom = data.get("geometry") if isinstance(data, dict) else None
        if geom is not None:
            lines.append(geom)

    if not lines:
        return LineString()

    coords = [tuple(lines[0].coords)[0]]
    for ln in lines:
        cs = list(ln.coords)
        if coords[-1] != cs[0]:
            coords.append(cs[0])
        coords.extend(cs[1:])
    return LineString(coords)

# ─────────────────────────────────────────────
# Endpoints: Agent output and load existing (SECURITY ENHANCED)
# ─────────────────────────────────────────────
@router.get("/compute-default")
def compute_default():
    """Simple version: copies inputs, runs simulate_agent.py, and returns routes_final from results.gpkg (WGS84)."""
    if not rate_limit_check():
        return _err_response(429, Exception("Rate limit exceeded"), "compute-default")
    
    try:
        _prepare_inputs_for_sim()
        _run_simulate_agent()
        gpkg = os.path.join(SRC_OUT, "results.gpkg")
        routes_fc = _routes_fc_from_gpkg(gpkg)
        meta = {"source": "simulate_agent.py", "output_file": "results.gpkg", "layer": "routes_final"}
        return JSONResponse({"routes_final": routes_fc, "meta": meta})
    except FileNotFoundError as e:
        return _err_response(404, e, "compute-default")
    except RuntimeError as e:
        return _err_response(400, e, "compute-default")
    except Exception as e:
        return _err_response(500, e, "compute-default")

@router.get("/load-existing")
def load_existing_results():
    """If results.gpkg already exists, returns it without running simulation. Checks first in src/outputs then in app/data."""
    if not rate_limit_check():
        return _err_response(429, Exception("Rate limit exceeded"), "load-existing")
    
    try:
        gpkg = os.path.join(SRC_OUT, "results.gpkg")
        if not os.path.exists(gpkg):
            gpkg = os.path.join(DATA_DIR, "results.gpkg")
        if not os.path.exists(gpkg):
            raise FileNotFoundError("results.gpkg not found in outputs or data")
        routes_fc = _routes_fc_from_gpkg(gpkg)
        meta = {"source": "existing results", "file": os.path.basename(gpkg), "layer": "routes_final"}
        return JSONResponse({"routes_final": routes_fc, "meta": meta})
    except Exception as e:
        return _err_response(500, e, "load-existing")

# ─────────────────────────────────────────────
# General endpoint: Route computation with dynamic weighting synced with tabs (SECURITY ENHANCED)
# ─────────────────────────────────────────────
def _compute_weighted_internal(
    risk: str,
    max_pairs: Optional[int] = None,
    alpha_build_base: float = 0.05,
    alpha_build_heat_coeff: float = 0.02,
) -> JSONResponse:
    """
    Route computation incorporating all data:
    - roads, nodes/nods, origins, destinations
    - vegetation (shade/cover), buildings (building buffer), weather_now.json (shade effect intensity with heat)
    Output: FeatureCollection (CRS=4326) for Leaflet display
    """
    if not rate_limit_check():
        return _err_response(429, Exception("Rate limit exceeded"), f"compute-{risk}")
    
    # SECURITY: Input validation
    max_pairs = min(max_pairs or MAX_PAIRS_LIMIT, MAX_PAIRS_LIMIT) if max_pairs else None
    alpha_build_base = min(max(alpha_build_base, 0.0), MAX_ALPHA_LIMIT)
    alpha_build_heat_coeff = min(max(alpha_build_heat_coeff, 0.0), MAX_ALPHA_LIMIT)
    
    try:
        # 1) Read data
        roads = _read_fc("roads")
        try:
            _ = _read_fc("nodes")  # Just for data validation; build graph from roads
        except FileNotFoundError:
            _ = _read_fc("nods")
        origins = _read_fc("origins")
        dests = _read_fc("destinations")

        vegetation = None
        buildings = None
        try:
            vegetation = _read_fc("vegetation")
        except Exception:
            pass
        try:
            buildings = _read_fc("buildings")
        except Exception:
            pass

        weather = _read_weather()
        temp_c = float(weather.get("temp_c", 25.0))

        # 2) Metric CRS
        roads_m = _to_metric(_explode_lines(roads))
        origins_m = _to_metric(origins)
        dests_m = _to_metric(dests)

        veg_u = None
        if vegetation is not None and not vegetation.empty:
            veg_u = unary_union(_to_metric(vegetation).geometry)
        bldg_u = None
        if buildings is not None and not buildings.empty:
            bldg_u = unary_union(_to_metric(buildings).geometry)

        # 3) Build weighted graph (dynamic)
        G = _build_graph_weighted(
            roads_m, veg_u, bldg_u, temp_c,
            alpha_build_base=alpha_build_base,
            alpha_build_heat_coeff=alpha_build_heat_coeff
        )

        # 4) Map nearest nodes and route (no 4-pair limit, controllable with max_pairs)
        origins_pts = list(origins_m.geometry)
        dests_pts = list(dests_m.geometry)
        total_pairs = min(len(origins_pts), len(dests_pts))
        n_pairs = total_pairs if (max_pairs is None) else min(max_pairs, total_pairs)

        features: List[dict] = []
        no_path = 0

        for i in range(n_pairs):
            o_pt: Point = origins_pts[i]
            d_pt: Point = dests_pts[i]
            u = _nearest_graph_node(G, o_pt)
            v = _nearest_graph_node(G, d_pt)
            if u is None or v is None:
                no_path += 1
                continue

            # Attempt 1: Shortest path with weight (shade/building/weather)
            nodes_seq = None
            try:
                nodes_seq = nx.shortest_path(G, u, v, weight="weight")
            except nx.NetworkXNoPath:
                nodes_seq = None

            # Attempt 2 (fallback): Geometric length only
            if nodes_seq is None:
                try:
                    nodes_seq = nx.shortest_path(G, u, v, weight="length")
                except nx.NetworkXNoPath:
                    nodes_seq = None

            if nodes_seq is None:
                no_path += 1
                continue

            path_geom_m = _path_geom_from_nodes(G, nodes_seq)
            if path_geom_m.is_empty:
                no_path += 1
                continue

            gdf_tmp = gpd.GeoDataFrame([{"agentId": i + 1, "risk": risk}], geometry=[path_geom_m], crs=3857)
            gdf_tmp = _to_wgs84(gdf_tmp)
            coords = list(gdf_tmp.geometry.iloc[0].coords)  # [lon, lat]

            features.append({
                "type": "Feature",
                "properties": {
                    "agentId": i + 1,
                    "length_m": float(path_geom_m.length),
                    "temp_c": temp_c,
                    "risk": risk,
                    "weights": {
                        "shade": True,
                        "buildings": True,
                        "weather": True,
                        "alpha_build_base": alpha_build_base,
                        "alpha_build_heat_coeff": alpha_build_heat_coeff,
                        "fallback_if_needed": True
                    }
                },
                "geometry": {"type": "LineString", "coordinates": coords}
            })

        fc = {"type": "FeatureCollection", "features": features}
        meta = {
            "pairs_total": total_pairs,
            "pairs_processed": n_pairs,
            "ok": len(features),
            "no_path": no_path,
            "temp_c": temp_c,
            "risk": risk,
            "weights": {"shade": True, "buildings": True, "weather": True}
        }
        return JSONResponse({"routes_final": fc, "meta": meta})

    except FileNotFoundError as e:
        return _err_response(404, e, f"compute-{risk}", {"risk": risk})
    except Exception as e:
        return _err_response(500, e, f"compute-{risk}", {"risk": risk})

# ─────────────────────────────────────────────
# Endpoints synced with frontend (tabs) - VALIDATION ENHANCED
# ─────────────────────────────────────────────
@router.get("/compute-flood")
def compute_flood(
    max_pairs: Optional[int] = Query(None, ge=1, le=MAX_PAIRS_LIMIT, description="Maximum number of pairs to process"),
):
    return _compute_weighted_internal(risk="flood", max_pairs=max_pairs)

@router.get("/compute-heat")
def compute_heat(
    max_pairs: Optional[int] = Query(None, ge=1, le=MAX_PAIRS_LIMIT),
    alpha_build_base: float = Query(0.06, ge=0.0, le=MAX_ALPHA_LIMIT),
    alpha_build_heat_coeff: float = Query(0.03, ge=0.0, le=MAX_ALPHA_LIMIT),
):
    # In heat, building effect is slightly stronger (different default parameters)
    return _compute_weighted_internal(
        risk="heat",
        max_pairs=max_pairs,
        alpha_build_base=alpha_build_base,
        alpha_build_heat_coeff=alpha_build_heat_coeff,
    )

@router.get("/compute-fire")
def compute_fire(
    max_pairs: Optional[int] = Query(None, ge=1, le=MAX_PAIRS_LIMIT),
    alpha_build_base: float = Query(0.04, ge=0.0, le=MAX_ALPHA_LIMIT),
    alpha_build_heat_coeff: float = Query(0.02, ge=0.0, le=MAX_ALPHA_LIMIT),
):
    # In fire, buildings have milder effect (gentler defaults)
    return _compute_weighted_internal(
        risk="fire",
        max_pairs=max_pairs,
        alpha_build_base=alpha_build_base,
        alpha_build_heat_coeff=alpha_build_heat_coeff,
    )

@router.get("/compute-quake")
def compute_quake(
    max_pairs: Optional[int] = Query(None, ge=1, le=MAX_PAIRS_LIMIT),
    alpha_build_base: float = Query(0.03, ge=0.0, le=MAX_ALPHA_LIMIT),
    alpha_build_heat_coeff: float = Query(0.01, ge=0.0, le=MAX_ALPHA_LIMIT),
):
    # In earthquake, proximity to buildings has very low effect (adjustable parameters)
    return _compute_weighted_internal(
        risk="quake",
        max_pairs=max_pairs,
        alpha_build_base=alpha_build_base,
        alpha_build_heat_coeff=alpha_build_heat_coeff,
    )

@router.get("/compute-merge")
def compute_merge(
    max_pairs: Optional[int] = Query(None, ge=1, le=MAX_PAIRS_LIMIT),
    alpha_build_base: float = Query(0.05, ge=0.0, le=MAX_ALPHA_LIMIT),
    alpha_build_heat_coeff: float = Query(0.02, ge=0.0, le=MAX_ALPHA_LIMIT),
):
    # Comprehensive map: average parameters
    return _compute_weighted_internal(
        risk="merge",
        max_pairs=max_pairs,
        alpha_build_base=alpha_build_base,
        alpha_build_heat_coeff=alpha_build_heat_coeff,
    )
