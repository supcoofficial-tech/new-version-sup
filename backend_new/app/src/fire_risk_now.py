import os, json
import numpy as np
import geopandas as gpd
from shapely.strtree import STRtree
from shapely.geometry import Point

# ---------- تنظیمات ----------
API_KEY = "4729a449bfa1e86d952dfdff6bf6ddc0"
CENTER_LAT = (34.323814 + 34.314269) / 2.0
CENTER_LON = (47.069031 + 47.078733) / 2.0

TREES_FP   = "data/vegetation.geojson"
PARCELS_FP = "data/neighborhood.geojson"
WEATHER_FP = "data/weather_now.json"
OUT_TREES  = "output/tree_fire_prob.geojson"
OUT_PARC   = "output/parcel_fire_prob.geojson"

# ---------- آب‌وهوا ----------
def fetch_current_weather(lat, lon, api_key):
    import requests
    url = "https://api.openweathermap.org/data/2.5/weather"
    r = requests.get(url, params={"lat": lat, "lon": lon, "units": "metric", "appid": api_key}, timeout=15)
    r.raise_for_status()
    j = r.json()
    return {
        "temp": j["main"]["temp"],
        "humidity": j["main"]["humidity"],
        "wind_speed": j.get("wind", {}).get("speed", 0.0),
        "wind_deg": j.get("wind", {}).get("deg", 0.0),
        "wind_gust": j.get("wind", {}).get("gust", 0.0),
        "ts": j.get("dt", None)
    }

