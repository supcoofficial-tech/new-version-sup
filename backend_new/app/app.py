from fastapi import FastAPI
from pydantic import BaseModel
import random
import json

app = FastAPI()

# داده‌های فرضی برای سناریوها
scenarios = [
    {"id": 1, "name": "تخریب ساختمان‌ها"},
    {"id": 2, "name": "توسعه عمودی (ساخت برج‌ها)"},
    {"id": 3, "name": "تغییر کاربری زمین"}
]

# کلاس برای درخواست شبیه‌سازی
class SimulationRequest(BaseModel):
    agent_id: int
    scenario_id: int
    steps: int
    seed: int
    map_name: str

# API برای گرفتن سناریوها
@app.get("/scenarios/")
def get_scenarios():
    return scenarios

# API برای اجرای شبیه‌سازی
@app.post("/simulator/run")
def run_simulation(request: SimulationRequest):
    scenario = next(s for s in scenarios if s["id"] == request.scenario_id)
    
    # اعمال سناریو
    simulation_result = {
        "scenario": scenario["name"],
        "html_url": "/simulator/map"  # یک URL فرضی که برای نمایش نقشه تغییرات استفاده می‌شود
    }
    
    return simulation_result
