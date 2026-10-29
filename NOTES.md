# Build notes — untested / assumptions / known gaps

**Nothing in this package has been executed** — no server start, no tests, no imports,
no `pip install`. Everything below was derived from reading the source code only.
Please run it locally and expect to fix small issues on first start.

## Stack (from the code)

- Python 3, Flask
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
python -m backend.app
```

Then open http://127.0.0.1:5000 (or whatever port `backend/app.py` binds).

## Known gaps / things to verify

1. **Environment variables** — `.env.example` lists names only. Confirm exact variable
   names match what the code reads (check `backend/config.py` and the ai_helpers).
2. **Session storage** — `backend/sessions/` is gitignored. The app creates it at runtime;
   make sure the process has write permission there.
3. **Reports** — `ai_test_generator/reports/` is gitignored except `.gitkeep`. Generated
   test cases land there; confirm the path in `qtest_paths.py` / the pipeline.
4. **Frontend paths** — static files are under `frontend/`. Confirm Flask is configured
   to serve them (check `app.py` for `static_folder` / route definitions).
5. **CORS / same-origin** — if the frontend is served by Flask itself, no CORS issues.
   If you later split them, you'll need CORS headers.
6. **Auth** — no authentication layer is present in the current code. Do not expose this
   publicly without adding one.
7. **Large JS** — `frontend/js/app.js` is the main client. It talks to backend endpoints;
   verify the API contract matches `backend/app.py` routes.
