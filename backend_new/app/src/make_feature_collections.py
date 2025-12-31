# make_feature_collections.py
# -*- coding: utf-8 -*-
import os, sys, json, argparse
import geopandas as gpd
from shapely.geometry import shape, Point, LineString, MultiLineString
from pyproj import CRS

ALLOWED_USER = {1,4,5}

def read_any_geo(path: str):
    """
    تلاش برای خواندن با GeoPandas؛ اگر شکست خورد، سعی می‌کنیم
    JSON/NDJSON را به FeatureCollection تبدیل کنیم و بعد بخوانیم.
    """
    try:
        return gpd.read_file(path)
    except Exception:
        # تلاش دوم: متن را بخوان و تبدیل کن به FeatureCollection
        with open(path, "r", encoding="utf-8") as f:
            txt = f.read().strip()
        fc = None
        try:
            obj = json.loads(txt)
            if isinstance(obj, dict) and obj.get("type") == "FeatureCollection":
                fc = obj
            elif isinstance(obj, list):
                # لیست فیچرها → FeatureCollection
                fc = {"type":"FeatureCollection","features":obj}
            elif isinstance(obj, dict) and obj.get("type") == "Feature" and "geometry" in obj:
                fc = {"type":"FeatureCollection","features":[obj]}
        except Exception:
            # NDJSON: هر خط یک JSON
            feats = []
            for line in txt.splitlines():
                line = line.strip()
                if not line: continue
                try:
                    x = json.loads(line)
                    if isinstance(x, dict) and x.get("type") in ("Feature","FeatureCollection"):
                        if x.get("type") == "Feature":
                            feats.append(x)
                        elif x.get("type") == "FeatureCollection":
                            feats.extend(x.get("features",[]))
                    elif isinstance(x, dict) and "geometry" in x:
                        feats.append({"type":"Feature","geometry":x["geometry"],"properties":x.get("properties",{})})
                except Exception:
                    pass
            if feats:
                fc = {"type":"FeatureCollection","features":feats}
        if fc is None:
            raise RuntimeError(f"Cannot parse {path} as geojson or ndjson.")
        tmp = path + ".tmp_fc.geojson"
        with open(tmp,"w",encoding="utf-8") as f:
            json.dump(fc, f, ensure_ascii=False)
        gdf = gpd.read_file(tmp)
        os.remove(tmp)
        return gdf

def ensure_crs_4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    # GeoJSON استانداردش WGS84 است؛ اگر چیز دیگری بود، می‌بریم به 4326
    if gdf.crs is None:
        # فرض 4326 اگر معلوم نبود
        return gdf.set_crs(4326, allow_override=True)
    crs = CRS.from_user_input(gdf.crs)
    return gdf if crs.to_epsg() == 4326 or crs.is_geographic else gdf.to_crs(4326)

def normalize_columns(gdf: gpd.GeoDataFrame, for_nodes=False):
    # user → اگر نبود بساز (۱)
    
    cols_lower = {c.lower(): c for c in gdf.columns}
    if "user" not in cols_lower:
        gdf["user"] = 1
    else:
        c0 = cols_lower["user"]
        if c0 != "user":
            gdf.rename(columns={c0:"user"}, inplace=True)

    if for_nodes:
        # Degree → اگر نبود 0
        if "degree" not in cols_lower:
            gdf["Degree"] = 0
        else:
            c1 = cols_lower["degree"]
            if c1 != "Degree":
                gdf.rename(columns={c1:"Degree"}, inplace=True)
    return gdf

def lines_only(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return gdf[gdf.geometry.geom_type.isin(["LineString","MultiLineString"])].copy()

def points_only(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return gdf[gdf.geometry.geom_type.isin(["Point"])].copy()

def to_feature_collection(gdf: gpd.GeoDataFrame, out_path: str):
    # ذخیره با درایور GeoJSON → همیشه FeatureCollection می‌نویسد
    gdf.to_file(out_path, driver="GeoJSON")
    print(f"✅ wrote FeatureCollection → {out_path}")

def main():
    ap = argparse.ArgumentParser(description="Convert roads/nodes to GeoJSON FeatureCollection.")
    ap.add_argument("--roads", required=True, help="مسیر لایه خطوط (هر فرمتی)")
    ap.add_argument("--nodes", required=True, help="مسیر لایه گره‌ها (هر فرمتی)")
    ap.add_argument("--outdir", default="data/fc", help="پوشه‌ی خروجی")
    ap.add_argument("--filter-user", action="store_true", help="فقط user در {1,4,5} نگه‌دار")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)

    # خواندن ورودی‌ها
    roads = read_any_geo(args.roads)
    nodes = read_any_geo(args.nodes)

    # اطمینان از CRS=4326
    roads = ensure_crs_4326(roads)
    nodes = ensure_crs_4326(nodes)

    # پاک‌سازی ستون‌ها
    roads = normalize_columns(roads, for_nodes=False)
    nodes = normalize_columns(nodes, for_nodes=True)

    # فقط هندسه‌های معتبر
    roads = lines_only(roads)
    nodes = points_only(nodes)

    # اعمال فیلتر user در صورت نیاز
    if args.filter_user:
        roads = roads[roads["user"].isin(ALLOWED_USER)].copy()
        nodes = nodes[nodes["user"].isin(ALLOWED_USER)].copy()

    # خروجی نهایی FeatureCollection
    out_roads = os.path.join(args.outdir, "roads_fc.geojson")
    out_nodes = os.path.join(args.outdir, "nodes_fc.geojson")
    to_feature_collection(roads, out_roads)
    to_feature_collection(nodes, out_nodes)


if __name__ == "__main__":
    main()