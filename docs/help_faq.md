# Help FAQ

Short answers for the in-app Help Assistant. These notes complement the README and stay aligned with current app behaviour.

## How to generate test cases

1. On **Input**, fetch a **Jira Story**, paste **Local text**, or **Upload Excel** (Excel skips Generate).
2. Optionally pick prompt templates on Input, or use **Record** to capture steps.
3. On **Generate**, choose a **Provider** (Gemini, Grok, Groq, NVIDIA, Claude, OpenAI, Codex, or Ollama) and Default / Custom prompt.
4. Optionally turn on **Also run AI Reviewer after generation**.
5. When it finishes, continue to **Review** to edit, map acceptance criteria, generate test data, boost coverage, and export (including Gherkin).

A sidebar step unlocks once the previous one has data. Configure API keys on **Settings → AI Providers**.

## Connect Jira

Jira is used to fetch a story on the **Input** step and is optional (you can use Local text or Excel without it).

1. Open **Settings → Integrations → Jira**.
2. Set `JIRA_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN`. Leave a secret blank to keep the saved value.
3. On **Input**, choose **Jira Story**, enter the issue key, and fetch. Acceptance criteria are extracted for Generate.

You can also import requirement keys from the Requirements area.

## Zephyr Scale Cloud upload

**Zephyr Scale Cloud upload is not implemented yet.**

You can still store connection details so they are ready when upload ships:

1. Open **Settings → Integrations → Zephyr Scale**.
2. Set `ZEPHYR_BASE_URL` (example: `https://api.zephyrscale.smartbear.com/v2/`).
3. Paste `ZEPHYR_API_KEY`. Leave the field blank to keep a key that is already saved.
4. Optionally, on a **Project**, store a `zephyr_project_key` — this is a mapping field only; there is no Zephyr API client yet.

Today, test-case upload + RTM is available for **qTest Manager** on step 4 (Preview payload → Confirm Upload).

## Parse errors

The README has no dedicated “parse error” heading. A parse error usually means the model’s reply could not be turned into test-case cards. The parser looks for headings such as `Test Case ID:` and markdown table rows starting with `|`.

Try:

1. Check the raw model output on Generate / Review, if it is shown.
2. Confirm the provider and exact model ID on **Settings → AI Providers**. A wrong or retired model ID can return an error page instead of cases.
3. Retry Generate, or use **Upload Excel** on Input / Review to load cases without the parser (`GET /api/excel/template`).
4. If Groq returns HTTP 429, wait and retry — the app retries up to 2 times using the `retry-after` header.

## Groq model 404

If Groq returns HTTP 404, the Model ID in **Settings → AI Providers → Groq** is not available on your Groq account.

The app default `llama-3.3-70b-versatile` (used when `GROQ_MODEL` is blank) is Enterprise-only for some accounts and will 404 on a free or developer key.

Set `GROQ_MODEL` to a model listed in your Groq console, for example `openai/gpt-oss-120b` or `openai/gpt-oss-20b`. Enter the exact ID; do not treat example names as guaranteed.

## NVIDIA provider

**Settings → AI Providers → NVIDIA** is an OpenAI-compatible Catalog / NIM provider (default base URL `https://integrate.api.nvidia.com/v1`). Paste `NVIDIA_API_KEY`, or set it in `ai_test_generator/.env`. The default model is `nvidia/nemotron-3.5-super-vl-120b-a12b` when the Model ID is blank.

Enable thinking is **off** by default — keep it off for JSON test cases. When on, reasoning tokens are discarded and only the final message content is used. Seeded example prices are 0, with the note “NVIDIA free trial — enter rates if billed”. Leave Temperature blank to keep the usual Generate 0.2 / Review 0.0 defaults.

Seeded catalog (Super stays the default). Suggested uses:

- **Generate / Review:** `mistralai/mistral-large-4-1t-a52b` (262,144), `nvidia/nemotron-3.5-super-vl-120b-a12b` (262,144, default), `z-ai/glm-5.3-flash` (1,048,576), `minimaxai/minimax-m3.1-flash` (262,144)
- **Regenerate / Help:** `nvidia/nemotron-3.5-lightning-30b-a3b` (1,048,576), `nvidia/nemotron-3.5-bolt-e4b` (65,536), `openai/gpt-oss-20b` (131,072)

Missing seed IDs are merged into an existing saved registry on read; your edits and any models you Removed and Saved are not overwritten or re-added.

