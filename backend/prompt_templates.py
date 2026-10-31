"""Custom prompt templates (additive feature). Stored in backend/prompt_templates.json (gitignored).

The built-in 'Default' template reads the original prompt file (ai_test_generator/prompt/test_cases_generator_prompt.md)
unless it has been edited on the Prompt templates page; the edit is stored here as 'default_text' and is what every
Default-prompt generation uses. 'Reset to original' removes the edit. If the file is missing on first use
the starter templates are seeded."""
import json
import re
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

PATH = Path(__file__).resolve().parent / "prompt_templates.json"
_LOCK = threading.Lock()
DEFAULT_ID = "default"
PLACEHOLDERS = [  # (name, required)
    ("story_title", True), ("description", True), ("acceptance_criteria", True),
    ("num_cases", False), ("test_types", False), ("detail_level", False),
]
REQUIRED = [p for p, r in PLACEHOLDERS if r]
KNOWN = {p for p, _ in PLACEHOLDERS}
PH_RE = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")
TEST_TYPES = ["positive", "negative", "edge", "boundary"]
DETAIL = {"brief": "Brief (key steps only)", "standard": "Standard", "detailed": "Detailed (steps + test data)"}
MAX_TEMPLATES = 100
MAX_LEN = 50_000


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _body(role: str, focus: List[str]) -> str:
    return ("**Role and Persona:**\nYou are an elite QA Architect specialised in " + role + ".\n\n"
            "**Story:** {{story_title}}\n**Description:**\n{{description}}\n\n"
            "**Acceptance Criteria:**\n{{acceptance_criteria}}\n\n"
            "**Instructions:**\n* Generate about {{num_cases}} test cases.\n* Cover {{test_types}} scenarios.\n"
            "* Detail level: {{detail_level}}\n" + "".join(f"* {f}\n" for f in focus) +
            "* Map each case to at least one AC (traceability).\n")


def _starters() -> List[Dict[str, Any]]:
    o = lambda n=10, d="detailed": {"test_types": ["positive", "negative", "edge"], "num_cases": n, "detail_level": d}
    rows = [
        ("API testing", "Endpoint-level cases: status codes, schema validation, auth headers, error payloads.",
         ["api", "rest", "contract"], "API testing", ["For every endpoint verify status code, response schema, auth header and error payload."], o(12)),
        ("UI testing", "Human-centric UI steps: field validation, labels, navigation, responsive layout.",
         ["ui", "manual", "forms"], "manual UI testing", ["Write steps from a human user's perspective using visible labels only.", "Check field validation messages and navigation."], o()),
        ("Security", "OWASP-style negative cases: injection, authz bypass, session handling, PII masking.",
         ["security", "negative", "owasp"], "application security testing", ["Include injection, broken access control, session expiry and PII masking checks."], o(8)),
        ("Performance", "Load/latency expectations, timeouts, large data sets, concurrency.",
         ["performance", "nfr"], "performance testing", ["Include response-time expectations, large data sets, timeouts and concurrent users."], o(6, "standard")),
        ("Regression", "Compact regression suite focusing on changed ACs and high-risk existing flows.",
         ["regression", "smoke"], "regression testing", ["Prioritise high-risk existing flows; keep cases compact."], o(8, "brief")),
    ]
    return [{"id": "tpl-" + re.sub(r"[^a-z]+", "-", n.lower()).strip("-"), "name": n, "description": d, "tags": t,
             "text": _body(role, f), "options": opts, "builtin": False, "updated_at": _now(), "used": 0}
            for n, d, t, role, f, opts in rows]


def default_override() -> Optional[str]:
    """Edited Default prompt text (None -> use the original prompt file)."""
    with _LOCK:
        d = _load()
    t = d.get("default_text")
    return t if isinstance(t, str) and t.strip() else None


def update_default(data: Dict[str, Any]) -> Dict[str, Any]:
    from .services import ServiceError
    text = str(data.get("text") or "")
    if not text.strip():
        raise ServiceError("The default prompt cannot be empty.")
    if len(text) > MAX_LEN:
        raise ServiceError(f"Prompt text is too long (max {MAX_LEN:,} characters).")
    with _LOCK:
        d = _load()
        d["default_text"] = text
        d["default_updated_at"] = _now()
        _write(d)
    return {"template": get(DEFAULT_ID), "warnings": []}


def reset_default() -> Dict[str, Any]:
    with _LOCK:
        d = _load()
        d.pop("default_text", None)
        d.pop("default_updated_at", None)
        _write(d)
    return {"template": get(DEFAULT_ID)}


