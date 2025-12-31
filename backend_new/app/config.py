import os
from functools import lru_cache

class Settings:
    OPENWEATHER_API_KEY: str = os.getenv("OPENWEATHER_API_KEY", "")

@lru_cache()
def get_settings():
    return Settings()
