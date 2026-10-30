"""Review tools (additive): export (xlsx / csv / qTest-import csv) and per-run version history.

Nothing here changes the existing Save & Download Excel flow or the qTest payload builder:
exports are written to <run>/exports/ and never touch run['excel_path']; versions live in
<run>/versions.json next to the run's other files.
"""
import csv
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill

from . import excel_io, parsing, services
from .config import RUNS_DIR

# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #
EXPORT_COLS = {  # key -> header
    "id": "Test case Id", "name": "Test Case Name", "description": "Test Case Description",
    "precondition": "Precondition", "priority": "Priority", "acs": "AC Tags", "status": "Review Status",
    "template": "Template", "type": "Type",
}
DEFAULT_COLS = ["id", "name", "description", "precondition", "priority", "acs"]
BASE6 = ["id", "name", "description", "precondition"]
STATUS_LABEL = {"not": "Not reviewed", "reviewed": "Reviewed", "changes": "Needs changes"}
FORMATS = ("xlsx", "csv", "qtest")


def case_type(tc: Dict[str, Any]) -> str:
    return tc.get("type") if tc.get("type") in parsing.TYPES else parsing.guess_type(tc)


def _val(tc: Dict[str, Any], key: str) -> str:
    if key == "acs":
        return ", ".join(tc.get("acs") or [])
    if key == "status":
        return STATUS_LABEL.get(tc.get("status"), "Not reviewed")
    if key == "type":
        return case_type(tc)
    if key == "template":
        return tc.get("template") or "Default"
    return str(tc.get(key) or "")


def parse_cols(raw: str) -> List[str]:
    cols = [c for c in (raw or "").split(",") if c in EXPORT_COLS]
    return cols or list(DEFAULT_COLS)


def select_cases(cases: List[Dict[str, Any]], only_reviewed: bool) -> List[Dict[str, Any]]:
    return [c for c in cases if not only_reviewed or c.get("status") == "reviewed"]


def table(cases: List[Dict[str, Any]], cols: List[str], steps: bool) -> List[List[str]]:
    """Header + rows. steps=True -> one row per step (TC fields repeated); else one row per TC."""
    head = [EXPORT_COLS[c] for c in cols] + (["Step #", "Step Description", "Expected Result"] if steps
                                              else ["Steps", "Expected Results"])
    rows = [head]
    for tc in cases:
        base = [_val(tc, c) for c in cols]
        st = tc.get("steps") or [{"description": "", "expected": ""}]
        if steps:
            for i, s in enumerate(st, 1):
                rows.append(base + [str(i), s.get("description", ""), s.get("expected", "")])
        else:
            rows.append(base + ["\n".join(f"{i}. {s.get('description', '')}" for i, s in enumerate(st, 1)),
                                "\n".join(f"{i}. {s.get('expected', '')}" for i, s in enumerate(st, 1))])
    return rows


QTEST_HEAD = ["Name", "Description", "Precondition", "Test Step #", "Test Step Description",
              "Test Step Expected Result", "Priority", "Type", "Status", "Tags"]


def qtest_table(cases: List[Dict[str, Any]]) -> List[List[str]]:
    """qTest Manager 'Import test cases from file' layout: one row per step, test-case level fields
    only on the first step row of each test case."""
    rows = [QTEST_HEAD]
    for tc in cases:
        st = tc.get("steps") or [{"description": "", "expected": ""}]
        tags = ", ".join((tc.get("acs") or []) + [case_type(tc)])
        for i, s in enumerate(st, 1):
            first = i == 1
            rows.append([
                tc.get("name", "") if first else "",
                tc.get("description", "") if first else "", tc.get("precondition", "") if first else "",
                str(i), s.get("description", ""), s.get("expected", ""),
                (tc.get("priority") or "Medium") if first else "", "Manual" if first else "",
                "New" if first else "", tags if first else "",
            ])
    return rows


def csv_bytes(rows: List[List[str]]) -> bytes:
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\r\n").writerows(rows)
    return ("\ufeff" + buf.getvalue()).encode("utf-8")   # BOM so Excel opens UTF-8 correctly


def xlsx_file(run: Dict[str, Any], cases: List[Dict[str, Any]], cols: List[str], steps: bool) -> Path:
    out = RUNS_DIR / run["run_id"] / "exports"
    out.mkdir(parents=True, exist_ok=True)
    name = (run.get("story_id") or "LOCAL").replace("/", "_")
    path = out / f"Export_{name}.xlsx"
    std = steps and cols[:4] == BASE6 and set(cols) <= set(BASE6 + ["priority", "acs", "status"])
    if std:
        # Reuse the existing Excel writer (same layout as Save & Download Excel) ...
        services.save_excel(parsing.test_cases_to_markdown(cases), path)
        if set(cols) & {"priority", "acs", "status"}:
            # ... plus the same review-only columns it adds
            excel_io.add_review_columns(path, cases, run.get("ac_list"))
        return path
    rows = table(cases, cols, steps)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Test Cases"
    for r in rows:
        ws.append(r)
    fill = PatternFill("solid", fgColor="4361EE")
    for c in ws[1]:
        c.font, c.fill = Font(bold=True, color="FFFFFF"), fill
    for col in ws.columns:
        w = max(len(str(c.value or "")) for c in col)
        ws.column_dimensions[col[0].column_letter].width = min(60, max(10, w + 2))
        for c in col[1:]:
            c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.freeze_panes = "A2"
    wb.save(path)
    return path


# --------------------------------------------------------------------------- #
# Version history
# --------------------------------------------------------------------------- #
MAX_VERSIONS = 30


def _vpath(run: Dict[str, Any]) -> Optional[Path]:
    rid = run.get("run_id")
    return RUNS_DIR / rid / "versions.json" if rid else None


def load(run: Dict[str, Any]) -> List[Dict[str, Any]]:
    p = _vpath(run)
    if not p or not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []


def _clean(cases: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return json.loads(json.dumps(parsing.sanitize_cases(cases)))


def record(run: Dict[str, Any], note: str) -> Optional[Dict[str, Any]]:
    """Append a version when the run's test cases changed since the last one. Never raises."""
    p = _vpath(run)
    cases = run.get("test_cases") or []
    if not p or not cases:
        return None
    vs = load(run)
    snap = _clean(cases)
    if vs and vs[-1].get("cases") == snap:
        return None
    if note == "manual edits" and vs:   # name the regenerated test cases when a Save carries them
        prev = {c["id"]: c for c in vs[-1].get("cases", [])}
        rg = [c["id"] for c in snap if c.get("regenerated") and not (prev.get(c["id"]) or {}).get("regenerated")]
        if rg:
            note = "regenerated " + ", ".join(rg[:4]) + ("…" if len(rg) > 4 else "")
    tpls = sorted({c.get("template") for c in snap if c.get("template")}) or ["Default"]
    v = {"v": (vs[-1]["v"] + 1) if vs else 1, "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
         "note": note, "templates": tpls, "count": len(snap),
         "steps": sum(len(c.get("steps") or []) for c in snap), "cases": snap}
    vs.append(v)
    vs = vs[-MAX_VERSIONS:]
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(vs, ensure_ascii=False), encoding="utf-8")
    return v
