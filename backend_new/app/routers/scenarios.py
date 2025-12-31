from fastapi import APIRouter

router = APIRouter()

@router.get("/")
def get_scenarios():
    return [
        {"id": 1, "name": "تحلیل و آنالیز"},
        {"id": 2, "name": "مورفولوژی"},
    ]
