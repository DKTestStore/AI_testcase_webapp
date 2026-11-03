# AI TestCase Generator — Web App

An AI-assisted manual test case generator. It turns a **Jira story** (or pasted / uploaded requirements) into
structured test cases with **Google Gemini** (default model `gemini-3.5-flash`), lets you review and edit them,
exports them to **Excel**, and uploads them to **qTest Manager** with requirement traceability (RTM).

- **Backend:** FastAPI (`backend/`), wrapping the existing `ai_test_generator` package (Jira, Gemini/Codex/Ollama, qTest helpers).
- **Frontend:** static HTML/CSS/vanilla JS (`frontend/`) served by FastAPI, with no build step.
- **Integrations:** Gemini (generation + optional AI reviewer), Jira (story fetch), qTest (module, test cases, requirement links).

---

## Tech Stack

| Layer | Technology | Used for |
|---|---|---|
| Backend | Python, FastAPI, Uvicorn | REST API (`/api/...`) and serving the frontend |
| Config | python-dotenv (`ai_test_generator/.env`) | API keys and settings |
| AI / LLM | Google Gemini (`google-genai`), OpenAI, Ollama | Test case generation (Gemini token usage shown on the Dashboard) |
| Integrations | Jira (`jira`), qTest (REST via `requests`), FastMCP | Story input, test case push, MCP tooling |
| Record | Playwright (Chromium) | Capturing browser actions as test steps |
| Data | JSON files on disk | Runs, repository, test runs (no database yet) |
| Import / Export | pandas, openpyxl | Excel (.xlsx) and CSV import/export, one row per step |
| Frontend | Plain HTML, CSS, JavaScript (no framework) | Single page `frontend/app.html`, hash routing in `app.js`, feature modules (`review.js`, `repo.js`, `casepreview.js`, `dashboard.js`) |
| Charts | Custom donut and bar charts | Dashboard sections; choices saved in localStorage |
| Caching | `?v=N` query on static files | Forces browsers to load new frontend builds |
| Source control | Git + GitHub | Feature branches merged via pull requests |

**Planned (not built yet):** SQLAlchemy + Alembic (SQLite locally, Postgres on Supabase/Neon in production), Supabase Storage or Cloudflare R2 for attachments, hosting on Render free tier (or Oracle Always Free for Record with Playwright).

## 1. Setup

**Requirements:** Python **3.10+** (the existing `jira_worker.py` uses `str | None` syntax), pip. Dependencies are in `requirements.txt`
(FastAPI, uvicorn, python-dotenv, requests, playwright, google-genai, openai, ollama, jira, fastmcp, pandas, openpyxl).

```bash
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt

# configuration (or fill the values later on the Settings page)
# Windows:      copy ai_test_generator\.env.example ai_test_generator\.env
# macOS/Linux:  cp ai_test_generator/.env.example ai_test_generator/.env

# run from the repo root (the folder containing backend/ and frontend/)
python -m uvicorn backend.app:app --port 8000        # add --reload while developing
```

Open **http://localhost:8000** and click **Welcome →**. No username or password is needed; the button starts a browser session.

### Record feature (⏺ Record on the Input step) — extra setup
The recorder opens a **real Chromium window on the machine that runs the app** (your PC when you use `localhost`).
It needs Playwright and its browser once:

```bash
pip install playwright                 # already in requirements.txt
python -m playwright install chromium  # downloads the recorder browser + ffmpeg (used for the evidence video)
```

- **Windows / macOS:** the window always opens visibly. If Playwright's Chromium is missing, the installed Google Chrome or
  Microsoft Edge is used instead.
- **Linux:** the window opens on your desktop (`DISPLAY` or `WAYLAND_DISPLAY`). On a server **without** a display the
  recorder can only run headless — it is invisible and you cannot interact with it; the Record page shows this warning.
  `ATG_REC_HEADLESS=1` forces headless (CI only). `ATG_REC_CHROME=<path>` selects a specific Chrome executable.
- Without Playwright, *Start recording* shows these install commands instead of failing silently.

### Configuration keys (`ai_test_generator/.env`)
`.env` holds secrets. **Never commit it** (it is in `.gitignore`); only `.env.example` (empty values) is tracked.