def _default_entry(d: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    d = d or {}
    return {"id": DEFAULT_ID, "name": "Default", "builtin": True, "locked": False, "modified": bool(d.get("default_text")), "tags": ["built-in", "manual", "all acs"],
            "description": "Built-in QA Architect prompt (test_cases_generator_prompt.md) — mortgage-domain manual test cases with full AC traceability.",
            "options": {}, "text": None, "updated_at": d.get("default_updated_at", ""), "used": 0}


def _load() -> Dict[str, Any]:
    try:
        d = json.loads(PATH.read_text(encoding="utf-8"))
        if isinstance(d, dict) and isinstance(d.get("templates"), list):
            return d
    except FileNotFoundError:
        pass
    except Exception:
        pass
    d = {"default_id": DEFAULT_ID, "templates": _starters(), "default_used": 0}
    _write(d)
    return d


def _write(d: Dict[str, Any]) -> None:
    tmp = PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, indent=1), encoding="utf-8")
    tmp.replace(PATH)


def default_text() -> str:
    from .services import read_default_prompt
    return read_default_prompt()


def list_all() -> Dict[str, Any]:
    with _LOCK:
        d = _load()
    de = _default_entry(d)
    de["used"] = d.get("default_used", 0)
    ids = {t["id"] for t in d["templates"]}
    did = d.get("default_id") if d.get("default_id") in ids else DEFAULT_ID
    return {"default_id": did, "templates": [de] + d["templates"]}


def get(tid: str) -> Optional[Dict[str, Any]]:
    return next((t for t in list_all()["templates"] if t["id"] == tid), None)


def text_of(t: Dict[str, Any]) -> str:
    return default_text() if t["id"] == DEFAULT_ID else (t.get("text") or "")


def validate(text: str) -> Dict[str, Any]:
    found = PH_RE.findall(text or "")
    missing = [p for p in REQUIRED if p not in found]
    unknown = sorted({p for p in found if p not in KNOWN})
    return {"missing": missing, "unknown": unknown, "found": sorted(set(found) & KNOWN), "ok": not missing}


