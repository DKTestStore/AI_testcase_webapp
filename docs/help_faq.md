# Help FAQ

Short answers for the in-app Help Assistant. These notes complement the README and stay aligned with current app behaviour.

## How to generate test cases

1. On **Input**, fetch a **Jira Story**, paste **Local text**, or **Upload Excel** (Excel skips Generate).
2. Optionally pick prompt templates on Input, or use **Record** to capture steps.
3. On **Generate**, choose a **Provider** (Gemini, Grok, Groq, Claude, OpenAI, Codex, or Ollama) and Default / Custom prompt.
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

Free-tier keys also have per-minute and per-day limits. HTTP 429 is retried up to 2 times.

## What is AI Reviewer

**AI Reviewer** is an optional second pass over generated test cases.

1. On **Generate**, tick **Also run AI Reviewer after generation**, or click **Run AI Reviewer** on the Review toolbar.
2. When it finishes, Review shows the result so you can compare, apply, or dismiss the suggestions.
3. It uses the same provider as **Generate** for that run (the Review badge shows the provider and model name). If the run has no saved provider (Repo or Excel), it uses **Settings → Preferences → Default provider**. The Review caret lets you override the **provider and model** for this call only. Before the call, an estimate strip shows estimated input/output tokens, example cost, and context fit (Open in calculator). Token usage is recorded in the ledger with estimated vs actual values.

This is separate from inline editing, AC mapping, duplicate detection (local, no AI call), and the local quality score / Improve with AI tools on the Review toolbar.

## Review screen

The **Review** step (step 3) is where you work with generated (or uploaded) cases before export or upload.

- Edit names, descriptions, preconditions and steps inline. Set priority, AC tags and review status.
- Toolbar: ＋ Test case, Save changes, Run AI Reviewer (optional per-call provider), Check duplicates, **Generate test data**, **Boost coverage**, Upload Excel, Save & Download Excel, Export (Excel / CSV / qTest / Gherkin).
- A provider badge shows the Generate provider, or the Settings default when the run has none. Coverage chips count Positive / Negative / Boundary / Security cases. Each step has a **Test Data** column (edit, regenerate, or ⚡ insert from the Edge library).
- Additive tools also include Edit mode, AC coverage (List / Matrix), type tags, version history and a local quality score.
- When you are happy, **Save to Test Case Repo** or **Execute now**, or continue to **qTest Upload**. Test data is appended into the qTest step description; the six-column layout is unchanged.

Unsaved edits are guarded. A step unlocks once the previous one has data.

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

- The calculator counts the text you paste (or the current run’s requirements), shows coloured tokens and optional Token IDs, estimates cost and context fit for the selected model, compares all enabled models grouped by provider, and warns when the prompt plus expected output is over the context window.
- Counts use **characters ÷ 4** (or the model’s divisor) by default. **tiktoken** is optional and only used for OpenAI / Codex when the package is already installed and the pref is on. Provider count APIs are off by default because they use quota.
- Example prices are labelled as such until you edit them in **Settings → Preferences → Model registry**. The Token Usage month-cost tile still uses the workspace-wide global `$ / 1M` rates on that page.

Generate, AI Review, Regenerate and Help show a live estimate before you call the model. **Generate test data** and **Boost coverage** show **No AI call · 0 tokens** when they use the library / heuristic path.

## Model registry and daily limits

**Settings → Preferences** keeps the existing default provider and Edge library cards, and adds:

- **Model registry** — several models per provider, each with example input/output rates, a context limit, a default ★, and an enable toggle. Dropdowns on Generate, AI Review, Regenerate and Help list enabled models. The starred model is the default. Existing **Settings → AI Providers** model ID fields (and env) still work as a fallback. The registry is stored in the app settings database and is seeded from the model already configured for each provider; it does not change `.env`.
- **Daily token & cost limits** per provider — leave a field blank for no warning. When you set a limit, the Dashboard and Token Usage show a banner at 80% of that day’s usage for that provider. Click the banner to open the ledger already filtered to that provider.

New ledger rows store provider, model, estimated vs actual tokens, cost, and whether the rate came from the model registry or the legacy global rates. Older rows are unchanged. Export CSV includes the new columns and keeps the existing ones. The ledger still has its Mode column and filter.
