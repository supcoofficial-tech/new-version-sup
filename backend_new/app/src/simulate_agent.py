# -*- coding: utf-8 -*-
"""
simulate_agent.py
- Export both User=1 (allowed) and User=0 (blocked) for nodes & edges
- Robust handling of MultiLineString
- Auto-create endpoint nodes when no nearby node exists (so user=1 lines won't disappear)
- Build fully connected route: linemerge + endpoint fix
- Pathfinding uses only User==1; User==0 only for visualization
"""

import os, json, math
from pathlib import Path
from dataclasses import dataclass
from typing import Optional, Tuple, Iterable
from shapely.ops import unary_union
import numpy as np
import geopandas as gpd
import networkx as nx
from shapely.geometry import Point, LineString, shape, base
from shapely.ops import linemerge
from pyproj import CRS


ROOT = Path(__file__).parent.resolve()
DATA = ROOT / "data"
OUT  = ROOT / "outputs"
OUT.mkdir(parents=True, exist_ok=True)

def pick_first(*cands: Path) -> Optional[str]:
    for p in cands:
        if p and p.exists(): return str(p)
    return None

FP_ROADS = pick_first(DATA/"roads.geojson", DATA/"roads.shp")
FP_NODES = pick_first(DATA/"nodes.geojson", DATA/"nodes.shp")
FP_BLDG  = pick_first(DATA/"buildings.geojson", DATA/"buildings.shp")
FP_VEG   = pick_first(DATA/"vegetation.geojson", DATA/"vegetation.shp")
FP_ORG   = pick_first(DATA/"origins.geojson", DATA/"origins.shp")
FP_DST   = pick_first(DATA/"destinations.geojson", DATA/"destinations.shp")
OUT_GPKG = str(OUT/"results.gpkg")

ALLOWED = {1}   # انسان فقط روی User=1
BLOCKED = {0}   # برای نمایش در خروجی، نه مسیر‌یابی


# ------------- IO & CRS -------------
def read_geo(path: Optional[str]) -> gpd.GeoDataFrame:
    if not path or not os.path.exists(path):
        raise FileNotFoundError(f"فایل پیدا نشد: {path}")
    gdf = gpd.read_file(path)
    if "geometry" not in gdf.columns:
        raise ValueError(f"geometry در {path} نیست")
    return gdf