| Feature | Keys |
|---|---|
| Generate with Gemini (default) | `GEMINI_API_KEY`, `GEMINI_MODEL` (e.g. `gemini-3.5-flash`) |
| Generate with Codex (optional) | `OPENAI_API_KEY` |
| Generate with Ollama (optional) | `OLLAMA_MODEL` (default `gemma3:4b`), `OLLAMA_HOST` (default `http://localhost:11434`), `OLLAMA_TIMEOUT` (seconds, default 300; shows a clear error instead of loading forever), `OLLAMA_NUM_CTX` (context window, default 8192). Both are editable on the Settings page. The console prints when an Ollama call starts and how long it took. |
| Jira story input | `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` |
| qTest upload | `QTEST_BASE_URL` (`https://<site>.qtestnet.com/api/v3/projects`), `QTEST_TOKEN` (`Bearer …`), `QTEST_PROJECT_ID`; optional `QTEST_REQUIREMENT_ID`, `QTEST_PARENT_MODULE_ID` |
| Original CLI only | `ENABLE_JIRA_REQURIMENT`, `STORY_ID` |

All keys can be edited on the **Settings** page. They are written to `.env` on the server, and secrets are only ever shown masked.

---

## 2. Workflow

The sidebar shows the four steps with progress. A step unlocks once the previous one has data. Each step page shows
the current **Ticket / Story ID** as a pill next to the title (for example `🎫 Ticket CX-196`). The pill is hidden when there is no ticket.
The sidebar footer shows `Run RUN-YYYYMMDD-NNN` and `Story <id>`.

1. **Input:** three options:
   - *Jira Story*: enter a Story ID → **Fetch**. The scenarios and acceptance criteria are extracted and can be edited.
   - *Local text*: paste text or drop a `.txt` file.
   - *⬆ Upload test cases (Excel)*: import existing test cases and go straight to Review. **Generate is skipped**
     (the sidebar marks it "skipped"), and you can continue to qTest without generating anything.
2. **Generate:** choose a model (Gemini / Codex / Ollama), then the **Default prompt** (`test_cases_generator_prompt.md`) or a **Custom prompt**.
   You can also run the **AI Reviewer**. A token usage card is shown.
3. **Review:** edit and curate the test cases (see below), then **Save & Download Excel**.
4. **qTest Upload:**
   - *Upload*: choose project / requirement / module (new or existing), then **Preview payload** (paginated JSON, nothing is sent)
     and **Confirm Upload**. A results summary is shown.
   - *RTM*: Story → AC → TC → qTest IDs, search/filter, AC mapping, **Export RTM (Excel)** and **Retry failed**.

**＋ New run** starts a fresh run. The previous run stays in Run history. **Log out** clears only the session.

### Review UI
- Every field can be edited inline: name, description, precondition, step descriptions and expected results.
- **Priority** (High / Medium / Low) and **AC tags** per test case, with filters by status, priority and AC.
- **Reorder** test cases and steps (drag or ▲▼). IDs and step numbers are re-sequenced automatically.
- **Review status** pill (Not reviewed / Reviewed / Needs changes), a reviewed x/n progress bar, and bulk actions.
- **Pagination** (10 / 25 / 50 / 100 per page), "Jump to TC…", search, expand/collapse all, and internal scrolling for long lists.
- Unsaved-edit indicator with a leave/navigation guard. **Run AI Reviewer** lets you apply or dismiss the reviewed version.

### Excel download and upload
- **Excel export** contains the 6 qTest columns: *Test Case ID, Test Case Name, Test Case Description, Precondition,
  Step Description, Expected Result*. It adds **AC Tags, Priority, Review Status** and an **AC List** sheet.
  The extra columns are for review only and are **never sent to qTest** (the payload builder reads only the 6 mapped columns).
- **Upload Excel** is available on the Review page (toolbar button) and on the Input page. Rules:
  - `.xlsx` only, max 5 MB, first sheet is read. Header names are matched flexibly.
  - Required columns: name, step and expected result. A missing column is reported clearly.
  - Validation preview: counts, warnings (for example an invalid priority or status falls back to the default),
    and highlighted cells. Import is disabled while there are errors.
  - Modes: **Replace all**, **Append** (renumbered), **Merge by TC ID** (update matching IDs, add new ones).
  - **Download template** gives a sample workbook with an Instructions sheet (`GET /api/excel/template`).

---

