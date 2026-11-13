"""Server-side storage of API keys/settings in ai_test_generator/.env.

Secrets are NEVER returned in full: only a masked preview + a 'set' flag.
"""
import os
from typing import Dict, List

from dotenv import dotenv_values, set_key

from .config import ENV_PATH, reload_env

# (key, label, group, secret)
FIELDS: List[tuple] = [
    ("GEMINI_API_KEY", "API Key", "Gemini", True),
    ("GEMINI_MODEL", "Model name (enter the ID from Google AI Studio)", "Gemini", False),
    ("GROK_API_KEY", "API Key", "Grok (xAI)", True),
    ("GROK_MODEL", "Model ID (enter from your xAI console)", "Grok (xAI)", False),
    ("GROK_TIMEOUT", "Timeout in seconds (default 120)", "Grok (xAI)", False),
    ("GROQ_API_KEY", "API Key", "Groq", True),
    ("GROQ_MODEL", "Model ID (default llama-3.3-70b-versatile)", "Groq", False),
    ("GROQ_TIMEOUT", "Timeout in seconds (default 120)", "Groq", False),
    ("GROQ_MAX_TOKENS", "Max output tokens (default 8192)", "Groq", False),
    ("ANTHROPIC_API_KEY", "API Key", "Claude (Anthropic)", True),
    ("CLAUDE_MODEL", "Model ID (enter from Anthropic)", "Claude (Anthropic)", False),
    ("CLAUDE_TIMEOUT", "Timeout in seconds (default 120)", "Claude (Anthropic)", False),
    ("CLAUDE_MAX_TOKENS", "Max output tokens (default 8192)", "Claude (Anthropic)", False),
    ("OPENAI_API_KEY", "API Key (shared with Codex)", "OpenAI", True),
    ("OPENAI_MODEL", "Model ID (enter from OpenAI)", "OpenAI", False),
    ("OPENAI_TIMEOUT", "Timeout in seconds (default 120)", "OpenAI", False),
    ("CODEX_MODEL", "Codex model ID (optional; falls back to OPENAI_MODEL, then legacy gpt-5-mini)", "Codex (OpenAI)", False),
    ("OLLAMA_MODEL", "Ollama model (default gemma3:4b)", "Ollama", False),
    ("OLLAMA_HOST", "Ollama host (default http://localhost:11434)", "Ollama", False),
    ("OLLAMA_TIMEOUT", "Ollama timeout in seconds (default 300)", "Ollama", False),
    ("OLLAMA_NUM_CTX", "Ollama context window (default 8192)", "Ollama", False),
    ("JIRA_URL", "Base URL", "Jira", False),
    ("JIRA_EMAIL", "Email", "Jira", False),
    ("JIRA_API_TOKEN", "API Token", "Jira", True),
    ("QTEST_BASE_URL", "Base URL (…/api/v3/projects)", "qTest", False),
    ("QTEST_TOKEN", "Bearer Token", "qTest", True),
    ("QTEST_PROJECT_ID", "Project ID", "qTest", False),
    ("QTEST_REQUIREMENT_ID", "Default Requirement ID", "qTest", False),
    ("QTEST_PARENT_MODULE_ID", "Parent Module ID", "qTest", False),
    ("ZEPHYR_BASE_URL", "Base URL", "Zephyr Scale", False),
    ("ZEPHYR_API_KEY", "API Key", "Zephyr Scale", True),
]
KEYS = {f[0] for f in FIELDS}
SECRET_KEYS = {f[0] for f in FIELDS if f[3]}


def mask(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "•" * len(value)
    return value[:4] + "•" * 16 + value[-4:]


def _current() -> Dict[str, str]:
    file_vals = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}
    out = {}
    for key in KEYS:
        out[key] = (file_vals.get(key) or os.environ.get(key) or "").strip()
    return out


def get_settings() -> List[dict]:
    cur = _current()
    result = []
    for key, label, group, secret in FIELDS:
        val = cur.get(key, "")
        result.append({
            "key": key, "label": label, "group": group, "secret": secret,
            "is_set": bool(val),
            "value": mask(val) if secret else val,
        })
    return result