def to_metric(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        gdf = gdf.set_crs(4326, allow_override=True)
    crs = CRS.from_user_input(gdf.crs)
    if crs.is_geographic:
        minx, miny, maxx, maxy = gdf.total_bounds
        lon, lat = (minx+maxx)/2, (miny+maxy)/2
        zone = int((lon + 180)//6) + 1
        epsg = 32600 + zone if lat >= 0 else 32700 + zone
        gdf = gdf.to_crs(epsg)
    return gdf

def ensure_user_col(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    # User/user هر اسمی داشته باشد → user
    lower = {c.lower(): c for c in gdf.columns}
    if "user" in lower:
        real = lower["user"]
        if real != "user":
            gdf = gdf.rename(columns={real: "user"})
    if "user" not in gdf.columns:
        gdf["user"] = 1
    return gdf

def read_weather_temp(default_c: float = 25.0) -> float:
    """weather_now.json را از پوشه data می‌خواند؛ اگر نبود یا نامعتبر بود، مقدار پیش‌فرض را می‌دهد."""
    fp = DATA / "weather_now.json"
    if not fp.exists():
        return default_c
    try:
        j = json.loads(fp.read_text(encoding="utf-8"))
        # تلاش برای استخراج کلیدهای رایج
        cand = j.get("temp_c", j.get("temperature", j.get("temp", default_c)))
        return float(cand)
    except Exception:
        return default_c

# ------------- Traits & Shade -------------
@dataclass
class AgentTraits:
    # وزن‌های پایه
    w_len: float = 1.0
    # ضرایب اثر سایه/ساختمان (ضرب در length)
    alpha_shade_base: float = 0.25     # پایه اثر سایه
    alpha_shade_range: float = 0.25    # دامنه افزایش با گرما (پس 0.25..0.50)
    alpha_build: float = 0.10          # اثر نزدیکی ساختمان‌ها

    # نرمال‌سازی دما
    temp_min_c: float = 15.0
    temp_max_c: float = 45.0

    def norm_temp(self, t: float) -> float:
        return float(np.clip((t - self.temp_min_c) / (self.temp_max_c - self.temp_min_c + 1e-9), 0, 1))

    def alpha_shade(self, t_c: float) -> float:
        heat = self.norm_temp(t_c)
        return self.alpha_shade_base + self.alpha_shade_range * heat

class ShadowProbe:
    """
    برآورد نسبت طولِ داخل "سایه درختان" و "حریم ساختمان".
    - trees: vegetation/polygons
    - buildings: building/polygons
    - shade_buf_m: بافر کوچک برای سایه (≈0.8 متر)
    - bldg_buf_m: بافر برای نزدیکی ساختمان (≈6 متر)
    """
    def __init__(self, buildings=None, trees=None, shade_buf_m: float = 0.8, bldg_buf_m: float = 6.0):
        self.shade_buf_m = float(shade_buf_m)
        self.bldg_buf_m  = float(bldg_buf_m)

        self._shade_union = None
        self._bldg_union  = None

        # Union امن با بافر
        try:
            if trees is not None and len(trees):
                geoms = [g for g in trees.geometry if g is not None and not g.is_empty]
                if geoms:
                    bufs = [g.buffer(self.shade_buf_m) for g in geoms]
                    self._shade_union = unary_union(bufs)
        except Exception:
            self._shade_union = None

        try:
            if buildings is not None and len(buildings):
                geoms = [g for g in buildings.geometry if g is not None and not g.is_empty]
                if geoms:
                    self._bldg_union = unary_union([g.buffer(self.bldg_buf_m) for g in geoms])
        except Exception:
            self._bldg_union = None

    def ratios_for_line(self, line: LineString) -> tuple[float, float]:
        """
        خروجی: (shade_ratio, near_build_ratio) — هر دو بین 0..1
        """
        if line is None or line.is_empty or line.length <= 0:
            return 0.0, 0.0

        L = float(line.length)
        shade_ratio = 0.0
        bldg_ratio  = 0.0

        if self._shade_union is not None:
            try:
                inter = line.intersection(self._shade_union)
                shade_len = float(inter.length) if inter and not inter.is_empty else 0.0
                shade_ratio = max(0.0, min(1.0, shade_len / L))
            except Exception:
                pass

        if self._bldg_union is not None:
            try:
                inter_b = line.intersection(self._bldg_union)
                bldg_len = float(inter_b.length) if inter_b and not inter_b.is_empty else 0.0
                bldg_ratio = max(0.0, min(1.0, bldg_len / L))
            except Exception:
                pass

        return shade_ratio, bldg_ratio

# ------------- Helpers -------------
def iter_line_parts(geom: base.BaseGeometry) -> Iterable[LineString]:
    if geom is None or geom.is_empty:
        return
    if geom.geom_type == "LineString":
        yield geom
    elif geom.geom_type == "MultiLineString":
        for part in geom.geoms:
            if part and not part.is_empty and part.geom_type == "LineString":
                yield part

def connect_endpoints_exact(route: LineString, o: Point, d: Point, tol: float = 0.3) -> LineString:
    """اگر اول/آخر خط دقیقاً به مبدا/مقصد نچسبد، بخش اتصال کوتاه اضافه کن."""
    coords = list(route.coords)
    if Point(coords[0]).distance(o) > tol:
        coords = [ (o.x, o.y) ] + coords
    if Point(coords[-1]).distance(d) > tol:
        coords = coords + [ (d.x, d.y) ]
    return LineString(coords)
# ------------- Graph build -------------
def build_graph(roads_all: gpd.GeoDataFrame, nodes_all: gpd.GeoDataFrame,
                buildings: Optional[gpd.GeoDataFrame], trees: Optional[gpd.GeoDataFrame],
                traits: AgentTraits, temp_c: float,
                snap_rad_node: float = 15.0) -> tuple[nx.Graph, gpd.GeoDataFrame, gpd.GeoDataFrame,
                                                      gpd.GeoDataFrame, gpd.GeoDataFrame]:
    """برگشتی‌ها: G, nodes_allowed, edges_allowed, nodes_blocked, edges_blocked"""
    roads_all = ensure_user_col(roads_all)
    nodes_all = ensure_user_col(nodes_all)

    roads_allowed = roads_all[roads_all["user"].isin(ALLOWED)].copy()
    roads_blocked = roads_all[roads_all["user"].isin(BLOCKED)].copy()
    nodes_allowed = nodes_all[nodes_all["user"].isin(ALLOWED)].copy()
    nodes_blocked = nodes_all[nodes_all["user"].isin(BLOCKED)].copy()

    # explode امن
    for name, gdf in [("roads_allowed", roads_allowed), ("roads_blocked", roads_blocked)]:
        try:
            gdf_ex = gdf.explode(index_parts=False, ignore_index=True)
        except TypeError:
            gdf_ex = gdf.explode().reset_index(drop=True)
        if name == "roads_allowed": roads_allowed = gdf_ex
        else: roads_blocked = gdf_ex

    # پروب سایه/ساختمان
    probe = ShadowProbe(buildings=buildings, trees=trees, shade_buf_m=0.8, bldg_buf_m=6.0)
    G = nx.Graph()

    # add allowed nodes
    for nid, r in nodes_allowed.iterrows():
        G.add_node(int(nid), geom=r.geometry)

    # nearest helper روی گره‌های مجاز
    nidx = nodes_allowed.sindex
    def nearest_or_create(pt: Point) -> int:
        try:
            cand = list(nidx.query(pt.buffer(snap_rad_node)))
        except Exception:
            cand = []
        if cand:
            best, bid = 1e18, None
            for i in cand:
                nid = int(nodes_allowed.index[i])
                d = pt.distance(nodes_allowed.geometry.iloc[i])
                if d < best:
                    best, bid = d, nid
            return bid
        new_id = int(max(G.nodes) + 1) if len(G.nodes) else 1000000
        G.add_node(new_id, geom=pt)
        nodes_allowed.loc[new_id, "geometry"] = pt
        nodes_allowed.loc[new_id, "user"] = 1
        return new_id

    edges_allowed = []
    # ضرایب وابسته به دما
    a_shade = traits.alpha_shade(temp_c)  # 0.25..0.50 بسته به گرما
    a_bldg  = traits.alpha_build          # ثابت 0.10

    for _, r in roads_allowed.iterrows():
        for line in iter_line_parts(r.geometry):
            if not line or line.is_empty:
                continue
            u = nearest_or_create(Point(line.coords[0]))
            v = nearest_or_create(Point(line.coords[-1]))
            if u == v:
                continue

            length = float(line.length)
            shade_ratio, near_b_ratio = probe.ratios_for_line(line)

            # وزن ضربی (هرچه سایه/نزدیکی بیشتر → وزن کمتر)
            weight = length * (1.0 - a_shade * shade_ratio) * (1.0 - a_bldg * near_b_ratio)
            # کف ایمنی تا صفر نشود
            weight = max(length * 0.1, weight)

            # اگر خواستی به شیوه‌ی جمعی هم نگاه کنی: cost = traits.w_len*weight  (ساده)
            cost = traits.w_len * weight

            G.add_edge(u, v, cost=cost, geometry=line,
                       length=length, shade_ratio=shade_ratio, near_b_ratio=near_b_ratio)
            edges_allowed.append({"u": u, "v": v, "geometry": line, "user": 1,
                                  "length": length, "shade_ratio": shade_ratio, "near_b_ratio": near_b_ratio})

    edges_allowed_gdf = gpd.GeoDataFrame(edges_allowed, geometry="geometry", crs=roads_all.crs)

    # فقط برای نمایش
    edges_blocked_gdf = roads_blocked[["geometry", "user"]].copy()
    nodes_blocked_gdf = nodes_blocked[["geometry", "user"]].copy()

    return G, nodes_allowed, edges_allowed_gdf, nodes_blocked_gdf, edges_blocked_gdf


# ------------- Snap to graph -------------
def snap_point_to_graph(pt: Point, nodes_gdf: gpd.GeoDataFrame,
                        edges_gdf: gpd.GeoDataFrame, G: nx.Graph,
                        traits: AgentTraits, rad_nodes=30.0, rad_edge=100.0) -> Tuple[Optional[int], bool]:
    # node-first
    try:
        sidx = nodes_gdf.sindex
        cand = list(sidx.query(pt.buffer(rad_nodes)))
    except Exception:
        cand = []
    if cand:
        best, bid = 1e18, None
        for i in cand:
            nid = int(nodes_gdf.index[i])
            d = pt.distance(nodes_gdf.geometry.iloc[i])
            if d < best:
                best, bid = d, nid
        return bid, False

    # edge-second
    if edges_gdf is None or edges_gdf.empty:
        return None, False
    try:
        eidx = edges_gdf.sindex
        cand = list(eidx.query(pt.buffer(rad_edge)))
    except Exception:
        cand = []
    if not cand:
        return None, False

    best_d, best_i = 1e18, None
    for i in cand:
        geom = edges_gdf.geometry.iloc[i]
        d = pt.distance(geom)
        if d < best_d:
            best_d, best_i = d, i

    row = edges_gdf.iloc[best_i]
    u, v = int(row.get("u")), int(row.get("v"))
    vid = (max(G.nodes) + 1) if len(G.nodes) else 2000000
    G.add_node(vid, geom=pt)

    # وصل به نزدیک‌ترِ u/v
    du = pt.distance(G.nodes[u]["geom"]); dv = pt.distance(G.nodes[v]["geom"])
    t  = u if du <= dv else v
    seg = LineString([pt, G.nodes[t]["geom"]])
    length = float(seg.length); cost = length
    G.add_edge(vid, t, cost=cost, geometry=seg)

    # در nodes_gdf هم نشانش بده تا در خروجی دیده شود
    nodes_gdf.loc[vid, "geometry"] = pt
    nodes_gdf.loc[vid, "user"] = 1
    return vid, True


# ------------- Main -------------
def main():
    print("🚀 شروع: بارگذاری لایه‌ها")
    roads_all = to_metric(ensure_user_col(read_geo(FP_ROADS)))
    nodes_all = to_metric(ensure_user_col(read_geo(FP_NODES)))
    bldg = to_metric(read_geo(FP_BLDG)) if FP_BLDG else None
    veg  = to_metric(read_geo(FP_VEG))  if FP_VEG  else None
    org  = to_metric(read_geo(FP_ORG))
    dst  = to_metric(read_geo(FP_DST))
    temp_c = read_weather_temp(default_c=25.0)

    traits = AgentTraits()

    G, nodes_allowed, edges_allowed, nodes_blocked, edges_blocked = build_graph(
    roads_all, nodes_all, bldg, veg, traits, temp_c, snap_rad_node=15.0
)

    print(f"✅ گراف ساخته شد → nodes_allowed: {len(nodes_allowed)}, edges_allowed: {len(edges_allowed)}")

    # ذخیره همه‌ی لایه‌ها (۱ و ۰)
    if Path(OUT_GPKG).exists():
        Path(OUT_GPKG).unlink()
    nodes_allowed.to_file(OUT_GPKG, layer="graph_nodes_allowed", driver="GPKG")
    edges_allowed.to_file(OUT_GPKG, layer="graph_edges_allowed", driver="GPKG")
    if len(nodes_blocked): nodes_blocked.to_file(OUT_GPKG, layer="graph_nodes_blocked", driver="GPKG")
    if len(edges_blocked): edges_blocked.to_file(OUT_GPKG, layer="graph_edges_blocked", driver="GPKG")

    if org is not None: org.to_file(OUT_GPKG, layer="origins", driver="GPKG")
    if dst is not None: dst.to_file(OUT_GPKG, layer="destinations", driver="GPKG")
    if bldg is not None: bldg.to_file(OUT_GPKG, layer="buildings", driver="GPKG")
    if veg  is not None: veg.to_file(OUT_GPKG, layer="vegetation", driver="GPKG")
    print(f"🟢 خروجی لایه‌ها نوشته شد → {OUT_GPKG}")

    # مسیر‌یابی
    print("🚶 در حال محاسبه مسیر بین مبدا و مقصدها...")
    if "Id" not in org.columns: org["Id"] = np.arange(1, len(org)+1, dtype=int)
    if "Id" not in dst.columns: dst["Id"] = np.arange(1, len(dst)+1, dtype=int)

    routes = []
    for oid in sorted(set(org["Id"]).intersection(set(dst["Id"]))):
        try:
            o_pt = org.loc[org["Id"]==oid].geometry.values[0]
            d_pt = dst.loc[dst["Id"]==oid].geometry.values[0]
            u,_ = snap_point_to_graph(o_pt, nodes_allowed, edges_allowed, G, traits, 30.0, 120.0)
            v,_ = snap_point_to_graph(d_pt, nodes_allowed, edges_allowed, G, traits, 30.0, 120.0)
            if u is None or v is None:
                print(f"⚠️ اسنپ Id={oid} شکست خورد.")
                continue

            path = nx.shortest_path(G, source=u, target=v, weight="cost")
            # جمع‌کردن خطوط مسیر و linemerge
            segs = []
            for i in range(len(path)-1):
                segs.append(G.edges[path[i], path[i+1]]["geometry"])
            merged = linemerge(segs)  # یکپارچه‌سازی هندسی
            if merged.geom_type == "MultiLineString":
                merged = linemerge(list(merged.geoms))  # دوباره تلاش

            # اتصال دقیق به مبدا/مقصد
            if merged.geom_type == "LineString":
                line = connect_endpoints_exact(merged, o_pt, d_pt, tol=0.3)
            else:
                # fallback: جمع‌کردن همهٔ مختصات
                coords = []
                for s in segs:
                    coords.extend(list(s.coords) if not coords else list(s.coords)[1:])
                line = connect_endpoints_exact(LineString(coords), o_pt, d_pt, tol=0.3)

            routes.append({"Id": int(oid), "geometry": line})
            print(f"✅ مسیر Id={oid} ساخته و متصل شد.")
        except Exception as e:
            print(f"⚠️ مسیر برای Id={oid} پیدا نشد: {e}")

    if routes:
        routes_gdf = gpd.GeoDataFrame(routes, geometry="geometry", crs=org.crs or dst.crs or edges_allowed.crs)
        routes_gdf.to_file(OUT_GPKG, layer="routes_final", driver="GPKG")
        print(f"🟢 مسیر نهایی ذخیره شد → routes_final ({len(routes_gdf)} مسیر)")
    else:
        print("⚠️ هیچ مسیری ساخته نشد.")

    print("🏁 تمام شد.")


if __name__ == "__main__":
    main()