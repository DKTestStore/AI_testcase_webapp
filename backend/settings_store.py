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
    ("GEMINI_MODEL", "Model name (e.g. gemini-2.5-pro)", "Gemini", False),
    ("OPENAI_API_KEY", "OpenAI API Key (Codex option)", "Codex / OpenAI", True),
    ("OLLAMA_MODEL", "Ollama model (default gemma3:4b)", "Ollama", False),
    ("OLLAMA_HOST", "Ollama host (default http://localhost:11434)", "Ollama", False),
    ("JIRA_URL", "Base URL", "Jira", False),
    ("JIRA_EMAIL", "Email", "Jira", False),
    ("JIRA_API_TOKEN", "API Token", "Jira", True),
    ("QTEST_BASE_URL", "Base URL (…/api/v3/projects)", "qTest", False),
    ("QTEST_TOKEN", "Bearer Token", "qTest", True),
    ("QTEST_PROJECT_ID", "Project ID", "qTest", False),
    ("QTEST_REQUIREMENT_ID", "Default Requirement ID", "qTest", False),
    ("QTEST_PARENT_MODULE_ID", "Parent Module ID", "qTest", False),
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
