# Build notes — untested / assumptions / known gaps

**Nothing in this package has been executed** — no server start, no tests, no imports,
no `pip install`. Everything below was derived from reading the source code only.
Please run it locally and expect to fix small issues on first start.

## Stack (from the code)

- Python 3, FastAPI + Uvicorn
- Frontend: plain HTML/CSS/JS (no build step, no framework)
- AI backends referenced: Gemini, OpenAI/Codex-style, Ollama (local)
- Integrations: Jira, qTest

## How to start (expected)

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ai_test_generator/.env.example ai_test_generator/.env
# fill in keys
uvicorn backend.app:app --reload
```

Then open http://127.0.0.1:8000

## Known gaps / things to verify

1. **Environment variables** — `.env.example` lists names only. Confirm exact variable
   names match what the code reads.
2. **Session storage** — `backend/sessions/` is gitignored. The app creates it at runtime.
3. **Reports** — `ai_test_generator/reports/` is gitignored except `.gitkeep`.
4. **Frontend paths** — static files are under `frontend/`. Confirm the static mount in the FastAPI app.
5. **Auth** — no authentication layer is present. Do not expose publicly without adding one.