### Batch mode (multiple stories)

Click **▦ Batch mode** (last tab on Input). Batch mode is a separate workspace with its own purple layout;
your single run is kept exactly as it is and **↩ Exit batch** brings you back to it.

1. **Batch items** (max 10): add Jira IDs (fetched one by one, retry/remove on failure), local text stories
   (no ID → `LOCAL-001`, `LOCAL-002`…) and several `.xlsx` files (ID taken from the file name; these skip Generate).
2. **Generate queue**: items generate one at a time with per-item status, tokens and time; cancel, skip or retry
   any item. Finished items can be reviewed while the others generate.
3. **Review items**: the normal review cards (incl. ↻ Regenerate) per item, with the ticket pill. Mark each item **Ready** by hand.
4. **qTest batch upload**: Ready items are pre-selected. Jira/Excel items look up their qTest requirement by story ID
   (if none is found they upload without a link); local items need a module. Per-item results and retry of failed uploads.
   **⬇ Excel (zip)** downloads one workbook per item.

In Run history a batch is **one** entry (`BATCH-YYYYMMDD-NN`) that expands to its per-story runs; it counts as one
toward the history limit and, when it is the oldest, it is removed as a whole.

## 3. Run history

- Each browser keeps a rolling list of its most recent runs. The browser is identified by a long-lived `atg_history` cookie,
  separate from the `atg_session` session cookie, so **Logout and New run never clear history**.
- Readable run IDs: **`RUN-YYYYMMDD-NNN`**, a daily sequence in IST (e.g. `RUN-20261029-003`). The Story ID is shown in its own column.
- Columns: Run ID + date/time (IST), Story + title, Source (Jira / Local text / Excel upload), Test cases, Reviewed x/n,
  Status (Draft / Reviewed / Uploaded to qTest). Actions: **Open** (resume into the session), **Download Excel**, **Delete** (with a confirm).
- **Rolling FIFO:** when a new run is saved beyond the limit, **only the oldest run is removed**. History is never cleared all at once.
  The oldest row is tagged "will be replaced next" when the list is full.
- **Configurable limit:** set it in **Settings → Run history limit** (whole number **1–100**, default **5**). Lowering it removes only
  the oldest runs beyond the new limit; raising it keeps everything. The banner ("Keeps your last N runs…") and the "x of N runs" footer follow it.
- Shown in the sidebar (**Run history** with a count badge) and as a **Recent runs** panel below the Setup checklist.
- A run is recorded when it has test cases and something is saved (generate, review save, AI review accept, Excel import/save,
  qTest upload) or when you switch runs. The list reads only a small index; full run details load lazily on Open or Excel.
- **Storage:** `backend/history/<history-id>/history.json` (index) and `backend/history/<history-id>/runs/<run_id>.json` (snapshots).
  Excel files are written to `ai_test_generator/reports/runs/<run_id>/`.

## 4. Setup checklist, Settings, logs

- **Setup checklist** (first screen after Welcome) has a progress ring (x/5) and five cards: Gemini API key, Gemini model (required),
  Jira, qTest (optional), and **Default prompt** (required). The Default prompt card is set when `test_cases_generator_prompt.md` exists and is not empty.
  Its **View / Edit in Settings →** link opens the **Default prompt editor** on the Settings page, which saves to `ai_test_generator/prompt/test_cases_generator_prompt.md` and rejects empty text.
- **Settings:** `.env` keys (secrets masked), the Default prompt editor, and the **Run history limit**.
- **App settings file:** non-secret app settings (such as `history_limit`) are stored in `backend/app_settings.json`, not in `.env`.
- **Logs:** `backend/logs/app.log`, a rotating log (**5 MB × 3** backups) covering session start/logout, history open/delete,
  limit changes, prompt updates and unexpected errors.

Runtime data is git-ignored: `ai_test_generator/.env`, `ai_test_generator/reports/*`, `backend/sessions/`, `backend/history/`,
`backend/logs/`, `backend/app_settings.json`.

---

## 5. Project structure

