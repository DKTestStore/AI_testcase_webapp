"""Thin wrappers around the existing ai_test_generator functions.

The original functions mostly print errors and return None/""; these wrappers turn
that into ServiceError(message) so the API can show a real error to the UI.
Heavy third-party modules are imported lazily so the web app can start (and the
Settings screen works) even before API keys are configured.
"""
import importlib
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

from . import config
from .config import (GENERATOR_PROMPT_FILE, REPORTS_DIR, REVIEWER_PROMPT_FILE,
                     GEMINI_USAGE_FILE, env, reload_env)


class ServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# --------------------------------------------------------------------------- #
# Prompts
# --------------------------------------------------------------------------- #
def read_default_prompt() -> str:
    from ai_test_generator.ai_helpers.ai_helpers_utils import read_test_case_generator_prompt_file
    text = read_test_case_generator_prompt_file(str(GENERATOR_PROMPT_FILE))
    if not text:
        raise ServiceError(f"Default prompt file missing: {GENERATOR_PROMPT_FILE.name}", 500)
    return text


def read_reviewer_prompt() -> str:
    from ai_test_generator.ai_helpers.ai_helpers_utils import read_test_cases_reviewer_prompt_file
    text = read_test_cases_reviewer_prompt_file(str(REVIEWER_PROMPT_FILE))
    if not text:
        raise ServiceError(f"Reviewer prompt file missing: {REVIEWER_PROMPT_FILE.name}", 500)
    return text


def output_template_section() -> str:
    """'**Required Output Template:**' block from the default prompt (appended to
    custom prompts that don't define it, so the parser/Excel export keep working)."""
    text = read_default_prompt()
    idx = text.find("**Required Output Template:**")
    return text[idx:] if idx >= 0 else ""


def build_prompt(mode: str, custom_prompt: str) -> Tuple[str, bool]:
    if mode != "custom":
        return read_default_prompt(), False
    custom = (custom_prompt or "").strip()
    if not custom:
        raise ServiceError("Custom prompt is empty. Enter a prompt or switch to Default prompt.")
    appended = False
    if "Test Case ID:" not in custom:
        custom = custom + "\n\n" + output_template_section()
        appended = True
    return custom, appended


