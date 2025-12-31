import os
import geopandas as gpd

BASE = os.path.dirname(os.path.dirname(__file__))
DATA = os.path.join(BASE, "data")
OUT  = os.path.join(BASE, "output")
os.makedirs(OUT, exist_ok=True)

# 1) ورودی‌ت از کجاست؟ یکی از این‌ها را داشته باش:
#   - اگر پوشش گیاهی polygon در DATA داری:
candidates = [
    os.path.join(DATA, "vegetation.geojson"),
    os.path.join(OUT,  "vegetation.geojson"),
    os.path.join(DATA, "vegetation.gpkg"),
]

src_fp = next((p for p in candidates if os.path.exists(p)), None)
if not src_fp:
    raise FileNotFoundError("No vegetation file found in DATA/OUT (e.g., vegetation.geojson)")

g = gpd.read_file(src_fp)

# 2) CRS را درست کن (اگر معلوم نبود، پیش‌فرض بگذار EPSG:32638؛ بعد به 4326 تبدیل کن)
if g.crs is None:
    # اگر مختصات متری دارید (UTM Zone 38N برای غرب ایران)، این پیش‌فرض خوب عمل می‌کند
    g.set_crs(32638, inplace=True)
g = g.to_crs(4326)

# 3) اگر از قبل Point است، همان را ذخیره کن؛ اگر Polygon/MultiPolygon است، نقطه نماینده بساز
geom_type = g.geometry.iloc[0].geom_type if len(g) else None
pts = g.copy()
if geom_type and "Point" not in geom_type:
    # representative_point بهتر از centroid برای پلیگون‌های باریک
    pts["geometry"] = g.representative_point()

# 4) خروجی استاندارد
out_fp = os.path.join(OUT, "vegetation_points.geojson")
pts.to_file(out_fp, driver="GeoJSON")
print("✅ Saved:", out_fp)