```
.
├── ai_test_generator/          # existing package (Jira worker, AI helpers, qTest utils, CLI pipeline)
│   ├── .env.example            # copy to .env (never commit .env)
│   ├── prompt/                 # test_cases_generator_prompt.md, test_cases_reviewer_prompt.md
│   ├── ai_helpers/  qtest_utils/  worker/  test_runner/  input/
│   └── reports/                # outputs: runs/<run_id>/*.xlsx, gemini_usage.json, payload JSON
├── backend/
│   ├── app.py                  # FastAPI routes, page serving, rotating log setup
│   ├── services.py             # wrappers around the existing functions (errors returned to the UI)
│   ├── parsing.py              # markdown ⇄ test cases, AC splitting / TC→AC mapping
│   ├── excel_io.py             # review columns + AC List sheet, template, Excel import (validate / modes)
│   ├── history_store.py        # rolling run history (index + snapshots, FIFO)
│   ├── test_repo.py            # Test Case Repo: folders, versions, duplicate check, import, AI review (/api/repo/*)
│   ├── test_runs.py            # Test Runs: cycles, executions, attachments (/api/runs/*, /api/attachments/*)
│   ├── session_store.py        # per-browser current run (memory + backend/sessions/*.json)
│   ├── settings_store.py       # .env settings (masked) + app_settings.json (history limit)
│   └── config.py               # paths, .env loading, data folders
├── frontend/
│   ├── welcome.html  app.html  css/app.css
│   └── js/ app.js  review.js  excel_upload.js  history.js  welcome.js  repo.js  runs.js  casepreview.js  (css/repo.css, css/casepreview.css)
├── requirements.txt
├── README.md
└── NOTES.md                    # assumptions and known gaps
```

## 6. Testing notes

Offline test switches (process environment only, never read from `.env`): `ATG_MOCK_GEMINI=1`, `ATG_MOCK_JIRA=1`
(`ATG_MOCK_JIRA_MISSING=MTG-1427`), `ATG_MOCK_QTEST=1` (`ATG_MOCK_QTEST_FAIL=…`, `ATG_MOCK_QTEST_NOREQ=…`), `ATG_MOCK_DELAY=1.5`.


- End-to-end checks were run with Playwright (Chromium / Google Chrome) against `http://127.0.0.1:8000`. They cover:
  - Review editing, pagination and qTest payload preview.
  - Excel export columns and upload in each mode, plus error cases.
  - Run history: FIFO, logout/re-login, Open, Delete, New run.
  - Ticket ID pill and history limit changes, including invalid values.
- Test data can be created **without Gemini calls** through Excel import (`POST /api/excel/import`) or by saving test cases
  (`PUT /api/review/test_cases`) after a Local text input. Use **Preview payload** to check qTest output without uploading.
- Useful endpoints: `GET /api/health`, `GET /api/setup/status`, `GET /api/history`, `GET|PUT /api/settings/history_limit`.

## Test Case Repo & Test Runs

Store reviewed test cases for reuse, group them into cycles and execute them step by step. No extra setup:
no new Python dependency (uploads are sent as base64 JSON like the Excel upload; `openpyxl` is already required)
and no new `.env` key — AI review uses the existing Gemini settings.

**Data folders** (created automatically, git-ignored, back them up if you care about the data):

| Folder | Content |
|---|---|
| `backend/test_repo/repo.json` | repo folders + test cases (with every version snapshot) |
| `backend/test_repo/runs.json` | cycles, cycle items and every execution attempt |
| `backend/attachments/` | execution attachments (images / videos / logs / PDF, max **50 MB** each), served only via `GET /api/attachments/<name>` (strict file-name check) |

Writes are atomic (temp file + replace) under a thread lock and an `fcntl` file lock.

**Usage flow**
1. **Review** page → next to the unchanged *Continue to qTest Upload* there are two new buttons:
   - **🗂 Save to Test Case Repo** – choose the folder (default *Project › Story* from the Jira key, or ＋ New folder), status
     *Draft / Ready*, tags and linked story. Every case is checked against the repo cases of the same story:
     *Update → vN+1* (creates a new version), *Save as new* or *Skip* (default *Skip* when identical).
   - **▶ Execute now** – new quick-run cycle (`Quick run – <story> – DD-Mon-YYYY`, build / environment / assignee as free text)
     or add to an existing cycle. Cases are saved to the repo automatically (new ones as *Draft*) and the cycle opens.
