"""Check and Run a project framework in a temp workspace (additive).

The application .env is never read or written. Env vars for a run are taken
from the request and from framework files such as config/staging.env, then
injected into the subprocess environment only.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.orm import Session

from . import script_options as so
from . import services
from .config import env
from .db.engine import session_scope
from .db.models import (
    AutomationRun,
    AutomationRunResult,
    Counter,
    FrameworkFile,
    ProjectFramework,
)
from .framework import _fw_or_404, now_ist, safe_path, _ai_complete, _parse_json_blob
from .services import ServiceError

log = logging.getLogger("atg.runner")

_LIVE: Dict[str, Dict[str, Any]] = {}
_LOCK = threading.Lock()
_SECRET = re.compile(r"(password|secret|token|key|passwd|api_key|connection)", re.I)
_IMPORT = re.compile(r"^\s*(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*)", re.M)
_STDLIB = {
    "abc", "argparse", "asyncio", "base64", "collections", "contextlib", "copy",
    "csv", "datetime", "decimal", "enum", "functools", "glob", "hashlib", "io",
    "itertools", "json", "logging", "math", "os", "pathlib", "random", "re",
    "shutil", "socket", "sqlite3", "string", "subprocess", "sys", "tempfile",
    "threading", "time", "typing", "unittest", "uuid", "xml", "zipfile",
    "pytest", "playwright",
}


def _next(session: Session, name: str, prefix: str, width: int = 4) -> str:
    row = session.get(Counter, name)
    if row is None:
        row = Counter(name=name, value=0)
        session.add(row)
        session.flush()
    row.value = int(row.value or 0) + 1
    return f"{prefix}{row.value:0{width}d}"


def _redact(d: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for k, v in (d or {}).items():
        if _SECRET.search(str(k)):
            out[k] = "••••••••"
        else:
            out[k] = v
    return out


def _run_dict(r: AutomationRun, *, log_full: bool = False) -> Dict[str, Any]:
    return {
        "id": r.id,
        "framework_id": r.framework_id,
        "scope": r.scope or {},
        "status": r.status,
        "command": r.command,
        "env": _redact(r.env or {}),
        "headless": bool(r.headless),
        "started": r.started,
        "finished": r.finished,
        "log": r.log if log_full else (r.log or "")[-8000:],
        "summary": r.summary or {},
        "artifacts_dir": r.artifacts_dir,
        "exit_code": r.exit_code,
    }


def detect_runtime(files: Dict[str, str]) -> Dict[str, Any]:
    names = set(files)
    py = any(p.endswith(".py") or p == "requirements.txt" or p == "pytest.ini" for p in names)
    java = any(p.endswith(".java") or p.endswith("pom.xml") or p == "pom.xml" for p in names)
    dotnet = any(p.endswith(".cs") or p.endswith(".csproj") for p in names)
    node = any(p.endswith(".js") or p.endswith(".ts") or p == "package.json" for p in names)
    runtimes = []
    if py:
        runtimes.append({"id": "python", "label": f"Python {sys.version.split()[0]}", "cmd": sys.executable})
    if java:
        runtimes.append({"id": "java", "label": "Java + Maven", "cmd": "mvn"})
    if dotnet:
        runtimes.append({"id": "dotnet", "label": ".NET", "cmd": "dotnet"})
    if node:
        runtimes.append({"id": "node", "label": "Node", "cmd": "node"})
    if not runtimes:
        runtimes.append({"id": "python", "label": f"Python {sys.version.split()[0]}", "cmd": sys.executable})
    return {"runtimes": runtimes, "primary": runtimes[0]["id"]}


def syntax_check(files: Dict[str, str], work: Path) -> List[Dict[str, Any]]:
    out = []
    for path, content in files.items():
        if not path.endswith(".py"):
            continue
        dest = work / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content or "", encoding="utf-8")
        rec = {"path": path, "ok": True, "error": ""}
        try:
            import py_compile
            py_compile.compile(str(dest), doraise=True)
        except Exception as e:
            rec["ok"] = False
            rec["error"] = str(e)
        out.append(rec)
    return out


def missing_libs(files: Dict[str, Any]) -> List[Dict[str, str]]:
    req = set()
    raw = files.get("requirements.txt") or ""
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name = re.split(r"[<>=!~\[]", line, 1)[0].strip().lower().replace("-", "_")
        if name:
            req.add(name)
    used = set()
    for path, content in files.items():
        if not path.endswith(".py"):
            continue
        for m in _IMPORT.finditer(content or ""):
            used.add(m.group(1))
    missing = sorted(u for u in used if u not in _STDLIB and u.lower() not in req and u.replace("_", "-") not in {r.replace("_", "-") for r in req})
    # ignore relative / project modules
    missing = [m for m in missing if m not in ("conftest", "settings", "base_page")]
    return [{"name": m, "install": f"pip install {m.replace('_', '-')}"} for m in missing]


def _materialize(files: List[FrameworkFile], dest: Path) -> Dict[str, str]:
    """Write framework files into dest. Never writes outside dest."""
    dest = dest.resolve()
    written = {}
    for f in files:
        if f.is_dir:
            (dest / f.path.rstrip("/")).mkdir(parents=True, exist_ok=True)
            continue
        rel = safe_path(f.path)
        target = (dest / rel).resolve()
        if dest not in target.parents and target != dest:
            raise ServiceError("Refusing to write outside the workspace.")
        # Never touch the application's .env even if a path somehow escaped
        app_env = Path(__file__).resolve().parents[1] / "ai_test_generator" / ".env"
        if target == app_env.resolve():
            raise ServiceError("Refusing to write the application .env.")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f.content or "", encoding="utf-8")
        written[rel] = f.content or ""
    return written


def _temp_root() -> Path:
    prefs = so.get_automation_prefs()
    custom = (prefs.get("runner_temp_folder") or "").strip()
    if custom:
        p = Path(custom).expanduser()
        p.mkdir(parents=True, exist_ok=True)
        return p
    return Path(tempfile.gettempdir()) / "atg-runs"


def _build_command(files: Dict[str, str], scope: Dict[str, Any], prefs: Dict[str, Any], headless: bool, browser: str) -> List[str]:
    info = detect_runtime(files)
    primary = info["primary"]
    paths = scope.get("paths") or []
    if primary == "python":
        exe = (prefs.get("runner_python") or "").strip() or sys.executable
        args = [exe, "-m", "pytest", "-v"]
        if paths:
            args.extend(paths)
        else:
            args.append("tests")
        if "pytest-html" in (files.get("requirements.txt") or ""):
            args.extend(["--html=reports/report.html", "--self-contained-html"])
        args.extend(["--junitxml=reports/junit.xml"])
        return args
    if primary == "java":
        mvn = (prefs.get("runner_mvn") or "").strip() or "mvn"
        return [mvn, "-q", "test"]
    if primary == "dotnet":
        dn = (prefs.get("runner_dotnet") or "").strip() or "dotnet"
        return [dn, "test"]
    if primary == "node":
        node = (prefs.get("runner_node") or "").strip() or "npx"
        return [node, "playwright", "test"]
    return [sys.executable, "-m", "pytest", "-v", "tests"]


def _parse_junit(path: Path) -> List[Dict[str, Any]]:
    if not path.is_file():
        return []
    try:
        root = ET.parse(path).getroot()
    except Exception:
        return []
    results = []
    suites = root.findall(".//testsuite") or ([root] if root.tag == "testsuite" else [])
    for suite in suites:
        for case in suite.findall("testcase"):
            name = case.get("name") or ""
            file = case.get("file") or ""
            time_s = float(case.get("time") or 0)
            fail = case.find("failure")
            err = case.find("error")
            skipped = case.find("skipped")
            if fail is not None:
                status, error, stack = "fail", (fail.get("message") or fail.text or ""), (fail.text or "")
            elif err is not None:
                status, error, stack = "fail", (err.get("message") or err.text or ""), (err.text or "")
            elif skipped is not None:
                status, error, stack = "skip", (skipped.get("message") or ""), ""
            else:
                status, error, stack = "pass", "", ""
            tc_id = ""
            m = re.search(r"(TC\d+)", name, re.I)
            if m:
                tc_id = m.group(1).upper()
            if not tc_id:
                m = re.search(r"(TC\d+)", file, re.I)
                if m:
                    tc_id = m.group(1).upper()
            results.append({
                "tc_id": tc_id, "name": name, "file": file, "status": status,
                "duration_ms": int(time_s * 1000), "error": (error or "")[:2000],
                "stack": (stack or "")[:4000], "screenshot": "",
            })
    return results


def _find_screenshots(root: Path) -> Dict[str, str]:
    found = {}
    if not root.is_dir():
        return found
    for p in root.rglob("*"):
        if p.suffix.lower() in (".png", ".jpg", ".jpeg") and p.is_file():
            found[p.stem] = str(p)
    return found


def _prune_artifacts(root: Path, days: int) -> None:
    if days <= 0 or not root.is_dir():
        return
    cutoff = time.time() - days * 86400
    for child in root.iterdir():
        try:
            if child.is_dir() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
        except Exception:
            pass


def attach(parent: APIRouter, current) -> None:

    @parent.post("/check")
    def preflight(data: Dict[str, Any] = Body(...)):
        fid = str(data.get("framework_id") or "")
        with session_scope() as session:
            _fw_or_404(session, fid)
            rows = (
                session.query(FrameworkFile)
                .filter(FrameworkFile.framework_id == fid)
                .all()
            )
            files = {r.path: (r.content or "") for r in rows if not r.is_dir}
        work = Path(tempfile.mkdtemp(prefix="atg-check-"))
        try:
            syntax = syntax_check(files, work)
        finally:
            shutil.rmtree(work, ignore_errors=True)
        runtime = detect_runtime(files)
        missing = missing_libs(files)
        browsers = {"chromium": "unknown", "firefox": "unknown", "webkit": "unknown"}
        return {
            "ok": True,
            "syntax": syntax,
            "syntax_ok": all(s["ok"] for s in syntax) if syntax else True,
            "runtime": runtime,
            "missing": missing,
            "browsers": browsers,
        }

    @parent.post("/runs")
    def start_run(data: Dict[str, Any] = Body(...)):
        fid = str(data.get("framework_id") or "")
        scope = data.get("scope") if isinstance(data.get("scope"), dict) else {}
        run_env = data.get("env") if isinstance(data.get("env"), dict) else {}
        # never accept a path to the application .env
        if any(str(v).endswith("ai_test_generator/.env") or str(k).lower() == "dotenv_path" for k, v in run_env.items()):
            raise ServiceError("The application .env cannot be used as a run environment.")
        headless = bool(data.get("headless") if "headless" in data else True)
        browser = str(data.get("browser") or "chromium")
        prefs = so.get_automation_prefs()
        if "headless" not in data:
            headless = bool(prefs.get("runner_headless", True))
        with session_scope() as session:
            _fw_or_404(session, fid)
            rows = session.query(FrameworkFile).filter(FrameworkFile.framework_id == fid).all()
            rid = _next(session, "automation_run_seq", "AR-")
            files_map = {r.path: (r.content or "") for r in rows if not r.is_dir}
            cmd = _build_command(files_map, scope, prefs, headless, browser)
            root = _temp_root() / rid
            root.mkdir(parents=True, exist_ok=True)
            (root / "reports").mkdir(exist_ok=True)
            written = _materialize(rows, root)
            now = now_ist()
            rec = AutomationRun(
                id=rid, framework_id=fid, scope=scope, status="running",
                command=" ".join(cmd), env=run_env, headless=headless,
                started=now, finished="", log="", summary={},
                artifacts_dir=str(root), exit_code=None,
            )
            session.add(rec)
            session.commit()
        # launch subprocess in a thread
        t = threading.Thread(target=_exec_run, args=(rid, cmd, run_env, root, headless, browser), daemon=True)
        t.start()
        days = 7
        try:
            days = int(prefs.get("runner_keep_artifacts_days") or 7)
        except Exception:
            days = 7
        _prune_artifacts(_temp_root(), days)
        return {"ok": True, "run": {"id": rid, "status": "running", "command": " ".join(cmd), "artifacts_dir": str(root)}}

    @parent.get("/runs")
    def list_runs(framework_id: str = Query("")):
        with session_scope() as session:
            q = session.query(AutomationRun).order_by(AutomationRun.started.desc())
            if framework_id:
                q = q.filter(AutomationRun.framework_id == framework_id)
            rows = q.limit(50).all()
            return {"ok": True, "runs": [_run_dict(r) for r in rows]}

    @parent.get("/runs/{rid}")
    def get_run(rid: str):
        with session_scope() as session:
            rec = session.get(AutomationRun, rid)
            if not rec:
                raise ServiceError("Run not found.", 404)
            results = (
                session.query(AutomationRunResult)
                .filter(AutomationRunResult.run_id == rid)
                .all()
            )
            return {
                "ok": True,
                "run": _run_dict(rec, log_full=True),
                "results": [
                    {
                        "id": x.id, "tc_id": x.tc_id, "name": x.name, "file": x.file,
                        "status": x.status, "duration_ms": x.duration_ms,
                        "error": x.error, "stack": x.stack, "screenshot": x.screenshot,
                    }
                    for x in results
                ],
            }

    @parent.post("/runs/{rid}/stop")
    def stop_run(rid: str):
        with _LOCK:
            live = _LIVE.get(rid)
        if live and live.get("proc") and live["proc"].poll() is None:
            try:
                live["proc"].terminate()
                try:
                    live["proc"].wait(timeout=5)
                except Exception:
                    live["proc"].kill()
            except Exception as e:
                raise ServiceError(str(e))
        with session_scope() as session:
            rec = session.get(AutomationRun, rid)
            if rec and rec.status == "running":
                rec.status = "stopped"
                rec.finished = now_ist()
                rec.log = (rec.log or "") + "\n[stopped]\n"
                session.commit()
            return {"ok": True, "run": _run_dict(rec) if rec else {"id": rid, "status": "stopped"}}

    @parent.post("/runs/{rid}/fix")
    def fix_with_ai(rid: str, data: Dict[str, Any] = Body(...), sess=Depends(current)):
        result_id = data.get("result_id")
        with session_scope() as session:
            rec = session.get(AutomationRun, rid)
            if not rec:
                raise ServiceError("Run not found.", 404)
            row = session.get(AutomationRunResult, int(result_id)) if result_id else None
            if result_id and not row:
                raise ServiceError("Result not found.", 404)
            files = {
                f.path: (f.content or "")
                for f in session.query(FrameworkFile).filter(
                    FrameworkFile.framework_id == rec.framework_id, FrameworkFile.is_dir.is_(False)
                ).all()
            }
        err = (row.error if row else "") or ""
        stack = (row.stack if row else "") or ""
        target = (row.file if row else "") or ""
        source = files.get(target) or next(iter(files.values()), "")
        system = "You are an expert at fixing failing automated tests. Return JSON {path, original, fixed, note}."
        user = (
            f"The test failed.\nError: {err}\nStack:\n{stack}\n\n"
            f"File {target}:\n{source[:8000]}\n\nReturn a corrected file."
        )
        if env("ATG_MOCK_GEMINI", "") == "1":
            fixed = source + "\n# TODO: fix asserted by AI mock\n"
            return {"ok": True, "path": target, "original": source, "fixed": fixed, "note": "Mock fix", "mock": True}
        out = _ai_complete(str(data.get("provider") or ""), str(data.get("model") or ""), system, user, sess)
        parsed = _parse_json_blob(out.get("text") or "")
        if isinstance(parsed, dict):
            return {
                "ok": True,
                "path": parsed.get("path") or target,
                "original": parsed.get("original") or source,
                "fixed": parsed.get("fixed") or "",
                "note": parsed.get("note") or "",
            }
        raise ServiceError("The model did not return a fix.")

    @parent.get("/runs/{rid}/artifact")
    def get_artifact(rid: str, path: str = Query("")):
        # only files under the run's artifacts_dir
        with session_scope() as session:
            rec = session.get(AutomationRun, rid)
            if not rec or not rec.artifacts_dir:
                raise ServiceError("Run not found.", 404)
            root = Path(rec.artifacts_dir).resolve()
        rel = safe_path(path)
        target = (root / rel).resolve()
        if root not in target.parents and target != root:
            raise ServiceError("Invalid artifact path.")
        if not target.is_file():
            raise ServiceError("Artifact not found.", 404)
        from fastapi.responses import FileResponse
        return FileResponse(str(target))


def _exec_run(rid: str, cmd: List[str], run_env: Dict[str, Any], root: Path, headless: bool, browser: str) -> None:
    env_map = os.environ.copy()
    # do not load the application .env; fold in framework env files from the workspace
    for env_file in sorted(root.rglob("*")):
        if not env_file.is_file():
            continue
        if env_file.name == ".env" or env_file.suffix == ".env" or env_file.name.endswith(".env"):
            try:
                for line in env_file.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    k, v = k.strip(), v.strip().strip('"').strip("'")
                    if k and k not in env_map:
                        env_map[k] = v
            except Exception:
                pass
    for k, v in (run_env or {}).items():
        if not k:
            continue
        env_map[str(k)] = str(v)
    if headless:
        env_map.setdefault("HEADLESS", "1")
    if browser:
        env_map.setdefault("BROWSER", browser)
    timeout = 120
    try:
        timeout = int(so.get_automation_prefs().get("runner_timeout") or 120)
    except Exception:
        timeout = 120
    log_buf: List[str] = []
    proc = None
    code = -1
    try:
        proc = subprocess.Popen(
            cmd, cwd=str(root), env=env_map,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        with _LOCK:
            _LIVE[rid] = {"proc": proc}
        start = time.time()
        assert proc.stdout is not None
        for line in proc.stdout:
            log_buf.append(line)
            if time.time() - start > timeout:
                proc.kill()
                log_buf.append("\n[timeout]\n")
                break
        proc.wait(timeout=10)
        code = proc.returncode if proc.returncode is not None else -1
    except FileNotFoundError as e:
        log_buf.append(f"Command not found: {e}\n")
        code = 127
    except Exception as e:
        log_buf.append(f"Run failed: {e}\n")
        code = 1
    finally:
        with _LOCK:
            _LIVE.pop(rid, None)
    text = "".join(log_buf)
    results = _parse_junit(root / "reports" / "junit.xml")
    shots = _find_screenshots(root)
    for r in results:
        if r["status"] == "fail" and shots:
            r["screenshot"] = next(iter(shots.values()), "")
    passed = sum(1 for r in results if r["status"] == "pass")
    failed = sum(1 for r in results if r["status"] == "fail")
    skipped = sum(1 for r in results if r["status"] == "skip")
    if not results:
        # fallback: look at exit code
        status = "passed" if code == 0 else ("stopped" if code in (-signal.SIGTERM, -15) else "failed")
        summary = {"passed": 1 if code == 0 else 0, "failed": 0 if code == 0 else 1, "skipped": 0, "exit_code": code}
    else:
        status = "passed" if failed == 0 and code == 0 else "failed"
        summary = {"passed": passed, "failed": failed, "skipped": skipped, "exit_code": code}
    try:
        with session_scope() as session:
            rec = session.get(AutomationRun, rid)
            if rec:
                rec.log = text[-200000:]
                rec.status = status if rec.status != "stopped" else "stopped"
                rec.finished = now_ist()
                rec.exit_code = code
                rec.summary = summary
                for r in results:
                    session.add(AutomationRunResult(
                        run_id=rid, tc_id=r.get("tc_id") or "", name=r.get("name") or "",
                        file=r.get("file") or "", status=r.get("status") or "",
                        duration_ms=int(r.get("duration_ms") or 0),
                        error=r.get("error") or "", stack=r.get("stack") or "",
                        screenshot=r.get("screenshot") or "",
                    ))
                session.commit()
    except Exception:
        log.exception("failed to persist run %s", rid)
