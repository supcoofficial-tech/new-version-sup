# backend/app/main.py
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import sys, os, subprocess

# بخش‌های خودت
from app.routers import weather
from app.features import heat_layer, flood_layer, fire_layer,merge_layer ,quake_router
from app.features import transport_agent_api

# ──────────────────────────────────────────────
# تنظیمات پایه
# ──────────────────────────────────────────────
app = FastAPI(title="Climate Resilience + Simulator API", version="1.0.0")

# روترها
app.include_router(weather.router)
app.include_router(heat_layer.router)
app.include_router(flood_layer.router)
app.include_router(fire_layer.router)
app.include_router(merge_layer.router)  # ← /api/merge (محاسباتی و قابل‌تنظیم)
app.include_router(quake_router.router)
app.include_router(transport_agent_api.router)
# مسیرهای پایه
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE_DIR, "src")
OUT_DIR = os.path.join(BASE_DIR, "output")
DATA_DIR = os.path.join(BASE_DIR, "data")

os.environ.setdefault("PYTHONUNBUFFERED", "1")

# ──────────────────────────────────────────────
# فعال‌سازی CORS برای ارتباط با فرانت‌اند
# ──────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # در نسخه‌ نهایی بهتره دامنه‌ رو محدود کنی
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────
# تابع اجرای اسکریپت‌ها (با مفسر درست)
# ──────────────────────────────────────────────
def run_script(script_name: str) -> Optional[str]:
    script_path = os.path.join(SRC_DIR, script_name)
    if not os.path.exists(script_path):
        return f"Script not found: {script_path}"

    os.makedirs(OUT_DIR, exist_ok=True)
    try:
        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        subprocess.run(
            [sys.executable, script_path],
            cwd=BASE_DIR,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
        )
        return None
    except subprocess.CalledProcessError as e:
        return (
            f"Python script failed (code {e.returncode}):\n"
            f"STDOUT:\n{e.stdout}\n\nSTDERR:\n{e.stderr}"
        )

# ──────────────────────────────────────────────
# تابع بازگردانی امن فایل خروجی
# ──────────────────────────────────────────────
def safe_file_response(path: str):
    if os.path.exists(path):
        return FileResponse(path, media_type="application/json")
    return JSONResponse({"error": f"Output file not found: {os.path.basename(path)}"}, status_code=404)

# ──────────────────────────────────────────────
# روت‌های عمومی
# ──────────────────────────────────────────────
@app.get("/")
def root():
    return {"message": "Climate Resilience + Simulator API is running 🚀"}

@app.get("/health")
def health():
    return {"status": "ok"}

# ──────────────────────────────────────────────
# APIهای تحلیل اقلیمی — الگوی Run/File (بدون تداخل مسیر)
# ──────────────────────────────────────────────

# Flood
@app.get("/api/flood-risk/run")
def api_flood_risk_run():
    err = run_script("flood_risk_simple.py")
    if err:
        return JSONResponse({"error": err}, status_code=500)
    return safe_file_response(os.path.join(OUT_DIR, "parcel_flood_risk.geojson"))

@app.get("/api/flood-risk/file")
def api_flood_risk_file():
    return safe_file_response(os.path.join(OUT_DIR, "parcel_flood_risk.geojson"))

# Heat
@app.get("/api/heat-risk/run")
def api_heat_risk_run():
    err = run_script("heat_from_api_plus_veg.py")
    if err:
        return JSONResponse({"error": err}, status_code=500)
    # تلاش برای چند نام خروجی ممکن
    for name in ["parcel_heat_risk.geojson", "parcel_heat_from_api.geojson"]:
        fp = os.path.join(OUT_DIR, name)
        if os.path.exists(fp):
            return safe_file_response(fp)
    return JSONResponse({"error": "No heat output file found"}, status_code=404)

@app.get("/api/heat-risk/file")
def api_heat_risk_file():
    for name in ["parcel_heat_risk.geojson", "parcel_heat_from_api.geojson"]:
        fp = os.path.join(OUT_DIR, name)
        if os.path.exists(fp):
            return safe_file_response(fp)
    return JSONResponse({"error": "No heat output file found"}, status_code=404)

