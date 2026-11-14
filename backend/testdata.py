"""Test data generator, Edge value library, coverage booster, and Gherkin export.

The library is a built-in Bug Magnet-style catalog (our own values, not Bug Magnet's
exact list). Library lookups are offline and never call an AI provider.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .services import ServiceError

LIB_PATH = Path(__file__).resolve().parent / "data" / "edge_values.json"

# Field-type inference from step / field labels
_FIELD_RES: List[Tuple[str, re.Pattern]] = [
    ("email", re.compile(r"\be-?mail\b", re.I)),
    ("confirm", re.compile(r"\bconfirm(?:\s+password)?\b", re.I)),
    ("password", re.compile(r"\bpasswords?\b|\bpasswd\b|\bpin\b", re.I)),
    ("url", re.compile(r"\bhttps?\b|\burls?\b|\bwebsite\b", re.I)),
    ("date", re.compile(r"\bdates?\b|\bdob\b|\bbirth|\bexpir", re.I)),
    ("name", re.compile(r"\b(first\s+)?names?\b|\bsurname\b|\bfull name\b", re.I)),
    ("number", re.compile(r"\bamount\b|\bcount\b|\bage\b|\bquantity\b|\bnumber\b|\bqty\b", re.I)),
]

_PWD_LEN = re.compile(r"(\d+)\s*[-–to]+\s*(\d+)\s*(?:char|characters)?", re.I)

# Heuristic "AI" samples (used when we are not calling a model, or as a fallback)
_AI_SAMPLES = {
    "email": {
        "valid": ["jordan.lee@example.com"],
        "invalid": ["(empty)"],
        "boundary": [],
    },
    "password": {
        "valid": ["Summer2026!"],
        "invalid": ["password", "(empty)"],
        "boundary": [],
    },
    "confirm": {
        "valid": ["Summer2026!  (match)"],
        "invalid": ["Summer2026  (mismatch)", "(empty)"],
        "boundary": ["same as New password at min and max length"],
    },
    "url": {
        "valid": ["https://example.com"],
        "invalid": ["not a url"],
        "boundary": [],
    },
    "date": {
        "valid": ["2024-02-29"],
        "invalid": ["2023-02-31"],
        "boundary": ["1970-01-01"],
    },
    "name": {
        "valid": ["Jordan Lee"],
        "invalid": ["(empty)"],
        "boundary": ["A"],
    },
    "number": {
        "valid": ["1"],
        "invalid": ["abc", "(empty)"],
        "boundary": ["0", "-1"],
    },
    "text": {
        "valid": ["Sample text"],
        "invalid": ["(empty)"],
        "boundary": [],
    },
}

_SEC_RE = re.compile(r"\b(sql\s*injection|sqli|xss|script|brute.?force|lockout|payload|injection)\b", re.I)


def load_catalog() -> Dict[str, Any]:
    if not LIB_PATH.exists():
        raise ServiceError("Edge value library file is missing.", 500)
    return json.loads(LIB_PATH.read_text(encoding="utf-8"))


def _prefs() -> Dict[str, Any]:
    try:
        from . import settings_store
        return settings_store.get_edge_library_prefs()
    except Exception:
        return {"enabled": True, "disabled": [], "custom": [], "custom_categories": []}


def library(prefs: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Catalog with Settings prefs applied (disabled categories, custom values)."""
    cat = load_catalog()
    p = prefs if prefs is not None else _prefs()
    disabled = set(p.get("disabled") or [])
    enabled = bool(p.get("enabled", True))
    custom_items = list(p.get("custom") or [])
    categories = []
    for c in cat.get("categories") or []:
        item = dict(c)
        item["enabled"] = enabled and c["id"] not in disabled
        if c["id"] == "custom":
            item["items"] = [
                {"v": x.get("value") or x.get("v") or "", "lab": x.get("label") or x.get("lab") or "custom",
                 "kind": x.get("kind") or ""}
                for x in custom_items if (x.get("value") or x.get("v"))
            ]
        categories.append(item)
    for cc in p.get("custom_categories") or []:
        cid = str(cc.get("id") or "").strip() or "custom"
        if any(c["id"] == cid for c in categories):
            continue
        categories.append({
            "id": cid, "name": cc.get("name") or cid, "match": cc.get("match") or [],
            "items": [], "enabled": enabled and cid not in disabled,
        })
    out = dict(cat)
    out["enabled"] = enabled
    out["categories"] = categories
    return out


