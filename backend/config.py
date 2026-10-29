"""Paths and environment handling shared by the backend."""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent          # /webapp
PKG_DIR = ROOT_DIR / "ai_test_generator"                    # existing project
ENV_PATH = PKG_DIR / ".env"
ENV_EXAMPLE_PATH = PKG_DIR / ".env.example"
PROMPT_DIR = PKG_DIR / "prompt"
GENERATOR_PROMPT_FILE = PROMPT_DIR / "test_cases_generator_prompt.md"
REVIEWER_PROMPT_FILE = PROMPT_DIR / "test_cases_reviewer_prompt.md"
REPORTS_DIR = PKG_DIR / "reports"
RUNS_DIR = REPORTS_DIR / "runs"
GEMINI_USAGE_FILE = REPORTS_DIR / "gemini_usage.json"
SESSIONS_DIR = Path(__file__).resolve().parent / "sessions"
FRONTEND_DIR = ROOT_DIR / "frontend"

# Make "import ai_test_generator...." work no matter where uvicorn is started.
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def reload_env() -> None:
    """(Re)load ai_test_generator/.env into os.environ (override=True so Settings changes apply)."""
    if ENV_PATH.exists():
        load_dotenv(ENV_PATH, override=True)


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


for _d in (REPORTS_DIR, RUNS_DIR, SESSIONS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

reload_env()