# Quake (اگر بعداً اسکریپت داری، مشابه بقیه run هم اضافه کن)
@app.get("/api/quake-risk/file")
def api_quake_risk_file():
    return safe_file_response(os.path.join(OUT_DIR, "parcel_quake_risk.geojson"))

# Fire (اگر اسکریپت داری، مشابه بقیه run هم اضافه کن)
@app.get("/api/fire-risk/file")
def api_fire_risk_file():
    return safe_file_response(os.path.join(OUT_DIR, "parcel_fire_prob.geojson"))

# Merge:
# - /api/merge  ← از merge_layer.router (محاسبات درجا و پارامتریک)
# - /api/merge/run  ← اجرای اسکریپت آفلاین و سِرو خروجی
# - /api/merge/file ← سِرو فایل موجود
@app.get("/api/merge/run")
def api_merge_run():
    err = run_script("vulnerability_index.py")
    if err:
        return JSONResponse({"error": err}, status_code=500)
    return safe_file_response(os.path.join(OUT_DIR, "parcel_vulnerability.geojson"))

@app.get("/api/merge/file")
def api_merge_file():
    return safe_file_response(os.path.join(OUT_DIR, "parcel_vulnerability.geojson"))

# ──────────────────────────────────────────────
# داده‌های ایجنت و سناریوها (بدون تغییر)
# ──────────────────────────────────────────────
scenarios = [
    {"id": 1, "name": "تخریب ساختمان‌ها"},
    {"id": 2, "name": "توسعه عمودی (ساخت برج‌ها)"},
    {"id": 3, "name": "تغییر کاربری زمین"},
]

agents = [
    {"id": 1, "name": "زمین"},
    {"id": 2, "name": "ساختمان"},
]

class SimulationRequest(BaseModel):
    agent_id: int
    scenario_id: int
    steps: int
    seed: int
    map_name: str

# شبیه‌سازی
@app.get("/agents/")
def get_agents():
    return agents

@app.get("/scenarios/")
def get_scenarios():
    return scenarios

@app.post("/simulator/run")
def run_simulation(simulation_request: SimulationRequest):
    agent = next((a for a in agents if a["id"] == simulation_request.agent_id), None)
    scenario = next((s for s in scenarios if s["id"] == simulation_request.scenario_id), None)

    if agent is None or scenario is None:
        return JSONResponse({"detail": "Agent or Scenario not found"}, status_code=404)

    if scenario["id"] == 1:
        result = {"scenario": scenario["name"], "description": "ساختمان‌ها در نقشه حذف می‌شوند.", "html_url": "/simulator/map/demolish"}
    elif scenario["id"] == 2:
        result = {"scenario": scenario["name"], "description": "ارتفاع ساختمان‌ها افزایش می‌یابد.", "html_url": "/simulator/map/vertical_growth"}
    elif scenario["id"] == 3:
        result = {"scenario": scenario["name"], "description": "کاربری زمین‌ها تغییر می‌کند.", "html_url": "/simulator/map/landuse_change"}
    else:
        result = {"scenario": scenario["name"], "description": "یک سناریوی عمومی است.", "html_url": "/simulator/map"}

    return result

@app.get("/simulator/map/demolish")
def demolish_map():
    return {"message": "Map for demolish scenario"}

@app.get("/simulator/map/vertical_growth")
def vertical_growth_map():
    return {"message": "Map for vertical growth scenario"}

@app.get("/simulator/map/landuse_change")
def landuse_change_map():
    return {"message": "Map for land use change scenario"}

# ──────────────────────────────────────────────
# لیست و سرو فایل‌های GeoJSON خروجی
# ──────────────────────────────────────────────
@app.get("/api/files")
def list_outputs() -> List[str]:
    if not os.path.exists(OUT_DIR):
        return []
    return sorted([f for f in os.listdir(OUT_DIR) if f.lower().endswith(".geojson")])

@app.get("/api/files/{name}")
def get_output_file(name: str):
    safe_name = os.path.basename(name)
    return safe_file_response(os.path.join(OUT_DIR, safe_name))
