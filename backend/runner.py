"""Check and Run a project framework in a temp workspace (additive).

The application .env is never read or written. Env vars for a run are taken
from the request and from framework files such as config/staging.env, then
injected into the subprocess environment only.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shlex
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

from fastapi import APIRouter, Body, Depends, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from . import session_store

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


# --- v14 flexible terminal (additive) ---


_APP_ENV = Path(__file__).resolve().parents[1] / "ai_test_generator" / ".env"
_PY_NAMES = {"python", "python3", "py", "python.exe", "python3.exe", "py.exe"}
_PIP_NAMES = {"pip", "pip3", "pip.exe", "pip3.exe"}
_PW_NAMES = {"playwright", "playwright.exe"}
_PYTEST_NAMES = {"pytest", "pytest.exe"}
_LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}


def _app_env_path() -> Path:
    try:
        return _APP_ENV.resolve()
    except Exception:
        return _APP_ENV


def _is_local_host(host: str) -> bool:
    h = (host or "").strip().lower()
    if h.startswith("::ffff:"):
        h = h.split(":")[-1]
    return h in _LOCAL_HOSTS


def _require_local(request: Request) -> None:
    host = ""
    if request is not None and request.client is not None:
        host = request.client.host or ""
    if not _is_local_host(host):
        raise ServiceError("The runner only accepts connections from localhost.", 403)


def _project_python(root: Path, prefs: Dict[str, Any]) -> str:
    custom = (prefs.get("runner_python") or "").strip()
    if custom:
        p = Path(custom).expanduser()
        if p.is_file():
            return str(p)
    if root:
        for rel in (".venv/bin/python", "venv/bin/python", ".venv/Scripts/python.exe", "venv/Scripts/python.exe"):
            p = root / rel
            if p.is_file():
                return str(p)
    return sys.executable


def _is_python_token(tok: str, exe: str) -> bool:
    base = Path(tok).name.lower()
    if base in _PY_NAMES:
        return True
    try:
        return Path(tok).expanduser().resolve() == Path(exe).resolve()
    except Exception:
        return False


def _req_in_workspace(raw: str, root: Path) -> bool:
    if not raw or not root:
        return False
    p = Path(raw)
    target = (root / p).resolve() if not p.is_absolute() else p.resolve()
    try:
        root_r = root.resolve()
        if root_r not in target.parents and target != root_r:
            return False
        if target == _app_env_path():
            return False
        name = target.name.lower()
        return name == "requirements.txt" or name.endswith("requirements.txt")
    except Exception:
        return False


def _normalize_argv(argv: List[str], python_exe: str) -> List[str]:
    if not argv:
        return argv
    head = Path(argv[0]).name.lower()
    if head in _PYTEST_NAMES:
        return [python_exe, "-m", "pytest"] + argv[1:]
    if head in _PW_NAMES:
        return [python_exe, "-m", "playwright"] + argv[1:]
    if head in _PIP_NAMES:
        return [python_exe, "-m", "pip"] + argv[1:]
    if _is_python_token(argv[0], python_exe):
        return [python_exe] + argv[1:]
    return argv


def _is_allowed_argv(argv: List[str], python_exe: str, root: Path) -> bool:
    if not argv:
        return False
    if argv[0] == python_exe or _is_python_token(argv[0], python_exe):
        if len(argv) >= 3 and argv[1] == "-m" and argv[2] == "pytest":
            return True
        if len(argv) >= 4 and argv[1] == "-m" and argv[2] == "playwright" and argv[3] == "install":
            return True
        if len(argv) >= 6 and argv[1] == "-m" and argv[2] == "pip" and argv[3] == "install" and argv[4] == "-r":
            return _req_in_workspace(argv[5], root)
        return False
    head = Path(argv[0]).name.lower()
    if head in _PYTEST_NAMES:
        return True
    if head in _PW_NAMES and len(argv) >= 2 and argv[1] == "install":
        return True
    if head in _PIP_NAMES and len(argv) >= 4 and argv[1] == "install" and argv[2] == "-r":
        return _req_in_workspace(argv[3], root)
    return False


def parse_term_command(raw: str, *, shell: bool, root: Path, python_exe: str) -> List[str]:
    raw = (raw or "").strip()
    if not raw:
        raise ServiceError("Enter a command.")
    posix = os.name != "nt"
    try:
        argv = shlex.split(raw, posix=posix)
    except ValueError as e:
        raise ServiceError(f"Could not parse command: {e}")
    if not argv:
        raise ServiceError("Enter a command.")
    argv = _normalize_argv(argv, python_exe)
    if shell:
        return argv
    if not _is_allowed_argv(argv, python_exe, root):
        raise ServiceError(
            "That command is not on the allowlist. Allowed: pytest, python -m pytest, "
            "playwright install, and pip install -r requirements.txt. "
            "Turn on Interactive shell mode (advanced) in Terminal settings to run other commands."
        )
    return argv


def _load_workspace_env(root: Path, run_env: Dict[str, Any], env_name: str = "") -> Dict[str, str]:
    env_map = os.environ.copy()
    app_env = _app_env_path()
    files: List[Path] = []
    if root and root.is_dir():
        if env_name:
            candidate = root / "config" / f"{env_name}.env"
            if candidate.is_file():
                files.append(candidate)
        for env_file in sorted(root.rglob("*")):
            if not env_file.is_file():
                continue
            name = env_file.name
            if name == ".env" or name.endswith(".env") or env_file.suffix == ".env":
                files.append(env_file)
    seen = set()
    for env_file in files:
        try:
            resolved = env_file.resolve()
        except Exception:
            continue
        if resolved == app_env or resolved in seen:
            continue
        seen.add(resolved)
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
    env_map["PYTHONUNBUFFERED"] = "1"
    return env_map


def _popen_kwargs() -> Dict[str, Any]:
    kw: Dict[str, Any] = {}
    if os.name == "nt":
        kw["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        kw["start_new_session"] = True
    return kw


def _kill_tree(proc: Any) -> None:
    if proc is None:
        return
    pid = getattr(proc, "pid", None)
    if not pid:
        return
    poll = getattr(proc, "poll", None)
    if callable(poll):
        try:
            if poll() is not None:
                return
        except Exception:
            pass
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            return
        except Exception:
            pass
    else:
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except Exception:
            try:
                proc.terminate()
            except Exception:
                pass
        deadline = time.time() + 5
        while time.time() < deadline:
            try:
                if callable(poll) and poll() is not None:
                    return
            except Exception:
                return
            time.sleep(0.1)
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        return
    try:
        proc.kill()
    except Exception:
        pass


def _register_live(rid: str, fid: str, proc: Any = None) -> Dict[str, Any]:
    rec = {
        "fid": fid,
        "proc": proc,
        "pid": getattr(proc, "pid", None) if proc is not None else None,
        "log": "",
        "seq": 0,
        "running": True,
        "status": "running",
        "cv": threading.Condition(),
    }
    with _LOCK:
        _LIVE[rid] = rec
    return rec


def _set_live_proc(rid: str, proc: Any) -> None:
    with _LOCK:
        rec = _LIVE.get(rid)
        if rec is not None:
            rec["proc"] = proc
            rec["pid"] = getattr(proc, "pid", None)


def _append_live(rid: str, text: str) -> None:
    if not text:
        return
    with _LOCK:
        rec = _LIVE.get(rid)
        if rec is None:
            return
        rec["log"] = (rec.get("log") or "") + text
        if len(rec["log"]) > 240000:
            rec["log"] = rec["log"][-200000:]
        rec["seq"] = int(rec.get("seq") or 0) + 1
        cv = rec.get("cv")
        if cv is not None:
            cv.notify_all()


def _finish_live(rid: str, status: str = "") -> str:
    with _LOCK:
        rec = _LIVE.get(rid)
        log_text = (rec.get("log") or "") if rec else ""
        if rec is not None:
            rec["running"] = False
            if status:
                rec["status"] = status
            rec["seq"] = int(rec.get("seq") or 0) + 1
            cv = rec.get("cv")
            if cv is not None:
                cv.notify_all()
        _LIVE.pop(rid, None)
        return log_text


def _wait_live(rid: str, seq: int, timeout: float = 1.0) -> Dict[str, Any]:
    with _LOCK:
        rec = _LIVE.get(rid)
        if rec is None:
            return {"missing": True, "seq": seq, "log": "", "running": False}
        cv = rec.get("cv")
        if int(rec.get("seq") or 0) <= seq and rec.get("running") and cv is not None:
            cv.wait(timeout)
            rec = _LIVE.get(rid) or rec
        return {
            "missing": False,
            "seq": int(rec.get("seq") or 0),
            "log": rec.get("log") or "",
            "running": bool(rec.get("running")),
            "status": rec.get("status") or "",
        }


def _busy_rid(fid: str) -> Optional[str]:
    with _LOCK:
        for rid, live in _LIVE.items():
            if live.get("fid") == fid and live.get("running"):
                return rid
    return None


def _close_stale_runs(fid: str) -> None:
    live = set()
    with _LOCK:
        live = {rid for rid, v in _LIVE.items() if v.get("fid") == fid and v.get("running")}
    try:
        with session_scope() as session:
            rows = (
                session.query(AutomationRun)
                .filter(AutomationRun.framework_id == fid, AutomationRun.status == "running")
                .all()
            )
            changed = False
            for rec in rows:
                if rec.id not in live:
                    rec.status = "failed"
                    rec.finished = now_ist()
                    rec.log = (rec.log or "") + "\n[stale run closed]\n"
                    changed = True
            if changed:
                session.commit()
    except Exception:
        log.exception("failed to close stale runs for %s", fid)


def _assert_project_idle(fid: str) -> None:
    _close_stale_runs(fid)
    busy = _busy_rid(fid)
    if busy:
        raise ServiceError(f"A run is already in progress ({busy}). Stop it first.", 409)


def _timeout_seconds(data: Dict[str, Any], prefs: Dict[str, Any]) -> int:
    raw = data.get("timeout") if data and "timeout" in data else prefs.get("runner_timeout")
    try:
        val = int(raw) if raw not in (None, "") else 120
    except Exception:
        val = 120
    return max(5, min(val, 24 * 60 * 60))


def _persist_finished_run(rid: str, root: Path, text: str, code: int, duration_s: float) -> None:
    results = _parse_junit(root / "reports" / "junit.xml") if root else []
    shots = _find_screenshots(root) if root else {}
    for r in results:
        if r["status"] == "fail" and shots:
            r["screenshot"] = next(iter(shots.values()), "")
    passed = sum(1 for r in results if r["status"] == "pass")
    failed = sum(1 for r in results if r["status"] == "fail")
    skipped = sum(1 for r in results if r["status"] == "skip")
    stopped = code in (-signal.SIGTERM, -15, -signal.SIGKILL if hasattr(signal, "SIGKILL") else -9)
    if os.name == "nt" and code in (1, 0xC000013A, 3221225786):
        # taskkill often yields 1 or STATUS_CONTROL_C_EXIT; leave to recorded status
        pass
    if not results:
        status = "passed" if code == 0 else ("stopped" if stopped else "failed")
        summary = {
            "passed": 1 if code == 0 else 0,
            "failed": 0 if code == 0 else 1,
            "skipped": 0,
            "exit_code": code,
            "duration_s": round(duration_s, 2),
        }
    else:
        status = "passed" if failed == 0 and code == 0 else "failed"
        summary = {
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "exit_code": code,
            "duration_s": round(duration_s, 2),
        }
    try:
        with session_scope() as session:
            rec = session.get(AutomationRun, rid)
            if rec:
                rec.log = (text or "")[-200000:]
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


async def _exec_run_async(
    rid: str,
    cmd: List[str],
    env_map: Dict[str, str],
    root: Path,
    timeout: int,
) -> None:
    proc = None
    code = -1
    start = time.time()
    log_buf: List[str] = []
    try:
        kw = _popen_kwargs()
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(root),
            env=env_map,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            **kw,
        )
        _set_live_proc(rid, proc)
        assert proc.stdout is not None
        while True:
            try:
                remaining = timeout - (time.time() - start)
                if remaining <= 0:
                    log_buf.append("\n[timeout]\n")
                    _append_live(rid, "\n[timeout]\n")
                    _kill_tree(proc)
                    break
                chunk = await asyncio.wait_for(proc.stdout.readline(), timeout=min(1.0, remaining))
            except asyncio.TimeoutError:
                if time.time() - start > timeout:
                    log_buf.append("\n[timeout]\n")
                    _append_live(rid, "\n[timeout]\n")
                    _kill_tree(proc)
                    break
                continue
            if not chunk:
                break
            line = chunk.decode("utf-8", errors="replace")
            log_buf.append(line)
            _append_live(rid, line)
        try:
            code = await asyncio.wait_for(proc.wait(), timeout=15)
        except Exception:
            _kill_tree(proc)
            try:
                code = await asyncio.wait_for(proc.wait(), timeout=5)
            except Exception:
                code = proc.returncode if proc.returncode is not None else -1
        if code is None:
            code = -1
    except FileNotFoundError as e:
        msg = f"Command not found: {e}\n"
        log_buf.append(msg)
        _append_live(rid, msg)
        code = 127
    except Exception as e:
        msg = f"Run failed: {e}\n"
        log_buf.append(msg)
        _append_live(rid, msg)
        code = 1
    finally:
        text = _finish_live(rid) or "".join(log_buf)
        if log_buf and not text.endswith("".join(log_buf)[-80:]):
            text = "".join(log_buf)
        _persist_finished_run(rid, root, text, code, time.time() - start)


def _spawn_async_run(rid: str, cmd: List[str], env_map: Dict[str, str], root: Path, timeout: int) -> None:
    def runner() -> None:
        try:
            asyncio.run(_exec_run_async(rid, cmd, env_map, root, timeout))
        except Exception:
            log.exception("async run %s crashed", rid)
            _finish_live(rid, "failed")

    threading.Thread(target=runner, daemon=True, name=f"atg-run-{rid}").start()


def _collect_markers_and_paths(files: Dict[str, str]) -> Dict[str, List[str]]:
    paths = sorted(p for p in files if p.endswith((".py", ".robot", ".js", ".ts", ".feature")))
    marks = set()
    ini = files.get("pytest.ini") or files.get("pyproject.toml") or ""
    for m in re.finditer(r"markers\s*[:=]\s*([^\n]+)", ini, re.I):
        for part in m.group(1).split(","):
            name = part.strip().split(":", 1)[0].strip().strip("\"'")
            if name and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
                marks.add(name)
    for m in re.finditer(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:", ini, re.M):
        if m.group(1) not in {"markers", "testpaths", "addopts", "filterwarnings", "minversion", "norecursedirs", "python_files"}:
            pass
    for content in files.values():
        for m in re.finditer(r"pytest\.mark\.([A-Za-z_][A-Za-z0-9_]*)", content or ""):
            marks.add(m.group(1))
        for m in re.finditer(r"@pytest\.mark\.([A-Za-z_][A-Za-z0-9_]*)", content or ""):
            marks.add(m.group(1))
    flags = [
        "-m", "-k", "-v", "-vv", "-q", "-x", "-s", "-n", "--lf", "--ff",
        "--headed", "--headless", "--tb=short", "--tb=long", "--tb=line",
        "--browser", "--maxfail=1", "--collect-only",
        "--tracing=retain-on-failure", "--junitxml=reports/junit.xml",
    ]
    return {"paths": paths, "markers": sorted(marks), "flags": flags}

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
    def start_run(data: Dict[str, Any] = Body(...), request: Request = None):
        if request is not None:
            _require_local(request)
        fid = str(data.get("framework_id") or "")
        if not fid:
            raise ServiceError("framework_id is required.")
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
        env_name = str(data.get("env_name") or scope.get("env_name") or "").strip()
        raw_cmd = data.get("command")
        shell = bool(data.get("shell") or data.get("interactive_shell"))
        if shell:
            scope = dict(scope or {})
            scope["interactive_shell"] = True
        timeout = _timeout_seconds(data, prefs)
        _assert_project_idle(fid)
        with session_scope() as session:
            _fw_or_404(session, fid)
            rows = session.query(FrameworkFile).filter(FrameworkFile.framework_id == fid).all()
            rid = _next(session, "automation_run_seq", "AR-")
            files_map = {r.path: (r.content or "") for r in rows if not r.is_dir}
            root = _temp_root() / rid
            root.mkdir(parents=True, exist_ok=True)
            (root / "reports").mkdir(exist_ok=True)
            _materialize(rows, root)
            python_exe = _project_python(root, prefs)
            if raw_cmd is not None and str(raw_cmd).strip():
                cmd = parse_term_command(str(raw_cmd), shell=shell, root=root, python_exe=python_exe)
            else:
                cmd = _build_command(files_map, scope, prefs, headless, browser)
            now = now_ist()
            rec = AutomationRun(
                id=rid, framework_id=fid, scope=scope, status="running",
                command=" ".join(cmd), env=_redact(run_env), headless=headless,
                started=now, finished="", log="", summary={},
                artifacts_dir=str(root), exit_code=None,
            )
            session.add(rec)
            session.commit()
        env_map = _load_workspace_env(root, run_env, env_name)
        if headless:
            env_map.setdefault("HEADLESS", "1")
        else:
            env_map["HEADLESS"] = "0"
        if browser:
            env_map.setdefault("BROWSER", browser)
        if env_name:
            env_map.setdefault("ENV_NAME", env_name)
        _register_live(rid, fid)
        use_async = bool(raw_cmd is not None and str(raw_cmd).strip()) or data.get("stream") is True
        if use_async:
            _spawn_async_run(rid, cmd, env_map, root, timeout)
        else:
            t = threading.Thread(target=_exec_run, args=(rid, cmd, run_env, root, headless, browser, env_name, timeout), daemon=True)
            t.start()
        days = 7
        try:
            days = int(prefs.get("runner_keep_artifacts_days") or 7)
        except Exception:
            days = 7
        _prune_artifacts(_temp_root(), days)
        return {"ok": True, "run": {"id": rid, "status": "running", "command": " ".join(cmd), "artifacts_dir": str(root), "timeout": timeout}}

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
    def stop_run(rid: str, request: Request = None):
        if request is not None:
            _require_local(request)
        with _LOCK:
            live = _LIVE.get(rid)
            proc = live.get("proc") if live else None
        if proc is not None:
            try:
                _kill_tree(proc)
            except Exception as e:
                raise ServiceError(str(e))
        _append_live(rid, "\n[stopped]\n")
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

    @parent.get("/term/suggest")
    def term_suggest(framework_id: str = Query(""), q: str = Query("")):
        fid = str(framework_id or "")
        if not fid:
            raise ServiceError("framework_id is required.")
        with session_scope() as session:
            _fw_or_404(session, fid)
            rows = session.query(FrameworkFile).filter(FrameworkFile.framework_id == fid).all()
            files = {r.path: (r.content or "") for r in rows if not r.is_dir}
        info = _collect_markers_and_paths(files)
        envs = []
        for path in files:
            name = Path(path).name
            if path.startswith("config/") and name.endswith(".env"):
                envs.append(name[:-4])
        needle = (q or "").strip().lower()
        def filt(items):
            if not needle:
                return items
            return [x for x in items if needle in x.lower()]
        return {
            "ok": True,
            "flags": filt(info["flags"]),
            "markers": filt(info["markers"]),
            "paths": filt(info["paths"]),
            "envs": envs,
            "allowlist": [
                "pytest",
                "python -m pytest",
                "playwright install",
                "pip install -r requirements.txt",
            ],
        }

    @parent.get("/runs/{rid}/events")
    def run_events(rid: str, request: Request):
        _require_local(request)
        with session_scope() as session:
            rec = session.get(AutomationRun, rid)
            if not rec:
                raise ServiceError("Run not found.", 404)

        def gen():
            seq = -1
            last = ""
            while True:
                snap = _wait_live(rid, seq, 1.0)
                if snap.get("missing"):
                    with session_scope() as session:
                        rec2 = session.get(AutomationRun, rid)
                        payload = {
                            "ok": True,
                            "id": rid,
                            "status": rec2.status if rec2 else "unknown",
                            "log": (rec2.log if rec2 else last) or "",
                            "exit_code": rec2.exit_code if rec2 else None,
                            "summary": (rec2.summary if rec2 else {}) or {},
                            "running": False,
                        }
                    yield "data: " + json.dumps(payload) + "\n\n"
                    return
                seq = int(snap.get("seq") or 0)
                last = snap.get("log") or last
                payload = {
                    "ok": True,
                    "id": rid,
                    "status": snap.get("status") or "running",
                    "log": last,
                    "running": bool(snap.get("running")),
                }
                yield "data: " + json.dumps(payload) + "\n\n"
                if not snap.get("running"):
                    with session_scope() as session:
                        rec2 = session.get(AutomationRun, rid)
                    payload = {
                        "ok": True,
                        "id": rid,
                        "status": rec2.status if rec2 else payload["status"],
                        "log": (rec2.log if rec2 else last) or last,
                        "exit_code": rec2.exit_code if rec2 else None,
                        "summary": (rec2.summary if rec2 else {}) or {},
                        "running": False,
                    }
                    yield "data: " + json.dumps(payload) + "\n\n"
                    return

        return StreamingResponse(gen(), media_type="text/event-stream", headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        })

    @parent.websocket("/runs/{rid}/ws")
    async def run_ws(websocket: WebSocket, rid: str):
        host = websocket.client.host if websocket.client else ""
        if not _is_local_host(host):
            await websocket.close(code=4403)
            return
        cookie = websocket.cookies.get("atg_session")
        if not session_store.get(cookie):
            await websocket.close(code=4401)
            return
        with session_scope() as session:
            rec = session.get(AutomationRun, rid)
            if not rec:
                await websocket.close(code=4404)
                return
        await websocket.accept()
        seq = -1
        try:
            while True:
                snap = await asyncio.to_thread(_wait_live, rid, seq, 1.0)
                if snap.get("missing"):
                    with session_scope() as session:
                        rec2 = session.get(AutomationRun, rid)
                    await websocket.send_text(json.dumps({
                        "ok": True,
                        "id": rid,
                        "status": rec2.status if rec2 else "unknown",
                        "log": (rec2.log if rec2 else "") or "",
                        "exit_code": rec2.exit_code if rec2 else None,
                        "summary": (rec2.summary if rec2 else {}) or {},
                        "running": False,
                    }))
                    return
                seq = int(snap.get("seq") or 0)
                await websocket.send_text(json.dumps({
                    "ok": True,
                    "id": rid,
                    "status": snap.get("status") or "running",
                    "log": snap.get("log") or "",
                    "running": bool(snap.get("running")),
                }))
                if not snap.get("running"):
                    with session_scope() as session:
                        rec2 = session.get(AutomationRun, rid)
                    await websocket.send_text(json.dumps({
                        "ok": True,
                        "id": rid,
                        "status": rec2.status if rec2 else "unknown",
                        "log": (rec2.log if rec2 else snap.get("log")) or "",
                        "exit_code": rec2.exit_code if rec2 else None,
                        "summary": (rec2.summary if rec2 else {}) or {},
                        "running": False,
                    }))
                    return
        except WebSocketDisconnect:
            return
        except Exception:
            log.exception("websocket stream failed for %s", rid)
            try:
                await websocket.close()
            except Exception:
                pass

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


def _exec_run(rid: str, cmd: List[str], run_env: Dict[str, Any], root: Path, headless: bool, browser: str, env_name: str = "", timeout: Optional[int] = None) -> None:
    env_map = _load_workspace_env(root, run_env, env_name)
    if headless:
        env_map.setdefault("HEADLESS", "1")
    else:
        env_map["HEADLESS"] = "0"
    if browser:
        env_map.setdefault("BROWSER", browser)
    if timeout is None:
        timeout = _timeout_seconds({}, so.get_automation_prefs())
    log_buf: List[str] = []
    proc = None
    code = -1
    start = time.time()
    try:
        proc = subprocess.Popen(
            cmd, cwd=str(root), env=env_map,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
            **_popen_kwargs(),
        )
        _set_live_proc(rid, proc)
        assert proc.stdout is not None
        for line in proc.stdout:
            log_buf.append(line)
            _append_live(rid, line)
            if time.time() - start > timeout:
                _kill_tree(proc)
                log_buf.append("\n[timeout]\n")
                _append_live(rid, "\n[timeout]\n")
                break
        try:
            proc.wait(timeout=10)
        except Exception:
            _kill_tree(proc)
            proc.wait(timeout=5)
        code = proc.returncode if proc.returncode is not None else -1
    except FileNotFoundError as e:
        log_buf.append(f"Command not found: {e}\n")
        _append_live(rid, f"Command not found: {e}\n")
        code = 127
    except Exception as e:
        log_buf.append(f"Run failed: {e}\n")
        _append_live(rid, f"Run failed: {e}\n")
        code = 1
    finally:
        text = _finish_live(rid) or "".join(log_buf)
        if not text:
            text = "".join(log_buf)
        _persist_finished_run(rid, root, text, code, time.time() - start)