# ---------- پاکسازی هندسه ----------
def clean_geoms(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    gdf = gdf.copy()
    gdf = gdf[gdf.geometry.notna()]
    gdf = gdf[~gdf.geometry.is_empty]
    def _fix(geom):
        if "Polygon" in geom.geom_type:
            try:
                fixed = geom.buffer(0)
                if not fixed.is_empty:
                    return fixed
                return None
            except Exception:
                return None
        return geom
    gdf["geometry"] = gdf.geometry.apply(_fix)
    gdf = gdf[gdf.geometry.notna()]
    gdf = gdf[~gdf.geometry.is_empty]
    return gdf

# ---------- نوشتن امن ----------
def safe_write(gdf: gpd.GeoDataFrame, path: str, driver="GeoJSON"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    gdf.to_file(tmp, driver=driver, engine="fiona")
    os.replace(tmp, path)
    return path

# ---------- بارگذاری ----------
def load_trees_and_parcels():
    trees = gpd.read_file(TREES_FP)
    parcels = gpd.read_file(PARCELS_FP)
    trees   = clean_geoms(trees).to_crs(epsg=3857)
    parcels = clean_geoms(parcels).to_crs(trees.crs)
    if len(trees) == 0:
        raise ValueError("⚠️ لایه پوشش گیاهی خالی است.")
    if trees.geometry.iloc[0].geom_type != "Point":
        trees = trees.copy()
        trees["geometry"] = trees.geometry.centroid
    return trees, parcels

# ---------- همسایگی ----------
def count_neighbors_radius(trees_m: gpd.GeoDataFrame, parcels_m: gpd.GeoDataFrame):
    tbuf3 = trees_m.copy()
    tbuf3["geometry"] = trees_m.geometry.buffer(3)
    pairs = gpd.sjoin(tbuf3, trees_m[["geometry"]], how="left", predicate="intersects")
    pairs = pairs[pairs.index != pairs["index_right"]]
    n_tree_3m = pairs.groupby(pairs.index).size().reindex(trees_m.index, fill_value=0)

    tbuf5 = trees_m.copy()
    tbuf5["geometry"] = trees_m.geometry.buffer(5)
    tpairs = gpd.sjoin(tbuf5, parcels_m[["geometry"]], how="left", predicate="intersects")
    n_parcel_5m = tpairs.groupby(tpairs.index).size().reindex(trees_m.index, fill_value=0)

    return n_tree_3m.astype(int), n_parcel_5m.astype(int)

# ---------- فاصله‌ها ----------
def nearest_dist_features(trees_m: gpd.GeoDataFrame, parcels_m: gpd.GeoDataFrame):
    geoms = list(trees_m.geometry)
    tree_index = STRtree(geoms)
    d_tree = np.zeros(len(trees_m), dtype="float64")
    for i, g in enumerate(geoms):
        cand = tree_index.query(g.buffer(25))
        mind = 1e9
        for cg in cand:
            if cg is g: continue
            d = g.distance(cg)
            if d < mind: mind = d
        if not np.isfinite(mind) or mind == 1e9: mind = 25.0
        d_tree[i] = mind

    par_geoms = list(parcels_m.geometry)
    par_index = STRtree(par_geoms)
    d_parcel = np.zeros(len(trees_m), dtype="float64")
    for i, g in enumerate(geoms):
        cand = par_index.query(g)
        inside = False
        mind = 1e9
        for pg in cand:
            if g.within(pg):
                inside = True; mind = 0.0; break
            d = g.distance(pg)
            if d < mind: mind = d
        if not inside:
            if not np.isfinite(mind) or mind == 1e9: mind = 25.0
        d_parcel[i] = mind
    return d_tree, d_parcel

# ---------- ریسک ----------
def risk_score_array(temp, humidity, wind_speed, n_tree_3m, n_parcel_5m, d_tree, d_parcel, dist_center):
    t  = np.clip(temp / 50.0, 0, 1)
    h  = np.clip((100.0 - humidity) / 100.0, 0, 1)
    w  = np.clip(wind_speed / 10.0, 0, 1)
    ntc = np.clip(n_tree_3m / 5.0, 0, 1)
    npc = np.clip(n_parcel_5m / 3.0, 0, 1)
    nt_cont = np.exp(-np.clip(d_tree,   0, 50) / 7.0)
    np_cont = np.exp(-np.clip(d_parcel, 0, 50) / 7.0)
    dc = np.exp(-np.clip(dist_center, 0, 500) / 150.0)
    score = (0.20 + 0.30*t + 0.30*h + 0.15*w +
             0.03*ntc + 0.02*npc +
             0.10*nt_cont + 0.08*np_cont +
             0.12*dc)
    return np.clip(score, 0.01, 0.99)

def base_from_weather(temp, hum, ws) -> float:
    t = np.clip(temp/50.0, 0, 1)
    h = np.clip((100.0 - hum)/100.0, 0, 1)
    w = np.clip(ws/10.0, 0, 1)
    return float(np.clip(0.2 + 0.3*t + 0.3*h + 0.2*w, 0.05, 0.95))

# ---------- نویز مکانی ----------
def spatial_noise_xy(xs, ys, bounds, scale=0.18, freq=2.0):
    minx, miny, maxx, maxy = bounds
    epsx = max(1e-6, maxx - minx)
    epsy = max(1e-6, maxy - miny)
    u = np.nan_to_num((xs - minx) / epsx, nan=0.0)
    v = np.nan_to_num((ys - miny) / epsy, nan=0.0)
    two_pi = 2.0 * np.pi
    noise = 0.5*np.sin(two_pi*freq*u) + 0.5*np.cos(two_pi*freq*v)
    return scale * noise

# ---------- اجرای اصلی ----------
def main():
    # آب‌وهوا
    if os.path.exists(WEATHER_FP):
        with open(WEATHER_FP, "r", encoding="utf-8") as f:
            W = json.load(f)
    else:
        W = fetch_current_weather(CENTER_LAT, CENTER_LON, API_KEY)
        os.makedirs("data", exist_ok=True)
        with open(WEATHER_FP, "w", encoding="utf-8") as f:
            json.dump(W, f, ensure_ascii=False, indent=2)
    temp = float(W.get("temp", 25.0))
    hum  = float(W.get("humidity", 40.0))
    ws   = float(W.get("wind_speed", 2.0))

    # داده‌ها
    trees, parcels = load_trees_and_parcels()
    n3, n5 = count_neighbors_radius(trees, parcels)
    trees["n_tree_3m"]   = n3.values
    trees["n_parcel_5m"] = n5.values
    d_tree, d_parcel = nearest_dist_features(trees, parcels)
    trees["d_tree"]   = d_tree
    trees["d_parcel"] = d_parcel

    # فاصله تا مرکز
    center = Point(CENTER_LON, CENTER_LAT)
    center_m = gpd.GeoSeries([center], crs="EPSG:4326").to_crs(epsg=3857).iloc[0]
    trees["dist_center"] = trees.geometry.distance(center_m)

    # fire_prob پایه
    base_probs = risk_score_array(
        temp, hum, ws,
        trees["n_tree_3m"].values,
        trees["n_parcel_5m"].values,
        trees["d_tree"].values,
        trees["d_parcel"].values,
        trees["dist_center"].values
    )

    # نویز مکانی
    bounds = parcels.total_bounds
    xs_t = np.array(trees.geometry.x, dtype="float64")
    ys_t = np.array(trees.geometry.y, dtype="float64")
    noise_trees = spatial_noise_xy(xs_t, ys_t, bounds, scale=0.18, freq=2.3)

    # fallback: اگر همه یکی بود → از index تنوع بده
    if len(np.unique(np.round(noise_trees, 4))) <= 1:
        idx_offsets = ((np.arange(len(trees)) % 10) - 5) / 50.0  # [-0.1, +0.1]
        noise_trees = idx_offsets

    trees["fire_prob"] = np.clip(base_probs + noise_trees, 0.01, 0.99).astype("float64")

    # پارسل‌ها
    base_parc = base_from_weather(temp, hum, ws)
    xs_p = np.array(parcels.geometry.centroid.x, dtype="float64")
    ys_p = np.array(parcels.geometry.centroid.y, dtype="float64")
    noise_parc = spatial_noise_xy(xs_p, ys_p, bounds, scale=0.15, freq=1.7)
    parcels["fire_prob"] = np.clip(base_parc + noise_parc, 0.01, 0.99).astype("float64")
    join_in = gpd.sjoin(trees[["fire_prob","geometry"]], parcels[["geometry"]], how="left", predicate="within")
    mean_in = join_in.groupby("index_right")["fire_prob"].mean()
    idx = mean_in.index
    parcels.loc[idx, "fire_prob"] = np.maximum(parcels.loc[idx, "fire_prob"].values, mean_in.values)

    # خروجی
    trees_out   = clean_geoms(trees.to_crs(epsg=4326))
    parcels_out = clean_geoms(parcels.to_crs(epsg=4326))
    tree_path   = safe_write(trees_out, OUT_TREES)
    parcel_path = safe_write(parcels_out, OUT_PARC)

    print("Weather → temp:", temp, "°C  hum:", hum, "%  wind:", ws, "m/s")
    print("Trees   → fire_prob min/mean/max:",
          float(trees_out["fire_prob"].min()),
          float(trees_out["fire_prob"].mean()),
          float(trees_out["fire_prob"].max()))
    print("Parcels → fire_prob min/mean/max:",
          float(parcels_out["fire_prob"].min()),
          float(parcels_out["fire_prob"].mean()),
          float(parcels_out["fire_prob"].max()))
    print("Saved:", tree_path, "and", parcel_path)

if __name__ == "__main__":
    main()