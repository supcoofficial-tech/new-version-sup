from fastapi import APIRouter

router = APIRouter()

@router.get("/")
def get_agents():
    return [
        {"id": 1, "name": "Building Agent"},
        {"id": 2, "name": "Traffic Agent"},
    ]