# --------------------------------------------------------------------------- #
# Input: Jira + local
# --------------------------------------------------------------------------- #
def fetch_jira(story_id: str) -> Dict[str, Any]:
    """Same logic as main_pipeline.fetch_jira_feature_description, but returns
    structured data / errors instead of printing."""
    story_id = (story_id or "").strip().upper()
    if not story_id:
        raise ServiceError("Enter a Jira Story ID (e.g. MTG-1427).")
    if os.environ.get("ATG_MOCK_JIRA") == "1":
        return _mock_jira(story_id)
    reload_env()
    try:
        jw = importlib.import_module("ai_test_generator.worker.jira_worker")
    except Exception as ex:
        raise ServiceError(f"Could not load jira_worker (missing dependency?): {ex}", 500)

    # pull_jira_story is decorated with @mcp.tool; depending on the fastmcp version
    # the decorator returns a Tool object (callable via .fn) or the function itself.
    pull = getattr(jw.pull_jira_story, "fn", jw.pull_jira_story)
    result = pull(story_id)
    if not isinstance(result, dict) or result.get("status") != "success":
        msg = result.get("message") if isinstance(result, dict) else str(result)
        raise ServiceError(f"Jira pull failed: {msg}")

    # Save raw payload like the original pipeline does
    with open(REPORTS_DIR / "jira_story_output.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    description = result.get("description", "") or ""
    sections = jw.analyze_story(result)
    status = sections.get("status", "")
    acceptance_criteria = (sections.get("acceptance_criteria") or "").strip()
    scenarios = (sections.get("scenarios") or "").strip()

    usable = status not in ("USE_BRD_FOR_TEST_CASES", "INSUFFICIENT_REQUIREMENTS")
    if scenarios:
        feature_text, used = scenarios, "scenarios"
    elif acceptance_criteria:
        feature_text, used = acceptance_criteria, "acceptance_criteria"
    else:
        feature_text, used = description, "description"

    return {
        "issue_key": result.get("issue_key", story_id),
        "summary": result.get("summary", ""),
        "description": description,
        "status": status,
        "message": sections.get("message", ""),
        "acceptance_criteria": acceptance_criteria,
        "scenarios": scenarios,
        "scenario_list": sections.get("scenario_list", []),
        "brd_links": sections.get("brd_links", []) or result.get("brd_links", []),
        "screenshot_count": len(result.get("screenshots") or []),
        "usable": usable,
        "feature_text": feature_text if usable else "",
        "feature_source": used,
    }


# --------------------------------------------------------------------------- #
# Generation
# --------------------------------------------------------------------------- #
def _gemini_module():
    reload_env()
    if not env("GEMINI_API_KEY"):
        raise ServiceError("GEMINI_API_KEY is not set. Add it in Settings.")
    if not env("GEMINI_MODEL"):
        raise ServiceError("GEMINI_MODEL is not set (e.g. gemini-2.5-pro). Add it in Settings.")
    try:
        g = importlib.import_module("ai_test_generator.ai_helpers.test_generator_gemini")
    except Exception as ex:
        raise ServiceError(f"Could not initialise Gemini module: {ex}", 500)
    # The module builds its client/model at import time; refresh them if Settings changed.
    key = env("GEMINI_API_KEY")
    if getattr(g, "_webapp_key", None) != key:
        g.client = g.genai.Client(api_key=key)
        g._webapp_key = key
    g.gemini_model = (env("GEMINI_MODEL") or "").strip().strip("\"'")
    return g


def _codex_module():
    reload_env()
    if not env("OPENAI_API_KEY"):
        raise ServiceError("OPENAI_API_KEY is not set. Add it in Settings to use Codex.")
    try:
        c = importlib.import_module("ai_test_generator.ai_helpers.test_generator_codex")
    except Exception as ex:
        raise ServiceError(f"Could not initialise Codex/OpenAI module: {ex}", 500)
    key = env("OPENAI_API_KEY")
    if getattr(c, "_webapp_key", None) != key:
        c.client = c.OpenAI(api_key=key)
        c._webapp_key = key
    return c


def _ollama_chat(system_prompt: str, user_content: str) -> str:
    """test_generator_ollama.generate_test_cases() uses a hard-coded prompt and only
    prints the result (returns None), so call ollama.chat the same way here but with
    the selected prompt, and return the text."""
    reload_env()
    try:
        import ollama
    except Exception as ex:
        raise ServiceError(f"ollama package not installed: {ex}", 500)
    model = env("OLLAMA_MODEL", "gemma3:4b")
    host = env("OLLAMA_HOST")
    try:
        client = ollama.Client(host=host) if host else ollama
        resp = client.chat(model=model, messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ])
    except Exception as ex:
        raise ServiceError(f"Ollama call failed (is `ollama serve` running and model '{model}' pulled?): {ex}", 502)
    try:
        return resp["message"]["content"]
    except Exception:
        return getattr(getattr(resp, "message", None), "content", "") or ""


def read_gemini_usage() -> Dict[str, Any]:
    if not GEMINI_USAGE_FILE.exists():
        return {"available": False}
    try:
        data = json.loads(GEMINI_USAGE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"available": False}
    if isinstance(data, dict):
        data = [data]
    today = datetime.today().strftime("%Y-%m-%d")
    today_entry = next((d for d in data if d.get("date") == today), None)
    return {"available": True, "today": today_entry, "history": data[-7:],
            "daily_request_limit": 400, "daily_token_limit": 5000000}


def _today_tokens() -> int:
    u = read_gemini_usage()
    t = (u.get("today") or {}) if u.get("available") else {}
    return int(t.get("tokens_used") or t.get("tokens") or 0)


