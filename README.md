# AI TestCase Generator — Web App

An AI-assisted manual test case generator. Turn a **Jira story** (or pasted / uploaded requirements) into structured test cases with a configurable AI provider, review and edit them, store them in a **Test Case Repo**, run them in **Test Runs**, link them to a **Requirement Repo**, export **Excel**, and upload to **qTest Manager** with RTM.

- **Backend:** FastAPI (`backend/`), wrapping the existing `ai_test_generator` package.
- **Frontend:** static HTML/CSS/vanilla JS (`frontend/`) served by FastAPI — **no build step**.
- **Sidebar icons:** [Lucide](https://lucide.dev) (ISC) inline SVG sprite in `frontend/app.html` (`stroke="currentColor"`). Workflow steps 1–4 use Lucide icons with a small numbered badge (1–4) at the icon’s top-right. See `THIRD_PARTY_NOTICES.md`.

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
13. [Token Usage & calculator](#token-usage)
14. [Prompt templates](#prompt-templates-multi-select)
15. [Review tools](#review-tools-export-edit-mode-traceability-matrix-type-tags-version-history-quality-score)
16. [Record (Playwright)](#record-feature--record-on-the-input-step--extra-setup)
17. [Voice input](#voice-input)
18. [Help Assistant](#help-assistant)
19. [Floating windows](#floating-windows)
20. [Test data, coverage and Gherkin](#test-data-coverage-and-gherkin)
21. [Troubleshooting](#troubleshooting)
22. [Testing notes](#6-testing-notes)
23. [Original CLI](#original-cli-pipeline)

---

## Tech stack

| Layer | Technology | Used for |
|---|---|---|
| Backend | Python 3.10+, FastAPI, Uvicorn | REST API (`/api/...`) and serving the frontend |
| Config | python-dotenv (`ai_test_generator/.env`) | API keys and settings (never commit `.env`) |
| AI / LLM | Gemini (`google-genai`), Grok/xAI, Groq (OpenAI-compatible via `openai`), Claude (Anthropic Messages via `requests`), OpenAI / Codex (`openai`), Ollama | Generation / review / regenerate; provider chosen on Generate; keys + model IDs on Settings |
| Integrations | Jira (`jira` + FastMCP worker), qTest (REST via `requests`) | Story fetch; module / test-case upload + RTM |
| Record | Playwright (Chromium) | Capture browser actions as test steps |
| Data | SQLite (`backend/app.db`) + JSON files | Repo, runs, requirements, token ledger, app settings, prompt templates, and run history live in SQLite. Sessions, recordings, Gemini quota, and attachments stay as files. |
| Import / Export | pandas, openpyxl | Excel (.xlsx) / CSV; one row per step |
| Frontend | Plain HTML, CSS, JavaScript | `frontend/app.html`, hash routing, feature modules |
| Charts | Custom SVG donut / bar | Dashboard; preferences in `localStorage` |
| Icons | Lucide (ISC), inline SVG | Sidebar nav; workflow steps also show a numbered badge (1–4) |
| Caching | `?v=N` on static assets | Cache-bust after frontend changes (currently `v=45`) |

**Persistence:** SQLAlchemy 2.x + Alembic; durable product data and run history in `backend/app.db` (WAL). On first start, leftover product JSON files are imported once if the database has no product data yet. Leftover run history folders under `backend/history/<id>/` are imported once after the history migration (a marker is set even if no folders exist, so later folders are not treated as a first-start import). Those JSON files are kept as a backup and are not the live store. Sessions, Record drafts/recordings, Review `versions.json`, `gemini_usage.json`, attachment bytes, Excel/exports, and logs stay as files. The `atg_history` cookie still identifies the browser; Logout / New run do not clear history. Secrets stay in `ai_test_generator/.env`. **Still planned:** object storage for attachments, hosted deploy. **Zephyr Scale Cloud upload is not implemented** (Projects may store an optional `zephyr_project_key` mapping field only).

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
| Groq | `GROQ_API_KEY`, `GROQ_MODEL` (default `llama-3.3-70b-versatile` when blank), optional `GROQ_TIMEOUT` (120), `GROQ_MAX_TOKENS` (8192) — see [Groq provider](#groq-provider) |
| Claude (Anthropic) | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, optional `CLAUDE_TIMEOUT` (120), `CLAUDE_MAX_TOKENS` (8192) |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL`, optional `OPENAI_TIMEOUT` (120) |
| Codex (OpenAI family) | Uses `OPENAI_API_KEY`. Optional `CODEX_MODEL` (falls back to `OPENAI_MODEL`, then legacy `gpt-5-mini`) |
| Ollama (local) | `OLLAMA_MODEL` (default `gemma3:4b`), `OLLAMA_HOST` (`http://localhost:11434`), `OLLAMA_TIMEOUT` (default **300**), `OLLAMA_NUM_CTX` (8192) |
| Jira | `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` |
| qTest | `QTEST_BASE_URL`, `QTEST_TOKEN` (`Bearer …`), `QTEST_PROJECT_ID`; optional `QTEST_REQUIREMENT_ID`, `QTEST_PARENT_MODULE_ID` |
| Zephyr Scale | `ZEPHYR_BASE_URL`, `ZEPHYR_API_KEY` (Settings only — **upload is not implemented yet**) |
| Original CLI only | `ENABLE_JIRA_REQURIMENT`, `STORY_ID` |

Model IDs are free-text — enter the exact ID from each provider console. Do not treat example names as guaranteed current IDs.

### Groq provider

[Groq](https://console.groq.com/) hosts open models (Llama, Qwen, GPT-OSS, etc.) behind an OpenAI-compatible API at `https://api.groq.com/openai/v1`. The app calls its **Chat Completions** endpoint with the existing `openai` package — no new dependency.

1. Create a free API key at <https://console.groq.com/keys>.
2. **Settings → AI Providers → Groq**: paste the key; optionally set a Model ID (blank = `llama-3.3-70b-versatile`), timeout and max output tokens.
3. Pick **Groq** in the Provider dropdown on **Generate** (or the Model dropdown on **Batch**).

**Free-tier note:** Groq's free plan has per-model limits per minute and per day (requests and tokens; check the *Limits* page in your Groq console for current numbers). When Groq returns HTTP 429 the app waits for the `retry-after` header (capped at 30 s) and retries up to **2** times; if it is still rate-limited the UI shows a clear "rate limit reached" error (HTTP 429). Large stories with a high `GROQ_MAX_TOKENS` can hit the per-minute token cap — lower it or use a smaller model if that happens.

Non-secret app settings (history limit, duplicate threshold, token rates/limit, model registry, calculator prefs, per-provider daily limits) live in the SQLite `app_settings` table in `backend/app.db`, not `.env`. A leftover `backend/app_settings.json` is imported once on first start and kept as a backup.

---

## Features overview

| Area | What you get |
|---|---|
| Multi-provider AI | Gemini, Grok, Groq, Claude, OpenAI, Codex, Ollama — choose provider **and model** on **Generate**; configure keys / a fallback model ID on **Settings → AI Providers**, and a per-provider model registry (multiple models, rates, context, default, enable) on **Settings → Preferences** |
| Settings UI | Tabs: **AI Providers** / **Integrations** (Jira, qTest, Zephyr Scale) / **Preferences** (history limit, duplicate threshold, **default Generate provider**, **Edge value library**, **model registry**, **per-provider daily token/cost limits**, voice input, Help Assistant, floating windows) |
| Projects + Requirement Repo | Project switcher; Requirements (REQ-####) with create / edit / duplicate / archive / permanent-delete; folder tree (new / rename / subfolder / delete with move); Jira import; link/unlink cases; auto-link by `case.story`; Generate-from-requirement; traceability matrix |
| Test Case Repo | Folders, versions, AI review, import/export, case drawer/full page |
| Test Runs | Cycles, step execution, attachments, results history |
| Dashboard | Totals **exclude Archived** cases; charts; cycle / story filters; token cards and usage-by-provider/model chart (click through to a pre-filtered ledger); near-limit banner at 80% of a user-set daily cap |
| Token usage | Per-provider ledger (Mode, provider, model, action, date filters; pagination 10/25/50/100; delete / delete-older; Export CSV). **Calculator** tab (`#tokens/calculator`) counts tokens (coloured tokens, Token IDs, compare enabled models, over-limit). New rows store estimated vs actual tokens, cost, and `rate_source` (`model` or `legacy_global`); older rows stay on workspace-wide global rates. Dashboard AI token totals still use those global rates. Estimates appear on Generate, AI Review, Regenerate and Help; Test data / Boost show **No AI call**. Gemini daily quota file is separate and is not reset by deletes. |
| Prompt templates | Multi-select templates; Custom prompt overrides |
| Record | Playwright capture → steps |
| Jira / qTest | Story fetch; upload + RTM (Excel export, retry failed) |
| Voice input | Teal mic in the header opens a draggable **Voice input** window (minimize / maximize / close). Dictate into whichever field you click on any screen; Start / Pause / Resume / Stop, `Ctrl+Shift+Space`, language picker, configurable voice commands. Browser Web Speech API (Chrome / Edge) — no AI model, no API key. See [Voice input](#voice-input) |
| Help Assistant | Dark-blue robot-headset icon in the header (right after the voice mic) opens a draggable **Help Assistant** window (minimize to a pill / maximize with conversation history / close). Answers are grounded in this README and `docs/help_faq.md`. **Use Generate provider** follows the current run’s saved provider, or **Settings → Preferences → Default provider** when the run has none (Repo / Excel). Quick-question chips, source citations, and jump buttons to the matching screen or Settings tab. Prefs stay in this browser. See [Help Assistant](#help-assistant) |
| Test data & coverage | Review can generate **Valid / Invalid / Boundary** test data per step (heuristic samples and/or the built-in **Edge value library**), **Boost coverage** with Negative / Boundary / Security suggestions (library values, no extra AI call by default), and export **Gherkin** (`.feature`, or a zip when a run has more than one story). See [Test data, coverage and Gherkin](#test-data-coverage-and-gherkin) |
| Floating windows | Voice input and Help Assistant share a window manager: they dock side by side (Help to the left of Voice), share one minimize tray, fill the content area when maximized (the other window auto-minimizes), click-to-front, and snap apart if they overlap. See [Floating windows](#floating-windows) |
| Lucide sidebar icons | Professional line icons on every visible item; workflow steps Input / Generate / Review / qTest Upload use an icon plus a mini numbered badge (1–4). Grouped order: Dashboard + Setup; steps 1–4 + Run history; Requirements / Repo / Test Runs; Prompts / Token Usage / Settings. No “NEW” badges (Run history count badge kept). |

---

## 2. Workflow

The sidebar is grouped (no section captions): **Dashboard** and **Setup checklist**; workflow steps 1–4 (**Input**, **Generate**, **Review**, **qTest Upload**) plus **Run history**; **Requirements**, **Test Case Repo**, **Test Runs**; **Prompt templates**, **Token Usage**, **Settings**. A step unlocks once the previous one has data. Projects / Traceability stay hidden (reachable from the Requirements area). “NEW” badges are not shown; the Run history count badge remains. Each step page can show the **Ticket / Story ID** pill. The sidebar footer shows run id / story / case count. The project switcher stays under the brand, with Lucide icons on every visible item (workflow steps also show numbered badges 1–4).

1. **Input:** *Jira Story* (fetch), *Local text*, or *Upload Excel* (skips Generate). Optional **Record**.
2. **Generate:** pick **Provider** + Default / Custom prompt (or templates from Input). Optional AI Reviewer. Token usage card.
3. **Review:** edit, map ACs, generate test data, boost coverage, save Excel; **Save to Test Case Repo** / **Execute now**. The Review badge shows the Generate provider (or the Settings default when a Repo / Excel run has none).
4. **qTest Upload:** Preview payload → Confirm Upload; **RTM** tab for Story → AC → TC → qTest IDs. Test data is appended into each step description so it reaches qTest without a new column.

**＋ New run** starts fresh (previous run stays in history). **Log out** clears only the session.

### Review UI (summary)

Inline edits, priority / AC tags, reorder, review status, pagination, AI Reviewer apply/dismiss (optional per-call provider override), unsaved-edit guard, **Test Data** column, coverage chips (Positive / Negative / Boundary / Security), **Generate test data**, **Boost coverage**, and **Export ▾** including Gherkin. See also [Review tools](#review-tools-export-edit-mode-traceability-matrix-type-tags-version-history-quality-score) and [Test data, coverage and Gherkin](#test-data-coverage-and-gherkin).

### Excel download and upload

- Export: qTest’s 6 columns plus AC Tags / Priority / Review Status / **Type** / **Test Data** + **AC List** sheet. The six standard columns stay the same; Test Data is also appended into the step description for qTest upload.
- Upload: `.xlsx`, max 5 MB; modes Replace / Append / Merge by TC ID; optional Type and Test Data columns; `GET /api/excel/template`.

### Batch mode (multiple stories)

**▦ Batch mode** on Input — separate purple workspace (max 10 items). Generate queue, per-item review, batch qTest, Excel zip. History stores one `BATCH-…` entry.

---

## 3. Run history

- Cookie `atg_history` (separate from session); Logout / New run do **not** clear history.
- IDs `RUN-YYYYMMDD-NNN` (IST). Rolling FIFO; limit **1–100** (default 5) in Settings → Preferences.
- Storage: SQLite (`backend/app.db` tables `history_entries`, `history_snapshots`, `history_seq`). Leftover `backend/history/<id>/history.json` + `runs/<run_id>.json` are imported once on first start after the history migration and kept as a backup. Excel / reports stay under `ai_test_generator/reports/runs/<run_id>/`. The list is still per-browser via the `atg_history` cookie (not stored in the browser itself).

---

## 4. Setup checklist, Settings, logs

- **Setup checklist:** Gemini key + model (required), Jira, qTest (optional), default prompt file.
- **Settings:** AI Providers (one at a time) · Integrations (Jira, qTest, Zephyr Scale) · Preferences (history limit, duplicate threshold, **default Generate provider**, **Edge value library** enable / categories / custom values / import / export / reset, **model registry** (multiple models per provider, example rates, context window, default ★, enable), **per-provider daily token and cost limits** (warn at 80%; blank = no warning), calculator prefs (optional tiktoken; provider count APIs off by default), Voice input, Help Assistant, Floating windows). Existing AI Provider model ID fields still work as a fallback when the registry has no default. Blank secret fields keep the saved value. Zephyr Scale stores Base URL and API Key only — **test case upload is not implemented yet**. No new `.env` keys are required for these preferences; the registry is seeded from the already-configured model IDs in the settings store (not by reading `.env`).
- **Logs:** `backend/logs/app.log` (rotating 5 MB × 3).

Git-ignored runtime data: `ai_test_generator/.env`, `ai_test_generator/reports/*`, `backend/app.db` (and `-wal`/`-shm`), `backend/sessions/`, `backend/history/`, `backend/logs/`, `backend/app_settings.json`, `backend/test_repo/`, `backend/attachments/`, `backend/prompt_templates.json`, `backend/token_usage.json`.

---

## 5. Project structure & data files

```
.
├── ai_test_generator/          # Jira worker, AI helpers, qTest utils, CLI pipeline
│   ├── .env.example            # copy to .env (never commit .env)
│   ├── prompt/                 # generator + reviewer prompts
│   ├── ai_helpers/             # test_generator_{gemini,grok,groq,claude,openai,codex,ollama}.py
│   └── reports/                # run Excel, usage JSON, exports
├── backend/
│   ├── app.py                  # FastAPI routes + static pages
│   ├── services.py             # AI / Jira / qTest wrappers
│   ├── test_repo.py / test_runs.py / requirements_repo.py / dashboard.py / recorder.py / help.py
│   ├── testdata.py             # test data, Edge library, boost coverage, Gherkin export
│   ├── data/edge_values.json   # built-in Bug Magnet-style catalog (our own values)
│   ├── settings_store.py / history_store.py / session_store.py / token_usage.py / token_registry.py / token_estimate.py
│   └── …
├── frontend/                   # welcome.html, app.html, css/ (incl. help.css, winmgr.css, testdata.css), js/ (incl. help.js, winmgr.js, testdata.js)
├── docs/
│   └── help_faq.md             # Short FAQ used by the Help Assistant
├── requirements.txt
├── THIRD_PARTY_NOTICES.md      # Lucide ISC attribution
├── README.md
└── NOTES.md
```

| Path | Content |
|---|---|
| `ai_test_generator/reports/` | Generated Excel, payload JSON, Gemini usage tracker, version exports |
| `backend/sessions/` | Per-browser current run |
| `backend/history/` | Backup of run history index + snapshots (imported once; not the live store) |
| `backend/app.db` | Live SQLite store (repo, runs, requirements, token ledger, app settings, prompt templates, run history) |
| `backend/test_repo/repo.json` | Backup of Test Case Repo (imported once on first start; not the live store) |
| `backend/test_repo/runs.json` | Backup of Test Runs |
| `backend/test_repo/requirements.json` | Backup of Projects / requirements / links |
| `backend/attachments/` | Execution / case attachments (≤ 50 MB), served via `/api/attachments/…` |
| `backend/logs/app.log` | Server log |
| `backend/app_settings.json` | Backup of non-secret settings (history limit, …) |
| `backend/token_usage.json` | Backup of the token ledger |
| `backend/prompt_templates.json` | Backup of prompt templates |

---

## API overview

All `/api/*` routes (except health/session start as applicable) require the session cookie. Grouped by area:

| Area | Examples |
|---|---|
| Session / health | `POST /api/session/start`, `POST /api/session/logout`, `GET /api/health`, `GET /api/state`, `GET /api/setup/status` |
| Input / generate / review | `POST /api/input/jira\|local`, `POST /api/generate`, `POST /api/review/*` (incl. `testdata`, `boost`, `regenerate`, `ai`), `PUT /api/review/test_cases`, `GET /api/testdata/library` |
| Excel / export | `POST /api/excel/import`, `GET /api/excel/template`, `GET /api/export` (`xlsx` / `csv` / `qtest` / `feature`; `outline`, `tags`, `background`, `stories`), `GET /api/review/excel` |
| qTest | `POST /api/qtest/preview\|upload`, `GET /api/qtest/rtm`, `POST /api/qtest/retry_failed` |
| Settings / prompts / tokens | `GET\|PUT /api/settings`, `GET\|PUT /api/settings/prefs` (default provider, Edge library, model registry, calculator prefs, per-provider daily limits), `GET\|PUT /api/prompt/default`, `/api/templates*`, `GET /api/tokens` (paged; also `provider` + `action` filters), `GET /api/tokens/export.csv` (includes provider, estimate, cost, `rate_source`), `POST /api/tokens/delete`, `POST /api/tokens/estimate`, `POST /api/tokens/count`, `/api/usage` |
| History / batch | `/api/history*`, `/api/batch*` |
| Test Case Repo | `/api/repo*` |
| Test Runs | `/api/runs*`, `/api/attachments*` |
| Projects / Requirements | `/api/projects*`, `/api/requirements*` (incl. `traceability`, `import`, `auto-link`, `generate-context`, `delete-check`, `duplicate`, `bulk`, folder `delete-check`) |
| Dashboard | `GET /api/dashboard` |
| Help Assistant | `POST /api/help/chat`, `GET /api/help/search` |
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

## Token Usage

`#tokens` — ledger in SQLite (`token_ledger` in `backend/app.db`; leftover `backend/token_usage.json` is imported once and kept as a backup). `GET /api/tokens` accepts the existing From/To/**Mode**/Model filters plus **provider** and **action**, and server-side pagination (`page`, `page_size` of 10/25/50/100, default 25). The Per-run table shows “Showing X–Y of N”; page size is remembered in `localStorage`. The table also shows provider, pre-call estimate, recorded cost, and `rate_source`. `GET /api/tokens/export.csv` still exports **all** filtered rows (not just the current page) and **appends** those new columns without dropping the existing ones.

New ledger rows record `est_input` / `est_output` / `est_cost`, `actual_cost`, and `rate_source` (`model` when a registry rate was used, otherwise `legacy_global`). Existing rows are left unchanged (migration `004_token_calculator` defaults them to `legacy_global` / 0). The month-cost tile on this page still uses the workspace-wide **Token settings** rates (`$ per 1M` input/output and the global daily limit). Per-model example prices and per-provider daily caps live in **Settings → Preferences**.

**Calculator** tab (`#tokens/calculator`): paste or reuse the current run’s text, pick a provider/model from the registry, see token counts, a coloured token view, optional Token IDs, estimated cost and context fit, compare all enabled models grouped by provider, and an over-limit warning. Counting uses characters ÷ 4 (or the model’s divisor) by default. **tiktoken** is optional — used only if the package is already installed and the calculator pref is on (OpenAI / Codex). Provider count APIs (for example Gemini `countTokens`) are **opt-in and off by default** because they make a real API call.

`POST /api/tokens/estimate` (and `/api/tokens/count`) is the shared pre-call API used by the calculator and by **Generate**, **AI Review**, **Regenerate**, and **Help**. Library / heuristic **Test data** and **Boost coverage** short-circuit to **No AI call · 0 tokens** and still do not write a ledger row.

Alembic migration `004_token_calculator` adds the new ledger columns with safe defaults (no data loss). JSON backups (`token_ledger.bak.json`) continue to dump the list including the new keys once they are persisted.

Delete: row icon, checkboxes (select-all on the current page), **Delete selected**, and **Delete older than** a date. `POST /api/tokens/delete` with `{ids:[…]}` or `{before:"YYYY-MM-DD"}`; `confirm: false` previews count + token total, `confirm: true` applies. Each entry has a stable `id` (`TU-` + 12 hex); older rows are backfilled on read/write. Before each delete the ledger is copied to `ai_test_generator/reports/token_ledger.bak.json` plus a timestamped file (last 5 kept).

The ledger action list includes **Test data** and **Boost coverage** (recorded only when a model is actually called). Deletes refresh this page’s tiles, daily chart, breakdowns (by action and by provider/model), estimate-accuracy, table, and the **Dashboard** AI token totals (same `token_usage._load()` data). They do **not** modify `ai_test_generator/reports/gemini_usage.json` (the provider’s real Gemini daily quota). The Daily quota tile on this page is ledger vs the Token settings daily limit, so it **does** change after a delete.

## Dashboard

`#dashboard` — `GET /api/dashboard`. Tiles and section 1 **exclude Archived** cases (aligned with Repo default). Charts (Table / Donut / Bar) remembered in `localStorage`. Customize layout locally.

Existing tiles and the **AI-generated cases and token usage** section (including `ai.cost` at the workspace-wide global rates) are unchanged. The response also includes an additive `token_summary`: period totals at per-model example rates, usage by provider/model, and `near_limit` entries when a **user-set** daily token or cost cap in Settings is at least 80% used today (blank limits never warn). Dashboard cards and the provider/model chart click through to `#tokens?provider=…` (and model) so the ledger opens pre-filtered.

---

## Prompt templates (multi-select)

Sidebar → **Prompt templates**. Built-in Default mirrors `ai_test_generator/prompt/test_cases_generator_prompt.md`. Multi-select on Input → Generate runs once per template and merges. **Custom prompt** on Generate always overrides. Storage: SQLite `prompt_templates` in `backend/app.db` (re-seeded if empty). Leftover `backend/prompt_templates.json` is imported once on first start and kept as a backup.

---

## Review tools (Export, Edit mode, Traceability matrix, Type tags, Version history, Quality score)

Additive Review toolbar features: Export ▾ (Excel, CSV, qTest-import CSV, **Gherkin .feature**), Edit mode, List/Matrix AC coverage, type tags (Positive / Negative / Edge / **Boundary** / **Security**), version history (`reports/runs/<run>/versions.json`), local quality score + Improve with AI, **Generate test data**, and **Boost coverage**. Existing cards and Batch layout stay as before.

---

## Voice input

Dictate instead of typing — into the story box on **Input**, any field of a test case on **Review**, Requirements, Repo, Settings, or any other text box in the app. It uses the browser's built-in **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`): **no AI model, no API key, no `.env` change, no backend call**.

**Open it**
- Click the **teal mic** in the top-right header (next to **＋ New run**). The **Voice input** window opens at the bottom-right of the content area (when Help is also open, they dock side by side — see [Floating windows](#floating-windows)).
- Click into any text field, then press **Start** (or `Ctrl+Shift+Space`). The window shows **Typing into: &lt;field&gt;** and the field glows blue. Click or Tab to another field at any time — dictation follows the field you focus, no restart needed.
- While listening, the header mic shows a red **LIVE** badge.

**Window controls**

| Control | What it does |
|---|---|
| **Start / Pause / Resume / Stop** | Start listening, pause (keeps the field and caret), resume where you left off, stop |
| **Language** | English (India) `en-IN` (default), English (US), Hindi, Tamil |
| Live transcript | Grey italic text is what is being heard right now; each finished phrase is listed with its time (and recognised commands) |
| **–** Minimize | Shrinks to a **Voice input** pill in the shared bottom-right tray (shows LIVE / PAUSED); click to restore |
| **▢** Maximize | Fills the content area (sidebar stays visible) with the full transcript history; the Help window auto-minimizes to the tray and is restored when you un-maximize. Click again (or double-click the title) to restore |
| **×** Close | Stops listening and hides the window; the header mic reopens it |
| Drag | Drag the teal title bar anywhere; it stays inside the browser window, comes to the front, and snaps apart from Help if they overlap. The position is remembered |
| **Reset position** | Moves the window back to its default dock slot (bottom-right; side by side with Help when both are open) |
| **?** | Lists the enabled voice commands |

Text is inserted **at the caret** of the focused input / textarea / editable cell and fires the normal `input` event, so the app reacts exactly as if you typed it (e.g. Review marks the case as edited and enables **Save changes**). Chrome stops recognition after a few seconds of silence; the app restarts it automatically while you are listening.

**Keyboard shortcut:** `Ctrl+Shift+Space` starts / pauses / resumes from anywhere (can be turned off in Settings).

**Voice commands** (say the phrase on its own; phrases are editable)

| Say | Action |
|---|---|
| "next field", "next box" | Move to the next text field (like Tab) |
| "next step" | Review: jump to the same column of the next step row |
| "new line", "new paragraph" | Insert a line break |
| "pause", "pause dictation" | Pause |
| "stop listening", "stop dictation" | Stop |
| "undo", "scratch that", "delete that" | Undo the last dictated phrase |
| "add step", "new step" | Review: add a step below the current step (same as the row's **＋** / **＋ Add step**) and move into it |
| "save changes", "save" | Review: click **💾 Save changes** (only on the Review screen) |

Custom commands can map any phrase to one of the actions above or to **Insert text…** (e.g. say "standard login" to insert a snippet).

**Settings → Preferences → 🎤 Voice input**
- **Enable launcher** (show / hide the header mic), **Default language**, **Keyboard shortcut** on/off, **Auto-punctuation** (capitalises sentences; "comma", "full stop", "question mark", "exclamation mark", "colon", "semicolon" become symbols), **Window start position** (bottom right · bottom left · top right · remember last position), **Reset window position**.
- **Voice commands** table: edit the comma-separated phrases for each action, turn rows on/off, **＋ Add custom command**, **Reset to defaults**.
- These preferences are saved **instantly in this browser's `localStorage`** (keys `atg.voice.prefs`, `atg.voice.pos`) — not in `.env` or the database, and not shared between browsers. The page's **Save changes** button is not needed for them.

**Browser support & privacy**
- Works in **Google Chrome** and **Microsoft Edge** (desktop). Firefox (and other browsers without speech recognition) shows a greyed-out mic with a tooltip, and the Settings card shows a notice.
- The first time you press Start, the browser asks for **microphone permission** — click **Allow**. If you blocked it, re-enable it from the site settings (padlock icon in the address bar). Mic access needs `http://localhost` or HTTPS.
- **Chrome / Edge send the audio to their speech service (Google / Microsoft) for recognition**, so dictation needs an internet connection. Nothing is sent to this app's backend or to any AI provider, and no API key is used.

---

## Help Assistant

An in-app chat that answers questions about how this app works, grounded in this README and `docs/help_faq.md`. It will not change your data, run Generate, or upload anything. If a feature is not implemented (for example **Zephyr Scale Cloud upload**), the assistant says so.

**Open it**
- Click the **dark-blue robot-headset icon** in the top-right header, immediately after the teal Voice input mic. The window opens at the bottom-right of the content area (when Voice is also open, Help docks to the left of it — see [Floating windows](#floating-windows)).
- Ask a question, press **Enter** to send (**Shift+Enter** for a new line), or click a **quick-question chip**. The teal mic in the help window dictates into the help input (same browser Web Speech API as Voice input; auto-sends if the box was empty). Chrome / Edge only — other browsers show a greyed-out mic.

**Window controls**

| Control | What it does |
|---|---|
| **Restart chat** | Refresh icon in the title bar (before minimize), and a **Restart chat** button next to **＋ New** in the maximized history sidebar. If the current chat has questions, an in-window confirm asks first. The current conversation is kept in History; a fresh chat opens with the welcome message and quick-question chips, the input is cleared, and the screen-context banner stays. |
| **–** Minimize | Shrinks to a **Help Assistant** pill in the shared bottom-right tray; click to restore |
| **▢** Maximize | Fills the content area (sidebar stays visible) with a **conversation history** sidebar, **Restart chat**, and **＋ New** chat; the Voice window auto-minimizes to the tray and is restored when you un-maximize. Click again (or double-click the title) to restore |
| **×** Close | Hides the window; the header icon reopens it |
| Drag | Drag the title bar anywhere; it stays inside the browser window, comes to the front, and snaps apart from Voice if they overlap. The position is remembered |
| **Reset window position** | In Settings → Preferences → Help Assistant; moves the window back to its default dock slot (side by side with Voice when both are open) |

Answers include **source citations** (README or FAQ heading) and, when relevant, **jump buttons** that open the matching screen or Settings tab (for example Settings → Integrations → Zephyr Scale). A context banner can show the current screen name (“You are on Review — ask about this screen”).

**Answer engine**
- **Use Generate provider** (default) — follows the provider saved on the current run after Generate. If the run has no saved provider (Repo or Excel open), it uses **Settings → Preferences → Default provider** (not a hardcoded Gemini). The badge shows *Generate provider · …* or *Settings default · …*.
- A specific provider (Gemini, Grok, Groq, Claude, OpenAI, Codex, or Ollama) — uses that provider’s key and model from Settings → AI Providers, via the same backend dispatch as Generate.
- **No AI — docs search only** — no model is called. `GET /api/help/search` returns ranked README / FAQ sections with snippets.

`POST /api/help/chat` keyword-ranks the docs, sends the top excerpts to the chosen provider, and returns `{answer, sources, provider, model}`. Token usage is recorded as action **Help chat**. Provider errors use the existing error mapper (429 / 504 / 502).

**Settings → Preferences → 💬 Help Assistant** (after the Voice input card)
- **Enable launcher**, **Answer engine**, **Include current screen context**, **Clear chat history**, **Reset window position**, editable **quick-question chips** (＋ Add question).
- These preferences, the window position, and conversation history are saved **in this browser’s `localStorage`** (keys `atg.help.prefs`, `atg.help.pos`, `atg.help.history`) — not in `.env` or the database, and not shared between browsers. The page’s **Save changes** button is not needed for them.

---

## Floating windows

Voice input and Help Assistant share a front-end window manager (`frontend/js/winmgr.js`) so the two windows no longer land on the same corner or cover each other.

- **Default dock:** both sit at the bottom-right of the content area (not over the sidebar), with **Help to the left of Voice** and a 12px gap. If there is not enough width, they stack vertically; if there is not enough height either, they cascade (offset) so both title bars stay visible.
- **Minimize tray:** minimized windows become pills in a single tray at the bottom-right (Help, then Voice). Each pill restores that window. The Voice pill still shows LIVE / PAUSED.
- **Maximize:** fills the content area (the sidebar stays visible). The other window is auto-minimized to the tray and is restored to its previous spot when you un-maximize.
- **Click or drag** brings a window to the front (stronger shadow and a slightly brighter title bar). Dragging keeps the window on screen; if the overlap is large at drop, it snaps to the nearest free side.
- Previously saved positions (`atg.voice.pos`, `atg.help.pos`) are still used. If they came from the old “both at `right: 20px; bottom: 16px`” default and would stack on top of each other, they are treated as the new side-by-side dock.

**Settings → Preferences → 🪟 Floating windows** (after the Help Assistant card)
- **Dock both (side by side)** opens both windows (if their launchers are enabled) and places them in the default dock.
- **Reset layout** clears remembered positions and docks both windows.
- Each window’s own **Reset window position** button still moves only that window to its dock slot.
- These preferences stay in this browser’s `localStorage` (not in `.env` or the database). The page’s **Save changes** button is not needed for them.

---


## Test data, coverage and Gherkin

Additive Review and Settings features. Existing Generate, Excel, qTest, and Repo flows stay backward compatible.

**Use Generate provider**
- After **Generate**, the run stores the provider id (`run.model`) and the configured model name (`run.model_name`). Review shows a badge such as `Provider: Groq · openai/gpt-oss-120b`.
- **Regenerate** and **AI Reviewer** use that provider. The AI Reviewer caret offers a **per-call override**; it is not saved on the run. The Regenerate popover names the resolved provider instead of always saying Gemini.
- When a run has no saved provider (opened from the **Test Case Repo** or Excel), Review uses **Settings → Preferences → Default provider** instead of a hardcoded Gemini, and the badge links to that setting. New runs leave `model` empty until you Generate (the Generate dropdown still pre-selects the Settings default).

**Test data generator**
- **Generate test data** (all cases, or regenerate one step) proposes Valid / Invalid / Boundary values. Per-field **Source** can be AI-style samples, the **Edge value library**, or both.
- Accept writes a **Test Data** column on each step (`step.test_data` plus a flattened `data` string). Edit, regenerate, or use **⚡** to insert a library value. Persist with the existing **Save changes** (`PUT /api/review/test_cases`).
- `POST /api/review/testdata` is proposal-only. The default path is heuristic + library (no live model call, so no token row). Token action **Test data** is reserved if an AI path is added later.

**Edge value library**
- Built-in catalog in `backend/data/edge_values.json` (Bug Magnet-style categories such as emails, password length, unicode, whitespace, dates, URLs, and security payloads). These are our own values, not a copy of Bug Magnet’s exact list. Lookups are offline.
- `GET /api/testdata/library` returns the catalog with Settings prefs applied (enable, category toggles, custom values).
- **Settings → Preferences → Edge value library**: enable, toggle categories, add custom values, Import / Export JSON, Reset to built-in. Security payloads are flagged **testing only**.

**Boost coverage**
- **Boost coverage** (`POST /api/review/boost`) previews missing Negative, Boundary, and Security cases. Boundary and Security values come from the Edge library (offline — no extra AI call). Confirm appends the selected cases; they appear with a **NEW** badge. Coverage chips show Positive / Negative / Boundary / Security (legacy **Edge** types count as Boundary).
- Token action **Boost coverage** is reserved if an optional AI path is added later; the default preview does not record usage.

**Gherkin export**
- **Export ▾ → Gherkin (.feature)** (`GET /api/export?fmt=feature`) builds a Feature with optional Background, `@jira-{story}` and type tags (`@negative`, `@boundary`, `@security`), one Scenario per test case, or a **Scenario Outline + Examples** table built from test data. Multiple stories in the same run download as a `.zip` (stdlib `zipfile`, no extra dependency).

**Round-trip**
- Excel import / export includes **Type** and **Test Data** columns. Repo save / load keeps `data` and `test_data`. qTest upload appends `[Test data: …]` to the step description without changing the existing six-column layout. Run history stores the provider on each entry (`model`, `model_name`); Alembic revision `003_provider_testdata` adds those columns and is applied automatically when the app starts (`alembic upgrade head` on uvicorn startup).

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
- Help Assistant ranking is covered by mocked unit tests in `tests/test_help_search.py` (no network, no provider calls).
- Test data, Edge library, Boost coverage, Gherkin export, sanitize preservation, and provider fallback are covered by mocked unit tests in `tests/test_testdata_library.py` (no network, no provider calls).
- Token calculator counts (chars/4 fallback), per-model vs legacy-global rates, ledger provider/action filters, CSV column append, estimate-vs-actual recording, Dashboard near-limit banners, and migration `004_token_calculator` are covered by mocked unit tests in `tests/test_token_calculator.py` (no network, no provider calls).

---

## Original CLI pipeline

```bash
python -m ai_test_generator.test_runner.main_pipeline
```

Still works from the repo root (uses the same `.env`).
