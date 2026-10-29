# AI TestCase Generator — Web App

A FastAPI + static HTML/CSS/JS web UI built on the existing `ai_test_generator`
code. It takes you through **Welcome → Input → Generate → Review → qTest (Upload + RTM)**,
with **Settings** and **Logout** available at any point.

```
webapp/
├── ai_test_generator/        # your existing code (copied; 2 small bug fixes, see NOTES.md)
│   ├── .env.example          # copy to .env (or fill keys from the Settings screen)
│   ├── ai_helpers/  prompt/  qtest_utils/  worker/  test_runner/  input/
│   └── reports/              # outputs: Excel per run in reports/runs/<run_id>/, usage + payload JSON
├── backend/
│   ├── app.py                # FastAPI routes + page serving
│   ├── services.py           # thin wrappers around the existing functions (return errors to the UI)
│   ├── parsing.py            # markdown ⇄ 6-column table, AC splitting, TC→AC mapping for RTM
│   ├── settings_store.py     # read/write .env, masks secrets
│   ├── session_store.py      # per-browser "current run" state (memory + backend/sessions/*.json)
│   └── config.py             # paths, .env loading, sys.path
├── frontend/
│   ├── welcome.html          # 3D welcome page (0e_welcome_3d_bots design) – Welcome button starts a session
│   ├── app.html              # app shell: sidebar with step progress, top bar, modals
│   ├── css/app.css           # theme reused from the mockups
│   └── js/app.js, js/welcome.js
├── requirements.txt
├── README.md
└── NOTES.md                  # assumptions, untested areas, known gaps
```

## Setup & run (Windows / macOS / Linux)

Run these from the `webapp/` folder (the one containing `backend/` and `frontend/`).

```bash
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt

# configuration: copy the example env file (or fill values later from Settings)
# Windows:      copy ai_test_generator\.env.example ai_test_generator\.env
# macOS/Linux:  cp ai_test_generator/.env.example ai_test_generator/.env

uvicorn backend.app:app --reload
```

Then open **http://localhost:8000** and click **Welcome →**.

> Python 3.10+ is required (the existing `jira_worker.py` uses `str | None` type syntax).

### Minimum configuration
| Feature | Keys |
|---|---|
| Generate with Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` (e.g. `gemini-2.5-pro`) |
| Generate with Codex | `OPENAI_API_KEY` (model is `MODEL` in `test_generator_codex.py`) |
| Generate with Ollama | running `ollama serve`, `OLLAMA_MODEL` (default `gemma3:4b`), optional `OLLAMA_HOST` |
| Jira fetch | `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` |
| qTest upload | `QTEST_BASE_URL` (e.g. `https://<site>.qtestnet.com/api/v3/projects`), `QTEST_TOKEN` (e.g. `Bearer xxxx`), `QTEST_PROJECT_ID`; optional `QTEST_REQUIREMENT_ID`, `QTEST_PARENT_MODULE_ID` |

All of these can be entered on the **Settings** screen; they are written to
`ai_test_generator/.env` on the server and secrets are only ever shown masked.

## Flow
1. **Welcome** – no username/password; the button creates a session cookie.
2. **Input** – *Jira Story*: enter a Story ID → **Fetch** (`pull_jira_story` + `analyze_story`); the extracted
   Scenarios / Acceptance Criteria are shown and editable. *Local text*: paste text or drop a `.txt` file → **Use this description**.
3. **Generate** – pick Gemini / Codex / Ollama, choose **Default prompt** (read-only `test_cases_generator_prompt.md`)
   or **Custom prompt** (load from file, save as template, reset to default), optionally **Also run AI Reviewer**.
   Token usage card reads `reports/gemini_usage.json`.
4. **Review** – editable 6-column table (Test case Id, Name, Description, Precondition, Step Description, Expected Result);
   add/delete steps and test cases; **Run AI Reviewer** (apply or dismiss its version); **Save & Download Excel** (`save_to_excel`).
5. **qTest** – *Upload*: project / requirement / module (new or existing), **Preview payload**, **Confirm Upload**
   (`create_module_for_test_design` → `qtest_create_testcase` → `collect_testcase_ids` → link to requirement), results summary.
   *RTM*: Story → AC → TC → qTest IDs, upload + link status, search/filter, AC mapping dropdowns, **Export RTM (Excel)**, **Retry failed**.
6. **Logout** – confirm dialog that warns about unsaved edits / not-uploaded test cases, then returns to Welcome.

The **Next** button and sidebar steps unlock only when the previous step has data. **＋ New run** clears the current run.

## Original CLI pipeline
`python -m ai_test_generator.test_runner.main_pipeline` still works as before (run from `webapp/`).
