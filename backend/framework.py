"""Project automation framework: tree, files, generate-into, previews, sync.

Additive API under /api/automation. Framework files live in SQLite, not on
disk, and never in the application .env.
"""
from __future__ import annotations

import csv
import zipfile
import hashlib
import io
import json
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.orm import Session

from . import script_options as so
from . import services, token_usage
from . import framework_layout as fl
from . import libindex as li
from .config import env
from .db.engine import session_scope
from .db.models import (
    AutomationRun,
    AutomationRunResult,
    AutomationScript,
    Counter,
    FrameworkAssertion,
    FrameworkFile,
    FrameworkFileVersion,
    FrameworkLocator,
    FrameworkMapping,
    ProjectFramework,
    TcScriptMap,
)
from .services import ServiceError

try:
    import openpyxl  # already a required app dependency; still guard
except Exception:  # pragma: no cover
    openpyxl = None

try:
    import yaml as _yaml
except Exception:  # pragma: no cover — optional, no new required dep
    _yaml = None

log = logging.getLogger("atg.framework")

router = APIRouter()  # included on the /api/automation router

_SAFE_PATH = re.compile(r"^[A-Za-z0-9._\- /]+$")
_IST = ZoneInfo("Asia/Kolkata")
_SECRET_KEYS = re.compile(r"(password|secret|token|key|passwd|api_key|connection)", re.I)
_STDLIB = {
    "abc", "argparse", "asyncio", "base64", "collections", "contextlib", "copy",
    "csv", "datetime", "decimal", "enum", "functools", "glob", "hashlib", "io",
    "itertools", "json", "logging", "math", "os", "pathlib", "random", "re",
    "shutil", "socket", "sqlite3", "string", "subprocess", "sys", "tempfile",
    "threading", "time", "typing", "unittest", "uuid", "xml", "zipfile",
}


def now_ist() -> str:
    return datetime.now(_IST).strftime("%Y-%m-%d %H:%M IST")


def _session():
    session = session_scope()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _next(session: Session, name: str, prefix: str, width: int = 4) -> str:
    row = session.get(Counter, name)
    if row is None:
        row = Counter(name=name, value=0)
        session.add(row)
        session.flush()
    row.value = int(row.value or 0) + 1
    return f"{prefix}{row.value:0{width}d}"


def safe_path(raw: str, *, allow_dir: bool = True) -> str:
    s = str(raw or "").strip().replace("\\", "/").lstrip("/")
    if not s or ".." in s or s.startswith("/") or ":" in s:
        raise ServiceError("Invalid path.")
    if not _SAFE_PATH.match(s):
        raise ServiceError("Path may only contain letters, numbers, spaces, and . _ - /")
    if not allow_dir and s.endswith("/"):
        raise ServiceError("Expected a file path.")
    return s[:400]


def _fw_or_404(session: Session, fid: str) -> ProjectFramework:
    fw = session.get(ProjectFramework, str(fid or ""))
    if not fw:
        raise ServiceError("Framework not found.", 404)
    return fw


def _file_row(session: Session, fid: str, path: str) -> Optional[FrameworkFile]:
    return (
        session.query(FrameworkFile)
        .filter(FrameworkFile.framework_id == fid, FrameworkFile.path == path)
        .one_or_none()
    )


def _fw_dict(fw: ProjectFramework, session: Optional[Session] = None) -> Dict[str, Any]:
    nfiles = 0
    if session is not None:
        nfiles = (
            session.query(FrameworkFile)
            .filter(FrameworkFile.framework_id == fw.id, FrameworkFile.is_dir.is_(False))
            .count()
        )
    return {
        "id": fw.id,
        "project": fw.project,
        "language": fw.language,
        "framework": fw.framework,
        "types": list(fw.types or []),
        "options": dict(fw.options or {}),
        "created": fw.created,
        "updated": fw.updated,
        "file_count": nfiles,
    }


def _file_dict(f: FrameworkFile, *, content: bool = False) -> Dict[str, Any]:
    d = {
        "id": f.id,
        "path": f.path,
        "is_dir": bool(f.is_dir),
        "version": f.version,
        "updated": f.updated,
        "updated_by": f.updated_by,
        "ext": _ext(f.path),
    }
    if content and not f.is_dir:
        d["content"] = f.content or ""
    return d


def _ext(path: str) -> str:
    name = path.rstrip("/").split("/")[-1]
    if name.startswith(".") and name.count(".") == 1:
        return name.lower()  # .env
    if "." not in name:
        return ""
    return name.rsplit(".", 1)[-1].lower()


# --------------------------------------------------------------------------- seed

_SEED_TEXT = {
    "README.md": "# Project automation framework\n\nGenerated tests are added to this folder structure.\n",
    "requirements.txt": "pytest\nplaywright\n",
    "pytest.ini": "[pytest]\naddopts = -q\ntestpaths = tests\n",
    "package.json": '{\n  "name": "automation-framework",\n  "private": true\n}\n',
    "pom.xml": '<?xml version="1.0" encoding="UTF-8"?>\n<project>\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>example</groupId>\n  <artifactId>automation</artifactId>\n  <version>1.0.0</version>\n</project>\n',
    "config/settings.py": '"""Shared settings. Load environment values from staging.env / qa.env."""\nBASE_URL = ""\n',
    "config/staging.env": "BASE_URL=https://staging.example.com\nBROWSER=chromium\n",
    "config/qa.env": "BASE_URL=https://qa.example.com\nBROWSER=chromium\n",
    "pages/base_page.py": "class BasePage:\n    def __init__(self, page):\n        self.page = page\n",
    "fixtures/conftest.py": "import pytest\n\n@pytest.fixture\ndef page():\n    yield None\n",
}


def _seed_paths(language: str) -> List[str]:
    t = so.get_folder_templates()
    key = (language or "python").lower()
    aliases = {"py": "python", "js": "javascript", "ts": "typescript", "cs": "dotnet", ".net": "dotnet", "c#": "dotnet"}
    key = aliases.get(key, key)
    return list(t.get(key) or t.get("python") or [])


def _seed_framework(session: Session, fw: ProjectFramework) -> None:
    now = now_ist()
    paths = _seed_paths(fw.language)
    seen = set()
    for raw in paths:
        path = safe_path(raw)
        is_dir = path.endswith("/")
        # also create parent dirs
        parts = path.rstrip("/").split("/")
        acc = ""
        limit = len(parts) if is_dir else len(parts) - 1
        for i in range(limit):
            acc = "/".join(parts[: i + 1]) + "/"
            if acc not in seen:
                session.add(FrameworkFile(
                    framework_id=fw.id, path=acc, is_dir=True, content="",
                    version=1, updated=now, updated_by="System",
                ))
                seen.add(acc)
        if path not in seen:
            content = "" if is_dir else _SEED_TEXT.get(path, "")
            session.add(FrameworkFile(
                framework_id=fw.id, path=path, is_dir=is_dir, content=content,
                version=1, updated=now, updated_by="System",
            ))
            seen.add(path)
            if not is_dir and content:
                session.flush()
                row = _file_row(session, fw.id, path)
                if row:
                    _add_file_version(session, row, author="System", note="Initial")
    session.flush()


def _add_file_version(session: Session, row: FrameworkFile, author: str = "You", note: str = "") -> None:
    session.add(FrameworkFileVersion(
        file_id=row.id, version=row.version, content=row.content or "",
        author=author, note=note or "", created=now_ist(),
    ))


def _upsert_file(session: Session, fid: str, path: str, content: str, author: str, note: str = "") -> FrameworkFile:
    path = safe_path(path, allow_dir=True)
    is_dir = path.endswith("/")
    # parents
    parts = path.rstrip("/").split("/")
    acc = ""
    limit = len(parts) if is_dir else len(parts) - 1
    now = now_ist()
    for i in range(max(0, limit)):
        acc = "/".join(parts[: i + 1]) + "/"
        if not _file_row(session, fid, acc):
            session.add(FrameworkFile(
                framework_id=fid, path=acc, is_dir=True, content="",
                version=1, updated=now, updated_by=author,
            ))
            session.flush()
    row = _file_row(session, fid, path)
    if row:
        if is_dir:
            return row
        if (row.content or "") == (content or ""):
            return row
        row.content = content or ""
        row.version = int(row.version or 1) + 1
        row.updated = now
        row.updated_by = author
        session.flush()
        _add_file_version(session, row, author=author, note=note or "Updated")
        return row
    row = FrameworkFile(
        framework_id=fid, path=path, is_dir=is_dir, content="" if is_dir else (content or ""),
        version=1, updated=now, updated_by=author,
    )
    session.add(row)
    session.flush()
    if not is_dir:
        _add_file_version(session, row, author=author, note=note or "Added")
    return row


def _tree_payload(session: Session, fid: str) -> List[Dict[str, Any]]:
    rows = (
        session.query(FrameworkFile)
        .filter(FrameworkFile.framework_id == fid)
        .order_by(FrameworkFile.is_dir.desc(), FrameworkFile.path)
        .all()
    )
    edited = _edited_paths(session, fid)
    out = []
    for r in rows:
        d = _file_dict(r)
        if not r.is_dir:
            d["edited"] = bool(edited.get(r.path))
        out.append(d)
    return out


