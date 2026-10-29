import json
from pathlib import Path
from .config import SESSIONS_DIR

def session_path(sid: str) -> Path:
    return SESSIONS_DIR / f"{sid}.json"

def load_session(sid: str) -> dict:
    p = session_path(sid)
    if not p.exists():
        return {}
    return json.loads(p.read_text())

def save_session(sid: str, data: dict):
    session_path(sid).write_text(json.dumps(data, indent=2))