def generate(model: str, feature_text: str, prompt: str, tag: str = "") -> Dict[str, Any]:
    if not (feature_text or "").strip():
        raise ServiceError("No feature description. Complete the Input step first.")
    if os.environ.get("ATG_MOCK_GEMINI") == "1":
        return _mock_generate(feature_text, tag)
    model = (model or "gemini").lower()
    usage: Dict[str, Any] = {"model": model}
    if model == "gemini":
        g = _gemini_module()
        _, today = g.get_today_quota()
        if today.get("requests_used", 0) >= g.DAILY_REQUEST_LIMIT:
            raise ServiceError(f"Gemini daily request limit ({g.DAILY_REQUEST_LIMIT}) reached.", 429)
        before = _today_tokens()
        # Bug 03: capture usage_metadata from the response the helper receives
        captured: Dict[str, Any] = {}
        models = g.client.models
        orig = models.generate_content

        def _capture(*a, **k):
            r = orig(*a, **k)
            captured["um"] = getattr(r, "usage_metadata", None)
            return r
        models.generate_content = _capture
        try:
            text = g.generate_test_cases(feature_text, prompt)
        finally:
            try:
                del models.generate_content
            except AttributeError:
                models.generate_content = orig
        if not text:
            # The original function swallows exceptions; repeat the same call here to surface the real error.
            model_id = (env("GEMINI_MODEL") or "").strip().strip("\"'")
            try:
                resp = g.client.models.generate_content(
                    model=model_id, contents=feature_text,
                    config=g.types.GenerateContentConfig(system_instruction=prompt, temperature=0.2))
                text = getattr(resp, "text", None)
                captured["um"] = getattr(resp, "usage_metadata", None)
            except Exception as ex:
                print(f"Gemini API error: {type(ex).__name__}: {ex}")
                raise ServiceError(f"Gemini API error (model '{model_id}'): {type(ex).__name__}: {ex}", 502)
            if not text:
                fb = getattr(resp, "prompt_feedback", None)
                raise ServiceError(f"Gemini returned an empty response (possibly blocked). Feedback: {fb}", 502)
        um = captured.get("um")
        usage["input_tokens"] = getattr(um, "prompt_token_count", None) or 0
        usage["output_tokens"] = getattr(um, "candidates_token_count", None) or 0
        usage["total_tokens"] = (getattr(um, "total_token_count", None) or 0) or max(_today_tokens() - before, 0)
        usage["model_name"] = (env("GEMINI_MODEL") or "").strip().strip("\"'")
    elif model == "codex":
        c = _codex_module()
        text = c.generate_test_cases(feature_text, prompt)
        if not text:
            raise ServiceError("Codex/OpenAI returned no response (see server console for the error).", 502)
        usage["model_name"] = getattr(c, "MODEL", "")
    elif model == "ollama":
        text = _ollama_chat(prompt, feature_text)
        if not text:
            raise ServiceError("Ollama returned an empty response.", 502)
        usage["model_name"] = env("OLLAMA_MODEL", "gemma3:4b")
    else:
        raise ServiceError(f"Unknown model '{model}'.")
    return {"markdown": text, "usage": usage}


def review(model: str, feature_text: str, markdown: str) -> Dict[str, Any]:
    """AI Reviewer. Gemini's review function is commented out in the original code, so
    for Gemini this mirrors that commented implementation using the module's client."""
    if not (markdown or "").strip():
        raise ServiceError("No test cases to review.")
    reviewer_prompt = read_reviewer_prompt()
    content = (f"Acceptance Criteria:\n{feature_text}\n\n"
               f"Draft Test Cases To Review:\n{markdown}\n\n"
               "Review the draft against the acceptance criteria, fix gaps, duplicates and formatting, "
               "and return the COMPLETE corrected set using the Required Output Template.")
    model = (model or "gemini").lower()
    usage: Dict[str, Any] = {"model": model}
    if model == "gemini":
        g = _gemini_module()
        try:
            resp = g.client.models.generate_content(
                model=g.gemini_model, contents=content,
                config=g.types.GenerateContentConfig(system_instruction=reviewer_prompt, temperature=0.0))
        except Exception as ex:
            raise ServiceError(f"Gemini reviewer error: {ex}", 502)
        um = getattr(resp, "usage_metadata", None)
        total = getattr(um, "total_token_count", 0) or 0
        usage.update({"input_tokens": getattr(um, "prompt_token_count", 0) or 0,
                      "output_tokens": getattr(um, "candidates_token_count", 0) or 0,
                      "total_tokens": total})
        # keep the shared quota tracker accurate
        try:
            data, today = g.get_today_quota()
            today["requests_used"] = today.get("requests_used", 0) + 1
            today["requests_left"] = g.DAILY_REQUEST_LIMIT - today["requests_used"]
            today["tokens_used"] = today.get("tokens_used", 0) + total
            today["tokens_left"] = g.DAILY_TOKEN_LIMIT - today["tokens_used"]
            g.save_quota(data)
        except Exception:
            pass
        text = getattr(resp, "text", "") or ""
    elif model == "codex":
        c = _codex_module()
        text = c.review_test_cases(content, reviewer_prompt) or ""
    elif model == "ollama":
        text = _ollama_chat(reviewer_prompt, content)
    else:
        raise ServiceError(f"Unknown model '{model}'.")
    if not text.strip():
        raise ServiceError("Reviewer returned no response.", 502)
    return {"markdown": text, "usage": usage}


