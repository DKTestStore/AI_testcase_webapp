"""Convert between generator markdown, the 6-column table, and grouped test cases.

Reuses ai_test_generator.ai_helpers.ai_helpers_utils.parse_test_cases so the table
matches exactly what save_to_excel() would write.
"""
import re
from typing import Any, Dict, List

from . import config  # noqa: F401  (sets sys.path)
from ai_test_generator.ai_helpers.ai_helpers_utils import parse_test_cases

COLUMNS = ["Test case Id", "Test Case Name", "Test Case Description",
           "Precondition", "Step Description", "Expected Result"]


def markdown_to_test_cases(markdown: str) -> List[Dict[str, Any]]:
    """parse_test_cases() returns one row per step with TC fields repeated;
    group consecutive rows that share the same Test Case ID."""
    rows = parse_test_cases(markdown or "")
    cases: List[Dict[str, Any]] = []
    for tc_id, name, desc, pre, step, expected in rows:
        if cases and cases[-1]["id"] == tc_id and cases[-1]["name"] == name:
            cases[-1]["steps"].append({"description": step, "expected": expected})
        else:
            cases.append({"id": tc_id, "name": name, "description": desc,
                          "precondition": pre,
                          "steps": [{"description": step, "expected": expected}]})
    return cases


def _one_line(text: Any) -> str:
    # save_to_excel/_extract_field read single lines and split tables on "|"
    return re.sub(r"\s+", " ", str(text or "")).replace("|", "/").strip()


def test_cases_to_markdown(cases: List[Dict[str, Any]]) -> str:
    """Rebuild markdown in the exact 'Required Output Template' of the prompts,
    so the existing save_to_excel(markdown, filename) can be reused after edits."""
    blocks = []
    for tc in cases:
        steps = [s for s in tc.get("steps", []) if (s.get("description") or s.get("expected"))]
        if not steps:
            steps = [{"description": "-", "expected": "-"}]
        lines = [
            f"Test Case ID: {_one_line(tc.get('id'))}",
            f"Test Case Name: {_one_line(tc.get('name'))}",
            f"Test Case Description: {_one_line(tc.get('description'))}",
            f"Precondition: {_one_line(tc.get('precondition'))}",
            "",
            "| Step Description | Expected Result |",
            "| :--- | :--- |",
        ]
        for s in steps:
            lines.append(f"| {_one_line(s.get('description')) or '-'} | {_one_line(s.get('expected')) or '-'} |")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks) + "\n"


PRIORITIES = ("High", "Medium", "Low")
STATUSES = ("not", "reviewed", "changes")


def sanitize_cases(cases: Any) -> List[Dict[str, Any]]:
    out = []
    for tc in cases or []:
        if not isinstance(tc, dict):
            continue
        out.append({
            "id": str(tc.get("id", "")).strip(),
            "name": str(tc.get("name", "")).strip(),
            "description": str(tc.get("description", "")).strip(),
            "precondition": str(tc.get("precondition", "")).strip(),
            "steps": [{"description": str(s.get("description", "")).strip(),
                       "expected": str(s.get("expected", "")).strip()}
                      for s in (tc.get("steps") or []) if isinstance(s, dict)],
            # Review-only metadata (display only, never written to Excel / qTest payload)
            "priority": tc.get("priority") if tc.get("priority") in PRIORITIES else "Medium",
            "acs": [str(a)[:20] for a in (tc.get("acs") or []) if str(a).strip()][:30],
            "status": tc.get("status") if tc.get("status") in STATUSES else "not",
            "regenerated": bool(tc.get("regenerated")),  # display-only badge
        })
    return out


# --------------------------------------------------------------------------- #
# Acceptance-criteria splitting + heuristic TC -> AC mapping (for the RTM)
# --------------------------------------------------------------------------- #
_AC_HEAD = re.compile(
    r"(?im)^[ \t]*(?:h\d\.\s*)?[*#|\s]*(?:Acceptance\s+Criteria|AC)\s*[-#]?\s*0*(\d+)\s*[:\-\u2013\u2014.]?\s*(.*)$")


def split_acceptance_criteria(text: str) -> List[Dict[str, str]]:
    text = (text or "").replace("\r\n", "\n")
    heads = list(_AC_HEAD.finditer(text))
    acs = []
    if heads:
        for i, m in enumerate(heads):
            end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
            body = text[m.end():end].strip()
            title = re.sub(r"[*_{}]|\s+", " ", m.group(2)).strip() or body.split("\n")[0][:60]
            acs.append({"id": f"AC-{int(m.group(1)):02d}", "title": title[:80], "text": body})
    else:
        items = [l.strip(" -*\t") for l in text.split("\n")
                 if re.match(r"^\s*(?:[-*]|\d+[.)])\s+\S", l)]
        for i, it in enumerate(items[:30], 1):
            acs.append({"id": f"AC-{i:02d}", "title": it[:80], "text": it})
    if not acs and text.strip():
        acs = [{"id": "AC-01", "title": "Full requirement", "text": text}]
    return acs


_STOP = set("the a an and or to of in on for is are be with when then given i as that this it by at from "
            "should will can user lo".split())


def _tokens(s: str) -> set:
    return {w for w in re.findall(r"[a-z0-9]+", (s or "").lower()) if w not in _STOP and len(w) > 2}


def map_cases_to_acs(cases: List[Dict[str, Any]], acs: List[Dict[str, str]]) -> Dict[str, str]:
    """Best keyword-overlap match; explicit 'AC 01'/'AC-1' references in the TC win."""
    mapping = {}
    for tc in cases:
        blob = " ".join([tc.get("name", ""), tc.get("description", ""), tc.get("precondition", "")])
        explicit = re.search(r"(?i)\b(?:AC|acceptance\s+criteria)\s*[-#]?\s*0*(\d+)", blob)
        if explicit:
            want = f"AC-{int(explicit.group(1)):02d}"
            if any(a["id"] == want for a in acs):
                mapping[tc["id"]] = want
                continue
        tt = _tokens(blob)
        best, score = (acs[0]["id"] if acs else ""), -1
        for a in acs:
            sc = len(tt & _tokens(a["title"] + " " + a["text"]))
            if sc > score:
                best, score = a["id"], sc
        mapping[tc["id"]] = best
    return mapping


def suggest_acs(cases: List[Dict[str, Any]], acs: List[Dict[str, str]]) -> None:
    """Fill tc['acs'] (display-only) with explicit AC references found in the test case text,
    falling back to the best keyword match. Existing non-empty mappings are kept."""
    if not acs:
        return
    ids = {a["id"] for a in acs}
    best = map_cases_to_acs(cases, acs)
    for tc in cases:
        if tc.get("acs"):
            continue
        blob = " ".join([tc.get("name", ""), tc.get("description", ""), tc.get("precondition", "")]
                        + [s.get("description", "") for s in tc.get("steps", [])])
        found = []
        for m in re.finditer(r"(?i)\b(?:AC|acceptance\s+criteria)\s*[-#]?\s*0*(\d+)", blob):
            a = f"AC-{int(m.group(1)):02d}"
            if a in ids and a not in found:
                found.append(a)
        tc["acs"] = found or ([best[tc["id"]]] if best.get(tc["id"]) else [])
        tc.setdefault("priority", "Medium")
        tc.setdefault("status", "not")
