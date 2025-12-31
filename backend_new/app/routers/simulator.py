from fastapi import APIRouter, Body
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
import json, random, csv, os
import folium
from folium.plugins import TimestampedGeoJson

router = APIRouter()

BASE_DIR = Path(__file__).resolve().parents[2]  # ← backend/
DATA = BASE_DIR / "data" / "buildings.geojson"
OUT_DIR = BASE_DIR / "outputs"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_HTML = OUT_DIR / "simulation_map.html"
OUT_LOG  = OUT_DIR / "simulation_log.csv"

# رنگ‌های کاربری
COLORS = {
    1: "#FFFF00",  # Residential
    2: "#FF0000",  # Commercial
    3: "#FFA500",  # Office/Admin
    4: "#808080",  # Industrial
    5: "#DEB887",  # Vacant
    6: "#00BFFF",  # Public Services
    7: "#008000",  # Green/Open
    8: "#800080",  # Historical
    9: "#CCCCCC",  # Other
}

# این کاربری‌ها اجازه تغییر ندارند
LOCKED = {3, 4, 6, 7, 9}

def load_features():
    with open(DATA, "r", encoding="utf-8") as f:
        gj = json.load(f)
    return gj["features"]

def color_for(lu: int) -> str:
    return COLORS.get(int(lu), "#CCCCCC")

@router.post("/run")
def run_simulation(
    agent_id: int | None = Body(default=None),
    scenario_id: int | None = Body(default=None),
    steps: int = Body(default=5),
    seed: int | None = Body(default=42),
    map_name: str | None = Body(default="Feizabad"),
):
    """
    اجرای شبیه‌سازی: روی buildings.geojson اجرا می‌کند و
    یک HTML با انیمیشن زمانی + CSV لاگ تحویل می‌دهد.
    """
    if seed is not None:
        random.seed(seed)

    feats = load_features()

    # مطمئن شو Landuse به صورت عدد است
    for f in feats:
        try:
            f.setdefault("properties", {})
            f["properties"]["Landuse"] = int(f["properties"].get("Landuse", 9))
        except Exception:
            f["properties"]["Landuse"] = 9

    # لاگ
    log_rows = []
    # برای انیمیشن (FeatureCollection)
    anim_features = []

    # مرکز تقریبی فیض‌آباد (برای نقشه Folium)
    center_lat, center_lng = 34.3189, 47.0740

    # شبیه‌سازی چند قدمه
    for step in range(steps):
        for idx, f in enumerate(feats):
            props = f["properties"]
            lu_old = int(props.get("Landuse", 9))
            lu_new = lu_old
            action = "NoChange"

            if lu_old not in LOCKED:
                # قوانین ساده‌ی نمونه:
                # 1 → 2 (20%) ، 5 → 1 (30%) ، 2 → 1 (10%)
                r = random.random()
                if lu_old == 1 and r < 0.20:
                    lu_new = 2
                    action = "ChangeUse_to_Commercial"
                elif lu_old == 5 and r < 0.30:
                    lu_new = 1
                    action = "NewConstruction"
                elif lu_old == 2 and r < 0.10:
                    lu_new = 1
                    action = "Commercial_to_Residential"

            # به‌روزرسانی کاربری
            props["Landuse"] = lu_new

            log_rows.append({
                "step": step,
                "fid": idx,
                "old": lu_old,
                "new": lu_new,
                "action": action
            })

            # یک کپی برای فریم زمانی
            anim_feat = {
                "type": "Feature",
                "geometry": f["geometry"],
                "properties": {
                    "time": f"2025-01-01T00:00:{step:02d}Z",
                    "style": {
                        "color": "black",
                        "weight": 1,
                        "fillColor": color_for(lu_new),
                        "fillOpacity": 0.6,
                    },
                    "popup": f"ID:{idx}, Landuse:{lu_new}, Action:{action}, Step:{step}",
                },
            }
            anim_features.append(anim_feat)

    # ساخت نقشه Folium + لایه‌ی زمانی
    m = folium.Map(location=[center_lat, center_lng], zoom_start=14, tiles="cartodbdark_matter")

    TimestampedGeoJson(
        {"type": "FeatureCollection", "features": anim_features},
        transition_time=1000,
        loop=False,
        auto_play=True,
        add_last_point=True,
    ).add_to(m)

    m.save(OUT_HTML)

    # ذخیره CSV لاگ
    with open(OUT_LOG, "w", newline="", encoding="utf-8") as fcsv:
        w = csv.DictWriter(fcsv, fieldnames=["step", "fid", "old", "new", "action"])
        w.writeheader()
        w.writerows(log_rows)

    return JSONResponse({
        "status": "ok",
        "html_url": "/simulator/map"
    })

@router.get("/map")
def get_map_html():
    """
    سرو کردن فایل HTML انیمیشن.
    """
    return FileResponse(OUT_HTML, media_type="text/html")