# --------------------------------------------------------------------------- #
# Regenerate ONE test case
# --------------------------------------------------------------------------- #
REGEN_SYSTEM = """You are a senior QA engineer. Rewrite exactly ONE manual test case.
Rules:
- Return ONLY a JSON object, no prose, no markdown fences:
  {"name": str, "description": str, "precondition": str, "priority": "High"|"Medium"|"Low",
   "steps": [{"description": str, "expected": str}, ...]}
- Keep it a single test case focused on the same intent/acceptance criteria unless the instruction says otherwise.
- Follow the user's instruction. Steps must be concrete and testable, each with a clear expected result.
- Do not include the test case id. Do not invent features not implied by the story / acceptance criteria.
"""


def _parse_regen(text: str) -> Dict[str, Any]:
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.strip("`")
        t = t[t.find("{"):] if "{" in t else t
    i, j = t.find("{"), t.rfind("}")
    if i < 0 or j <= i:
        raise ServiceError("The model did not return a test case. Try again or rephrase the instruction.", 502)
    try:
        data = json.loads(t[i:j + 1])
    except Exception:
        raise ServiceError("The model's answer could not be read as a test case. Try again.", 502)
    steps = [{"description": str(s.get("description", "")).strip(), "expected": str(s.get("expected", "")).strip()}
             for s in (data.get("steps") or []) if isinstance(s, dict)]
    steps = [s for s in steps if s["description"] or s["expected"]]
    if not str(data.get("name", "")).strip() or not steps:
        raise ServiceError("The model returned an incomplete test case (missing name or steps). Try again.", 502)
    return {"name": str(data["name"]).strip(), "description": str(data.get("description", "")).strip(),
            "precondition": str(data.get("precondition", "")).strip(),
            "priority": data.get("priority") if data.get("priority") in ("High", "Medium", "Low") else "",
            "steps": steps}


def _mock_regen(tc: Dict[str, Any], instruction: str) -> str:
    """Deterministic offline stand-in used only when the process env ATG_MOCK_GEMINI=1 (tests)."""
    if "[mock-error]" in instruction:
        raise ServiceError("Gemini regenerate error: mocked failure (quota exceeded)", 502)
    if "[mock-bad]" in instruction:
        return "Sorry, I cannot help with that."
    old = tc.get("steps") or []
    first = (old[0]["description"] if old else "Open the page") + " (refined)"
    return json.dumps({
        "name": "Reject reset requests for invalid or unregistered emails",
        "description": "Negative cases: invalid format, empty input and unregistered email",
        "precondition": "User is on the Forgot password page (logged out)", "priority": "High",
        "steps": [{"description": first, "expected": "Inline error 'Enter a valid email address' is shown"},
                  {"description": "Leave the email empty and click Send link", "expected": "'Email is required' is shown"},
                  {"description": "Enter unregistered email 'nobody@cx.com' and click Send link",
                   "expected": "Generic message is shown (no account enumeration)"}]})