def library_public(prefs: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    lib = library(prefs)
    cats = []
    for c in lib["categories"]:
        cats.append({
            "id": c["id"], "name": c.get("name") or c["id"], "match": c.get("match") or [],
            "testing_only": bool(c.get("testing_only")), "enabled": bool(c.get("enabled", True)),
            "count": len(c.get("items") or []),
            "items": [
                {"v": it.get("v") or "", "lab": it.get("lab") or "", "kind": it.get("kind") or "",
                 "testing_only": bool(it.get("testing_only") or c.get("testing_only")),
                 "len": it.get("len")}
                for it in (c.get("items") or [])
            ],
        })
    return {"name": lib.get("name") or "Edge value library", "note": lib.get("note") or "",
            "enabled": bool(lib.get("enabled", True)), "categories": cats}


def infer_field_type(text: str) -> str:
    blob = text or ""
    for key, rx in _FIELD_RES:
        if rx.search(blob):
            return key
    return "text"


def password_bounds(feature_text: str) -> Tuple[int, int]:
    m = _PWD_LEN.search(feature_text or "")
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return (min(a, b), max(a, b))
    return (8, 64)


def infer_fields(cases: List[Dict[str, Any]], feature_text: str = "") -> List[Dict[str, Any]]:
    """Unique fields inferred from step descriptions (and case names)."""
    seen: Dict[str, Dict[str, Any]] = {}
    blob_story = feature_text or ""
    for tc in cases or []:
        for s in tc.get("steps") or []:
            desc = str(s.get("description") or s.get("step") or "")
            key = infer_field_type(desc + " " + str(tc.get("name") or "") + " " + blob_story)
            if key not in seen:
                seen[key] = {"key": key, "label": _field_label(key), "rule": _field_rule(key, blob_story)}
    if not seen:
        # story-only: still offer email/password when the text mentions them
        for key, rx in _FIELD_RES:
            if rx.search(blob_story) and key not in seen:
                seen[key] = {"key": key, "label": _field_label(key), "rule": _field_rule(key, blob_story)}
    return list(seen.values())


def _field_label(key: str) -> str:
    return {"email": "Email", "password": "New password", "confirm": "Confirm password",
            "url": "URL", "date": "Date", "name": "Name", "number": "Number", "text": "Text"}.get(key, key.title())


def _field_rule(key: str, feature_text: str) -> str:
    if key == "email":
        return "Valid email format"
    if key in ("password", "confirm"):
        lo, hi = password_bounds(feature_text)
        return f"{lo}–{hi} characters, 1 upper, 1 lower, 1 digit" + (" · must match New password" if key == "confirm" else "")
    if key == "date":
        return "ISO date or locale date"
    if key == "url":
        return "Valid URL"
    if key == "number":
        return "Numeric value"
    return "Free text"


def _expand_len(item: Dict[str, Any]) -> str:
    n = item.get("len")
    v = str(item.get("v") or "")
    if not n:
        return v
    if v in ("256-char string", "1,024-char string", "65,536-char string", "256-char lorem", "1,024-char lorem", "64k lorem"):
        return v  # keep short label in the UI; the label already names the length
    return v


def _lib_values_for(field_key: str, lib: Optional[Dict[str, Any]] = None) -> Dict[str, List[Dict[str, str]]]:
    lib = lib or library()
    if not lib.get("enabled", True):
        return {"valid": [], "invalid": [], "boundary": []}
    buckets = {"valid": [], "invalid": [], "boundary": []}
    for c in lib.get("categories") or []:
        if not c.get("enabled", True):
            continue
        if field_key not in (c.get("match") or []) and c["id"] not in ("custom",):
            continue
        for it in c.get("items") or []:
            kind = (it.get("kind") or "").lower()
            entry = {"v": _expand_len(it) or it.get("lab") or "(empty)", "src": "lib",
                     "lab": it.get("lab") or "", "testing_only": bool(it.get("testing_only") or c.get("testing_only"))}
            if c["id"] in ("text", "lorem") or (it.get("len") and not kind):
                # long strings / length labels are boundary-ish
                if (it.get("len") or 0) >= 256 or "char" in (it.get("lab") or ""):
                    kind = "boundary"
                elif it.get("v") in ("", "   "):
                    kind = "invalid"
            if not kind:
                if c["id"] in ("security",) or it.get("testing_only"):
                    kind = "invalid"
                elif c["id"] in ("ws",) and it.get("v") in ("", "   "):
                    kind = "invalid"
                elif c["id"] in ("special", "unicode", "ws"):
                    kind = "invalid" if c["id"] == "ws" else "boundary"
                else:
                    kind = "valid"
            if kind not in buckets:
                kind = "valid"
            # Avoid flooding a column: cap later
            buckets[kind].append(entry)
    return buckets


def _ai_values_for(field_key: str, feature_text: str) -> Dict[str, List[Dict[str, str]]]:
    samples = _AI_SAMPLES.get(field_key) or _AI_SAMPLES["text"]
    out: Dict[str, List[Dict[str, str]]] = {}
    # Pull a realistic email from the story if present
    extra_email = None
    m = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", feature_text or "", re.I)
    if m and field_key == "email":
        extra_email = m.group(0)
    for kind in ("valid", "invalid", "boundary"):
        vals = list(samples.get(kind) or [])
        if kind == "valid" and extra_email and extra_email not in vals:
            vals = [extra_email] + vals
        if field_key in ("password", "confirm") and kind == "boundary":
            lo, hi = password_bounds(feature_text)
            vals = [f"Aa1!{'a' * max(0, lo - 4)} ({lo})", f"Aa1!… ({hi})", f"Aa1!{'a' * max(0, lo - 5)} ({lo - 1})"]
        out[kind] = [{"v": v, "src": "ai"} for v in vals]
    return out


def _filter(col: List[Dict[str, str]], source: str) -> List[Dict[str, str]]:
    if source == "ai":
        return [x for x in col if x.get("src") == "ai"]
    if source in ("library", "lib"):
        return [x for x in col if x.get("src") == "lib"]
    return col


def values_for_field(field_key: str, source: str = "both", feature_text: str = "",
                     lib: Optional[Dict[str, Any]] = None) -> Dict[str, List[Dict[str, str]]]:
    src = (source or "both").lower()
    if src in ("library", "lib"):
        ai, libv = {"valid": [], "invalid": [], "boundary": []}, _lib_values_for(field_key, lib)
        merged = libv
    elif src == "ai":
        merged = _ai_values_for(field_key, feature_text)
    else:
        ai = _ai_values_for(field_key, feature_text)
        libv = _lib_values_for(field_key, lib)
        merged = {k: (ai.get(k) or []) + (libv.get(k) or []) for k in ("valid", "invalid", "boundary")}
    # cap columns so the panel stays readable
    for k in merged:
        merged[k] = merged[k][:8]
    return merged


def format_test_data(td: Any) -> str:
    """Single-line display / Excel / repo `data` string."""
    if not td:
        return ""
    if isinstance(td, str):
        return td.strip()
    if not isinstance(td, dict):
        return str(td).strip()
    parts = []
    for label, key in (("Valid", "valid"), ("Invalid", "invalid"), ("Boundary", "boundary")):
        items = td.get(key) or []
        if not items:
            continue
        first = items[0]
        val = first.get("v") if isinstance(first, dict) else first
        if val:
            parts.append(f"{label}: {val}")
    return " · ".join(parts)


def parse_test_data(raw: Any) -> Dict[str, List[Dict[str, str]]]:
    if isinstance(raw, dict) and any(k in raw for k in ("valid", "invalid", "boundary")):
        out = {}
        for k in ("valid", "invalid", "boundary"):
            col = []
            for it in raw.get(k) or []:
                if isinstance(it, dict):
                    col.append({"v": str(it.get("v") or it.get("value") or ""), "src": it.get("src") or ""})
                elif it:
                    col.append({"v": str(it), "src": ""})
            out[k] = col
        return out
    if isinstance(raw, str) and raw.strip():
        return {"valid": [{"v": raw.strip(), "src": ""}], "invalid": [], "boundary": []}
    return {"valid": [], "invalid": [], "boundary": []}


def attach_to_cases(cases: List[Dict[str, Any]], field_values: Dict[str, Dict[str, List]],
                    feature_text: str = "") -> List[Dict[str, Any]]:
    """Copy of cases with test_data (and flattened data) written onto matching steps."""
    out = json.loads(json.dumps(cases, default=str))
    for tc in out:
        for s in tc.get("steps") or []:
            desc = str(s.get("description") or s.get("step") or "")
            key = infer_field_type(desc + " " + str(tc.get("name") or ""))
            vals = field_values.get(key)
            if not vals:
                continue
            s["test_data"] = vals
            s["data"] = format_test_data(vals)
    return out


def generate(cases: List[Dict[str, Any]], *, source: str = "both",
             sources: Optional[Dict[str, str]] = None, feature_text: str = "") -> Dict[str, Any]:
    fields = infer_fields(cases, feature_text)
    lib = library()
    field_values: Dict[str, Any] = {}
    field_rows = []
    for f in fields:
        src = (sources or {}).get(f["key"]) or source or "both"
        vals = values_for_field(f["key"], src, feature_text, lib)
        field_values[f["key"]] = vals
        matched = [c["name"] for c in lib.get("categories") or []
                   if c.get("enabled", True) and f["key"] in (c.get("match") or [])]
        field_rows.append({**f, "source": src, "matched": matched, "values": vals})
    proposed = attach_to_cases(cases, field_values, feature_text)
    return {"fields": field_rows, "test_cases": proposed, "library_enabled": bool(lib.get("enabled", True))}


# --------------------------------------------------------------------------- #
# Boost coverage (heuristic + library; no AI call)
# --------------------------------------------------------------------------- #

def coverage_type(tc: Dict[str, Any]) -> str:
    from . import parsing
    t = tc.get("type") if tc.get("type") in getattr(parsing, "TYPES", ()) else None
    if not t:
        t = parsing.guess_type(tc)
    if t == "Edge":
        return "Boundary"
    return t or "Positive"


def coverage_counts(cases: List[Dict[str, Any]]) -> Dict[str, int]:
    c = {"Positive": 0, "Negative": 0, "Boundary": 0, "Security": 0}
    for tc in cases or []:
        t = coverage_type(tc)
        c[t] = c.get(t, 0) + 1
    return c


def _has_similar(cases: List[Dict[str, Any]], name: str) -> bool:
    n = (name or "").lower()
    keys = set(re.findall(r"[a-z0-9]{4,}", n))
    for tc in cases or []:
        blob = (tc.get("name") or "") + " " + (tc.get("description") or "")
        if n and n in blob.lower():
            return True
        if keys and len(keys & set(re.findall(r"[a-z0-9]{4,}", blob.lower()))) >= max(3, len(keys) - 1):
            return True
    return False


def boost_preview(cases: List[Dict[str, Any]], *, feature_text: str = "",
                  story_id: str = "") -> Dict[str, Any]:
    """Suggested missing Negative / Boundary / Security cases. Nothing is added yet."""
    lo, hi = password_bounds(feature_text)
    fields = {f["key"] for f in infer_fields(cases, feature_text)}
    story = feature_text or ""
    suggestions: List[Dict[str, Any]] = []

    def add(sid, typ, pri, name, why, steps, field_key=""):
        if _has_similar(cases, name):
            return
        suggestions.append({
            "id": sid, "type": typ, "priority": pri, "name": name, "why": why,
            "from_library": typ in ("Boundary", "Security"),
            "steps": steps, "field": field_key,
        })

    if "email" in fields or re.search(r"e-?mail", story, re.I):
        add("N-email-format", "Negative", "High",
            "Invalid email format is rejected and no mail is sent",
            "Malformed addresses are a common gap when only empty email is covered.",
            [
                {"description": "Enter not-an-email in the Email field and submit",
                 "expected": "A format error is shown; no success confirmation is used",
                 "test_data": {"invalid": [{"v": "not-an-email", "src": "lib"}], "valid": [], "boundary": []},
                 "data": "Invalid: not-an-email"},
                {"description": "Confirm no email or reset message is sent",
                 "expected": "No message is issued"},
            ], "email")
        add("N-email-unknown", "Negative", "High",
            "Unregistered email shows the same generic confirmation",
            "Prevents account enumeration when a lookup is involved.",
            [
                {"description": "Enter unknown.user@example.com and submit",
                 "expected": "The same generic confirmation as for a registered email is shown",
                 "data": "Invalid: unknown.user@example.com"},
                {"description": "Confirm the mail sink has no new message",
                 "expected": "No email is generated"},
            ], "email")
    if "confirm" in fields or "password" in fields:
        add("N-mismatch", "Negative", "Medium",
            "Confirm password mismatch is rejected and the password is unchanged",
            "Mismatch on a confirmation field is often missing.",
            [
                {"description": "Enter a valid new password and a different confirm password",
                 "expected": "A mismatch error is shown; the value is not saved",
                 "data": "Invalid: confirm does not match"},
            ], "confirm")
    if "password" in fields or re.search(r"password", story, re.I):
        add("B-pwd-below", "Boundary", "Medium",
            f"New password of {lo - 1} characters is rejected",
            f"Lower boundary just below the {lo}-character minimum. Value from the Edge value library.",
            [
                {"description": f"Enter a complex password of {lo - 1} characters and confirm it",
                 "expected": f"A length error states the minimum is {lo} characters",
                 "data": f"Boundary: {lo - 1} characters"},
            ], "password")
        add("B-pwd-min", "Boundary", "Medium",
            f"New password of {lo} characters (minimum) is accepted",
            f"Exact minimum length with complexity met. Value from the Edge value library.",
            [
                {"description": f"Enter a complex password of {lo} characters and confirm it",
                 "expected": "No length error is shown and the password is accepted",
                 "data": f"Boundary: {lo} characters"},
            ], "password")
        add("B-pwd-max", "Boundary", "Medium",
            f"New password of {hi} characters (maximum) is accepted, {hi + 1} is rejected",
            f"Upper boundary at {hi}, and just above at {hi + 1}. Values from the Edge value library.",
            [
                {"description": f"Enter a {hi}-character complex password and confirm it",
                 "expected": "The value is accepted",
                 "data": f"Boundary: {hi} characters"},
                {"description": f"Repeat with a {hi + 1}-character password",
                 "expected": f"A length error states the maximum is {hi} characters",
                 "data": f"Boundary: {hi + 1} characters"},
            ], "password")
    # Security from the library (testing only)
    add("S-sqli", "Security", "High",
        "SQL injection in an input field is rejected with no query effect",
        "Values from the Edge value library (for testing only).",
        [
            {"description": "Enter a SQL injection payload in the email or lookup field and submit",
             "expected": "The app does not error or dump data; the payload is treated as a normal invalid or unknown value",
             "data": "Invalid: ' OR 1=1 --  (library, testing only)"},
            {"description": "Verify stored records are unchanged",
             "expected": "No unexpected rows or resets are created"},
        ], "email")
    add("S-xss", "Security", "Medium",
        "XSS payload in an input field is encoded and not executed",
        "Values from the Edge value library (for testing only).",
        [
            {"description": "Enter a script payload in a text field and submit",
             "expected": "The string is not executed; it is escaped in any echoed message",
             "data": "Invalid: <script>alert(1)</script>  (library, testing only)"},
        ], "text")
    if re.search(r"lock|attempt|sign\s*in|login|brute", story, re.I) or "password" in fields:
        add("S-lockout", "Security", "High",
            "Five failed sign-in attempts lock the account for 15 minutes",
            "Brute-force lockout is a common gap when login is in the story.",
            [
                {"description": "Submit the correct identifier and an incorrect password 4 times",
                 "expected": "Each attempt shows an invalid-credentials error; the account is not locked"},
                {"description": "Submit a 5th incorrect password",
                 "expected": "The account is locked; a lockout message is shown"},
                {"description": "Try the correct password immediately",
                 "expected": "Sign in is refused until the lockout window ends"},
            ], "password")

    cur = coverage_counts(cases)
    by = {"Negative": [], "Boundary": [], "Security": []}
    for s in suggestions:
        by.setdefault(s["type"], []).append(s)
    addc = {k: len(by.get(k) or []) for k in ("Negative", "Boundary", "Security")}
    nxt = {k: cur.get(k, 0) + addc.get(k, 0) if k != "Positive" else cur.get(k, 0)
           for k in ("Positive", "Negative", "Boundary", "Security")}
    return {
        "current": cur, "add": addc, "next": nxt,
        "groups": [
            {"type": "Negative", "title": "Negative cases", "items": by.get("Negative") or []},
            {"type": "Boundary", "title": "Boundary cases", "items": by.get("Boundary") or []},
            {"type": "Security", "title": "Security cases", "items": by.get("Security") or []},
        ],
        "suggestions": suggestions,
        "story_id": story_id or "",
    }


def suggestions_to_cases(suggestions: Iterable[Dict[str, Any]], start_n: int = 1) -> List[Dict[str, Any]]:
    out = []
    n = start_n
    for s in suggestions:
        cid = f"TC{n:03d}"
        n += 1
        steps = []
        for st in s.get("steps") or []:
            td = st.get("test_data")
            steps.append({
                "description": st.get("description") or "",
                "expected": st.get("expected") or "",
                "test_data": td,
                "data": st.get("data") or format_test_data(td),
            })
        out.append({
            "id": cid,
            "name": s.get("name") or cid,
            "description": s.get("why") or "",
            "precondition": "",
            "priority": "High" if s.get("priority") == "High" else ("Low" if s.get("priority") == "Low" else "Medium"),
            "type": s.get("type") or "Negative",
            "acs": [],
            "status": "not",
            "added": True,
            "steps": steps or [{"description": "", "expected": ""}],
        })
    return out


# --------------------------------------------------------------------------- #
# Gherkin
# --------------------------------------------------------------------------- #

def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s or "feature"


def _tag_for_type(t: str) -> str:
    t = (t or "").lower()
    if t in ("negative",):
        return "@negative"
    if t in ("boundary", "edge"):
        return "@boundary"
    if t in ("security",):
        return "@security"
    return ""


def _examples_from_cases(cases: List[Dict[str, Any]]) -> List[Tuple[str, str]]:
    """password, result pairs from test_data / names where possible."""
    rows = []
    for tc in cases or []:
        typ = coverage_type(tc)
        result = "rejected" if typ in ("Negative", "Boundary", "Security") and re.search(
            r"reject|invalid|error|below|65|too long|too short|mismatch",
            (tc.get("name") or "") + " " + (tc.get("description") or ""), re.I) else "accepted"
        if typ == "Positive":
            result = "accepted"
        # Prefer an explicit test_data value
        val = ""
        for s in tc.get("steps") or []:
            td = parse_test_data(s.get("test_data") or s.get("data"))
            for kind in ("boundary", "invalid", "valid"):
                if td.get(kind):
                    val = td[kind][0].get("v") or ""
                    if kind == "invalid":
                        result = "rejected"
                    break
            if val:
                break
        if not val:
            val = (tc.get("name") or "")[:40]
        rows.append((val, result))
    return rows


def gherkin_for_run(run: Dict[str, Any], *, outline: bool = False, tags: bool = True,
                    background: bool = True, cases: Optional[List[Dict[str, Any]]] = None) -> str:
    cases = cases if cases is not None else list(run.get("test_cases") or [])
    story = run.get("story_id") or "LOCAL"
    title = ""
    if isinstance(run.get("jira"), dict):
        title = run["jira"].get("summary") or ""
    title = title or (run.get("title") or f"Tests for {story}")
    lines: List[str] = []
    if tags:
        lines.append(f"@jira-{story}")
    lines.append(f"Feature: {title}")
    # User-story flavour from the feature text, if it looks like one
    feat = (run.get("feature_text") or "").strip()
    for raw in feat.splitlines()[:8]:
        s = raw.strip()
        if re.match(r"(?i)^(as a|i want|so that)\b", s):
            lines.append(f"  {s}")
    if background:
        lines.append("")
        lines.append("  Background:")
        pre = next((c.get("precondition") for c in cases if c.get("precondition")), "") or "the application is open"
        lines.append(f"    Given {pre[0].lower() + pre[1:] if pre else 'the application is open'}")
    if outline:
        pwd_cases = [c for c in cases if coverage_type(c) in ("Boundary", "Positive", "Negative")
                     and re.search(r"password|length", (c.get("name") or ""), re.I)]
        if not pwd_cases:
            pwd_cases = cases[:4]
        examples = _examples_from_cases(pwd_cases) or [("Summer2026!", "accepted")]
        lines.append("")
        if tags:
            lines.append("  @boundary")
        lines.append("  Scenario Outline: Input values are validated")
        lines.append('    When the user enters "<value>" in the field')
        lines.append("    And submits the form")
        lines.append('    Then the result is "<result>"')
        lines.append("")
        lines.append("    Examples:")
        w1 = max(len("value"), max(len(a) for a, _ in examples))
        w2 = max(len("result"), max(len(b) for _, b in examples))
        lines.append(f"      | {'value'.ljust(w1)} | {'result'.ljust(w2)} |")
        for a, b in examples:
            lines.append(f"      | {a.ljust(w1)} | {b.ljust(w2)} |")
    else:
        for tc in cases:
            typ = coverage_type(tc)
            lines.append("")
            tag = _tag_for_type(typ) if tags else ""
            if tag:
                lines.append(f"  {tag}")
            lines.append(f"  Scenario: {tc.get('name') or tc.get('id')}")
            pre = tc.get("precondition") or ""
            if pre and not background:
                lines.append(f"    Given {pre[0].lower() + pre[1:] if pre else pre}")
            steps = tc.get("steps") or []
            for i, s in enumerate(steps):
                kw = "When" if i == 0 else ("Then" if i == len(steps) - 1 else "And")
                desc = (s.get("description") or "").strip() or "the step is performed"
                td = format_test_data(s.get("test_data") or s.get("data"))
                if td and "enter" in desc.lower() and '"' not in desc:
                    # keep the action; data already lives in the Test Data column
                    pass
                lines.append(f"    {kw} {desc[0].lower() + desc[1:] if desc else desc}")
                if i == len(steps) - 1:
                    exp = (s.get("expected") or "").strip()
                    if exp and kw != "Then":
                        lines.append(f"    Then {exp[0].lower() + exp[1:]}")
                elif i == 0 and len(steps) == 1:
                    exp = (s.get("expected") or "").strip()
                    if exp:
                        lines.append(f"    Then {exp[0].lower() + exp[1:]}")
            if steps:
                last_exp = (steps[-1].get("expected") or "").strip()
                # If we used Then on the last action, also add expected if the last kw wasn't Then
                if last_exp and not any(ln.strip().startswith("Then ") for ln in lines[-6:]):
                    lines.append(f"    Then {last_exp[0].lower() + last_exp[1:]}")
    return "\n".join(lines).rstrip() + "\n"


def gherkin_filename(run: Dict[str, Any]) -> str:
    story = (run.get("story_id") or "LOCAL").replace("/", "_")
    title = ""
    if isinstance(run.get("jira"), dict):
        title = run["jira"].get("summary") or ""
    return f"{story}-{_slug(title) if title else 'tests'}.feature"


def zip_features(files: List[Tuple[str, str]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, text in files:
            zf.writestr(name, text.encode("utf-8"))
    return buf.getvalue()