2. **Test Case Repo** (sidebar): folder tree with counts, search (title, step text, TC-ID), filters (priority, status, source,
   last result), bulk *Add to cycle / Move / Mark Ready / Delete* (with confirm), **Import** (.xlsx or .csv using the app's
   upload-template columns, or JSON), and a case preview drawer / full page (see *Case detail* below). IDs are `TC-0001…`.
   **＋ New test case** / ✎ Edit: all fields are text, step editor (step / expected / test data – add, duplicate, delete,
   drag or ▲▼ to reorder), *Save draft*, *Save as Ready*, **🤖 Review with AI** – per-field / per-step suggestions plus an AC
   coverage score; Accept / Reject each or all, nothing changes until you *Apply* (token usage recorded as
   *AI review (repo)* with the model name).
   - **Pagination**: the case table always shows a pager above and below it (Showing a–b of N, rows per page
     10 / **25** (default) / 50 / 100, ‹ Prev, page numbers, Next ›). It resets to page 1 when the search, filters,
     *Show archived* or the selected folder change.
   - **⬇ Export ▾** (next to Import): Excel (.xlsx) or CSV. Exports the ticked cases, or every case matching the current
     folder / search / filters if none are ticked (archived ones only when *Show archived* or *Status: Archived* is on).
     One row per test step; the case fields (Test Case ID, Test Case Name, Folder Path, Priority, Case Status, Version,
     Source, Story, Description, Precondition, Last Result, Updated) are on the first row of each case, followed by
     Step No, Step Description, Expected Result, Test Data. Endpoint: `POST /api/repo/export`
     `{ids, format: "xlsx"|"csv", include_archived}`. The file can be re-imported via **Import** (title, description,
     precondition, priority and steps/expected are read back; test data, folder and status are not).
3. **Test Runs** (sidebar): cycles list with ＋ New / ✎ Edit (all free-text fields) / ⧉ Clone / 🗄 Archive / 🗑 Delete (type the
   name to confirm). Inside a cycle: ＋ Add cases (folder tree + checkbox list, *Ready only* on by default, priority and
   *last result failed* filters), status filter chips, assignee filter, reassign, remove, ▲ reorder, ▶ Run selected,
   ▶ Continue execution.
4. **Execution screen**: case list with status dots, step cards (Actual result, *= Same as expected*, Pass / Fail / Blocked / N/A),
   attachments per step (Upload image/video, 📋 Paste or Ctrl+V a screenshot, thumbnails, centred preview, delete),
   *Pass all remaining*, timer, overall status derived automatically (any Fail → Fail, else any Blocked → Blocked,
   all Pass/N/A → Pass) with an override that requires a reason, defect keys, comments, Save / Save & exit / Save & next.
   Shortcuts: `P` `F` `B` `N` set the current step, `J`/`K` move, `Ctrl+Enter` save & next. Every attempt is stored separately
   with the case version it ran against; history is shown per case. *Log defect to Jira* and *Sync to qTest* are shown
   disabled (“coming soon”).

**Folders, archive and review from repo (v4)**
- **Folders are stored records** (`id, name, parent, order, description` in `repo.json`). The Repo tree and the Review
  *Save to Test Case Repo* modal read the same list. A missing default folder is only *suggested* as
  “(new) Project › Story” and is created when you save. Older `repo.json` files are migrated once on first load:
  folder records are rebuilt from the cases' folder/story, so nothing is lost.
- Folder **⋯ menu**: Rename (inline, Enter/Esc), New sub-folder, Move up / down, Delete…. Drag ⋮⋮ to reorder (order is saved).
  **＋ New folder** opens a modal (name, parent picker, description, duplicate-name check). **Delete folder** asks to
  move the cases to another folder or archive them, and you type the folder name to confirm.
- **Archived** test cases are hidden by default (*Show archived* toggle or Status filter), can be restored (↺ Restore),
  can't be added to new cycles, and still appear in execution history. **Delete** on a case that was executed or is in
  a cycle archives it instead. In a cycle such cases show muted as *Case archived* / *Case removed* with *Remove from cycle*.
  Cycles can always be deleted or archived, even when their cases are gone. The name confirmation ignores dash type, spacing and case.
