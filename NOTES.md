# Build notes — untested / assumptions / known gaps

**Nothing in this package has been executed** — no server start, no tests, no imports,
no `pip install`. Everything below was derived from reading the source code only.
Please run it locally and expect to fix small issues on first start.

## Changes made to the copied `ai_test_generator` code
* `qtest_utils/qtest_worker.py`: `load_dotenv` → `load_dotenv()` (it was never called).
* `test_runner/main_pipeline.py`: added missing `import json` (used by `json.dump`).
* Nothing else in the existing code was modified. Not copied: the real `.env`, `reports/*.json`,
  `reports/*.xlsx`, `__pycache__/`. A `.env.example` with the same keys (blank) was added,
  plus optional `OPENAI_API_KEY`, `OLLAMA_MODEL`, `OLLAMA_HOST`.

## Function signatures relied on (read from the code)
| Function | Signature / behaviour assumed |
|---|---|
| `worker.jira_worker.pull_jira_story` | `(issue_key: str) -> dict` with `status`, `issue_key`, `summary`, `description`, `brd_links`, `brd_documents`, `screenshots`; on error `{"status":"error","message":…}`. It is decorated with `@mcp.tool`; the wrapper calls `pull_jira_story.fn` if present (fastmcp versions where the decorator returns a Tool object), else the function directly. |
| `worker.jira_worker.analyze_story` | `(result: dict) -> dict` with `status` (`READY_USING_SCENARIOS`, `READY_USING_ACCEPTANCE_CRITERIA`, `USE_BRD_FOR_TEST_CASES`, `INSUFFICIENT_REQUIREMENTS`), `message`, `acceptance_criteria`, `scenarios`, `scenario_list`, `brd_links`. Feature text = scenarios › AC › description (same as `main_pipeline`). |
| `ai_helpers.test_generator_gemini.generate_test_cases` | `(target_code_or_feature, test_case_generation_prompt) -> str | None`; prompt is the *system instruction*. Swallows exceptions (returns None) → the UI can only show a generic error. Module creates `client` and `gemini_model` at import time and raises if `GEMINI_API_KEY` is missing, so it is imported lazily and `client`/`gemini_model` are refreshed from Settings before each call. Token usage = delta of today's `tokens_used` in `reports/gemini_usage.json` (input/output split is not returned by the function). |
| `ai_helpers.test_generator_codex.generate_test_cases` / `review_test_cases` | `(acceptance_criteria, prompt, html_source="") -> str | None`, `(test_cases, reviewer_prompt) -> str | None`. `client` refreshed from Settings. |
| `ai_helpers.test_generator_ollama.generate_test_cases` | **Not reused**: it has a hard-coded prompt and only prints (returns None). The backend calls `ollama.chat` the same way but with the selected prompt and returns the text. |
| Gemini reviewer | Commented out in the original. Backend mirrors that commented code (`client.models.generate_content`, reviewer prompt as system instruction, temperature 0) and also updates the quota tracker. Reviewer output is treated as a *full corrected test-case set* (the reviewer prompt uses the same output template), which the user can Apply or Dismiss. |
| `ai_helpers_utils.parse_test_cases` / `save_to_excel` | `(markdown)` → rows / `(markdown, filename)`. After edits the table is converted back to the prompt's template markdown so `save_to_excel` is reused unchanged. `|` and newlines inside cells are flattened because the original parser is line/pipe based. |
| `qtest_worker.create_module_for_test_design` | `(payload_name) -> module_id | None` |
| `qtest_worker.qtest_create_testcase` | `(excel_path, module_id) -> [{"status_code", "response"}]` (order = test cases in the Excel). Results are matched back to Review rows by index, so Test case IDs must be unique (enforced). |
| `qtest_worker.collect_testcase_ids` | `(results) -> [internal ids]` |
| `qtest_worker.link_testcase_to_requirement` | **Not called directly**: the underlying client function discards the HTTP response (returns None), so the backend builds the *same* payload (`build_payload_for_linking_requirement_and_testcase`) and URL (`link_testcase_and_requirement_url`) and POSTs it itself to report link success/failure. |
| qtest_worker globals | `qtest_base_url`, `qtest_token`, `qtest_project_id`, `qtest_requriment_id`, `qtest_parent_module_id` are read at import time; the backend overwrites them from `.env` + the values typed on the Upload screen before each call. |

## Known gaps / assumptions
* **Single-user, local tool.** Sessions are a random cookie with no authentication (as requested); module-level globals of the existing code are patched per call, so concurrent users would interfere. Don't expose it on a network as-is.
* No streaming progress — the Generate button shows an indeterminate bar + elapsed timer while the request runs.
* RTM **AC mapping is a keyword heuristic** (or an explicit "AC 01" mention in the test case). It can be changed per row with the dropdown. AC list comes from Jira AC/scenarios or the local text headings like "Acceptance Criteria 01 – …".
* qTest link "Linked" status is per batch (the qTest link endpoint is called once for all created IDs). "Retry failed" re-creates only failed cases and links the new IDs.
* qTest TC ID shown is the `pid` from the create response; no deep link to the qTest UI is built (URL format unknown).
* "Save as template" for custom prompts is stored in the browser's localStorage only.
* Uploading the same run twice creates duplicates in qTest (a warning is shown).
* Requires Python 3.10+ (`str | None` in `jira_worker.py`). `fastmcp` + `jira` are needed even for local mode only if you use Jira fetch (imported lazily).
* The welcome page keeps the mockup's fixed pixel layout (best at ≥1280×800).
* `reports/gemini_usage.json` limits (400 requests / 5M tokens per day) are taken from `test_generator_gemini.py`.
