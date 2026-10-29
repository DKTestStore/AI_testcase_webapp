"""Very small per-browser-session 'current run' store (in memory + JSON file).

No usernames/passwords: the Welcome button just creates a session id cookie.
Intended for a single local user; not hardened for multi-user deployment.
"""
import json
import threading
import time
import uuid
from typing import Any, Dict, Optional

from .config import SESSIONS_DIR

_LOCK = threading.Lock()
_SESSIONS: Dict[str, Dict[str, Any]] = {}


def _new_run() -> Dict[str, Any]:
    return {
        "run_id": uuid.uuid4().hex[:10],
        "created": time.strftime("%Y-%m-%d %H:%M:%S"),
        # Input
        "source": None,            # "jira" | "local"
        "story_id": "",
        "jira": None,              # summary/status/message/AC/scenarios/brd_links (no screenshots)
        "local_filename": "",
        "feature_text": "",        # what will be sent to the generator
        # Generate
        "model": "gemini",
        "prompt_mode": "default",  # "default" | "custom"
        "custom_prompt": "",
        "run_reviewer": False,
        "last_usage": None,
        "markdown": "",            # raw generator output
        # Review
        "test_cases": [],          # [{id,name,description,precondition,steps:[{description,expected}]}]
        "review": None,            # {markdown, test_cases, usage}
        "dirty": False,            # edits not yet saved to Excel
        "excel_path": "",
        # qTest
        "upload": None,            # summary of last upload
        "rtm": [],                 # RTM rows
        "ac_list": [],
    }


def _path(sid: str):
    return SESSIONS_DIR / f"{sid}.json"


def create() -> str:
    sid = uuid.uuid4().hex
    with _LOCK:
        _SESSIONS[sid] = {"sid": sid, "run": _new_run()}
        _save(sid)
    return sid


def get(sid: Optional[str]) -> Optional[Dict[str, Any]]:
    if not sid or not sid.isalnum():
        return None
    with _LOCK:
        if sid in _SESSIONS:
            return _SESSIONS[sid]
        p = _path(sid)
        if p.exists():
            try:
                _SESSIONS[sid] = json.loads(p.read_text(encoding="utf-8"))
                return _SESSIONS[sid]
            except Exception:
                return None
    return None


def save(sid: str) -> None:
    with _LOCK:
        _save(sid)


def _save(sid: str) -> None:
    data = _SESSIONS.get(sid)
    if data is not None:
        _path(sid).write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


def reset_run(sid: str) -> Dict[str, Any]:
    with _LOCK:
        _SESSIONS[sid]["run"] = _new_run()
        _save(sid)
        return _SESSIONS[sid]["run"]


def delete(sid: str) -> None:
    with _LOCK:
        _SESSIONS.pop(sid, None)
        p = _path(sid)
        if p.exists():
            p.unlink()