- **Expand / collapse folders**: every folder that has sub-folders gets a ▸/▾ caret, and *All test cases* has ⊞ Expand all / ⊟ Collapse all. The state is remembered per browser (localStorage), and the selected folder's parents open automatically. This works the same in the Repo tree, the Save-to-repo modal and the Add-cases picker.
**Case detail (preview v2)** — `frontend/js/casepreview.js`, `frontend/css/casepreview.css`
- Click a row in the Repo table to open the **drawer** (default 60 % wide; drag its left edge to resize, the width is remembered
  per browser). **⤢** opens the **full page** at `#repo/case/TC-0050` (shareable / bookmarkable; the sidebar collapses to icons,
  ☰ toggles it; ⤡ goes back to the drawer).
- Sticky header: TC-ID, title, folder path, **‹ N of M ›** over the current filtered/searched list (also `J` / `K`; `Esc` closes
  the drawer), ✎ Edit (existing editor), ＋ Add to cycle, **▶ Run now** (pick a cycle that already contains the case, add it to
  another cycle, or create a quick-run cycle → opens the execution screen for that case), ⋯ Duplicate / Move to folder /
  Export this case (.xlsx/.csv via `POST /api/repo/export` with one id) / Archive or Restore.
  **Status dropdown** (Draft / Ready / Deprecated — stored as `Obsolete` for compatibility) saves immediately. The story chip
  links to `<JIRA_URL>/browse/<KEY>` when the Jira base URL is configured in Settings, otherwise it is a plain chip.
- **Steps**: stats strip (step count, story, last run + date, pass rate, last-5 result dots), collapsible Description &
  Precondition, step cards (Action | Expected, test-data chip), Detailed / Compact, click a step to edit inline, drag ⋮⋮ to
  reorder, *＋ insert step* between cards, ⎘ Copy steps (plain text), ✨ Regenerate with AI (same service as Review's
  Regenerate; shows a diff and saves only after confirm). Every save creates a new version.
- **Versions**: version list, word-level diff (inline or side-by-side; removed = red strikethrough, added = green) per field
  and per step against any other version, **↺ Restore vN** (creates a new version with the old content).
- **Executions**: timeline of every attempt (cycle, date, tester, env/build, version, defects, result); expand for per-step
  actual result, status and attachment thumbnails.
- **Attachments**: all run screenshots / videos grouped by run (type filter, click to preview) plus **case-level attachments**
  (⬆ Upload, same `/api/attachments` endpoint and 50 MB limit).
- **Activity**: audit log (created, edited, regenerated, restored, status changed, moved, archived / restored, ran, commented,
  attached) and comments. New events are stored on the case (`activity`, `comments`, `attachments` fields — added lazily, old
  data stays valid); history from before this release is derived from versions and executions.
- Endpoints (all under the session): `GET /api/repo/cases/{id}` (now also returns `activity`, `cycles`, `jira_base`),
  `POST /api/repo/cases/{id}/status|comments|duplicate|restore_version|regenerate|attachments`,
  `DELETE /api/repo/cases/{id}/attachments/{name}`.

- **Pagination** (10 / 25 / 50 / 100 rows) on the Repo table, the cycles list (with search and status filter) and the cycle run list.
- **🔍 Review** (bulk bar, one or more cases): opens the cases as a new run (source *Repo*) in Review step 3. If a run is
  already open, a confirm dialog appears and that run is saved to Run history first. A toast links to it and Run history
  marks it *Just saved*. On a repo run the Review button becomes **Save back to repo (update N)**, which writes edits back as
  new versions of the same cases (no duplicates; repo test data is kept).

Mock for tests: with `ATG_MOCK_GEMINI=1` the AI review returns deterministic suggestions (no Gemini call).
E2E: `/workspace/e2e/test_testrun.py` (`ATG_BASE=http://127.0.0.1:8001`).

## Original CLI pipeline
`python -m ai_test_generator.test_runner.main_pipeline` still works as before (run from the repo root).

## Prompt templates (multi-select)
- Sidebar → **Prompt templates**: built-in locked **Default** (= `ai_test_generator/prompt/test_cases_generator_prompt.md`, view/duplicate only) plus API / UI / Security / Performance / Regression starters. Stored in `backend/prompt_templates.json` (gitignored, re-seeded if missing).
- Placeholders: `{{story_title}}`, `{{description}}`, `{{acceptance_criteria}}` (required, validated on save), `{{num_cases}}`, `{{test_types}}`, `{{detail_level}}` (optional, from template options). Unknown placeholders are warned about and left as-is. The output template is appended if the prompt lacks `Test Case ID:`.
- Input step → **Generate options**: pick one or more templates. Selecting several calls the model once per template, merges results (each case tagged with its template), renumbers TC IDs and records one Token Usage row per call.
- Interaction with the Generate step: **Custom prompt** always overrides templates (unchanged behaviour). **Default prompt** uses the Input-step template selection; when the selection is just the built-in Default (initial state) the original code path runs unchanged.
- Batch: batch-level multi-select plus a per-item override column (Excel items: n/a).

