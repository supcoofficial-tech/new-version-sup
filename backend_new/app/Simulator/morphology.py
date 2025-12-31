import geopandas as gpd
import os

def run_morphology():
    # مسیر فایل ورودی
    input_path = "feizabad_buildings_exploded.geojson"
    gdf = gpd.read_file(input_path)

    # 👇 اینجا همون منطق اصلی سناریوی مورفولوژی‌ات میاد
    # مثلا اضافه کردن ستون‌ها، الگوریتم رشد، تغییر کاربری و غیره
    gdf["morphology"] = "residential"  # این خط فقط مثاله

    # ساختن خروجی
    output_dir = "outputs"
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "morphology_output.geojson")
    gdf.to_file(output_path, driver="GeoJSON")

    return output_path
