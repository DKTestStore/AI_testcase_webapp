# AI TestCase Generator — Web App

An AI-assisted manual test case generator. Turn a **Jira story** (or pasted / uploaded requirements) into structured test cases with a configurable AI provider, review and edit them, store them in a **Test Case Repo**, run them in **Test Runs**, link them to a **Requirement Repo**, export **Excel**, and upload to **qTest Manager** with RTM.

- **Backend:** FastAPI (`backend/`), wrapping the existing `ai_test_generator` package.
- **Frontend:** static HTML/CSS/vanilla JS (`frontend/`) served by FastAPI — **no build step**.
- **Sidebar icons:** [Lucide](https://lucide.dev) (ISC) inline SVG sprite in `frontend/app.html` (`stroke="currentColor"`). Workflow steps 1–4 keep numbered circles. See `THIRD_PARTY_NOTICES.md`.

---

## Table of contents

1. [Tech stack](#tech-stack)
2. [Setup (Windows / macOS / Linux)](#1-setup)
3. [Configuration (`.env`)](#configuration-keys-ai_test_generatorenv)
4. [Features overview](#features-overview)
5. [Workflow (Input → qTest)](#2-workflow)
6. [Run history](#3-run-history)
7. [Setup checklist, Settings, logs](#4-setup-checklist-settings-logs)
8. [Project structure & data files](#5-project-structure--data-files)
9. [API overview](#api-overview)
10. [Test Case Repo & Test Runs](#test-case-repo--test-runs)
11. [Projects & Requirement Repo](#projects--requirement-repo)
12. [Dashboard](#dashboard)
13. [Prompt templates](#prompt-templates-multi-select)
14. [Review tools](#review-tools-export-edit-mode-traceability-matrix-type-tags-version-history-quality-score)
15. [Record (Playwright)](#record-feature--record-on-the-input-step--extra-setup)
16. [Troubleshooting](#troubleshooting)
17. [Testing notes](#6-testing-notes)
18. [Original CLI](#original-cli-pipeline)

---

## Tech stack

| Layer | Technology | Used for |
|---|---|---|
| Backend | Python 3.10+, FastAPI, Uvicorn | REST API (`/api/...`) and serving the frontend |
| Config | python-dotenv (`ai_test_generator/.env`) | API keys and settings (never commit `.env`) |
| AI / LLM | Gemini (`google-genai`), Grok/xAI, Claude (Anthropic Messages via `requests`), OpenAI / Codex (`openai`), Ollama | Generation / review / regenerate; provider chosen on Generate; keys + model IDs on Settings |
| Integrations | Jira (`jira` + FastMCP worker), qTest (REST via `requests`) | Story fetch; module / test-case upload + RTM |
| Record | Playwright (Chromium) | Capture browser actions as test steps |
| Data | JSON files on disk | Sessions, history, repo, runs, requirements (no SQL DB yet) |
| Import / Export | pandas, openpyxl | Excel (.xlsx) / CSV; one row per step |
| Frontend | Plain HTML, CSS, JavaScript | `frontend/app.html`, hash routing, feature modules |
| Charts | Custom SVG donut / bar | Dashboard; preferences in `localStorage` |
| Icons | Lucide (ISC), inline SVG | Sidebar nav (except step numbers 1–4) |
| Caching | `?v=N` on static assets | Cache-bust after frontend changes (currently `v=34`) |

**Planned (not built yet):** SQLAlchemy + Alembic, object storage for attachments, hosted deploy. **Zephyr Scale Cloud upload is not implemented** (Projects may store an optional `zephyr_project_key` mapping field only).

---

## 1. Setup

**Requirements:** Python **3.10+**, pip. Dependencies: `requirements.txt`.

```bash
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt

# configuration (or fill later on the Settings page)
# Windows:      copy ai_test_generator\.env.example ai_test_generator\.env
# macOS/Linux:  cp ai_test_generator/.env.example ai_test_generator/.env

# run from the repo root (folder that contains backend/ and frontend/)
python -m uvicorn backend.app:app --port 8000
# while developing you can add:  --reload
```

Open **http://localhost:8000** → **Welcome →**. No username/password; that starts a browser session cookie.

### Record feature (⏺ Record on the Input step) — extra setup

The recorder opens a **real Chromium window on the machine that runs the app**. Install the browser once:

```bash
pip install playwright                 # already in requirements.txt
python -m playwright install chromium  # Chromium + ffmpeg for evidence video
```

- **Windows / macOS:** visible window; falls back to installed Chrome/Edge if Playwright Chromium is missing.
- **Linux:** needs `DISPLAY` / `WAYLAND_DISPLAY`. Headless-only hosts cannot interact with Record. `ATG_REC_HEADLESS=1` forces headless (CI). `ATG_REC_CHROME=<path>` selects a Chrome executable.

### Configuration keys (`ai_test_generator/.env`)

Copy from `.env.example`. **Never commit `.env`**. Secrets are masked in the Settings UI.

| Feature | Keys |
|---|---|
| Gemini (default) | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| Grok (xAI) | `GROK_API_KEY`, `GROK_MODEL`, optional `GROK_TIMEOUT` (default 120) |
| Claude (Anthropic) | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, optional `CLAUDE_TIMEOUT` (120), `CLAUDE_MAX_TOKENS` (8192) |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL`, optional `OPENAI_TIMEOUT` (120) |
| Codex (OpenAI family) | Uses `OPENAI_API_KEY`. Optional `CODEX_MODEL` (falls back to `OPENAI_MODEL`, then legacy `gpt-5-mini`) |
| Ollama (local) | `OLLAMA_MODEL` (default `gemma3:4b`), `OLLAMA_HOST` (`http://localhost:11434`), `OLLAMA_TIMEOUT` (default **300**), `OLLAMA_NUM_CTX` (8192) |
| Jira | `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` |
| qTest | `QTEST_BASE_URL`, `QTEST_TOKEN` (`Bearer …`), `QTEST_PROJECT_ID`; optional `QTEST_REQUIREMENT_ID`, `QTEST_PARENT_MODULE_ID` |
| Zephyr Scale | `ZEPHYR_BASE_URL`, `ZEPHYR_API_KEY` (Settings only — **upload is not implemented yet**) |
| Original CLI only | `ENABLE_JIRA_REQURIMENT`, `STORY_ID` |

Model IDs are free-text — enter the exact ID from each provider console. Do not treat example names as guaranteed current IDs.

Non-secret app settings (e.g. history limit) live in `backend/app_settings.json`, not `.env`.

---

## Features overview

| Area | What you get |
|---|---|
| Multi-provider AI | Gemini, Grok, Claude, OpenAI, Codex, Ollama — choose on **Generate**; configure on **Settings → AI Providers** |
| Settings UI | Tabs: **AI Providers** / **Integrations** (Jira, qTest, Zephyr Scale) / **Preferences** (history limit, duplicate threshold) |
| Projects + Requirement Repo | Project switcher; Requirements (REQ-####) with create / edit / duplicate / archive / permanent-delete; folder tree (new / rename / subfolder / delete with move); Jira import; link/unlink cases; auto-link by `case.story`; Generate-from-requirement; traceability matrix |
| Test Case Repo | Folders, versions, AI review, import/export, case drawer/full page |
| Test Runs | Cycles, step execution, attachments, results history |
| Dashboard | Totals **exclude Archived** cases; charts; cycle / story filters |
| Token usage | Per-provider usage tracking (Gemini local quota card remains Gemini-specific) |
| Prompt templates | Multi-select templates; Custom prompt overrides |
| Record | Playwright capture → steps |
| Jira / qTest | Story fetch; upload + RTM (Excel export, retry failed) |
| Lucide sidebar icons | Professional line icons; order unchanged |

---

## 2. Workflow

The sidebar shows the four steps with progress. A step unlocks once the previous one has data. Each step page can show the **Ticket / Story ID** pill. The sidebar footer shows run id / story / case count.

1. **Input:** *Jira Story* (fetch), *Local text*, or *Upload Excel* (skips Generate). Optional **Record**.
2. **Generate:** pick **Provider** + Default / Custom prompt (or templates from Input). Optional AI Reviewer. Token usage card.
3. **Review:** edit, map ACs, save Excel; **Save to Test Case Repo** / **Execute now**.
4. **qTest Upload:** Preview payload → Confirm Upload; **RTM** tab for Story → AC → TC → qTest IDs.

**＋ New run** starts fresh (previous run stays in history). **Log out** clears only the session.

### Review UI (summary)

Inline edits, priority / AC tags, reorder, review status, pagination, AI Reviewer apply/dismiss, unsaved-edit guard. See also [Review tools](#review-tools-export-edit-mode-traceability-matrix-type-tags-version-history-quality-score).

### Excel download and upload

- Export: qTest’s 6 columns plus review-only AC Tags / Priority / Review Status + **AC List** sheet (review columns are **not** sent to qTest).
- Upload: `.xlsx`, max 5 MB; modes Replace / Append / Merge by TC ID; `GET /api/excel/template`.

### Batch mode (multiple stories)

**▦ Batch mode** on Input — separate purple workspace (max 10 items). Generate queue, per-item review, batch qTest, Excel zip. History stores one `BATCH-…` entry.

---

## 3. Run history

- Cookie `atg_history` (separate from session); Logout / New run do **not** clear history.
- IDs `RUN-YYYYMMDD-NNN` (IST). Rolling FIFO; limit **1–100** (default 5) in Settings → Preferences.
- Storage: `backend/history/<id>/history.json` + `runs/<run_id>.json`. Excel under `ai_test_generator/reports/runs/<run_id>/`.

---

## 4. Setup checklist, Settings, logs

- **Setup checklist:** Gemini key + model (required), Jira, qTest (optional), default prompt file.
- **Settings:** AI Providers (one at a time) · Integrations (Jira, qTest, Zephyr Scale) · Preferences. Blank secret fields keep the saved value. Zephyr Scale stores Base URL and API Key only — **test case upload is not implemented yet**.
- **Logs:** `backend/logs/app.log` (rotating 5 MB × 3).

Git-ignored runtime data: `ai_test_generator/.env`, `ai_test_generator/reports/*`, `backend/sessions/`, `backend/history/`, `backend/logs/`, `backend/app_settings.json`, `backend/test_repo/`, `backend/attachments/`, `backend/prompt_templates.json`, `backend/token_usage.json`.

---

## 5. Project structure & data files

```
.
├── ai_test_generator/          # Jira worker, AI helpers, qTest utils, CLI pipeline
│   ├── .env.example            # copy to .env (never commit .env)
│   ├── prompt/                 # generator + reviewer prompts
│   ├── ai_helpers/             # test_generator_{gemini,grok,claude,openai,codex,ollama}.py
│   └── reports/                # run Excel, usage JSON, exports
├── backend/
│   ├── app.py                  # FastAPI routes + static pages
│   ├── services.py             # AI / Jira / qTest wrappers
│   ├── test_repo.py / test_runs.py / requirements_repo.py / dashboard.py / recorder.py
│   ├── settings_store.py / history_store.py / session_store.py / token_usage.py
│   └── …
├── frontend/                   # welcome.html, app.html, css/, js/
├── requirements.txt
├── THIRD_PARTY_NOTICES.md      # Lucide ISC attribution
├── README.md
└── NOTES.md
```

| Path | Content |
|---|---|
| `ai_test_generator/reports/` | Generated Excel, payload JSON, Gemini usage tracker, version exports |
| `backend/sessions/` | Per-browser current run |
| `backend/history/` | Rolling run history index + snapshots |
| `backend/test_repo/repo.json` | Test Case Repo folders + cases |
| `backend/test_repo/runs.json` | Test Runs cycles + executions |
| `backend/test_repo/requirements.json` | Projects, requirement folders, REQ-####, case links |
| `backend/attachments/` | Execution / case attachments (≤ 50 MB), served via `/api/attachments/…` |
| `backend/logs/app.log` | Server log |
| `backend/app_settings.json` | Non-secret settings (history limit, …) |

---

## API overview

All `/api/*` routes (except health/session start as applicable) require the session cookie. Grouped by area:

| Area | Examples |
|---|---|
| Session / health | `POST /api/session/start`, `POST /api/session/logout`, `GET /api/health`, `GET /api/state`, `GET /api/setup/status` |
| Input / generate / review | `POST /api/input/jira\|local`, `POST /api/generate`, `POST /api/review/*`, `PUT /api/review/test_cases` |
| Excel / export | `POST /api/excel/import`, `GET /api/excel/template`, `GET /api/export`, `GET /api/review/excel` |
| qTest | `POST /api/qtest/preview\|upload`, `GET /api/qtest/rtm`, `POST /api/qtest/retry_failed` |
| Settings / prompts / tokens | `GET\|PUT /api/settings`, `GET\|PUT /api/prompt/default`, `/api/templates*`, `/api/tokens*`, `/api/usage` |
| History / batch | `/api/history*`, `/api/batch*` |
| Test Case Repo | `/api/repo*` |
| Test Runs | `/api/runs*`, `/api/attachments*` |
| Projects / Requirements | `/api/projects*`, `/api/requirements*` (incl. `traceability`, `import`, `auto-link`, `generate-context`, `delete-check`, `duplicate`, `bulk`, folder `delete-check`) |
| Dashboard | `GET /api/dashboard` |
| Record | recorder routes under the Record UI (Playwright) |

---

## Test Case Repo & Test Runs

Store reviewed cases for reuse; group into cycles and execute step by step. No extra pip package beyond `openpyxl` / existing Gemini (or other provider) settings for AI review.

**Flow (short):** Review → **Save to Test Case Repo** or **Execute now** → Repo tree / case detail → Runs cycles → execution screen (pass/fail/blocked, attachments, shortcuts).

Folders are first-class records; Archived cases are hidden by default and **excluded from Dashboard totals**. Delete of an executed case archives it. See earlier detailed bullets in git history / UI for full drawer, versions, and export behaviour.

IDs: cases `TC-####`, cycles `CY-####`.

---

## Projects & Requirement Repo

Additive: **Projects** scope Requirements ↔ linked Test Cases ↔ cycles. Cases keep free-text `story`.

- **Projects** (`/api/projects`): `key`, `name`, `description`; optional `jira_project_key`, `qtest_project_id`, `zephyr_project_key` (mapping only — **no Zephyr API client**). System **Local** project for legacy data.
- **Requirements** (`/api/requirements`): REQ-####; type Story/Epic/Feature; source Manual|Jira; single `jira_key`; statuses Draft/Ready/Approved/Archived.
- **Create / edit UI:** wide right-hand drawer (~70vw, min 760px, max 1100px, full height; 100vw on small screens) with Basics, Description, acceptance-criteria rows, and a Test Case Repo search picker. Detail page also has inline **Edit** with an unsaved-changes bar. `POST` accepts optional `case_ids`; `PUT` updates fields (links synced via the existing link/unlink APIs).
- **Delete:** `GET /api/requirements/{id}/delete-check` returns linked-case and execution counts. `DELETE /api/requirements/{id}` archives by default. `DELETE /api/requirements/{id}?permanent=true` is allowed only when those counts are 0 (UI asks you to type the ID). Bulk archive / move / status: `POST /api/requirements/bulk`. Duplicate: `POST /api/requirements/{id}/duplicate` (copies fields, not the Jira key or links; new status Draft).
- **Folders:** create / rename / new subfolder dialogs (no browser `prompt()`). `GET /api/requirements/folders/{id}/delete-check` returns counts. `DELETE` of an empty folder removes it; otherwise pass `move_to=<folder id>` (use `__root__` for unfiled) or `to_parent=true`. Subfolders are reparented — a delete never silently drops a subtree.
- Activity events include `ts` and `by` (`local user`, or a display name from app settings if one was stored — no login/auth).
- Link / unlink cases; opt-in **auto-link** when `case.story == jira_key`.
- Import: paste keys or `KEY | Title`; optional fetch via existing `services.fetch_jira`.
- **Generate with AI** prefills Generate and sets `story_id` to the Jira key.
- Traceability: `GET /api/requirements/traceability?project_id=&cycle_id=&gaps_only=`.

Sidebar: project switcher + **Requirements** (Projects / Traceability reachable from that area).

---

## Dashboard

`#dashboard` — `GET /api/dashboard`. Tiles and section 1 **exclude Archived** cases (aligned with Repo default). Charts (Table / Donut / Bar) remembered in `localStorage`. Customize layout locally.

---

## Prompt templates (multi-select)

Sidebar → **Prompt templates**. Built-in Default mirrors `ai_test_generator/prompt/test_cases_generator_prompt.md`. Multi-select on Input → Generate runs once per template and merges. **Custom prompt** on Generate always overrides. Storage: `backend/prompt_templates.json` (gitignored, re-seeded if missing).

---

## Review tools (Export, Edit mode, Traceability matrix, Type tags, Version history, Quality score)

Additive Review toolbar features: Export ▾, Edit mode, List/Matrix AC coverage, type tags, version history (`reports/runs/<run>/versions.json`), local quality score + Improve with AI. Existing cards and Batch layout stay as before.

---

## Troubleshooting

| Issue | What to try |
|---|---|
| Frontend looks stale after pull | Hard refresh: **Ctrl+Shift+R** (Mac: Cmd+Shift+R). Static assets use `?v=N` cache busting. |
| Ollama Generate spins forever | Set **Settings → Ollama → Timeout** (`OLLAMA_TIMEOUT`, default 300s). Ensure `ollama serve` is running and `OLLAMA_HOST` / `OLLAMA_MODEL` match your machine. |
| Gemini / other provider errors | Confirm key + model ID on **Settings → AI Providers**. Empty secret field keeps the saved key. |
| Record won’t start | `pip install playwright` then `python -m playwright install chromium`. On Linux ensure a display is available. |
| Jira / qTest fail | Check Integrations tab URLs/tokens; use Preview payload before upload. |
| Port in use | Change `--port` on the uvicorn command. |

Offline mocks (process env only, **not** read from `.env`): `ATG_MOCK_GEMINI=1`, `ATG_MOCK_JIRA=1`, `ATG_MOCK_QTEST=1`, `ATG_MOCK_DELAY=1.5`, etc.

---

## 6. Testing notes

- E2E historically run with Playwright against `http://127.0.0.1:8000` (Review, Excel, history, …).
- Create data without live LLM calls via Excel import or `PUT /api/review/test_cases` after Local input; use **Preview payload** for qTest.
- Useful: `GET /api/health`, `GET /api/setup/status`, `GET /api/history`, `GET|PUT /api/settings/history_limit`.

---

## Original CLI pipeline

```bash
python -m ai_test_generator.test_runner.main_pipeline
```

Still works from the repo root (uses the same `.env`).