Pick **NVIDIA** on Generate, in Review / Repo regenerate pickers, or as the default provider in Preferences. The app uses non-streaming text completions (no image parts).


Free-tier keys also have per-minute and per-day limits. HTTP 429 is retried up to 2 times.

## What is AI Reviewer

**AI Reviewer** is an optional second pass over generated test cases.

1. On **Generate**, tick **Also run AI Reviewer after generation**, or click **Run AI Reviewer** on the Review toolbar.
2. When it finishes, Review shows the result so you can compare, apply, or dismiss the suggestions.
3. It defaults to the same provider as **Generate** for that run (the Review badge shows the provider and model name). If the run has no saved provider (Repo or Excel), it uses **Settings → Preferences → Default provider**. **Run AI Reviewer** opens a modal to search and pick a **provider and model** (grouped by provider, current/default marked), shows a pre-call estimate, and runs only after **Confirm**. The same modal is used from Repo edit (**Review with AI**) and Repo case regenerate. Token usage is recorded in the ledger with estimated vs actual values.

The Review row button is labelled **Regenerate** (the provider name is inside the popover, not on the button). The popover stays in the viewport — it flips upward near the bottom of the list and scrolls internally, so it does not extend the page.

**Regenerate** windows share the same options: quick chips (Add negative cases, Add boundary values, More detailed steps, Simplify), **Cover AC…**, **Keep my edits to title & priority**, and **Add as a new test case instead of replacing**. In the Test Case Repo, “add as new” creates a new case and leaves the current one unchanged; otherwise the proposal is saved as a new version of the current case. Keep title & priority is honoured on the proposal and when you confirm.

### Auto Save

**Settings → Preferences → Auto Save** is on by default. Edits in the Review step, Requirements, the Test Case Repo editor, and the Automation Script editor are saved automatically about 1.5 seconds after you stop typing, using the existing save endpoints. The indicator reads **Saving…**, **All changes saved**, or **Save failed – retry** (click to retry). Manual Save buttons still work. Autosave waits when a title is empty or a Jira key is only partly typed, and it flushes when you leave the page. In the Repo editor, autosave updates the live case in place and does not create a new version on every save; use **Save draft** or **Save as Ready** when you want a new version. In the Automation Script editor, autosave likewise updates the working copy; use **Save as new version** for a snapshot.

This is separate from inline editing, AC mapping, duplicate detection (local, no AI call), and the local quality score / Improve with AI tools on the Review toolbar.

## Review screen

The **Review** step (step 3) is where you work with generated (or uploaded) cases before export or upload.

- Edit names, descriptions, preconditions and steps inline. Set priority, AC tags and review status.
- Toolbar: ＋ Test case, Save changes, Run AI Reviewer (opens the shared provider/model picker, then Confirm), **Generate Automation Script**, Check duplicates, **Generate test data**, **Boost coverage**, Upload Excel, Save & Download Excel, Export (Excel / CSV / qTest / Gherkin). A **Scripts (n)** badge on each case opens the Automation Scripts workspace with that case selected (`#scripts?tc=…`).
- A provider badge shows the Generate provider, or the Settings default when the run has none. Coverage chips count Positive / Negative / Boundary / Security cases. Each step has a **Test Data** column (edit, regenerate, or ⚡ insert from the Edge library).
- Additive tools also include Edit mode, AC coverage (List / Matrix), type tags, version history and a local quality score.
- When you are happy, **Save to Test Case Repo** or **Execute now**, or continue to **qTest Upload**. Test data is appended into the qTest step description; the six-column layout is unchanged.

Unsaved edits are guarded. A step unlocks once the previous one has data.


## Generate Automation Script

From **Review** (action row or bulk bar) or the **Test Case Repo** (bulk bar or per-row menu), **Generate Automation Script** builds runnable tests for the selected cases.

1. Choose **Language** (one, by default), **Type** (UI / API / Database / Mobile, several at once), and **Framework**. Grey chips are incompatible with the current language or types — hover for the reason. Catalogue and selection mode are under **Settings → Script options**.
2. Fill the context cards (base URLs, auth, database placeholder, mobile device) and optional **Additional context**. The token estimate includes this text.
3. Pick a provider and model with the shared AI picker, then Generate. Optional: reuse locators from an accessible Recorder session.
4. Review files, mapping and warnings. Copy, download one file or a `.zip`, or **Save to Script Library** (new script, or overwrite an existing one as a new version). **Mirror Test Case Repo folders** copies the current repo folder path into the script library.

