import json
from pathlib import Path
from .config import BASE_DIR

SETTINGS_FILE = BASE_DIR / "backend" / "settings.json"

def load_settings() -> dict:
    if not SETTINGS_FILE.exists():
        return {}
    return json.loads(SETTINGS_FILE.read_text())

def save_settings(data: dict):
    SETTINGS_FILE.write_text(json.dumps(data, indent=2))
