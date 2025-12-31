from fastapi import APIRouter
from app.Simulator.morphology import run_morphology

router = APIRouter()

@router.post("/morphology")
def simulate_morphology():
    """
    اجرای سناریوی مورفولوژی و برگردوندن خروجی
    """
    output_path = run_morphology()
    return {"message": "Morphology simulation finished ✅", "output": output_path}