Open **Automation Scripts** in the sidebar for the project workspace. **Generated versions** in the header is the former Script Library (folders and AS-#### bundles are unchanged). **Preview** opens a bundle read-only; **Add to project framework** reviews the files against the current framework; the editable editor at `#scripts/AS-####` still works. Auto Save keeps a working copy; **Save as new version** snapshots history; you can still Regenerate from linked cases.

Robot Framework is its own language (`.robot` files), not a Python framework. Record’s no-AI Playwright export on the Input step is unchanged.

Deleting a language, type, or framework in Settings hides it from Generate; scripts already saved keep the value they stored.

## Project framework, Check & Run

**Automation Scripts** is a single project workspace for the current project and language (no Project / Library tabs). **Generate** walks through three steps only: choose test cases (filter **Not automated yet** or open **Recently generated**, and preview **Steps** or **Code**), tell the AI anything it should know, then review proposed files (New / Changed / Reused) and apply, Check, or Run. The existing Generate modal on the Review page is unchanged. The workspace shows file-type icons, a searchable tree, and a file header with breadcrumbs and version. Click a folder to see its summary (not a leftover file). The file view is a GitHub-style read table with line numbers and lightweight highlighting; use **Edit** to change a file. **＋ New** (or New file on a folder) opens a dialog: pick a type (Python, Excel, CSV, JSON, TXT, YAML, XML), get the matching extension and icon, and choose the target folder. Excel, JSON, TXT, CSV, YAML, and XML files have a **Preview / Edit** toggle (sheet tabs for Excel, a tree for JSON/XML, plain text for TXT). Open files appear as tabs. **Ctrl+P** quickly opens a file, **F12** or Ctrl/Cmd-click jumps to a class or page-object definition, and Edit mode offers autocomplete (Python, Playwright, and this project's page objects and locators). Press Ctrl+Space and choose **Ask AI** if you want an on-demand AI completion — it does not run while you type. **Regenerate** on a file compares a new AI draft with your current text, tags files you edited by hand, and lets you **Keep mine**, **Take AI**, or **Merge selected**. Your edits are never overwritten unless you apply them. Check lives under the Run menu; Run history, **Terminal**, and **Generated versions** are text links in the header. Open **Terminal** (or press **Ctrl+`**) for a docked or floating run console: resize it, dock it at the bottom or right, or pop it out (drag, maximize / minimize, collapsed status bar). Use multiple tabs or a split view, the quick-actions bar (**Run all**, **Run file**, **Run TC**, **Rerun failed**, **Run with tags**, and browser / headed / env pickers), the command box (autocomplete, history, favorite chips), and output tools (ANSI colors, clickable `file.py:N` links, **Ctrl+F**, filters, wrap, font size, timestamps, Copy / Download, **Stop** / **Ctrl+C**). Terminal settings remember the layout in this browser, set a timeout, and include **Interactive shell mode (advanced)** — off by default, with a warning. Without that toggle, only allowlisted commands run (`pytest`, `python -m pytest`, `playwright install`, `pip install -r requirements.txt`). The runner uses the project venv when it can, injects project env files (never the application `.env`), streams the log, stores each run as `AR-####` with command, exit code, duration and log, allows one run per project at a time, and only accepts start/stop from localhost.

From the Test Case Repo, **Scripts (n)** / **Open scripts** lands on the mapped test file with a breadcrumb back to the Repo. **Where is this used** shows the test file, page objects, locators and test data, last run, and generated versions. A case with no script in the framework gets **Generate script** and **Link existing**.

The file tree supports icons, new / rename / move / delete, and an unsaved marker. Open a file to edit it, split or full-screen the editor, or compare versions (times are shown in IST). Locators, assertions, and test data have table editors and **Suggest with AI**. Framework env files (for example `config/staging.env`) open as a key–value table with secrets masked — that is not the application `.env`. Test data files preview as a grid or tree (xlsx, csv, JSON, XML, YAML).

The Test Case Repo Scripts column also shows whether a case already has a script, is out of date, or was just regenerated, and offers **Update script** when steps changed after the last generate.

**Check** runs a preflight (syntax, runtime, missing libraries). **Run** (the existing dialog) copies the project into a temp folder and executes it, with Stop, pass/fail results, optional failure screenshots, run history, and **Fix with AI**. The **Terminal** is an additional console for the same runner: allowlisted commands (or any command in interactive shell mode, still via exec, no PTY), live streaming (WebSocket, or SSE / polling if needed), process-tree Stop, and the same `automation_runs` history. Runner paths, timeout, and the temp folder are under **Settings → Script options → Runner**. Folder layouts for new frameworks are under **Folder templates**.

## Voice input limits

Voice input uses the browser’s **Web Speech API** (no AI model, no API key, no backend call).

- Works in **Google Chrome** and **Microsoft Edge** (desktop). Firefox and other browsers without speech recognition show a greyed-out mic.
- Needs an internet connection: Chrome / Edge send audio to their speech service (Google / Microsoft). Nothing is sent to this app’s backend.
- Needs `http://localhost` or HTTPS, plus microphone permission.
- Chrome may stop after a few seconds of silence or about a minute of speech; the app restarts listening automatically.
- Accuracy is weaker on technical terms (qTest, Jira, IDs), noisy rooms, and mixed languages. You cannot train it or add custom vocabulary.
- Punctuation is not added by the service; the app can turn spoken “comma” and “full stop” into symbols when auto-punctuation is on.

Open it with the teal mic in the header (next to ＋ New run), or `Ctrl+Shift+Space`. Preferences are in **Settings → Preferences → Voice input**.

## Help Assistant

The **Help Assistant** is an in-app chat that answers how this app’s features work, using the README and this FAQ.

- The header launcher (robot-headset icon, next to the Voice mic) opens a draggable window (minimize / maximize / close).
- The default **Use Generate provider** engine follows the current run’s saved provider. If the run has none, it uses **Settings → Preferences → Default provider** (the badge says *Settings default*). You can also pick a specific provider, or **No AI — docs search only** (keyword search over the docs, no model call). A small estimate under the composer shows tokens for the current question (0 when **No AI** is selected).
- Optional **Include current screen context** lets it know which page you are on (for example Review).
- Quick-question chips, the answer engine, and the launcher visibility are set in **Settings → Preferences → Help Assistant** and are saved in this browser’s `localStorage` (not in `.env`).
- The assistant does not change your data, run Generate, or upload anything. If a feature is not implemented, it should say so.

## How do I start a new help chat?

Use **Restart chat** in the Help Assistant window:

- Click the **refresh icon** in the title bar (just before Minimize). The tooltip is “Restart chat”.
- Or, when the window is maximized, click **Restart chat** next to **＋ New** in the history sidebar.

If the current chat already has questions, a short confirm appears in the window first (Cancel to keep chatting). The current conversation is saved in **History** so you can open it again. A new empty chat then shows the welcome message and quick-question chips, clears the input, and keeps the current-screen banner. This only affects the help window in this browser — it does not change your test cases, Settings, or `.env`.

## Why do the Voice and Help windows overlap?

They should not, once you hard-refresh after this update. Voice input and Help Assistant share a window manager:

- They dock **side by side** at the bottom-right of the content area (Help to the left of Voice).
- Minimized pills sit together in one tray, not on top of each other.
- Maximizing one fills the content area and sends the other to the tray; un-maximize brings the other back.
- Click or drag a window to bring it to the front. If you drop one on top of the other, it snaps apart.

If they still stack (for example after using an older saved position), open **Settings → Preferences → Floating windows** and click **Reset layout** (or **Dock both (side by side)**). **Reset window position** on the Voice or Help card moves only that window. These settings stay in this browser only (not in `.env`).

## Default Generate provider

**Settings → Preferences → Default provider** is used when a run has no saved provider — typically after you open cases from the **Test Case Repo** or Excel, before you click Generate.

- After Generate, the run keeps the provider you picked. Review, Regenerate, and Help “Use Generate provider” follow that saved value.
- The default is **not** a new `.env` key; it is stored with the other app preferences (SQLite).
- Changing the default does not rewrite an existing run’s provider.

## Generate test data

On **Review**, click **Generate test data** (or regenerate a single step from the Test Data column).

1. The panel lists inferred fields (for example Email, New password, Confirm password) with Valid / Invalid / Boundary values.
2. Choose the source per field: **AI** (heuristic samples), **Edge library** (offline catalog), or **Both**.
3. **Accept & insert** writes the Test Data column. You can still **Edit** a cell or use **⚡** to insert a library value.
4. Click **Save changes** to persist (`PUT /api/review/test_cases`). `POST /api/review/testdata` is a proposal only.

Excel import/export includes a Test Data column. Repo save/load keeps the values.

## Edge value library

A built-in Bug Magnet-style catalog (`backend/data/edge_values.json`) of standard edge values — our own list, not a copy of Bug Magnet’s exact values. Lookups work **offline** (no AI call).

- Open it from a Test Data cell with **⚡**, or use it as the source in Generate test data / Boost coverage (Boundary and Security).
- **Settings → Preferences → Edge value library**: enable or disable the library, toggle categories, add custom values, Import / Export JSON, or Reset to built-in.
- Security payloads (SQL injection, XSS, and similar) are flagged **for testing only**.

`GET /api/testdata/library` returns the catalog with your Settings preferences applied.

## Boost coverage

**Boost coverage** on Review suggests missing **Negative**, **Boundary**, and **Security** cases for the current run.

1. The preview shows coverage chips (current counts and how they would change) and a why-note for each suggestion.
2. Boundary and Security values come from the **Edge value library** (offline — no extra AI call).
3. Tick the cases you want and **Add selected**. New cases appear with a **NEW** badge. Save changes to keep them.

`POST /api/review/boost` previews first (`confirm` omitted) and appends only when you confirm.

## Export Gherkin

On Review, open **Export ▾** and choose **Gherkin (.feature)** (`GET /api/export?fmt=feature`).

- The file is a Feature with optional Background, `@jira-{story}` and type tags such as `@negative`, `@boundary`, `@security`, and one Scenario per test case.
- **Scenario Outline + Examples** builds an Examples table from test data (for example password values and accepted/rejected).
- If the run has more than one story, the download is a `.zip` of `.feature` files (no extra Python package — the app uses the standard library).

Excel, CSV, and qTest-import CSV exports still work as before.

## Token calculator

**Token Usage** has two tabs: the existing **Ledger** and a **Calculator** (`#tokens/calculator`).

- The calculator counts the text you paste (or the current run’s requirements, or the full prompt passed from Generate / Review via Open in calculator), shows coloured tokens and optional Token IDs (high-contrast numbered badges; the toggle re-paints immediately without a new API call), estimates cost and context fit for the selected model, compares all enabled models grouped by provider, and warns when the prompt plus expected output is over the context window.
- Counts use **characters ÷ 4** (or the model’s divisor) by default. **tiktoken** is optional and only used for OpenAI / Codex when the package is already installed and the pref is on. Provider count APIs are off by default because they use quota.
- Example prices are labelled as such until you edit them in **Settings → AI Providers → Models**. The Token Usage month-cost tile still uses the workspace-wide global `$ / 1M` rates on that page.

Generate, AI Review, Regenerate and Help show a live estimate before you call the model. **Generate test data** and **Boost coverage** show **No AI call · 0 tokens** when they use the library / heuristic path.

## Model registry and daily limits

**Settings → AI Providers** has **Connection**, **Models**, and **Limits** sub-tabs on each provider (Gemini, Grok, Groq, NVIDIA, Claude, OpenAI, Codex, Ollama). Connection keeps the API key and existing model ID fallback. **Settings → Preferences** keeps the existing default provider, Edge library, history, duplicate, **Auto Save** (default on), and calculator-option cards.

- **Models** — several models for *that* provider, each with example input/output rates, a context limit, a default ★, and an enable toggle. Dropdowns on Generate, AI Review, Regenerate and Help list enabled models. The starred model is the default. Existing **Connection** model ID fields (and env) still work as a fallback. The registry is stored in the app settings database and is seeded from the model already configured for each provider; it does not change `.env`. Click **Save models** on that tab, or the page footer **Save changes** — the footer also writes Models and Limits for every provider. A new row’s context defaults to the provider’s example window, so you can add a model by entering only its ID.
- **Limits** — daily token & cost caps for *that* provider. Leave a field blank for no warning. When you set a limit, the Dashboard and Token Usage show a banner at 80% of that day’s usage for that provider. Click the banner to open the ledger already filtered to that provider.
- Generate estimates count the **full prompt** (default or custom prompt, or each selected template, plus the story and the type-hint line), multiplied by the number of templates, plus the AI Reviewer if that toggle is on. **Open in calculator** passes the same composed text.

New ledger rows store provider, model, estimated vs actual tokens, cost, and whether the rate came from the model registry or the legacy global rates. Older rows are unchanged. Export CSV includes the new columns and keeps the existing ones. The ledger still has its Mode column and filter.