def _clean(data: Dict[str, Any], cur: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    from .services import ServiceError
    name = str(data.get("name", (cur or {}).get("name", ""))).strip()[:80]
    if not name:
        raise ServiceError("Template name is required.")
    text = str(data.get("text", (cur or {}).get("text", "")) or "")
    if not text.strip():
        raise ServiceError("Prompt text is required.")
    if len(text) > MAX_LEN:
        raise ServiceError(f"Prompt text is too long (max {MAX_LEN:,} characters).")
    v = validate(text)
    if v["missing"]:
        raise ServiceError("Missing required placeholder" + ("s" if len(v["missing"]) > 1 else "") + ": "
                           + ", ".join("{{" + p + "}}" for p in v["missing"]))
    tags = data.get("tags", (cur or {}).get("tags", []))
    if isinstance(tags, str):
        tags = tags.split(",")
    tags = [str(t).strip().lstrip("#").lower()[:30] for t in tags if str(t).strip()][:10]
    op = data.get("options") if isinstance(data.get("options"), dict) else (cur or {}).get("options", {})
    tt = [x for x in (op.get("test_types") or []) if x in TEST_TYPES] or ["positive", "negative", "edge"]
    try:
        n = max(1, min(100, int(op.get("num_cases") or 10)))
    except (TypeError, ValueError):
        raise ServiceError("Number of cases must be a whole number between 1 and 100.")
    dl = op.get("detail_level") if op.get("detail_level") in DETAIL else "detailed"
    return {"name": name, "description": str(data.get("description", (cur or {}).get("description", "")) or "").strip()[:300],
            "tags": tags, "text": text, "options": {"test_types": tt, "num_cases": n, "detail_level": dl}, "warnings": v["unknown"]}


def create(data: Dict[str, Any]) -> Dict[str, Any]:
    from .services import ServiceError
    c = _clean(data)
    warn = c.pop("warnings")
    with _LOCK:
        d = _load()
        if len(d["templates"]) >= MAX_TEMPLATES:
            raise ServiceError(f"At most {MAX_TEMPLATES} templates.")
        if any(t["name"].lower() == c["name"].lower() for t in d["templates"]) or c["name"].lower() == "default":
            raise ServiceError(f"A template named '{c['name']}' already exists.")
        t = {"id": "tpl-" + uuid.uuid4().hex[:8], **c, "builtin": False, "updated_at": _now(), "used": 0}
        d["templates"].append(t)
        _write(d)
    return {"template": t, "warnings": warn}


def update(tid: str, data: Dict[str, Any]) -> Dict[str, Any]:
    from .services import ServiceError
    if tid == DEFAULT_ID:
        return update_default(data)
    with _LOCK:
        d = _load()
        t = next((x for x in d["templates"] if x["id"] == tid), None)
        if not t:
            raise ServiceError("Template not found.", 404)
        c = _clean(data, t)
        warn = c.pop("warnings")
        if any(x is not t and x["name"].lower() == c["name"].lower() for x in d["templates"]) or c["name"].lower() == "default":
            raise ServiceError(f"A template named '{c['name']}' already exists.")
        t.update(c, updated_at=_now())
        _write(d)
    return {"template": t, "warnings": warn}


def delete(tid: str) -> None:
    from .services import ServiceError
    if tid == DEFAULT_ID:
        raise ServiceError("The built-in Default template cannot be deleted.", 403)
    with _LOCK:
        d = _load()
        n = len(d["templates"])
        d["templates"] = [x for x in d["templates"] if x["id"] != tid]
        if len(d["templates"]) == n:
            raise ServiceError("Template not found.", 404)
        if d.get("default_id") == tid:
            d["default_id"] = DEFAULT_ID
        _write(d)


def duplicate(tid: str) -> Dict[str, Any]:
    src = get(tid)
    from .services import ServiceError
    if not src:
        raise ServiceError("Template not found.", 404)
    names = {t["name"].lower() for t in list_all()["templates"]}
    base = src["name"] + " (copy)"
    name, k = base, 2
    while name.lower() in names:
        name, k = f"{base} {k}", k + 1
    text = text_of(src)
    if src["id"] == DEFAULT_ID:  # the default file has no placeholders: add a context header so it validates
        text = ("**Story:** {{story_title}}\n**Description:**\n{{description}}\n\n**Acceptance Criteria:**\n"
                "{{acceptance_criteria}}\n\n" + text)
    return create({"name": name, "description": src.get("description", ""), "tags": src.get("tags", []), "text": text,
                   "options": src.get("options") or {}})


def set_default(tid: str) -> None:
    from .services import ServiceError
    with _LOCK:
        d = _load()
        if tid != DEFAULT_ID and not any(x["id"] == tid for x in d["templates"]):
            raise ServiceError("Template not found.", 404)
        d["default_id"] = tid
        _write(d)


def mark_used(ids: List[str]) -> None:
    try:
        with _LOCK:
            d = _load()
            for t in d["templates"]:
                if t["id"] in ids:
                    t["used"] = int(t.get("used") or 0) + 1
            if DEFAULT_ID in ids:
                d["default_used"] = int(d.get("default_used") or 0) + 1
            _write(d)
    except Exception:
        pass


def resolve_ids(ids: Any) -> List[str]:
    """Valid, de-duplicated template ids; falls back to the current default template."""
    valid = {t["id"] for t in list_all()["templates"]}
    out = []
    for i in ids if isinstance(ids, list) else []:
        i = str(i)
        if i in valid and i not in out:
            out.append(i)
    return out or [list_all()["default_id"]]


# ---------------------------------------------------------------- filling
def context_from_run(run: Dict[str, Any]) -> Dict[str, str]:
    from . import parsing
    ft = run.get("feature_text") or ""
    jira = run.get("jira") or {}
    title = (jira.get("summary") if isinstance(jira, dict) else "") or next((l.strip() for l in ft.splitlines() if l.strip()), "")
    acs = []
    try:
        acs = parsing.split_acceptance_criteria(ft) or []
    except Exception:
        pass
    ac_txt = "\n".join(f"{a.get('id')}: {a.get('title', '')}" for a in acs) if acs else ft
    sid = run.get("story_id") or ""
    return {"story_title": (f"{sid} · " if sid else "") + title[:200], "description": ft, "acceptance_criteria": ac_txt}


def fill(t: Dict[str, Any], ctx: Dict[str, str]) -> str:
    """Filled system prompt for template t. Default -> the prompt file unchanged. Unknown placeholders are left as-is.
    The required output template is appended when missing (same rule as the Custom prompt)."""
    if t["id"] == DEFAULT_ID:
        return default_text()
    op = t.get("options") or {}
    vals = dict(ctx)
    vals["num_cases"] = str(op.get("num_cases") or 10)
    vals["test_types"] = ", ".join(op.get("test_types") or ["positive", "negative", "edge"])
    vals["detail_level"] = DETAIL.get(op.get("detail_level"), DETAIL["detailed"])
    out = PH_RE.sub(lambda m: vals.get(m.group(1), m.group(0)), t.get("text") or "")
    if "Test Case ID:" not in out:
        from .services import output_template_section
        out = out + "\n\n" + output_template_section()
    return out
