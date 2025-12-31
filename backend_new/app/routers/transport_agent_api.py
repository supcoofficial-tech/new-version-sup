# backend/app/routers/transport_agent_api.py
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, FileResponse
import os, sys, json, subprocess

router = APIRouter(prefix="/transport", tags=["Transport (Minimal)"])

# مسیرها مثل main.py محاسبه می‌شن، اما اینجا مستقل تا وابستگی نداشته باشیم
BASE_DIR = os.path.dirname(os.path.dirname(__file__))          # backend/app
SRC_DIR  = os.path.join(BASE_DIR, "src")                       # backend/app/src
DATA_DIR = os.path.join(BASE_DIR, "data")                      # backend/app/data
OUT_DIR  = os.path.join(BASE_DIR, "output")                    # backend/app/output

# نام‌های پیش‌فرض فایل خروجی در اسکریپت‌ها
ROUTES_OUT_CANDIDATES = [
    "routes_final.geojson",
    "routes.geojson",
    "routes_output.geojson",
]

def _run_py(script_name: str, *args: str) -> None:
    """
    اجرای اسکریپت با مفسر فعلی پایتون (بدون چاپ بی‌رویه در لاگ).
    خطا را به Exception تبدیل می‌کند تا به HTTP 400/500 تبدیل شود.
    """
    script_path = os.path.join(SRC_DIR, script_name)
    if not os.path.exists(script_path):
        raise FileNotFoundError(f"Script not found: {script_path}")

    os.makedirs(OUT_DIR, exist_ok=True)
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}

    proc = subprocess.run(
        [sys.executable, script_path, *args],
        cwd=BASE_DIR,                 # اجرا از backend/app
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"Python script failed ({script_name})\n"
            f"STDOUT:\n{proc.stdout}\n\nSTDERR:\n{proc.stderr}"
        )

def _read_geojson_file(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def _find_routes_output_path() -> str | None:
    for name in ROUTES_OUT_CANDIDATES:
        p = os.path.join(OUT_DIR, name)
        if os.path.exists(p):
            return p
    return None

@router.get("/compute-default")
def compute_default():
    """
    نسخه‌ی نمایشی «فقط نمایش»: هیچ ورودی از کلاینت نمی‌گیرد.
    - فرض: make_feature_collections.py و simulate_agent.py در backend/app/src موجودند.
    - داده‌های ورودی در backend/app/data قرار دارند (درصورت نیاز توسط make_... خوانده/ساخته می‌شوند).
    - خروجی مسیرها در backend/app/output نوشته می‌شود (routes_final.geojson یا مشابه).
    """
    try:
        # 1) (اختیاری) اگر اسکریپت آماده‌سازی داده لازم داری، این را باز بگذار:
        make_script = os.path.join(SRC_DIR, "make_feature_collections.py")
        if os.path.exists(make_script):
            _run_py("make_feature_collections.py")

        # 2) محاسبه‌ی مسیرها با اسکریپت شبیه‌سازی
        _run_py("simulate_agent.py")

        # 3) پیدا کردن خروجی
        out_path = _find_routes_output_path()
        if not out_path:
            raise FileNotFoundError(
                f"No routes output file found in {OUT_DIR}. "
                f"Tried: {', '.join(ROUTES_OUT_CANDIDATES)}"
            )

        routes_fc = _read_geojson_file(out_path)

        # سازگاری با فرانت: { routes_final: FeatureCollection, meta: {...} }
        meta = {
            "source": "simulate_agent.py",
            "output_file": os.path.basename(out_path),
        }
        return JSONResponse({"routes_final": routes_fc, "meta": meta})

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        # خطای اجرای اسکریپت
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/routes-file")
def routes_file():
    """
    فایل خام خروجی (GeoJSON) را مستقیم برمی‌گرداند (برای دیباگ یا استفاده‌ی دیگر).
    """
    out_path = _find_routes_output_path()
    if not out_path:
        raise HTTPException(status_code=404, detail="Routes output file not found")
    return FileResponse(out_path, media_type="application/geo+json")
