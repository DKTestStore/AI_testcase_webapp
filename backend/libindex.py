"""Library-symbol index for editor autocomplete (venv introspection).

Looks up members of installed packages in a chosen interpreter via a
short-lived subprocess. Caches results per package name+version and
invalidates when requirements.txt changes. Never imports user test code
and never reads or writes the application .env.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from . import script_options as so

log = logging.getLogger("atg.libindex")

WORKER = Path(__file__).resolve().parent / "libindex_worker.py"
TIMEOUT_SEC = 12
REQ_TIMEOUT_SEC = 20

DEFAULT_EXCLUDE = [
    "pywin32",
    "pywin32-ctypes",
    "pypiwin32",
    "uvicorn",
    "fastapi",
    "starlette",
    "gunicorn",
    "hypercorn",
    "daphne",
    "sqlalchemy",
    "alembic",
]

_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$")
_REQ_SKIP = re.compile(r"^(-[rce]|--|git\+|hg\+|svn\+|http://|https://|file:)", re.I)


def normalize_settings(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    only = data.get("only_requirements")
    if only is None:
        only = True
    exclude = data.get("exclude")
    if not isinstance(exclude, list):
        exclude = list(DEFAULT_EXCLUDE)
    cleaned: List[str] = []
    seen = set()
    for item in exclude:
        name = str(item or "").strip()
        key = _norm_pkg(name)
        if not name or key in seen:
            continue
        seen.add(key)
        cleaned.append(name)
    return {"only_requirements": bool(only), "exclude": cleaned}


def parse_requirements(text: str) -> List[str]:
    names: List[str] = []
    seen = set()
    for raw in (text or "").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or _REQ_SKIP.match(line):
            continue
        if line.startswith("-"):
            continue
        token = re.split(r"\s*;\s*", line, 1)[0].strip()
        token = re.split(r"\[", token, 1)[0].strip()
        token = re.split(r"[=<>!~@]", token, 1)[0].strip()
        token = token.strip("\"'")
        if not token or not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]*$", token):
            continue
        key = _norm_pkg(token)
        if key in seen:
            continue
        seen.add(key)
        names.append(token)
    return names


def _norm_pkg(name: str) -> str:
    return re.sub(r"[-_.]+", "-", (name or "").strip().lower())


def _ok_module(name: str) -> bool:
    return bool(name) and len(name) <= 180 and bool(_NAME_RE.match(name))


def _runs_root(prefs: Optional[Dict[str, Any]] = None) -> Path:
    prefs = prefs if prefs is not None else so.get_automation_prefs()
    custom = (prefs.get("runner_temp_folder") or "").strip()
    if custom:
        return Path(custom).expanduser()
    return Path(tempfile.gettempdir()) / "atg-runs"


def _cache_root(fid: str, prefs: Optional[Dict[str, Any]] = None) -> Path:
    prefs = prefs if prefs is not None else so.get_automation_prefs()
    base = _runs_root(prefs)
    # Keep the index next to the runner workspace when a temp folder is set.
    custom = (prefs.get("runner_temp_folder") or "").strip()
    if custom:
        root = base / "libindex" / fid
    else:
        root = Path(tempfile.gettempdir()) / "atg-libindex" / fid
    root.mkdir(parents=True, exist_ok=True)
    return root


def _venv_python(root: Path) -> Optional[str]:
    if not root:
        return None
    try:
        if not root.is_dir():
            return None
    except Exception:
        return None
    for rel in (
        ".venv/bin/python",
        "venv/bin/python",
        ".venv/bin/python3",
        "venv/bin/python3",
        ".venv/Scripts/python.exe",
        "venv/Scripts/python.exe",
        ".venv/Scripts/python3.exe",
        "venv/Scripts/python3.exe",
    ):
        p = root / rel
        try:
            if p.is_file():
                return str(p.resolve())
        except Exception:
            continue
    return None


def resolve_interpreter(
    fid: str,
    prefs: Optional[Dict[str, Any]] = None,
    extra_roots: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """Pick project venv, then runner_python, then the app Python."""
    prefs = prefs if prefs is not None else so.get_automation_prefs()
    venv_missing = True
    chosen = ""
    source = "app"
    checked: List[str] = []

    fw_root = _runs_root(prefs) / "frameworks" / fid
    roots: List[Path] = [fw_root]
    for raw in extra_roots or []:
        if raw:
            roots.append(Path(str(raw)))
    seen_roots = set()
    for root in roots:
        try:
            key = str(root.resolve()) if root.exists() else str(root)
        except Exception:
            key = str(root)
        if key in seen_roots:
            continue
        seen_roots.add(key)
        checked.append(key)
        exe = _venv_python(root)
        if exe:
            chosen = exe
            source = "venv"
            venv_missing = False
            break

    if not chosen:
        custom = (prefs.get("runner_python") or "").strip()
        if custom:
            p = Path(custom).expanduser()
            if p.is_file():
                chosen = str(p)
                source = "runner_python"

    if not chosen:
        chosen = sys.executable
        source = "app"

    return {
        "executable": chosen,
        "source": source,
        "venv_missing": venv_missing,
        "venv_root": str(fw_root),
        "checked": checked[:8],
    }


def requirements_fingerprint(content: str, disk: Optional[Path] = None) -> Dict[str, Any]:
    raw = content or ""
    mtime = None
    blob = raw
    if disk is not None:
        try:
            if disk.is_file():
                mtime = disk.stat().st_mtime
                blob = raw + "\n--disk--\n" + disk.read_text(encoding="utf-8", errors="replace")
        except Exception:
            if mtime is not None:
                blob = raw + "\n--mtime--\n" + str(mtime)
    digest = hashlib.sha256(blob.encode("utf-8", "replace")).hexdigest()
    return {"hash": digest, "mtime": mtime}


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        if not path.is_file():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=0), encoding="utf-8")
    tmp.replace(path)


def _clean_env() -> Dict[str, str]:
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONSAFEPATH"] = "1"
    env["PYTHONPATH"] = ""
    # Never point a child at the application .env; the worker does not load it.
    env.pop("DOTENV", None)
    env.pop("DOTENV_PATH", None)
    return env


def _safe_cwd() -> Path:
    path = Path(tempfile.gettempdir()) / "atg-libindex-cwd"
    path.mkdir(parents=True, exist_ok=True)
    return path


def run_worker(executable: str, payload: Dict[str, Any], timeout: int = TIMEOUT_SEC) -> Dict[str, Any]:
    if not executable or not Path(executable).exists():
        return {"ok": False, "error": "interpreter-missing"}
    if not WORKER.is_file():
        return {"ok": False, "error": "worker-missing"}
    cmd = [executable, "-I", str(WORKER)]
    try:
        proc = subprocess.run(
            cmd,
            input=json.dumps(payload),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            cwd=str(_safe_cwd()),
            env=_clean_env(),
            text=True,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout"}
    except FileNotFoundError:
        return {"ok": False, "error": "interpreter-missing"}
    except OSError as exc:
        return {"ok": False, "error": str(exc)[:200]}
    raw = proc.stdout or ""
    try:
        data = json.loads(raw) if raw.strip() else {}
    except Exception:
        err = (proc.stderr or raw or "")[-400:]
        # Some older interpreters reject -I; retry without it once.
        if proc.returncode and "Unknown option" in (proc.stderr or ""):
            return run_worker_no_isolated(executable, payload, timeout)
        return {"ok": False, "error": "bad-worker-output", "detail": err}
    if not isinstance(data, dict):
        return {"ok": False, "error": "bad-worker-output"}
    if proc.returncode and not data.get("ok"):
        data.setdefault("error", (proc.stderr or "")[-200:] or "worker-failed")
    return data


def run_worker_no_isolated(executable: str, payload: Dict[str, Any], timeout: int = TIMEOUT_SEC) -> Dict[str, Any]:
    cmd = [executable, str(WORKER)]
    try:
        proc = subprocess.run(
            cmd,
            input=json.dumps(payload),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            cwd=str(_safe_cwd()),
            env=_clean_env(),
            text=True,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout"}
    except OSError as exc:
        return {"ok": False, "error": str(exc)[:200]}
    try:
        data = json.loads(proc.stdout or "") if (proc.stdout or "").strip() else {}
    except Exception:
        return {"ok": False, "error": "bad-worker-output", "detail": (proc.stderr or "")[-400:]}
    if not isinstance(data, dict):
        return {"ok": False, "error": "bad-worker-output"}
    return data


def _filter_packages(
    packages: Sequence[Dict[str, Any]],
    settings: Dict[str, Any],
    req_names: Sequence[str],
) -> List[Dict[str, Any]]:
    exclude = {_norm_pkg(x) for x in (settings.get("exclude") or [])}
    only = bool(settings.get("only_requirements"))
    wanted = {_norm_pkg(n) for n in req_names} if only else set()
    out: List[Dict[str, Any]] = []
    for pkg in packages:
        key = _norm_pkg(str(pkg.get("name") or ""))
        if not key or key in exclude:
            continue
        if only and key not in wanted:
            # Also accept a top-level module that matches a requirements name.
            mods = [_norm_pkg(m) for m in (pkg.get("modules") or [])]
            if key not in wanted and not (set(mods) & wanted):
                continue
        out.append(pkg)
    return out


def _import_entries(packages: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    seen = set()
    for pkg in packages:
        name = pkg.get("name") or ""
        version = pkg.get("version") or ""
        modules = list(pkg.get("modules") or [])
        if not modules and str(name).replace("-", "_").isidentifier():
            modules = [str(name).replace("-", "_")]
        for mod in modules:
            if not _ok_module(mod) or mod.lower() in seen:
                continue
            seen.add(mod.lower())
            items.append({
                "name": mod,
                "kind": "module",
                "package": name,
                "version": version,
                "badge": _badge(name, version),
                "source": "library",
                "detail": _badge(name, version),
                "insert": mod,
            })
    items.sort(key=lambda it: it["name"].lower())
    return items


def _badge(package: str, version: str) -> str:
    package = (package or "").strip()
    version = (version or "").strip()
    if package and version:
        return package + " " + version
    return package or version


def _meta_path(root: Path) -> Path:
    return root / "meta.json"


def _members_path(root: Path, package: str, version: str, module: str) -> Path:
    safe_pkg = re.sub(r"[^A-Za-z0-9._-]+", "_", package or "unknown")[:80]
    safe_ver = re.sub(r"[^A-Za-z0-9._-]+", "_", version or "0")[:40]
    digest = hashlib.sha1(module.encode("utf-8")).hexdigest()[:16]
    return root / "members" / f"{safe_pkg}__{safe_ver}" / f"{digest}.json"


def _clear_members(root: Path) -> None:
    folder = root / "members"
    if folder.is_dir():
        shutil.rmtree(folder, ignore_errors=True)


def _load_or_refresh_meta(
    fid: str,
    *,
    requirements_text: str,
    settings: Dict[str, Any],
    prefs: Optional[Dict[str, Any]] = None,
    extra_roots: Optional[Sequence[str]] = None,
    force: bool = False,
) -> Dict[str, Any]:
    prefs = prefs if prefs is not None else so.get_automation_prefs()
    interp = resolve_interpreter(fid, prefs, extra_roots)
    root = _cache_root(fid, prefs)
    disk_req = Path(interp.get("venv_root") or "") / "requirements.txt"
    finger = requirements_fingerprint(requirements_text, disk_req if disk_req.is_file() else None)
    meta = _read_json(_meta_path(root)) or {}
    stale = (
        force
        or meta.get("req_hash") != finger["hash"]
        or meta.get("executable") != interp["executable"]
        or not isinstance(meta.get("packages"), list)
    )
    if not stale:
        meta["interpreter"] = interp
        meta["settings"] = settings
        meta["req_names"] = parse_requirements(requirements_text)
        return meta

    _clear_members(root)
    fetched = run_worker(interp["executable"], {"op": "packages"}, timeout=REQ_TIMEOUT_SEC)
    packages = fetched.get("packages") if fetched.get("ok") else []
    if not isinstance(packages, list):
        packages = []
    meta = {
        "fid": fid,
        "req_hash": finger["hash"],
        "req_mtime": finger.get("mtime"),
        "req_names": parse_requirements(requirements_text),
        "executable": interp["executable"],
        "interpreter": interp,
        "python": fetched.get("python") or "",
        "packages": packages,
        "error": "" if fetched.get("ok") else (fetched.get("error") or "index-failed"),
        "indexed_at": time.time(),
        "settings": settings,
    }
    _write_json(_meta_path(root), meta)
    return meta


def _allowed_module(module: str, packages: Sequence[Dict[str, Any]], settings: Dict[str, Any], req_names: Sequence[str]) -> bool:
    if not _ok_module(module):
        return False
    top = module.split(".", 1)[0]
    filtered = _filter_packages(packages, {**settings, "only_requirements": False}, req_names)
    tops = set()
    for pkg in filtered:
        for mod in pkg.get("modules") or []:
            tops.add(str(mod).split(".", 1)[0])
        name = str(pkg.get("name") or "").replace("-", "_")
        if name.isidentifier():
            tops.add(name)
    if top in tops:
        if not settings.get("only_requirements"):
            return True
        # When the toggle is on, only allow tops that belong to a filtered package
        # (or a requirements name). Stdlib is handled by the worker if we skip here
        # and the parent still asks — see callers.
        wanted = _filter_packages(packages, settings, req_names)
        want_tops = set()
        for pkg in wanted:
            for mod in pkg.get("modules") or []:
                want_tops.add(str(mod).split(".", 1)[0])
            name = str(pkg.get("name") or "").replace("-", "_")
            if name.isidentifier():
                want_tops.add(name)
        return top in want_tops
    # Unknown to the package list: may still be stdlib. Let the worker decide.
    return True


def index_status(
    fid: str,
    *,
    requirements_text: str,
    settings: Dict[str, Any],
    prefs: Optional[Dict[str, Any]] = None,
    extra_roots: Optional[Sequence[str]] = None,
    force: bool = False,
) -> Dict[str, Any]:
    settings = normalize_settings(settings)
    meta = _load_or_refresh_meta(
        fid,
        requirements_text=requirements_text,
        settings=settings,
        prefs=prefs,
        extra_roots=extra_roots,
        force=force,
    )
    interp = meta.get("interpreter") or resolve_interpreter(fid, prefs, extra_roots)
    packages = _filter_packages(meta.get("packages") or [], settings, meta.get("req_names") or [])
    indexed_at = meta.get("indexed_at")
    return {
        "ok": True,
        "interpreter": interp.get("executable") or "",
        "interpreter_source": interp.get("source") or "app",
        "venv_missing": bool(interp.get("venv_missing")),
        "venv_root": interp.get("venv_root") or "",
        "python": meta.get("python") or "",
        "package_count": len(packages),
        "packages": [
            {"name": p.get("name"), "version": p.get("version"), "modules": p.get("modules") or []}
            for p in packages
        ],
        "only_requirements": bool(settings.get("only_requirements")),
        "exclude": list(settings.get("exclude") or []),
        "default_exclude": list(DEFAULT_EXCLUDE),
        "req_names": list(meta.get("req_names") or []),
        "error": meta.get("error") or "",
        "indexed_at": indexed_at,
    }


def reindex(
    fid: str,
    *,
    requirements_text: str,
    settings: Dict[str, Any],
    prefs: Optional[Dict[str, Any]] = None,
    extra_roots: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    return index_status(
        fid,
        requirements_text=requirements_text,
        settings=settings,
        prefs=prefs,
        extra_roots=extra_roots,
        force=True,
    )


def _decorate_items(items: Iterable[Dict[str, Any]], package: str, version: str, module: str) -> List[Dict[str, Any]]:
    out = []
    badge = _badge(package, version)
    for raw in items or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "")
        if not name:
            continue
        kind = str(raw.get("kind") or "attr")
        pkg = raw.get("package") or package
        ver = raw.get("version") or version
        label = _badge(pkg, ver) or badge
        insert = name
        if kind == "function":
            insert = name + "()"
        out.append({
            "name": name,
            "kind": kind,
            "signature": raw.get("signature") or "",
            "doc": raw.get("doc") or "",
            "returns": raw.get("returns") or "",
            "module": raw.get("module") or module,
            "package": pkg,
            "version": ver,
            "badge": label,
            "source": "library",
            "detail": label,
            "insert": insert,
        })
    return out


def lib_symbols(
    fid: str,
    *,
    module: str = "",
    prefix: str = "",
    requirements_text: str = "",
    settings: Optional[Dict[str, Any]] = None,
    prefs: Optional[Dict[str, Any]] = None,
    extra_roots: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    settings = normalize_settings(settings)
    meta = _load_or_refresh_meta(
        fid,
        requirements_text=requirements_text,
        settings=settings,
        prefs=prefs,
        extra_roots=extra_roots,
        force=False,
    )
    interp = meta.get("interpreter") or resolve_interpreter(fid, prefs, extra_roots)
    packages = meta.get("packages") or []
    req_names = meta.get("req_names") or parse_requirements(requirements_text)
    filtered = _filter_packages(packages, settings, req_names)
    exe = interp.get("executable") or sys.executable
    prefix = (prefix or "").strip()
    module = (module or "").strip()

    base = {
        "ok": True,
        "interpreter": exe,
        "interpreter_source": interp.get("source") or "app",
        "venv_missing": bool(interp.get("venv_missing")),
        "python": meta.get("python") or "",
        "error": meta.get("error") or "",
    }

    if not module:
        entries = _import_entries(filtered)
        if prefix:
            q = prefix.lower()
            entries = [e for e in entries if e["name"].lower().startswith(q)]
        base.update({"mode": "packages", "prefix": prefix, "items": entries[:80]})
        return base

    if not _ok_module(module):
        base.update({"mode": "members", "module": module, "items": [], "error": "invalid-module"})
        return base

    if not _allowed_module(module, packages, settings, req_names):
        base.update({"mode": "members", "module": module, "items": []})
        return base

    # Identify a package+version for the cache key from the top-level name.
    top = module.split(".", 1)[0]
    pkg_name, pkg_ver = "", ""
    for pkg in packages:
        mods = [str(m) for m in (pkg.get("modules") or [])]
        ident = str(pkg.get("name") or "").replace("-", "_")
        if top in mods or ident == top:
            pkg_name = pkg.get("name") or ""
            pkg_ver = pkg.get("version") or ""
            break
    cache_pkg = pkg_name or top or "unknown"
    cache_ver = pkg_ver or (meta.get("python") or "0")
    root = _cache_root(fid, prefs)
    # Cache the full member list for the module (package name+version), then filter by prefix.
    cpath = _members_path(root, cache_pkg, cache_ver, module)
    cached = _read_json(cpath)
    if cached and cached.get("executable") == exe and isinstance(cached.get("items"), list):
        items = cached["items"]
        if prefix:
            q = prefix.lower()
            items = [it for it in items if str(it.get("name") or "").lower().startswith(q)]
        base.update({
            "mode": "members",
            "module": module,
            "package": cached.get("package") or pkg_name,
            "version": cached.get("version") or pkg_ver,
            "items": items,
            "cached": True,
        })
        return base

    fetched = run_worker(exe, {"op": "members", "module": module}, timeout=TIMEOUT_SEC)
    raw_items = fetched.get("items") if fetched.get("ok") else []
    if not isinstance(raw_items, list):
        raw_items = []
    package = fetched.get("package") or pkg_name
    version = fetched.get("version") or pkg_ver
    items = _decorate_items(raw_items, package, version, module)
    if fetched.get("ok"):
        _write_json(cpath, {
            "module": module,
            "package": package,
            "version": version,
            "executable": exe,
            "items": items,
        })
    if prefix:
        q = prefix.lower()
        items = [it for it in items if str(it.get("name") or "").lower().startswith(q)]
    err = base.get("error") or ""
    if not fetched.get("ok"):
        err = fetched.get("error") or err
    base.update({
        "mode": "members",
        "module": module,
        "package": package,
        "version": version,
        "items": items,
        "cached": False,
        "error": err,
        "reason": fetched.get("reason") or "",
    })
    return base