# --------------------------------------------------------------------------- TC sync

def steps_hash(case: Dict[str, Any]) -> str:
    payload = {
        "title": case.get("title") or case.get("name") or "",
        "steps": case.get("steps") or [],
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _repo_cases_by_id(ids: List[str]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    try:
        from . import test_repo
        for cid in ids:
            c = test_repo.get_case(cid)
            if c:
                out[cid] = c
    except Exception:
        log.debug("repo lookup failed", exc_info=True)
    return out


def refresh_map_status(session: Session, rows: List[TcScriptMap]) -> None:
    ids = list({r.tc_id for r in rows if r.tc_id})
    cases = _repo_cases_by_id(ids)
    now = now_ist()
    for r in rows:
        if r.status == "regen":
            continue
        case = cases.get(r.tc_id)
        if not case:
            continue
        h = steps_hash(case)
        if r.steps_hash and h != r.steps_hash:
            if r.status != "stale":
                r.status = "stale"
                r.updated = now


def _status_payload(r: TcScriptMap) -> Dict[str, Any]:
    label = {
        "ready": "Script ready",
        "stale": "Out of date",
        "regen": "Regenerated",
        "none": "No script",
    }.get(r.status or "ready", r.status)
    return {
        "tc_id": r.tc_id,
        "framework_id": r.framework_id,
        "file_path": r.file_path,
        "script_id": r.script_id,
        "status": r.status,
        "label": label,
        "generated_at": r.generated_at,
        "updated": r.updated,
    }


# --------------------------------------------------------------------------- previews

def _detect_csv(text: str):
    sample = text[:4096] or ""
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        delim = dialect.delimiter
    except Exception:
        delim = "," if sample.count(",") >= sample.count(";") else (";" if ";" in sample else ",")
    has_header = True
    try:
        has_header = csv.Sniffer().has_header(sample)
    except Exception:
        has_header = True
    return delim, has_header


def preview_csv(text: str) -> Dict[str, Any]:
    delim, has_header = _detect_csv(text)
    rows = list(csv.reader(io.StringIO(text or ""), delimiter=delim))
    errors = []
    header = []
    body = rows
    if has_header and rows:
        header = rows[0]
        body = rows[1:]
    elif rows:
        header = [f"col_{i+1}" for i in range(len(rows[0]))]
    for i, row in enumerate(body, 1):
        for j, cell in enumerate(row):
            name = header[j] if j < len(header) else f"col_{j+1}"
            if name.lower() in ("email", "e-mail") and cell and "@" not in cell:
                errors.append({"row": i, "column": name, "message": f'email “{cell}” is not valid'})
            if name.lower() in ("password", "email") and not str(cell).strip():
                errors.append({"row": i, "column": name, "message": f"{name} is empty"})
    return {
        "kind": "csv",
        "delimiter": delim,
        "encoding": "utf-8",
        "has_header": has_header,
        "header": header,
        "rows": body,
        "errors": errors,
    }


def preview_xlsx(content: str) -> Dict[str, Any]:
    """`content` may be a JSON-encoded workbook (preferred) or raw bytes not stored.

    Workbooks are stored as JSON {sheets: {name: {header, rows}}} so we do not
    need to keep binary in SQLite. If openpyxl is present, callers can import
    an uploaded .xlsx; otherwise a message is returned.
    """
    if content and content.lstrip().startswith("{"):
        try:
            data = json.loads(content)
            if isinstance(data, dict) and "sheets" in data:
                return {"kind": "xlsx", "sheets": data["sheets"], "errors": data.get("errors") or []}
        except Exception:
            pass
    if openpyxl is None:
        return {"kind": "xlsx", "sheets": {}, "errors": [
            {"message": "openpyxl is not installed, so Excel files cannot be parsed. Paste a table or use CSV/JSON."}
        ]}
    # attempt binary? we don't store raw xlsx in text columns
    return {"kind": "xlsx", "sheets": {}, "errors": [
        {"message": "This file is not a stored workbook. Import a .xlsx or edit the table."}
    ]}


def parse_xlsx_bytes(raw: bytes) -> Dict[str, Any]:
    if openpyxl is None:
        raise ServiceError("openpyxl is not available to parse Excel files.")
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    sheets = {}
    for name in wb.sheetnames:
        ws = wb[name]
        rows = []
        for row in ws.iter_rows(values_only=True):
            rows.append(["" if c is None else str(c) for c in row])
        header = rows[0] if rows else []
        body = rows[1:] if rows else []
        sheets[name] = {"header": header, "rows": body}
    wb.close()
    return {"sheets": sheets}


def preview_json(text: str) -> Dict[str, Any]:
    errors = []
    data = None
    try:
        data = json.loads(text or "null")
    except Exception as e:
        errors.append({"message": f"JSON syntax: {e}"})
    return {"kind": "json", "ok": not errors, "data": data, "raw": text or "", "errors": errors, "tree": _json_tree(data) if data is not None else []}


def _json_tree(val, name="$", path="$") -> List[Dict[str, Any]]:
    typ = type(val).__name__
    if typ == "dict":
        typ = "object"
    elif typ == "list":
        typ = "array"
    elif typ == "bool":
        typ = "bool"
    elif typ == "NoneType":
        typ = "null"
    elif typ == "int" or typ == "float":
        typ = "number"
    else:
        typ = "string"
    node = {"name": name, "type": typ, "path": path, "value": None, "children": []}
    if typ == "object":
        node["children"] = [_json_tree(v, k, path + "." + str(k))[0] for k, v in (val or {}).items()]
    elif typ == "array":
        node["children"] = [_json_tree(v, str(i), path + f"[{i}]")[0] for i, v in enumerate(val or [])]
        node["value"] = len(val or [])
    else:
        node["value"] = val
    return [node]


def preview_xml(text: str) -> Dict[str, Any]:
    errors = []
    tree = []
    xpath = ""
    try:
        root = ET.fromstring(text or "<root/>")
        tree = [_xml_tree(root, "/")]
        xpath = "/" + root.tag
    except Exception as e:
        errors.append({"message": f"XML syntax: {e}"})
    return {"kind": "xml", "ok": not errors, "raw": text or "", "tree": tree, "xpath": xpath, "errors": errors}


def _xml_tree(el: ET.Element, parent: str) -> Dict[str, Any]:
    path = (parent.rstrip("/") + "/" + el.tag)
    kids = [_xml_tree(c, path) for c in list(el)]
    attrs = [{ "name": k, "type": "attr", "value": v, "path": path + f"/@{k}", "children": [] } for k, v in el.attrib.items()]
    text = (el.text or "").strip()
    return {
        "name": el.tag, "type": "element", "path": path, "value": text,
        "attrs": el.attrib, "children": attrs + kids,
    }


def preview_yaml(text: str) -> Dict[str, Any]:
    errors = []
    data = None
    if _yaml is None:
        errors.append({"message": "PyYAML is not installed; showing Raw only. Syntax was not fully validated."})
        # cheap indent hint: a line with 1 space then a key
        for i, line in enumerate((text or "").splitlines(), 1):
            if re.match(r"^ [^ ].*: ?", line):
                errors.append({"line": i, "message": f"Line {i}: bad indent — this key may not be nested correctly."})
    else:
        try:
            data = _yaml.safe_load(text or "")
        except Exception as e:
            msg = str(e)
            line = None
            m = re.search(r"line (\d+)", msg)
            if m:
                line = int(m.group(1))
            errors.append({"line": line, "message": f"YAML syntax: {msg}"})
    table = []
    if isinstance(data, dict):
        # keys per top-level env-like mapping
        envs = [k for k, v in data.items() if isinstance(v, dict)]
        keys = []
        for e in envs:
            for k in data[e].keys():
                if k not in keys:
                    keys.append(k)
        if envs and keys:
            for k in keys:
                row = {"key": k}
                for e in envs:
                    row[e] = (data[e] or {}).get(k, "")
                table.append(row)
            return {"kind": "yaml", "ok": not any("syntax" in (e.get("message") or "").lower() for e in errors if "PyYAML is not" not in (e.get("message") or "")),
                    "raw": text or "", "data": data, "table": table, "envs": envs, "errors": errors, "has_yaml": True}
    return {"kind": "yaml", "ok": not errors or all("PyYAML is not" in (e.get("message") or "") or e.get("line") for e in errors),
            "raw": text or "", "data": data, "table": table, "errors": errors, "has_yaml": _yaml is not None}


def preview_env(text: str) -> Dict[str, Any]:
    rows = []
    for line in (text or "").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if "=" not in line:
            rows.append({"key": line.strip(), "value": "", "secret": False})
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        rows.append({"key": k, "value": v, "secret": bool(_SECRET_KEYS.search(k))})
    return {"kind": "env", "rows": rows, "raw": text or ""}


def env_from_rows(rows: List[Dict[str, Any]]) -> str:
    lines = []
    for r in rows or []:
        k = str(r.get("key") or "").strip()
        if not k:
            continue
        v = str(r.get("value") if r.get("value") is not None else "")
        lines.append(f"{k}={v}")
    return "\n".join(lines) + ("\n" if lines else "")


def csv_from_preview(prev: Dict[str, Any]) -> str:
    delim = prev.get("delimiter") or ","
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=delim)
    header = prev.get("header") or []
    if prev.get("has_header", True) and header:
        w.writerow(header)
    for row in prev.get("rows") or []:
        w.writerow(row)
    return buf.getvalue()


# --------------------------------------------------------------------------- classify / used-by

def classify_files(existing: Dict[str, str], incoming: Dict[str, str], mapping: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_file: Dict[str, List[str]] = {}
    for m in mapping or []:
        p = str(m.get("file") or m.get("path") or "")
        tid = str(m.get("tc_id") or m.get("id") or "")
        if p and tid:
            by_file.setdefault(p, []).append(tid)
    out = []
    for path, content in incoming.items():
        if path not in existing:
            kind = "new"
        elif (existing.get(path) or "") == (content or ""):
            kind = "reused"
        else:
            kind = "changed"
        out.append({
            "path": path, "content": content, "kind": kind,
            "include": kind != "reused",
            "tc_ids": by_file.get(path, []),
        })
    return out


def used_by(session: Session, fid: str, path: str) -> List[str]:
    rows = (
        session.query(TcScriptMap)
        .filter(TcScriptMap.framework_id == fid, TcScriptMap.file_path == path)
        .all()
    )
    return [r.tc_id for r in rows if r.tc_id]


# --------------------------------------------------------------------------- AI suggest

def _ai_complete(provider: str, model: str, system: str, user: str, sess=None) -> Dict[str, Any]:
    if env("ATG_MOCK_GEMINI", "") == "1":
        return {"text": "{}", "usage": {"input_tokens": 0, "output_tokens": 0, "model_name": "mock", "provider": "mock"}}
    if not provider:
        try:
            from . import settings_store
            provider = settings_store.get_default_provider()
        except Exception:
            provider = "gemini"
    out = services._complete(provider, system, user, temperature=0.2, model_name=model or None)
    try:
        usage = out.get("usage") or {}
        token_usage.record(
            action="Automation suggest",
            usage={
                "provider": usage.get("provider") or provider or "",
                "model": usage.get("provider") or provider or "",
                "model_name": usage.get("model_name") or model or "",
                "input_tokens": int(usage.get("input_tokens") or 0),
                "output_tokens": int(usage.get("output_tokens") or 0),
                "total_tokens": int(usage.get("input_tokens") or 0) + int(usage.get("output_tokens") or 0),
            },
            run=(sess or {}).get("run") if isinstance(sess, dict) else None,
        )
    except Exception:
        log.debug("token record failed", exc_info=True)
    return out


def _parse_json_blob(raw: str) -> Any:
    t = (raw or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    try:
        return json.loads(t)
    except Exception:
        m = re.search(r"(\{.*\}|\[.*\])", t, re.S)
        if m:
            try:
                return json.loads(m.group(1))
            except Exception:
                pass
    raise ServiceError("The model did not return usable JSON.")


# --------------------------------------------------------------------------- routes (attached below)


def _files_dict(val) -> Dict[str, str]:
    if isinstance(val, dict):
        return {str(k): ("" if v is None else str(v)) for k, v in val.items()}
    return {}


def _module_to_existing(mod: str, existing: List[str]) -> Optional[str]:
    rel = (mod or "").replace(".", "/").strip("/")
    if not rel:
        return None
    names = set(existing)
    for ext in (".py", ".java", ".js", ".ts", ".cs", ".robot"):
        cand = rel + ext
        if cand in names:
            return cand
    last = rel.split("/")[-1].lower()
    hits = []
    for path in existing:
        base = path.rstrip("/").split("/")[-1]
        stem = base.rsplit(".", 1)[0].lower()
        if stem != last:
            continue
        low = "/" + path.replace("\\", "/")
        if "/pages/" in low or low.startswith("pages/") or "/pageobjects/" in low or "/keywords/" in low:
            hits.append(path)
    return hits[0] if hits else None


def infer_related_paths(content: str, existing: List[str]) -> Dict[str, List[str]]:
    """Best-effort page-object and test-data paths mentioned in a test file."""
    text = content or ""
    existing = [p for p in existing if p]
    pages: List[str] = []
    data: List[str] = []

    def add(bucket: List[str], path: str) -> None:
        path = (path or "").replace("\\", "/").lstrip("./")
        if path and path not in bucket:
            bucket.append(path)

    for m in re.finditer(r"^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+", text, re.M):
        hit = _module_to_existing(m.group(1), existing)
        if hit:
            add(pages, hit)
    for m in re.finditer(r"^\s*import\s+([A-Za-z_][\w.]*)", text, re.M):
        hit = _module_to_existing(m.group(1).split(",")[0].strip(), existing)
        if hit:
            add(pages, hit)
    for m in re.finditer(
        r"(?:(?<=[\"'`])|(?<![A-Za-z0-9_]))((?:pages|pageobjects|page_objects|keywords|components)/[A-Za-z0-9_./-]+\.\w+)",
        text,
        re.I,
    ):
        path = m.group(1).replace("\\", "/")
        if path in existing:
            add(pages, path)
    for m in re.finditer(
        r"(?:(?<=[\"'`])|(?<![A-Za-z0-9_]))((?:test_data|testdata|data|resources)/[A-Za-z0-9_./-]+\.(?:csv|xlsx|xls|json|xml|ya?ml))",
        text,
        re.I,
    ):
        path = m.group(1).replace("\\", "/")
        if path in existing or True:
            add(data, path)
    return {"page_objects": pages, "test_data": data}


def _is_test_path(path: str) -> bool:
    n = (path or "").replace("\\", "/").lower()
    base = n.split("/")[-1]
    return (
        "/tests/" in n or n.startswith("tests/") or n.startswith("test/") or "/test/" in n
        or base.startswith("test_") or base.endswith("_test.py") or "spec." in base
    )



def _stdlib_minimal_xlsx() -> bytes:
    """Minimal xlsx (Office Open XML) built with the stdlib only."""
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetData/></worksheet>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>'
    )
    wb_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '</Relationships>'
    )
    ctypes = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", ctypes)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        zf.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


def _minimal_xlsx_bytes() -> bytes:
    if openpyxl is not None:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Sheet1"
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()
    return _stdlib_minimal_xlsx()


def _minimal_xlsx_json() -> str:
    """Store a new workbook in the existing JSON-sheets format used by preview_xlsx."""
    raw = _minimal_xlsx_bytes()
    try:
        book = parse_xlsx_bytes(raw)
        if not book.get("sheets"):
            book = {"sheets": {"Sheet1": {"header": [], "rows": []}}}
        return json.dumps(book, ensure_ascii=False)
    except Exception:
        return json.dumps({"sheets": {"Sheet1": {"header": [], "rows": []}}}, ensure_ascii=False)


def seed_new_file_content(path: str) -> str:
    """Default content for a newly created file, based on extension."""
    ext = _ext(path)
    if ext in ("xlsx", "xlsm"):
        return _minimal_xlsx_json()
    if ext == "csv":
        return "col1,col2\n"
    if ext == "json":
        return "{}\n"
    if ext in ("yaml", "yml"):
        return "# YAML\n"
    if ext == "xml":
        return '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n</root>\n'
    if ext == "txt":
        return ""
    if ext == "py":
        name = path.rstrip("/").split("/")[-1]
        return f'"""{name}"""\n'
    return ""


def _is_generated_version(author: str, note: str) -> bool:
    a = (author or "").strip().lower()
    n = (note or "").strip().lower()
    if a == "ai":
        return True
    if a in ("you", "system", ""):
        return n in ("applied", "new", "changed", "generated", "applied changes") or n.startswith("applied")
    return False


def _baselines(session: Session, fid: str) -> Dict[str, str]:
    """Last AI/generated snapshot per file path (current content if last save was AI)."""
    rows = (
        session.query(FrameworkFile)
        .filter(FrameworkFile.framework_id == fid, FrameworkFile.is_dir.is_(False))
        .all()
    )
    if not rows:
        return {}
    ids = [r.id for r in rows]
    versions = (
        session.query(FrameworkFileVersion)
        .filter(FrameworkFileVersion.file_id.in_(ids))
        .order_by(FrameworkFileVersion.file_id, FrameworkFileVersion.version.desc())
        .all()
    )
    latest: Dict[int, FrameworkFileVersion] = {}
    for v in versions:
        if v.file_id in latest:
            continue
        if _is_generated_version(v.author, v.note):
            latest[v.file_id] = v
    out: Dict[str, str] = {}
    for r in rows:
        if r.id in latest:
            out[r.path] = latest[r.id].content or ""
        elif _is_generated_version(r.updated_by, ""):
            out[r.path] = r.content or ""
    return out


def _edited_paths(session: Session, fid: str) -> Dict[str, bool]:
    rows = (
        session.query(FrameworkFile)
        .filter(FrameworkFile.framework_id == fid, FrameworkFile.is_dir.is_(False))
        .all()
    )
    base = _baselines(session, fid)
    out: Dict[str, bool] = {}
    for r in rows:
        b = base.get(r.path)
        if b is not None and (r.content or "") != b:
            out[r.path] = True
    return out


_PY_CLASS = re.compile(r"^class\s+(\w+)", re.M)
_PY_DEF = re.compile(r"^([ \t]*)def\s+(\w+)\s*\(", re.M)


def _parse_py_symbols(path: str, content: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    current = None
    current_indent = 0
    lines = (content or "").splitlines()
    for i, line in enumerate(lines, 1):
        cm = re.match(r"^class\s+(\w+)", line)
        if cm:
            current = cm.group(1)
            current_indent = 0
            out.append({"name": current, "kind": "class", "path": path, "line": i, "detail": "class", "page": current})
            continue
        dm = re.match(r"^([ \t]*)def\s+(\w+)\s*\(", line)
        if dm:
            indent, name = len(dm.group(1).replace("\t", "    ")), dm.group(2)
            if current and indent > 0:
                out.append({"name": name, "kind": "method", "path": path, "line": i, "detail": current + "." + name, "page": current})
            else:
                current = None
                out.append({"name": name, "kind": "function", "path": path, "line": i, "detail": name, "page": ""})
    return out



def _delete_fw_path(session: Session, fid: str, path: str) -> None:
    """Delete a file or folder row and its versions. Caller must confirm."""
    path = safe_path(path)
    row = _file_row(session, fid, path)
    if not row:
        return
    prefix = path
    rows = (
        session.query(FrameworkFile)
        .filter(FrameworkFile.framework_id == fid, FrameworkFile.path.startswith(prefix))
        .all()
    )
    ids = [r.id for r in rows]
    if ids:
        session.query(FrameworkFileVersion).filter(FrameworkFileVersion.file_id.in_(ids)).delete(synchronize_session=False)
    for r in rows:
        session.delete(r)
    session.flush()


def _repoint_maps(session: Session, fid: str, src: str, dest: str) -> None:
    if not src or src == dest:
        return
    now = now_ist()
    # Test-case script map: unique on (tc_id, framework, path)
    rows = (
        session.query(TcScriptMap)
        .filter(TcScriptMap.framework_id == fid, TcScriptMap.file_path == src)
        .all()
    )
    for r in rows:
        clash = (
            session.query(TcScriptMap)
            .filter(
                TcScriptMap.tc_id == r.tc_id,
                TcScriptMap.framework_id == fid,
                TcScriptMap.file_path == dest,
            )
            .one_or_none()
        )
        if clash and clash.id != r.id:
            session.delete(r)
        else:
            r.file_path = dest
            r.updated = now
    maps = (
        session.query(FrameworkMapping)
        .filter(FrameworkMapping.framework_id == fid, FrameworkMapping.file_path == src)
        .all()
    )
    for r in maps:
        r.file_path = dest
    session.flush()


def attach(parent: APIRouter, current) -> None:

    """Register framework routes on the existing /api/automation router."""

    from . import automation as auto

    @parent.get("/frameworks")
    def list_frameworks(project: str = Query("")):
        with session_scope() as session:
            q = session.query(ProjectFramework)
            if project:
                q = q.filter(ProjectFramework.project == project)
            rows = q.order_by(ProjectFramework.updated.desc()).all()
            return {"ok": True, "frameworks": [_fw_dict(f, session) for f in rows]}

    @parent.post("/frameworks")
    def create_framework(data: Dict[str, Any] = Body(...)):
        project = str(data.get("project") or "default")[:80]
        language = str(data.get("language") or "python")[:80]
        framework = str(data.get("framework") or "")[:80]
        types = [str(x) for x in (data.get("types") or ["ui"]) if str(x).strip()]
        options = data.get("options") if isinstance(data.get("options"), dict) else {}
        with session_scope() as session:
            existing = (
                session.query(ProjectFramework)
                .filter(ProjectFramework.project == project, ProjectFramework.language == language)
                .one_or_none()
            )
            if existing:
                return {"ok": True, "framework": _fw_dict(existing, session), "created": False}
            fid = _next(session, "framework_seq", "FW-")
            now = now_ist()
            fw = ProjectFramework(
                id=fid, project=project, language=language, framework=framework,
                types=types, options=options, created=now, updated=now,
            )
            session.add(fw)
            session.flush()
            _seed_framework(session, fw)
            session.commit()
            return {"ok": True, "framework": _fw_dict(fw, session), "created": True, "tree": _tree_payload(session, fw.id)}

    @parent.get("/frameworks/{fid}")
    def get_framework(fid: str):
        with session_scope() as session:
            fw = _fw_or_404(session, fid)
            return {"ok": True, "framework": _fw_dict(fw, session), "tree": _tree_payload(session, fid)}

    @parent.get("/frameworks/{fid}/tree")
    def get_tree(fid: str):
        with session_scope() as session:
            _fw_or_404(session, fid)
            return {"ok": True, "tree": _tree_payload(session, fid)}

    @parent.get("/frameworks/{fid}/file")
    def get_file(fid: str, path: str = Query(...)):
        path = safe_path(path)
        with session_scope() as session:
            _fw_or_404(session, fid)
            row = _file_row(session, fid, path)
            if not row:
                raise ServiceError("File not found.", 404)
            versions = (
                session.query(FrameworkFileVersion)
                .filter(FrameworkFileVersion.file_id == row.id)
                .order_by(FrameworkFileVersion.version.desc())
                .all()
            )
            return {
                "ok": True,
                "file": _file_dict(row, content=True),
                "used_by": used_by(session, fid, path),
                "versions": [
                    {"version": v.version, "author": v.author, "note": v.note, "created": v.created}
                    for v in versions
                ],
            }

    @parent.post("/frameworks/{fid}/files")
    def add_file(fid: str, data: Dict[str, Any] = Body(...)):
        path = safe_path(str(data.get("path") or ""))
        content = str(data.get("content") or "")
        is_dir = bool(data.get("is_dir")) or path.endswith("/")
        if is_dir and not path.endswith("/"):
            path += "/"
        if not is_dir and content == "" and not data.get("empty"):
            content = seed_new_file_content(path)
        with session_scope() as session:
            _fw_or_404(session, fid)
            if _file_row(session, fid, path):
                raise ServiceError("A file or folder already exists at that path.")
            row = _upsert_file(session, fid, path, content, author=str(data.get("author") or "You"), note="Added")
            session.commit()
            return {"ok": True, "file": _file_dict(row, content=True)}

    @parent.put("/frameworks/{fid}/files")
    def update_file(fid: str, data: Dict[str, Any] = Body(...)):
        path = safe_path(str(data.get("path") or ""))
        with session_scope() as session:
            _fw_or_404(session, fid)
            row = _file_row(session, fid, path)
            if not row:
                raise ServiceError("File not found.", 404)
            new_path = data.get("new_path")
            if new_path:
                dest = safe_path(str(new_path))
                if row.is_dir and not dest.endswith("/"):
                    dest += "/"
                if _file_row(session, fid, dest):
                    raise ServiceError("A file already exists at the destination.")
                # move this and descendants
                old = row.path
                prefix = old
                moved = (
                    session.query(FrameworkFile)
                    .filter(FrameworkFile.framework_id == fid, FrameworkFile.path.startswith(prefix))
                    .all()
                )
                for item in moved:
                    item.path = dest + item.path[len(prefix):]
                    item.updated = now_ist()
                    item.updated_by = str(data.get("author") or "You")
                session.commit()
                return {"ok": True, "file": _file_dict(row, content=True)}
            if "content" in data:
                if row.is_dir:
                    raise ServiceError("Folders have no content.")
                _upsert_file(session, fid, path, str(data.get("content") or ""), author=str(data.get("author") or "You"), note=str(data.get("note") or "Edited"))
            session.commit()
            row = _file_row(session, fid, path)
            return {"ok": True, "file": _file_dict(row, content=True)}

    @parent.delete("/frameworks/{fid}/files")
    def delete_file(fid: str, path: str = Query(...)):
        path = safe_path(path)
        with session_scope() as session:
            _fw_or_404(session, fid)
            row = _file_row(session, fid, path)
            if not row:
                raise ServiceError("File not found.", 404)
            prefix = path
            rows = (
                session.query(FrameworkFile)
                .filter(FrameworkFile.framework_id == fid, FrameworkFile.path.startswith(prefix))
                .all()
            )
            ids = [r.id for r in rows]
            if ids:
                session.query(FrameworkFileVersion).filter(FrameworkFileVersion.file_id.in_(ids)).delete(synchronize_session=False)
            for r in rows:
                session.delete(r)
            session.commit()
            return {"ok": True}

    @parent.get("/frameworks/{fid}/file/versions")
    def file_versions(fid: str, path: str = Query(...)):
        path = safe_path(path)
        with session_scope() as session:
            _fw_or_404(session, fid)
            row = _file_row(session, fid, path)
            if not row:
                raise ServiceError("File not found.", 404)
            versions = (
                session.query(FrameworkFileVersion)
                .filter(FrameworkFileVersion.file_id == row.id)
                .order_by(FrameworkFileVersion.version.desc())
                .all()
            )
            return {"ok": True, "current": row.version, "versions": [
                {"version": v.version, "author": v.author, "note": v.note, "created": v.created, "content": v.content}
                for v in versions
            ]}

    @parent.get("/frameworks/{fid}/file/compare")
    def compare_versions(fid: str, path: str = Query(...), a: int = Query(...), b: int = Query(...)):
        path = safe_path(path)
        with session_scope() as session:
            _fw_or_404(session, fid)
            row = _file_row(session, fid, path)
            if not row:
                raise ServiceError("File not found.", 404)
            def grab(n):
                if n == row.version:
                    return row.content or ""
                v = (
                    session.query(FrameworkFileVersion)
                    .filter(FrameworkFileVersion.file_id == row.id, FrameworkFileVersion.version == n)
                    .one_or_none()
                )
                if not v:
                    raise ServiceError(f"Version {n} not found.", 404)
                return v.content or ""
            return {"ok": True, "path": path, "a": a, "b": b, "left": grab(a), "right": grab(b)}

    @parent.post("/frameworks/{fid}/generate")
    def generate_into_fw(fid: str, data: Dict[str, Any] = Body(...), sess=Depends(current)):
        with session_scope() as session:
            fw = _fw_or_404(session, fid)
            existing_rows = (
                session.query(FrameworkFile)
                .filter(FrameworkFile.framework_id == fid, FrameworkFile.is_dir.is_(False))
                .all()
            )
            existing = {r.path: (r.content or "") for r in existing_rows}
            fw_lang, fw_fw, fw_types = fw.language, fw.framework, list(fw.types or [])
        blob = fl.framework_tree_context(existing, fw_types)
        payload = dict(data or {})
        payload["additional_context"] = (payload.get("additional_context") or "") + "\n\n" + blob
        if not payload.get("language"):
            payload["language"] = fw_lang
        if not payload.get("frameworks") and fw_fw:
            payload["frameworks"] = [fw_fw]
        if not payload.get("types") and fw_types:
            payload["types"] = fw_types
        result = auto.generate_impl(payload, sess)
        incoming = result.get("files_map") or {f["path"]: f["content"] for f in (result.get("files") or [])}
        incoming, mapping, sources = fl.remap_files_map(existing, incoming, result.get("mapping") or [], fw_types)
        result["mapping"] = mapping
        result["files_map"] = incoming
        result["files"] = [{"path": p, "content": c} for p, c in incoming.items()]
        changes = classify_files(existing, incoming, mapping)
        fl.attach_remap_meta(changes, sources)
        with session_scope() as session:
            _fw_or_404(session, fid)
            baselines = _baselines(session, fid)
        for ch in changes:
            path = ch.get("path") or ""
            current = existing.get(path, "")
            base = baselines.get(path)
            ch["current"] = current
            ch["edited"] = bool(base is not None and current != base)
            if base is not None:
                ch["baseline"] = base
        return {**result, "ok": True, "framework_id": fid, "changes": changes}

    @parent.post("/frameworks/{fid}/apply")
    def apply_changes(fid: str, data: Dict[str, Any] = Body(...)):
        changes = data.get("changes") or data.get("files") or []
        author = str(data.get("author") or "AI")
        with session_scope() as session:
            fw = _fw_or_404(session, fid)
            existing = {
                r.path: (r.content or "")
                for r in session.query(FrameworkFile).filter(
                    FrameworkFile.framework_id == fid, FrameworkFile.is_dir.is_(False)
                )
            }
            fw_types = list(fw.types or [])
            for ch in changes:
                raw = str(ch.get("path") or "")
                if not raw:
                    continue
                try:
                    ch["path"] = fl.remap_path(safe_path(raw), existing, fw_types)
                except ServiceError:
                    continue
            for m in data.get("mapping") or []:
                for key in ("file", "path"):
                    if m.get(key):
                        try:
                            m[key] = fl.remap_path(safe_path(str(m.get(key))), existing, fw_types)
                        except ServiceError:
                            pass
            applied = []
            seen_map = set()
            def _map_once(tid, p):
                key = (str(tid or "").strip(), p)
                if not key[0] or not p or key in seen_map:
                    return
                seen_map.add(key)
                _upsert_map(session, key[0], fid, p, status="regen" if data.get("regenerated") else "ready")
            for ch in changes:
                if ch.get("include") is False:
                    continue
                path = safe_path(str(ch.get("path") or ""))
                content = str(ch.get("content") or "")
                row = _upsert_file(session, fid, path, content, author=author, note=str(ch.get("kind") or "Applied"))
                applied.append(_file_dict(row))
                for tid in ch.get("tc_ids") or []:
                    _map_once(tid, path)
            # mapping from generate
            for m in data.get("mapping") or []:
                path = str(m.get("file") or m.get("path") or "")
                tid = str(m.get("tc_id") or m.get("id") or "")
                if path and tid:
                    try:
                        path = safe_path(path)
                    except Exception:
                        continue
                    _map_once(tid, path)
            fw.updated = now_ist()
            session.commit()
            return {"ok": True, "applied": applied, "tree": _tree_payload(session, fid)}

    def _upsert_map(session: Session, tc_id: str, fid: str, path: str, status: str = "ready") -> None:
        case = _repo_cases_by_id([tc_id]).get(tc_id) or {}
        h = steps_hash(case) if case else ""
        now = now_ist()
        row = (
            session.query(TcScriptMap)
            .filter(TcScriptMap.tc_id == tc_id, TcScriptMap.framework_id == fid, TcScriptMap.file_path == path)
            .one_or_none()
        )
        if row:
            row.status = status
            row.steps_hash = h or row.steps_hash
            row.generated_at = now
            row.updated = now
        else:
            session.add(TcScriptMap(
                tc_id=tc_id, framework_id=fid, file_path=path, script_id="",
                status=status, steps_hash=h, generated_at=now, updated=now,
            ))
            # Flush so a second upsert for the same (tc_id, framework, path) in this
            # request finds this row instead of inserting a duplicate (autoflush=False).
            session.flush()

    @parent.get("/tc-status")
    def tc_status(ids: str = Query(""), project: str = Query("")):
        id_list = [x.strip() for x in (ids or "").split(",") if x.strip()]
        with session_scope() as session:
            q = session.query(TcScriptMap)
            if id_list:
                q = q.filter(TcScriptMap.tc_id.in_(id_list))
            rows = q.all()
            refresh_map_status(session, rows)
            session.commit()
            by = {}
            for r in rows:
                rec = _status_payload(r)
                cur = by.get(r.tc_id)
                # prefer stale > regen > ready
                rank = {"stale": 3, "regen": 2, "ready": 1, "none": 0}
                if not cur or rank.get(r.status, 0) > rank.get(cur.get("status"), 0):
                    rec["files"] = list(dict.fromkeys((cur or {}).get("files", []) + [r.file_path]))
                    by[r.tc_id] = rec
                else:
                    cur.setdefault("files", [])
                    if r.file_path not in cur["files"]:
                        cur["files"].append(r.file_path)
            # fill "none" for requested ids with no row
            for tid in id_list:
                if tid not in by:
                    by[tid] = {"tc_id": tid, "status": "none", "label": "No script", "files": []}
            return {"ok": True, "statuses": by}

    @parent.get("/tc-usage")
    def tc_usage(tc_id: str = Query(""), project: str = Query(""), framework_id: str = Query("")):
        """Read-only 'Where is this used' + mapping payload for one test case."""
        tid = (tc_id or "").strip()
        if not tid:
            raise ServiceError("tc_id is required.")
        with session_scope() as session:
            q = session.query(TcScriptMap).filter(TcScriptMap.tc_id == tid)
            if framework_id:
                q = q.filter(TcScriptMap.framework_id == framework_id)
            elif project:
                fids = [
                    f.id for f in session.query(ProjectFramework)
                    .filter(ProjectFramework.project == project).all()
                ]
                if fids:
                    q = q.filter(TcScriptMap.framework_id.in_(fids))
            rows = q.order_by(TcScriptMap.updated.desc()).all()
            refresh_map_status(session, rows)
            session.commit()
            fid = framework_id or (rows[0].framework_id if rows else "")
            if not fid and project:
                fw = (
                    session.query(ProjectFramework)
                    .filter(ProjectFramework.project == project)
                    .order_by(ProjectFramework.updated.desc())
                    .first()
                )
                if fw:
                    fid = fw.id
            existing_rows = []
            if fid:
                existing_rows = (
                    session.query(FrameworkFile)
                    .filter(FrameworkFile.framework_id == fid, FrameworkFile.is_dir.is_(False))
                    .all()
                )
            existing = {r.path: (r.content or "") for r in existing_rows}
            existing_paths = list(existing.keys())
            test_files = []
            seen_paths = set()
            for r in rows:
                if not r.file_path or r.file_path in seen_paths:
                    continue
                seen_paths.add(r.file_path)
                test_files.append({
                    "path": r.file_path,
                    "status": r.status,
                    "label": _status_payload(r).get("label"),
                    "framework_id": r.framework_id,
                    "updated": r.updated,
                })
            # prefer reading content of the primary test file
            primary = None
            for item in test_files:
                if _is_test_path(item["path"]):
                    primary = item["path"]
                    break
            if not primary and test_files:
                primary = test_files[0]["path"]
            content = existing.get(primary or "") or ""
            related = infer_related_paths(content, existing_paths)
            page_objects = [{"path": p} for p in related["page_objects"]]
            # locators for those pages (and any locator.page matching the stem)
            stems = set()
            for p in related["page_objects"]:
                stems.add(p.rstrip("/").split("/")[-1].rsplit(".", 1)[0].lower())
                stems.add(p.lower())
            locators = []
            if fid:
                for loc in session.query(FrameworkLocator).filter(FrameworkLocator.framework_id == fid).all():
                    page = (loc.page or "").lower()
                    if not stems or page in stems or any(s in page or page in s for s in stems if s):
                        locators.append({
                            "id": loc.id, "name": loc.name, "strategy": loc.strategy,
                            "value": loc.value, "page": loc.page, "status": loc.status,
                        })
            data_files = []
            seen_data = set()
            for path in related["test_data"]:
                if path in seen_data:
                    continue
                seen_data.add(path)
                data_files.append({"path": path, "note": ""})
            if fid:
                maps = (
                    session.query(FrameworkMapping)
                    .filter(FrameworkMapping.framework_id == fid, FrameworkMapping.tc_id == tid)
                    .all()
                )
                for mrow in maps:
                    note = ""
                    rows_val = mrow.rows if isinstance(mrow.rows, list) else []
                    if rows_val:
                        note = str(len(rows_val)) + " mapped row" + ("s" if len(rows_val) != 1 else "")
                    if mrow.file_path not in seen_data:
                        seen_data.add(mrow.file_path)
                        data_files.append({"path": mrow.file_path, "note": note})
                    else:
                        for d in data_files:
                            if d["path"] == mrow.file_path and note and not d.get("note"):
                                d["note"] = note
            last_run = None
            rq = (
                session.query(AutomationRunResult, AutomationRun)
                .join(AutomationRun, AutomationRunResult.run_id == AutomationRun.id)
            )
            if fid:
                rq = rq.filter(AutomationRun.framework_id == fid)
            file_list = [x["path"] for x in test_files]
            if file_list:
                rq = rq.filter(
                    (AutomationRunResult.tc_id == tid)
                    | (AutomationRunResult.file.in_(file_list))
                    | (AutomationRunResult.name.ilike("%" + tid + "%"))
                )
            else:
                rq = rq.filter(
                    (AutomationRunResult.tc_id == tid)
                    | (AutomationRunResult.name.ilike("%" + tid + "%"))
                )
            hit = rq.order_by(AutomationRun.started.desc()).first()
            if hit:
                res, run = hit
                last_run = {
                    "id": run.id,
                    "status": res.status or run.status,
                    "started": run.started,
                    "finished": run.finished,
                    "duration_ms": res.duration_ms,
                    "file": res.file,
                    "name": res.name,
                    "tc_id": res.tc_id,
                    "error": res.error or "",
                }
            versions = []
            for s in session.query(AutomationScript).order_by(AutomationScript.updated.desc()).all():
                if tid in (s.linked_ids or []):
                    versions.append({
                        "id": s.id, "name": s.name, "version": int(s.version or 1),
                        "updated": s.updated or "", "linked_ids": list(s.linked_ids or []),
                        "folder_id": s.folder_id or "", "language": s.language or "",
                    })
            title = ""
            try:
                case = _repo_cases_by_id([tid]).get(tid) or {}
                title = case.get("title") or case.get("name") or ""
            except Exception:
                title = ""
            return {
                "ok": True,
                "tc_id": tid,
                "title": title,
                "mapped": bool(test_files),
                "framework_id": fid,
                "test_files": test_files,
                "page_objects": page_objects,
                "locators": locators,
                "test_data": data_files,
                "last_run": last_run,
                "versions": versions,
            }

    @parent.get("/frameworks/{fid}/from-library")
    def from_library(fid: str, script_id: str = Query(...)):
        """Classify a Library bundle against the project framework (read-only)."""
        sid = (script_id or "").strip()
        if not sid:
            raise ServiceError("script_id is required.")
        with session_scope() as session:
            fw = _fw_or_404(session, fid)
            script = session.get(AutomationScript, sid)
            if not script:
                raise ServiceError("Script not found.", 404)
            existing_rows = (
                session.query(FrameworkFile)
                .filter(FrameworkFile.framework_id == fid, FrameworkFile.is_dir.is_(False))
                .all()
            )
            existing = {r.path: (r.content or "") for r in existing_rows}
            incoming = _files_dict(script.files)
            mapping = list(script.mapping or [])
            fw_types = list(fw.types or [])
            incoming, mapping, sources = fl.remap_files_map(existing, incoming, mapping, fw_types)
            changes = classify_files(existing, incoming, mapping)
            fl.attach_remap_meta(changes, sources)
            linked = list(script.linked_ids or [])
            if linked:
                for ch in changes:
                    if not ch.get("tc_ids"):
                        ch["tc_ids"] = linked
            return {
                "ok": True,
                "script_id": script.id,
                "name": script.name,
                "version": int(script.version or 1),
                "linked_ids": linked,
                "mapping": mapping,
                "changes": changes,
            }


    @parent.get("/frameworks/{fid}/normalize")
    def preview_normalize(fid: str):
        """Propose moves/merges to fold duplicate ui/ and tests/web/ trees into the project layout."""
        with session_scope() as session:
            _fw_or_404(session, fid)
            existing = {
                r.path: (r.content or "")
                for r in session.query(FrameworkFile).filter(
                    FrameworkFile.framework_id == fid, FrameworkFile.is_dir.is_(False)
                )
            }
            items = fl.normalize_proposals(existing)
            return {
                "ok": True,
                "framework_id": fid,
                "count": len(items),
                "items": items,
                "message": (
                    "No duplicate folders to fold into pages/ and tests/<area>/."
                    if not items else
                    "Review each move. Nothing is changed until you confirm."
                ),
            }

    @parent.post("/frameworks/{fid}/normalize")
    def apply_normalize(fid: str, data: Dict[str, Any] = Body(...)):
        """Apply confirmed Normalize folders items. Nothing is deleted without confirm=true."""
        if not data.get("confirm"):
            raise ServiceError("Confirm the folder moves before applying.")
        items = data.get("items") or []
        author = str(data.get("author") or "You")
        with session_scope() as session:
            fw = _fw_or_404(session, fid)
            existing = {
                r.path: (r.content or "")
                for r in session.query(FrameworkFile).filter(
                    FrameworkFile.framework_id == fid, FrameworkFile.is_dir.is_(False)
                )
            }
            # Recompute proposals so clients cannot invent arbitrary deletes.
            allowed = {it["from"]: it for it in fl.normalize_proposals(existing)}
            applied = []
            moves: List[tuple] = []
            sources: List[str] = []
            for raw in items:
                if raw.get("include") is False:
                    continue
                src = str(raw.get("from") or raw.get("src") or "").strip()
                if src not in allowed:
                    raise ServiceError(f"Not a proposed move: {src or '(empty path)'}")
                prop = allowed[src]
                dest = str(raw.get("to") or prop["to"])
                if dest != prop["to"]:
                    # Only allow the server-computed destination.
                    dest = prop["to"]
                try:
                    src_p = safe_path(src, allow_dir=False)
                    dest_p = safe_path(dest, allow_dir=False)
                except ServiceError:
                    raise
                action = prop["action"]
                resolution = str(raw.get("resolution") or prop.get("resolution") or "keep").lower()
                if action == "conflict" and resolution not in ("keep", "take", "merge"):
                    resolution = "keep"
                if action == "move":
                    resolution = "take"
                if action == "reuse":
                    # Identical contents: keep dest, drop the duplicate source.
                    resolution = "keep"
                content = prop.get("from_content") or ""
                if resolution == "merge":
                    content = str(raw.get("merged_content") or raw.get("content") or "")
                    if not content:
                        raise ServiceError(f"Merged content is required for {src_p} → {dest_p}.")
                elif resolution == "keep":
                    content = existing.get(dest_p, existing.get(src_p, ""))
                else:  # take
                    content = prop.get("from_content") or existing.get(src_p, "")
                if resolution != "keep" or dest_p not in existing:
                    _upsert_file(session, fid, dest_p, content, author=author, note="Normalized folders")
                _repoint_maps(session, fid, src_p, dest_p)
                moves.append((src_p, dest_p))
                if src_p != dest_p:
                    sources.append(src_p)
                applied.append({"from": src_p, "to": dest_p, "resolution": resolution, "action": action})

            if not applied:
                raise ServiceError("No folder moves were selected.")

            remaining_old = [p for p in existing if p not in sources]
            pairs = fl.import_pairs(moves, remaining_old)
            if pairs:
                rows = (
                    session.query(FrameworkFile)
                    .filter(FrameworkFile.framework_id == fid, FrameworkFile.is_dir.is_(False))
                    .all()
                )
                for row in rows:
                    if not (row.path or "").endswith(".py"):
                        continue
                    if row.path in sources:
                        continue
                    new_text = fl.rewrite_imports(row.content or "", pairs)
                    if new_text != (row.content or ""):
                        _upsert_file(session, fid, row.path, new_text, author=author, note="Updated imports after normalize")

            for src_p in sources:
                # Do not delete a path that is also a destination of another move.
                if any(d == src_p for _s, d in moves):
                    continue
                _delete_fw_path(session, fid, src_p)

            leftover_rows = (
                session.query(FrameworkFile)
                .filter(FrameworkFile.framework_id == fid)
                .all()
            )
            leftover_paths = [r.path for r in leftover_rows]
            for d in fl.empty_leftover_dirs(leftover_paths, sources):
                _delete_fw_path(session, fid, d)

            fw.updated = now_ist()
            session.commit()
            return {
                "ok": True,
                "applied": applied,
                "imports_updated": bool(pairs),
                "removed_dirs": fl.empty_leftover_dirs(leftover_paths, sources),
                "tree": _tree_payload(session, fid),
            }

    @parent.post("/update-script")
    def update_script(data: Dict[str, Any] = Body(...), sess=Depends(current)):
        tc_id = str(data.get("tc_id") or "").strip()
        if not tc_id:
            raise ServiceError("tc_id is required.")
        cases = _repo_cases_by_id([tc_id])
        case = cases.get(tc_id)
        if not case:
            raise ServiceError("Test case not found in the repo.", 404)
        fid = str(data.get("framework_id") or "")
        with session_scope() as session:
            if not fid:
                row = (
                    session.query(TcScriptMap)
                    .filter(TcScriptMap.tc_id == tc_id)
                    .order_by(TcScriptMap.updated.desc())
                    .first()
                )
                if not row:
                    raise ServiceError("This case has no script to update.")
                fid = row.framework_id
            fw = _fw_or_404(session, fid)
            lang, fwname, types = fw.language, fw.framework, list(fw.types or [])
        payload = {
            "test_cases": [{
                "id": case.get("id") or tc_id,
                "name": case.get("title") or case.get("name") or "",
                "description": case.get("description") or "",
                "steps": case.get("steps") or [],
                "priority": case.get("priority") or "",
            }],
            "language": lang,
            "frameworks": [fwname] if fwname else [],
            "types": types or ["ui"],
            "provider": data.get("provider"),
            "model": data.get("model"),
            "additional_context": data.get("additional_context") or "",
        }
        # reuse generate-into
        result = generate_into_fw(fid, payload, sess)
        # auto-apply included new/changed
        apply_changes(fid, {
            "changes": result.get("changes") or [],
            "mapping": result.get("mapping") or [],
            "author": "AI",
            "regenerated": True,
        })
        return {**result, "ok": True, "applied": True, "framework_id": fid}

    @parent.get("/frameworks/{fid}/locators")
    def get_locators(fid: str):
        with session_scope() as session:
            _fw_or_404(session, fid)
            rows = session.query(FrameworkLocator).filter(FrameworkLocator.framework_id == fid).all()
            return {"ok": True, "locators": [
                {"id": r.id, "name": r.name, "strategy": r.strategy, "value": r.value, "page": r.page, "status": r.status}
                for r in rows
            ]}

    @parent.put("/frameworks/{fid}/locators")
    def put_locators(fid: str, data: Dict[str, Any] = Body(...)):
        items = data.get("locators") if isinstance(data.get("locators"), list) else data.get("items") or []
        with session_scope() as session:
            _fw_or_404(session, fid)
            session.query(FrameworkLocator).filter(FrameworkLocator.framework_id == fid).delete()
            out = []
            for it in items:
                row = FrameworkLocator(
                    framework_id=fid,
                    name=str(it.get("name") or "")[:120],
                    strategy=str(it.get("strategy") or "css")[:40],
                    value=str(it.get("value") or "")[:500],
                    page=str(it.get("page") or "")[:160],
                    status=str(it.get("status") or "Draft")[:40],
                )
                session.add(row)
                out.append(it)
            session.commit()
            return {"ok": True, "locators": out}

    @parent.get("/frameworks/{fid}/assertions")
    def get_assertions(fid: str, tc_id: str = Query("")):
        with session_scope() as session:
            _fw_or_404(session, fid)
            q = session.query(FrameworkAssertion).filter(FrameworkAssertion.framework_id == fid)
            if tc_id:
                q = q.filter(FrameworkAssertion.tc_id == tc_id)
            rows = q.all()
            return {"ok": True, "assertions": [
                {"id": r.id, "tc_id": r.tc_id, "type": r.typ, "target": r.target, "expected": r.expected}
                for r in rows
            ]}

    @parent.put("/frameworks/{fid}/assertions")
    def put_assertions(fid: str, data: Dict[str, Any] = Body(...)):
        items = data.get("assertions") if isinstance(data.get("assertions"), list) else []
        tc_id = str(data.get("tc_id") or "")
        with session_scope() as session:
            _fw_or_404(session, fid)
            q = session.query(FrameworkAssertion).filter(FrameworkAssertion.framework_id == fid)
            if tc_id:
                q = q.filter(FrameworkAssertion.tc_id == tc_id)
            q.delete()
            for it in items:
                session.add(FrameworkAssertion(
                    framework_id=fid,
                    tc_id=str(it.get("tc_id") or tc_id)[:40],
                    typ=str(it.get("type") or it.get("typ") or "")[:80],
                    target=str(it.get("target") or "")[:200],
                    expected=str(it.get("expected") or "")[:500],
                ))
            session.commit()
            return {"ok": True}

    @parent.post("/frameworks/{fid}/suggest")
    def suggest(fid: str, data: Dict[str, Any] = Body(...), sess=Depends(current)):
        kind = str(data.get("kind") or "locator").lower()
        with session_scope() as session:
            _fw_or_404(session, fid)
        system = "You are an expert test-automation engineer. Return only JSON."
        if kind == "locator":
            user = (
                "Suggest a UI locator as JSON {name, strategy, value, page, status}. "
                "strategy is one of css, xpath, role, testid. "
                f"Context: {json.dumps(data.get('context') or {}, ensure_ascii=False)[:2000]}"
            )
        elif kind == "assertion":
            user = (
                "Suggest a test assertion as JSON {type, target, expected}. "
                f"Context: {json.dumps(data.get('context') or {}, ensure_ascii=False)[:2000]}"
            )
        elif kind == "testdata":
            user = (
                "Suggest test data rows as JSON {rows:[{...}]}. "
                f"Context: {json.dumps(data.get('context') or {}, ensure_ascii=False)[:2000]}"
            )
        elif kind == "completion":
            ctx = data.get("context") or {}
            user = (
                "Suggest a short code completion as JSON {text}. "
                "Return only the text that should be inserted at the cursor, not the whole file. "
                f"Path: {ctx.get('path') or ''}. Prefix: {str(ctx.get('prefix') or '')[:400]}. "
                f"Before cursor:\n{str(ctx.get('before') or '')[-2000:]}\n"
                f"After cursor:\n{str(ctx.get('after') or '')[:800]}"
            )
        else:
            user = f"Suggest a JSON improvement. Context: {json.dumps(data.get('context') or {}, ensure_ascii=False)[:2000]}"
        if env("ATG_MOCK_GEMINI", "") == "1":
            if kind == "locator":
                suggestion = {"name": "forgot_link", "strategy": "role", "value": 'name="Forgot password"', "page": "Login", "status": "Suggested"}
            elif kind == "assertion":
                suggestion = {"type": "Text equals", "target": "toast", "expected": "Reset link sent"}
            elif kind == "completion":
                ctx = data.get("context") or {}
                suggestion = {"text": str(ctx.get("prefix") or "pass")}
            else:
                suggestion = {"rows": [{"RESET_EMAIL": "ada@example.com"}]}
            return {"ok": True, "suggestion": suggestion, "mock": True}
        out = _ai_complete(str(data.get("provider") or ""), str(data.get("model") or ""), system, user, sess)
        suggestion = _parse_json_blob(out.get("text") or "")
        return {"ok": True, "suggestion": suggestion}

    @parent.get("/frameworks/{fid}/symbols")
    def get_symbols(fid: str):
        """Page-object classes/methods plus saved locators, for editor autocomplete and go-to-definition."""
        with session_scope() as session:
            _fw_or_404(session, fid)
            files = (
                session.query(FrameworkFile)
                .filter(FrameworkFile.framework_id == fid, FrameworkFile.is_dir.is_(False))
                .all()
            )
            symbols: List[Dict[str, Any]] = []
            for row in files:
                ext = _ext(row.path)
                if ext == "py":
                    symbols.extend(_parse_py_symbols(row.path, row.content or ""))
            locators = session.query(FrameworkLocator).filter(FrameworkLocator.framework_id == fid).all()
            for r in locators:
                symbols.append({
                    "name": r.name,
                    "kind": "locator",
                    "path": r.page or "",
                    "line": 0,
                    "detail": (r.strategy or "css") + "=" + (r.value or ""),
                    "page": r.page or "",
                    "strategy": r.strategy,
                    "value": r.value,
                })
            return {"ok": True, "symbols": symbols}

    def _lib_context(session, fid: str):
        fw = _fw_or_404(session, fid)
        req = (
            session.query(FrameworkFile)
            .filter(FrameworkFile.framework_id == fid, FrameworkFile.path == "requirements.txt", FrameworkFile.is_dir.is_(False))
            .one_or_none()
        )
        if req is None:
            rows = (
                session.query(FrameworkFile)
                .filter(FrameworkFile.framework_id == fid, FrameworkFile.is_dir.is_(False))
                .all()
            )
            req = next((r for r in rows if str(r.path or "").endswith("requirements.txt")), None)
        req_text = (req.content or "") if req is not None else ""
        opts = fw.options if isinstance(fw.options, dict) else {}
        settings = li.normalize_settings(opts.get("libindex") if isinstance(opts.get("libindex"), dict) else {})
        prefs = so.get_automation_prefs()
        runs = (
            session.query(AutomationRun)
            .filter(AutomationRun.framework_id == fid)
            .order_by(AutomationRun.started.desc())
            .limit(8)
            .all()
        )
        extra = [r.artifacts_dir for r in runs if r.artifacts_dir]
        return fw, req_text, settings, prefs, extra

    @parent.get("/frameworks/{fid}/libindex")
    def get_libindex(fid: str):
        """Status for the Libraries panel: interpreter, package count, settings."""
        with session_scope() as session:
            _fw, req_text, settings, prefs, extra = _lib_context(session, fid)
            return li.index_status(
                fid,
                requirements_text=req_text,
                settings=settings,
                prefs=prefs,
                extra_roots=extra,
            )

    @parent.post("/frameworks/{fid}/libindex")
    def post_libindex(fid: str, data: Dict[str, Any] = Body(default={})):
        """Save Libraries settings and optionally re-index installed packages."""
        data = data or {}
        with session_scope() as session:
            fw, req_text, settings, prefs, extra = _lib_context(session, fid)
            incoming = dict(settings)
            if "only_requirements" in data:
                incoming["only_requirements"] = bool(data.get("only_requirements"))
            if "exclude" in data and isinstance(data.get("exclude"), list):
                incoming["exclude"] = data.get("exclude")
            settings = li.normalize_settings(incoming)
            opts = dict(fw.options or {})
            opts["libindex"] = settings
            fw.options = opts
            fw.updated = now_ist()
            session.commit()
            force = data.get("reindex") is not False
            if force:
                return li.reindex(
                    fid,
                    requirements_text=req_text,
                    settings=settings,
                    prefs=prefs,
                    extra_roots=extra,
                )
            return li.index_status(
                fid,
                requirements_text=req_text,
                settings=settings,
                prefs=prefs,
                extra_roots=extra,
                force=False,
            )

    @parent.get("/frameworks/{fid}/libsymbols")
    def get_libsymbols(
        fid: str,
        module: str = Query("", description="Dotted module to inspect (members)."),
        prefix: str = Query("", description="Prefix for members or import names."),
        q: str = Query("", description="Alias for prefix."),
    ):
        """Members of an installed module, or import-name suggestions when module is empty."""
        prefix = prefix or q or ""
        with session_scope() as session:
            _fw, req_text, settings, prefs, extra = _lib_context(session, fid)
            return li.lib_symbols(
                fid,
                module=module or "",
                prefix=prefix,
                requirements_text=req_text,
                settings=settings,
                prefs=prefs,
                extra_roots=extra,
            )

    @parent.get("/frameworks/{fid}/preview")
    def get_preview(fid: str, path: str = Query(...)):
        path = safe_path(path)
        with session_scope() as session:
            _fw_or_404(session, fid)
            row = _file_row(session, fid, path)
            if not row or row.is_dir:
                raise ServiceError("File not found.", 404)
            ext = _ext(path)
            text = row.content or ""
            if ext in ("xlsx", "xlsm"):
                prev = preview_xlsx(text)
            elif ext == "csv":
                prev = preview_csv(text)
            elif ext == "json":
                prev = preview_json(text)
            elif ext == "xml":
                prev = preview_xml(text)
            elif ext in ("yaml", "yml"):
                prev = preview_yaml(text)
            elif ext in ("env",) or path.endswith(".env"):
                prev = preview_env(text)
            else:
                prev = {"kind": "text", "raw": text}
            prev["used_by"] = used_by(session, fid, path)
            prev["path"] = path
            prev["ext"] = ext
            return {"ok": True, "preview": prev, "file": _file_dict(row)}

    @parent.put("/frameworks/{fid}/preview")
    def put_preview(fid: str, path: str = Query(...), data: Dict[str, Any] = Body(...)):
        path = safe_path(path)
        with session_scope() as session:
            _fw_or_404(session, fid)
            row = _file_row(session, fid, path)
            if not row or row.is_dir:
                raise ServiceError("File not found.", 404)
            ext = _ext(path)
            if ext == "csv" and isinstance(data.get("preview"), dict):
                content = csv_from_preview(data["preview"])
            elif ext in ("xlsx", "xlsm") and isinstance(data.get("preview"), dict):
                content = json.dumps({"sheets": data["preview"].get("sheets") or {}}, ensure_ascii=False)
            elif ext in ("env",) or path.endswith(".env"):
                content = env_from_rows(data.get("rows") or (data.get("preview") or {}).get("rows") or [])
            else:
                content = str(data.get("content") or data.get("raw") or "")
            _upsert_file(session, fid, path, content, author=str(data.get("author") or "You"), note="Edited preview")
            session.commit()
            return {"ok": True}

    @parent.post("/frameworks/{fid}/import-xlsx")
    def import_xlsx(fid: str, data: Dict[str, Any] = Body(...)):
        """Accept base64 xlsx and store a JSON workbook preview in the file."""
        import base64
        path = safe_path(str(data.get("path") or "test_data/imported.xlsx"))
        raw_b64 = str(data.get("content_base64") or "")
        if not raw_b64:
            raise ServiceError("content_base64 is required.")
        try:
            raw = base64.b64decode(raw_b64)
        except Exception:
            raise ServiceError("Invalid base64.")
        book = parse_xlsx_bytes(raw)
        with session_scope() as session:
            _fw_or_404(session, fid)
            _upsert_file(session, fid, path, json.dumps(book, ensure_ascii=False), author="You", note="Imported xlsx")
            session.commit()
            return {"ok": True, "path": path, "preview": {"kind": "xlsx", **book}}

    @parent.get("/frameworks/{fid}/mapping")
    def get_mapping(fid: str, path: str = Query(""), tc_id: str = Query("")):
        with session_scope() as session:
            _fw_or_404(session, fid)
            q = session.query(FrameworkMapping).filter(FrameworkMapping.framework_id == fid)
            if path:
                q = q.filter(FrameworkMapping.file_path == path)
            if tc_id:
                q = q.filter(FrameworkMapping.tc_id == tc_id)
            rows = q.all()
            return {"ok": True, "mappings": [
                {"id": r.id, "file_path": r.file_path, "tc_id": r.tc_id, "mapping": r.mapping, "rows": r.rows}
                for r in rows
            ]}

    @parent.put("/frameworks/{fid}/mapping")
    def put_mapping(fid: str, data: Dict[str, Any] = Body(...)):
        path = safe_path(str(data.get("file_path") or data.get("path") or ""))
        tc_id = str(data.get("tc_id") or "")[:40]
        if not tc_id:
            raise ServiceError("tc_id is required.")
        with session_scope() as session:
            _fw_or_404(session, fid)
            row = (
                session.query(FrameworkMapping)
                .filter(FrameworkMapping.framework_id == fid, FrameworkMapping.file_path == path, FrameworkMapping.tc_id == tc_id)
                .one_or_none()
            )
            mapping = data.get("mapping") if isinstance(data.get("mapping"), (dict, list)) else {}
            rows = data.get("rows") if isinstance(data.get("rows"), list) else []
            if row:
                row.mapping = mapping
                row.rows = rows
            else:
                session.add(FrameworkMapping(framework_id=fid, file_path=path, tc_id=tc_id, mapping=mapping, rows=rows))
            session.commit()
            return {"ok": True}