def update_settings(values: Dict[str, str]) -> List[str]:
    """Write provided keys into .env. Empty/None secret values mean 'leave unchanged'.
    Returns list of keys changed."""
    if not ENV_PATH.exists():
        ENV_PATH.touch()
    changed = []
    for key, val in (values or {}).items():
        if key not in KEYS or val is None:
            continue
        val = str(val).strip()
        if key in SECRET_KEYS and (val == "" or "•" in val):
            continue  # unchanged (masked placeholder or blank)
        set_key(str(ENV_PATH), key, val, quote_mode="never")
        os.environ[key] = val
        changed.append(key)
    reload_env()
    return changed


def clear_setting(key: str) -> bool:
    if key not in KEYS:
        return False
    if not ENV_PATH.exists():
        ENV_PATH.touch()
    set_key(str(ENV_PATH), key, "", quote_mode="never")
    os.environ[key] = ""
    return True


# --------------------------------------------------------------------------- #
# App (non-secret) settings - stored in backend/app_settings.json, NOT in .env
# --------------------------------------------------------------------------- #
import json as _json
from pathlib import Path as _Path

APP_SETTINGS_PATH = _Path(__file__).resolve().parent / "app_settings.json"
HISTORY_LIMIT_DEFAULT, HISTORY_LIMIT_MIN, HISTORY_LIMIT_MAX = 5, 1, 100


def _app() -> dict:
    """Non-secret app settings (history_limit, dup_threshold, token rates/limit) in SQLite."""
    try:
        from .db import load_app_settings
        return load_app_settings()
    except Exception:
        return {}


def get_history_limit() -> int:
    try:
        n = int(_app().get("history_limit", HISTORY_LIMIT_DEFAULT))
    except (TypeError, ValueError):
        return HISTORY_LIMIT_DEFAULT
    return n if HISTORY_LIMIT_MIN <= n <= HISTORY_LIMIT_MAX else HISTORY_LIMIT_DEFAULT


def set_history_limit(value) -> int:
    """Validate and store; raises ValueError with a user-facing message."""
    try:
        if isinstance(value, bool) or (isinstance(value, float) and not value.is_integer()):
            raise ValueError
        sval = str(value).strip()
        if not sval.lstrip("-").isdigit():
            raise ValueError
        n = int(sval)
    except (TypeError, ValueError):
        raise ValueError("Run history limit must be a whole number.")
    if not HISTORY_LIMIT_MIN <= n <= HISTORY_LIMIT_MAX:
        raise ValueError(f"Run history limit must be between {HISTORY_LIMIT_MIN} and {HISTORY_LIMIT_MAX}.")
    from .db import update_app_settings
    update_app_settings({"history_limit": n})
    return n


DUP_THRESHOLD_DEFAULT, DUP_THRESHOLD_MIN, DUP_THRESHOLD_MAX = 80, 50, 99


def get_dup_threshold() -> int:
    try:
        n = int(_app().get("dup_threshold", DUP_THRESHOLD_DEFAULT))
    except (TypeError, ValueError):
        return DUP_THRESHOLD_DEFAULT
    return n if DUP_THRESHOLD_MIN <= n <= DUP_THRESHOLD_MAX else DUP_THRESHOLD_DEFAULT


def set_dup_threshold(value) -> int:
    try:
        if isinstance(value, bool) or (isinstance(value, float) and not value.is_integer()):
            raise ValueError
        n = int(str(value).strip())
    except (TypeError, ValueError):
        raise ValueError(f"Duplicate threshold must be a whole number between {DUP_THRESHOLD_MIN} and {DUP_THRESHOLD_MAX}.")
    if not DUP_THRESHOLD_MIN <= n <= DUP_THRESHOLD_MAX:
        raise ValueError(f"Duplicate threshold must be a whole number between {DUP_THRESHOLD_MIN} and {DUP_THRESHOLD_MAX}.")
    from .db import update_app_settings
    update_app_settings({"dup_threshold": n})
    return n