def regenerate_one(story_id: str, feature_text: str, acs: List[Dict[str, str]], tc: Dict[str, Any],
                   instruction: str) -> Dict[str, Any]:
    ac_txt = "\n".join(f"- {a.get('id')}: {a.get('title', '')}" for a in acs) or "(none linked)"
    cur = {k: tc.get(k) for k in ("name", "description", "precondition", "priority")}
    cur["steps"] = [{"description": s.get("description", ""), "expected": s.get("expected", "")} for s in tc.get("steps") or []]
    content = (f"Story: {story_id or '(none)'}\n\nRequirements / story text (truncated):\n{(feature_text or '')[:12000]}\n\n"
               f"Linked acceptance criteria:\n{ac_txt}\n\nCurrent test case (JSON):\n{json.dumps(cur, ensure_ascii=False)}\n\n"
               f"Instruction: {instruction or 'Improve this test case: make steps concrete and complete.'}")
    usage: Dict[str, Any] = {"model": "gemini"}
    if os.environ.get("ATG_MOCK_GEMINI") == "1":
        text = _mock_regen(tc, instruction or "")
        usage.update({"mock": True, "model_name": "mock", "input_tokens": len(content) // 4 + 400,
                      "output_tokens": len(text) // 4 + 150, "total_tokens": len(content) // 4 + len(text) // 4 + 550})
    else:
        g = _gemini_module()
        try:
            resp = g.client.models.generate_content(
                model=g.gemini_model, contents=content,
                config=g.types.GenerateContentConfig(system_instruction=REGEN_SYSTEM, temperature=0.4,
                                                     response_mime_type="application/json"))
        except Exception as ex:
            raise ServiceError(f"Gemini regenerate error: {ex}", 502)
        um = getattr(resp, "usage_metadata", None)
        total = getattr(um, "total_token_count", 0) or 0
        usage.update({"input_tokens": getattr(um, "prompt_token_count", 0) or 0,
                      "output_tokens": getattr(um, "candidates_token_count", 0) or 0, "total_tokens": total})
        try:
            data, today = g.get_today_quota()
            today["requests_used"] = today.get("requests_used", 0) + 1
            today["requests_left"] = g.DAILY_REQUEST_LIMIT - today["requests_used"]
            today["tokens_used"] = today.get("tokens_used", 0) + total
            today["tokens_left"] = g.DAILY_TOKEN_LIMIT - today["tokens_used"]
            g.save_quota(data)
        except Exception:
            pass
        text = getattr(resp, "text", "") or ""
    return {"test_case": _parse_regen(text), "usage": usage}


# --------------------------------------------------------------------------- #
# Excel
# --------------------------------------------------------------------------- #
def save_excel(markdown: str, path: Path) -> Path:
    from ai_test_generator.ai_helpers.ai_helpers_utils import save_to_excel
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        save_to_excel(markdown, str(path))
    except Exception as ex:
        raise ServiceError(f"Saving Excel failed: {ex}", 500)
    return path


# --------------------------------------------------------------------------- #
# qTest
# --------------------------------------------------------------------------- #
def _qtest_worker(project_id: str = "", requirement_id: str = "", parent_module_id: str = ""):
    """qtest_worker reads its config into module globals at import time; refresh them
    from .env (+ per-run overrides from the UI) before every call."""
    reload_env()
    try:
        qw = importlib.import_module("ai_test_generator.qtest_utils.qtest_worker")
    except Exception as ex:
        raise ServiceError(f"Could not load qtest_worker: {ex}", 500)
    qw.qtest_base_url = env("QTEST_BASE_URL").rstrip("/")
    qw.qtest_token = env("QTEST_TOKEN")
    qw.qtest_project_id = (project_id or env("QTEST_PROJECT_ID")).strip()
    qw.qtest_requriment_id = (requirement_id or env("QTEST_REQUIREMENT_ID")).strip()
    qw.qtest_parent_module_id = (parent_module_id or env("QTEST_PARENT_MODULE_ID")).strip()
    missing = [n for n, v in (("QTEST_BASE_URL", qw.qtest_base_url), ("QTEST_TOKEN", qw.qtest_token),
                              ("Project ID", qw.qtest_project_id)) if not v]
    if missing:
        raise ServiceError("Missing qTest settings: " + ", ".join(missing))
    return qw


def build_payload_preview(excel_path: Path, module_id: Optional[str]) -> List[Dict[str, Any]]:
    from ai_test_generator.qtest_utils.qtest_helpers import read_test_cases_from_excel, build_bulk_payloads
    test_cases = read_test_cases_from_excel(str(excel_path))
    parent = int(module_id) if module_id and str(module_id).isdigit() else None
    return build_bulk_payloads(test_cases, parent)


def _link(qw, testcase_ids: List[int], requirement_id: str) -> Dict[str, Any]:
    """Same payload/URL as qtest_worker.link_testcase_to_requirement, but the original
    client function discards the HTTP response, so post here to get the status."""
    if not testcase_ids:
        return {"ok": False, "status_code": None, "message": "No created test cases to link."}
    if not requirement_id:
        return {"ok": False, "status_code": None, "message": "No Requirement ID provided."}
    from ai_test_generator.qtest_utils.qtest_helpers import build_payload_for_linking_requirement_and_testcase
    from ai_test_generator.qtest_utils.qtest_paths import link_testcase_and_requirement_url
    try:
        payload = build_payload_for_linking_requirement_and_testcase(testcase_ids, requirement_id)
    except (TypeError, ValueError):
        return {"ok": False, "status_code": None, "message": f"Requirement ID '{requirement_id}' must be numeric."}
    with open(REPORTS_DIR / "qtest_link_testcase_to_requirement_payloads.json", "w", encoding="utf-8") as fp:
        json.dump(payload, fp, indent=2)
    url = link_testcase_and_requirement_url(qw.qtest_base_url, qw.qtest_project_id)
    try:
        r = requests.post(url, headers={"Content-Type": "application/json", "Authorization": qw.qtest_token},
                          data=json.dumps(payload), timeout=30)
    except Exception as ex:
        return {"ok": False, "status_code": None, "message": f"Link request failed: {ex}"}
    ok = r.status_code in (200, 201)
    return {"ok": ok, "status_code": r.status_code, "message": "Linked" if ok else r.text[:500]}


def _result_ids(result: Dict[str, Any]) -> Tuple[Any, Any]:
    resp = result.get("response") or {}
    qid, pid = resp.get("id"), resp.get("pid")
    if isinstance(resp.get("data"), dict):
        qid = qid or resp["data"].get("id")
        pid = pid or resp["data"].get("pid")
    return qid, pid


def _error_text(result: Dict[str, Any]) -> str:
    resp = result.get("response") or {}
    msg = resp.get("message") or resp.get("error") or resp.get("raw_text") or json.dumps(resp)[:300]
    return f"HTTP {result.get('status_code')}: {msg}"


def qtest_upload(excel_path: Path, test_cases: List[Dict[str, Any]], story_id: str,
                 project_id: str, requirement_id: str, parent_module_id: str,
                 module_id: str, module_name: str) -> Dict[str, Any]:
    if os.environ.get("ATG_MOCK_QTEST") == "1":
        return _mock_qtest_upload(test_cases, story_id, project_id, requirement_id, module_id, module_name)
    qw = _qtest_worker(project_id, requirement_id, parent_module_id)
    if not excel_path or not Path(excel_path).exists():
        raise ServiceError("Excel file not found. Save the Excel on the Review step first.")

    # 1. module (folder): use given ID or create one named after the story
    created_module = False
    if not module_id:
        name = (module_name or story_id or "AI Generated Test Cases").strip()
        try:
            module_id = qw.create_module_for_test_design(name)
        except Exception as ex:
            raise ServiceError(f"Module creation error: {ex}", 502)
        if not module_id:
            raise ServiceError("qTest module was not created (check token, project ID and parent module ID; "
                               "see server console for the qTest response).", 502)
        created_module = True

    # 2. create test cases
    try:
        results = qw.qtest_create_testcase(str(excel_path), module_id)
    except Exception as ex:
        raise ServiceError(f"Test case upload failed: {ex}", 502)

    # 3. collect ids + 4. link
    ids = qw.collect_testcase_ids(results)
    link = _link(qw, ids, qw.qtest_requriment_id)

    items = []
    for idx, res in enumerate(results):
        qid, pid = _result_ids(res)
        ok = res.get("status_code") in (200, 201)
        tc = test_cases[idx] if idx < len(test_cases) else {}
        items.append({
            "tc_id": tc.get("id", f"#{idx + 1}"), "name": tc.get("name", ""),
            "status": "Created" if ok else "Failed", "status_code": res.get("status_code"),
            "qtest_id": qid if ok else None, "qtest_pid": pid if ok else None,
            "error": "" if ok else _error_text(res),
            "linked": bool(ok and link.get("ok")),
        })
    return {
        "module_id": module_id, "module_created": created_module, "module_name": module_name or story_id,
        "project_id": qw.qtest_project_id, "requirement_id": qw.qtest_requriment_id,
        "created": sum(1 for i in items if i["status"] == "Created"), "total": len(items),
        "link": link, "items": items,
        "uploaded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def qtest_retry_failed(upload: Dict[str, Any], test_cases: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Re-POST only the failed test cases (same payload builder + client), then link them."""
    if os.environ.get("ATG_MOCK_QTEST") == "1":
        return _mock_qtest_retry(upload)
    qw = _qtest_worker(upload.get("project_id", ""), upload.get("requirement_id", ""), "")
    from ai_test_generator.qtest_utils.qtest_client import create_test_case
    from ai_test_generator.qtest_utils.qtest_helpers import build_payload
    from ai_test_generator.qtest_utils.qtest_paths import create_test_case_url
    by_id = {tc["id"]: tc for tc in test_cases}
    module_id = upload.get("module_id")
    parent = int(module_id) if module_id and str(module_id).isdigit() else None
    url = create_test_case_url(qw.qtest_base_url, qw.qtest_project_id)
    new_ids = []
    for item in upload.get("items", []):
        if item["status"] != "Failed":
            continue
        tc = by_id.get(item["tc_id"])
        if not tc:
            item["error"] = "Test case no longer exists in the Review table."
            continue
        try:
            res = create_test_case(url, qw.qtest_token, build_payload(tc, parent_id=parent))
        except Exception as ex:
            item["error"] = f"Request failed: {ex}"
            continue
        if res.get("status_code") in (200, 201):
            qid, pid = _result_ids(res)
            item.update({"status": "Created", "status_code": res["status_code"], "qtest_id": qid,
                         "qtest_pid": pid, "error": ""})
            if qid:
                new_ids.append(qid)
        else:
            item.update({"status_code": res.get("status_code"), "error": _error_text(res)})
    link = _link(qw, new_ids, qw.qtest_requriment_id) if new_ids else {"ok": False, "message": "Nothing new to link."}
    if link.get("ok"):
        for item in upload["items"]:
            if item.get("qtest_id") in new_ids:
                item["linked"] = True
    upload["created"] = sum(1 for i in upload["items"] if i["status"] == "Created")
    upload["retry_link"] = link
    upload["uploaded_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return upload


# --------------------------------------------------------------------------- #
# Batch: requirement lookup by story ID
# --------------------------------------------------------------------------- #
def find_requirement(project_id: str, story_id: str) -> Optional[str]:
    """Find the qTest requirement whose name starts with the Jira/Excel story ID (qTest search API).
    Returns the requirement id or None. Never raises - batch upload continues without a link."""
    story_id = (story_id or "").strip()
    if not story_id:
        return None
    if os.environ.get("ATG_MOCK_QTEST") == "1":
        missing = [x.strip().upper() for x in os.environ.get("ATG_MOCK_QTEST_NOREQ", "").split(",") if x.strip()]
        return None if story_id.upper() in missing else str(880000 + sum(map(ord, story_id)))
    try:
        reload_env()
        base = (env("QTEST_BASE_URL") or "").rstrip("/")
        token = env("QTEST_TOKEN") or ""
        project_id = project_id or env("QTEST_PROJECT_ID") or ""
        if not (base and token and project_id):
            return None
        auth = token if token.lower().startswith("bearer ") else f"Bearer {token}"
        url = base if "/api/v3" in base else f"{base}/api/v3"
        r = requests.post(f"{url}/projects/{project_id}/search", timeout=20,
                          headers={"Authorization": auth, "Content-Type": "application/json"},
                          json={"object_type": "requirements", "fields": ["id", "name"],
                                "query": f"'name' ~ '{story_id}'"})
        if r.status_code != 200:
            print(f"qTest requirement search {story_id}: HTTP {r.status_code}")
            return None
        for item in (r.json() or {}).get("items", []):
            if str(item.get("name", "")).upper().startswith(story_id.upper()):
                return str(item.get("id"))
    except Exception as ex:
        print(f"qTest requirement search {story_id} failed: {ex}")
    return None


# --------------------------------------------------------------------------- #
# Offline mocks - only when the PROCESS env sets ATG_MOCK_* = 1 (tests). Never read from .env.
# --------------------------------------------------------------------------- #
def _mock_delay():
    import time
    try:
        time.sleep(float(os.environ.get("ATG_MOCK_DELAY", "0")))
    except ValueError:
        pass


def _mock_jira(story_id: str) -> Dict[str, Any]:
    _mock_delay()
    missing = [x.strip().upper() for x in os.environ.get("ATG_MOCK_JIRA_MISSING", "MTG-1427").split(",") if x.strip()]
    if story_id in missing:
        raise ServiceError(f"Jira pull failed: Issue {story_id} does not exist or you do not have permission (404)")
    n = 2 + sum(map(ord, story_id)) % 3
    ac = "\n".join(f"Acceptance Criteria 0{i} – {story_id} rule {i}\nThe system handles rule {i} for {story_id}."
                   for i in range(1, n + 1))
    return {"issue_key": story_id, "summary": f"Mock story {story_id}", "description": ac, "status": "OK",
            "message": "", "acceptance_criteria": ac, "scenarios": "", "scenario_list": [], "brd_links": [],
            "screenshot_count": 0, "usable": True, "feature_text": ac, "feature_source": "acceptance_criteria"}


def _mock_generate(feature_text: str, tag: str = "") -> Dict[str, Any]:
    _mock_delay()
    if "[mock-gen-fail]" in feature_text:
        raise ServiceError("Gemini API error (mock): 503 model overloaded", 502)
    from . import parsing
    acs = parsing.split_acceptance_criteria(feature_text) or [{"id": "AC-01", "title": "Feature"}]
    cases = []
    for a in acs:
        for k in (1, 2):
            cases.append({"id": f"TC{len(cases) + 1:03d}", "name": f"Verify {a['title'][:60]} - case {k}",
                          "description": f"Covers {a['id']} ({'positive' if k == 1 else 'negative'})",
                          "precondition": "User is logged in",
                          "steps": [{"description": f"Perform step {j} for {a['id']}", "expected": f"Result {j} as per {a['id']}"}
                                    for j in (1, 2)]})
    if tag:  # prompt templates: distinct cases per (non-default) template
        k = len(tag)
        cases = [dict(c, name=f"[{tag}] {tag} check {i + 1} for {(c['description'].split(' ') + [''])[1]}",
                      description=f"{tag}-focused scenario #{i + 1}",
                      steps=[{"description": f"{tag}: action {j} ({i + 1})", "expected": f"{tag}: outcome {j}"} for j in (1, 2, 3)])
                 for i, c in enumerate(cases[:max(1, len(cases) - k % 2)])]
    md = parsing.test_cases_to_markdown(cases)
    return {"markdown": md, "usage": {"model": "gemini", "model_name": "mock", "input_tokens": len(feature_text) // 4,
                                      "output_tokens": len(md) // 4, "total_tokens": len(feature_text) // 4 + len(md) // 4}}


def _mock_qtest_upload(test_cases, story_id, project_id, requirement_id, module_id, module_name):
    _mock_delay()
    fail = [x.strip().upper() for x in os.environ.get("ATG_MOCK_QTEST_FAIL", "").split(",") if x.strip()]
    items = []
    for i, tc in enumerate(test_cases):
        bad = (story_id or "").upper() in fail and i < 2
        items.append({"tc_id": tc["id"], "name": tc.get("name", ""), "status": "Failed" if bad else "Created",
                      "status_code": 500 if bad else 200, "qtest_id": None if bad else 5000 + i,
                      "qtest_pid": None if bad else f"TC-{5000 + i}", "error": "HTTP 500 (mock)" if bad else "",
                      "linked": bool(requirement_id) and not bad})
    link = ({"ok": True, "message": f"Linked to requirement {requirement_id} (mock)"} if requirement_id
            else {"ok": False, "message": "No requirement ID - not linked."})
    return {"module_id": module_id or "770001", "module_created": not module_id,
            "module_name": module_name or story_id, "project_id": project_id or "1",
            "requirement_id": requirement_id, "created": sum(1 for i in items if i["status"] == "Created"),
            "total": len(items), "link": link, "items": items, "uploaded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "mock": True}


def _mock_qtest_retry(upload):
    _mock_delay()
    for i, it in enumerate(upload.get("items", [])):
        if it["status"] == "Failed":
            it.update(status="Created", status_code=200, qtest_id=6000 + i, qtest_pid=f"TC-{6000 + i}", error="",
                      linked=bool(upload.get("requirement_id")))
    upload["created"] = sum(1 for i in upload["items"] if i["status"] == "Created")
    upload["retry_link"] = {"ok": True, "message": "mock"}
    upload["uploaded_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return upload
