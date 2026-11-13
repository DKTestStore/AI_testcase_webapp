# Help FAQ

Short answers for the in-app Help Assistant. These notes complement the README and stay aligned with current app behaviour.

## How to generate test cases

1. On **Input**, fetch a **Jira Story**, paste **Local text**, or **Upload Excel** (Excel skips Generate).
2. Optionally pick prompt templates on Input, or use **Record** to capture steps.
3. On **Generate**, choose a **Provider** (Gemini, Grok, Groq, Claude, OpenAI, Codex, or Ollama) and Default / Custom prompt.
4. Optionally turn on **Also run AI Reviewer after generation**.
5. When it finishes, continue to **Review** to edit, map acceptance criteria, and export.

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
3. It uses the same configured AI provider as the run (keys on Settings → AI Providers). Token usage is recorded in the ledger.

This is separate from inline editing, AC mapping, duplicate detection (local, no AI call), and the local quality score / Improve with AI tools on the Review toolbar.

## Review screen

The **Review** step (step 3) is where you work with generated (or uploaded) cases before export or upload.

- Edit names, descriptions, preconditions and steps inline. Set priority, AC tags and review status.
- Toolbar: ＋ Test case, Save changes, Run AI Reviewer, Check duplicates, Upload Excel, Save & Download Excel.
- Additive tools include Export, Edit mode, AC coverage (List / Matrix), type tags, version history and a local quality score.
- When you are happy, **Save to Test Case Repo** or **Execute now**, or continue to **qTest Upload**.

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
- Answers can use your configured AI provider, or **No AI — docs search only** (keyword search over the docs, no model call).
- Optional **Include current screen context** lets it know which page you are on (for example Review).
- Quick-question chips, the answer engine, and the launcher visibility are set in **Settings → Preferences → Help Assistant** and are saved in this browser’s `localStorage` (not in `.env`).
- The assistant does not change your data, run Generate, or upload anything. If a feature is not implemented, it should say so.