## Review tools (Export, Edit mode, Traceability matrix, Type tags, Version history, Quality score)

All additive — the existing Review cards, drag handles, priority dropdown, **＋ Test case**, **Save & Download Excel**
and the Batch layout work exactly as before.

- **⇩ Export ▾** (Review toolbar, and on each batch item in *Generate queue*): Excel (.xlsx), CSV, or qTest-import CSV.
  Pick columns (ID, Name, Description, Precondition, Priority, AC mapping, Review status, Template, Type),
  *Include steps (one row per step)* and *Only reviewed test cases*. API: `GET /api/export?fmt=xlsx|csv|qtest&cols=…&steps=1&reviewed=0[&item=<batch key>]`.
  Exports are written to `reports/runs/<run>/exports/` and never change the run's saved Excel; the default xlsx
  layout reuses the same writer as Save & Download Excel.
- **Edit mode (✎ on a card)**: edit title, description, precondition, steps and expected results in text boxes,
  add/delete steps, delete the test case (click twice). **＋ Add test case** at the bottom adds one in edit mode.
  The unsaved-changes bar now has **Save** / **Discard**.
- **☰ List / ▦ Matrix**: List is the default card view. Matrix shows AC rows × TC columns, coverage %, uncovered ACs in red
  with *Generate test cases for ACn* (the existing coverage “Generate TC for AC” flow) and *Export matrix* (CSV).
- **Type tags**: each test case gets Positive / Negative / Edge. The generator prompt asks for an optional
  `Test Case Type:` line (set `ATG_TYPE_HINT=0` to disable); when it is absent a keyword heuristic is used.
  Click the chip to change it. Priority/Type filter chips with counts sit under the toolbar (the priority chips
  drive the existing *All priorities* select).
- **🕘 Versions**: a version is stored per run on Generate, Save (incl. accepted Regenerate / Improve with AI),
  AI-review accept and Excel import (`reports/runs/<run>/versions.json`, last 30). Restore any version, or compare
  two (added / removed / modified with word-level highlights, unified or side by side).
  API: `GET /api/versions`, `POST /api/versions/{v}/restore`.
- **Quality score**: local heuristic (no AI call) per test case 0–100 = 40 % clarity + 40 % completeness + 20 % duplicate risk;
  overall run score, *Weak* flag (< 50), *Weak only* filter, *Sort: score ↑*. Click a score for the breakdown;
  **Improve with AI** makes one regenerate call for that test case (mocked with `ATG_MOCK_GEMINI=1`).
- Tests: `/workspace/e2e/rt.py` (mock server on 8001; `ATG_BASE` overrides). Mock generate emits
  `Test Case Type:` lines when the feature text contains `[mock-types]`.

## Dashboard
Sidebar → **Dashboard** (route `#dashboard`, detail views `#dashboard/<section>`). Read-only; data from
`GET /api/dashboard?cycle=&story=&folder=&from=&to=` (`backend/dashboard.py`), computed from the Test Case Repo,
Test Runs (active cycles, executions, defect keys) and Token Usage.

- Tiles: total cases, active cycles, pass rate across active cycles, failed cases without a defect.
- Sections: cases by story/folder × status, cycle progress, pass/fail/blocked/not run per cycle, failed cases + linked
  Jira defect keys (links use the Jira URL from Settings), executions per tester, AI vs manual cases + token usage per story
  (cost uses the Token Usage $/1M rates).
- Every section has a **Table | Donut | Bar** switch (pure SVG, no libraries); the choice is remembered per section in localStorage.
- **Customize**: show/hide, drag to reorder, default chart per section, default cycle and date range (localStorage; Reset).
- Not backed by data yet: Jira defect *status* (not fetched – shown as "not synced"); "+ Log defect" is disabled (coming soon).
