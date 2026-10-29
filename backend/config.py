from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
SESSIONS_DIR = BASE_DIR / "backend" / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)

# AI keys
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

# Jira / qTest
JIRA_URL = os.getenv("JIRA_URL", "")
JIRA_TOKEN = os.getenv("JIRA_TOKEN", "")
QTEST_URL = os.getenv("QTEST_URL", "")
QTEST_TOKEN = os.getenv("QTEST_TOKEN", "")
