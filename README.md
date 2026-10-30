# AI TestCase Generator — Web App

An AI-assisted manual test case generator. It turns a **Jira story** (or pasted / uploaded requirements) into
structured test cases with **Google Gemini** (default model `gemini-3.5-flash`), lets you review and edit them,
exports them to **Excel**, and uploads them to **qTest Manager** with requirement traceability (RTM).

- **Backend:** FastAPI (`backend/`), wrapping the existing `ai_test_generator` package (Jira, Gemini/Codex/Ollama, qTest helpers).
- **Frontend:** static HTML/CSS/vanilla JS (`frontend/`) served by FastAPI, with no build step.
- **Integrations:** Gemini (generation + optional AI reviewer), Jira (story fetch), qTest (module, test cases, requirement links).

---

## 1. Setup

**Requirements:** Python **3.10+** (the existing `jira_worker.py` uses `str | None` syntax), pip. Dependencies are in `requirements.txt`
(FastAPI, uvicorn, python-dotenv, requests, google-genai, openai, ollama, jira, fastmcp, pandas, openpyxl).

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

### Configuration keys (`ai_test_generator/.env`)
`.env` holds secrets. **Never commit it** (it is in `.gitignore`); only `.env.example` (empty values) is tracked.

| Feature | Keys |
|---|---|
| Generate with Gemini (default) | `GEMINI_API_KEY`, `GEMINI_MODEL` (e.g. `gemini-3.5-flash`) |
| Generate with Codex (optional) | `OPENAI_API_KEY` |
| Generate with Ollama (optional) | `OLLAMA_MODEL` (default `gemma3:4b`), `OLLAMA_HOST` (default `http://localhost:11434`) |
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
- **Pagination** (25 / 50 / 100 per page), "Jump to TC…", search, expand/collapse all, and internal scrolling for long lists.
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
│   ├── session_store.py        # per-browser current run (memory + backend/sessions/*.json)
│   ├── settings_store.py       # .env settings (masked) + app_settings.json (history limit)
│   └── config.py               # paths, .env loading, data folders
├── frontend/
│   ├── welcome.html  app.html  css/app.css
│   └── js/ app.js  review.js  excel_upload.js  history.js  welcome.js
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

## Original CLI pipeline
`python -m ai_test_generator.test_runner.main_pipeline` still works as before (run from the repo root).

## Prompt templates (multi-select)
- Sidebar → **Prompt templates**: built-in locked **Default** (= `ai_test_generator/prompt/test_cases_generator_prompt.md`, view/duplicate only) plus API / UI / Security / Performance / Regression starters. Stored in `backend/prompt_templates.json` (gitignored, re-seeded if missing).
- Placeholders: `{{story_title}}`, `{{description}}`, `{{acceptance_criteria}}` (required, validated on save), `{{num_cases}}`, `{{test_types}}`, `{{detail_level}}` (optional, from template options). Unknown placeholders are warned about and left as-is. The output template is appended if the prompt lacks `Test Case ID:`.
- Input step → **Generate options**: pick one or more templates. Selecting several calls the model once per template, merges results (each case tagged with its template), renumbers TC IDs and records one Token Usage row per call.
- Interaction with the Generate step: **Custom prompt** always overrides templates (unchanged behaviour). **Default prompt** uses the Input-step template selection; when the selection is just the built-in Default (initial state) the original code path runs unchanged.
- Batch: batch-level multi-select plus a per-item override column (Excel items: n/a).
