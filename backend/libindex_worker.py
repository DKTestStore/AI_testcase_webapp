"""Introspect installed library modules for editor autocomplete.

Run in the chosen interpreter (project venv, runner_python, or app Python).
Only imports installed or stdlib modules named on stdin — never user test
files or application source.
"""
from __future__ import annotations

import importlib
import importlib.metadata as metadata
import inspect
import json
import pkgutil
import sys
import traceback

_MAX_MEMBERS = 120
_MAX_DOC = 240


def _ok_name(name: str) -> bool:
    if not name or len(name) > 180:
        return False
    parts = name.split(".")
    return all(p.isidentifier() and not p.startswith("__") for p in parts)


def _stdlib() -> set:
    names = set(getattr(sys, "stdlib_module_names", ()) or ())
    names.update(getattr(sys, "builtin_module_names", ()) or ())
    return names


def _top_levels(dist) -> list:
    out = []
    try:
        text = dist.read_text("top_level.txt")
        if text:
            for ln in text.splitlines():
                n = (ln or "").strip()
                if n and n.isidentifier() and not n.startswith("_"):
                    out.append(n)
    except Exception:
        pass
    if out:
        return list(dict.fromkeys(out))
    try:
        files = list(dist.files or [])
    except Exception:
        files = []
    found = []
    for f in files:
        s = str(f).replace("\\", "/")
        if not s or s.startswith(".."):
            continue
        if s.endswith(".dist-info") or ".dist-info/" in s or ".egg-info" in s:
            continue
        if s.endswith(".py") and "/" not in s:
            top = s[:-3]
        elif "/" in s:
            top = s.split("/", 1)[0]
        else:
            continue
        if top and top.isidentifier() and top not in ("__pycache__",) and not top.startswith("_"):
            found.append(top)
    if found:
        return list(dict.fromkeys(found))
    try:
        raw = (dist.metadata["Name"] or "").replace("-", "_")
        if raw.isidentifier():
            return [raw]
    except Exception:
        pass
    return []


def list_packages() -> dict:
    pkgs = []
    seen = set()
    try:
        dists = list(metadata.distributions())
    except Exception:
        dists = []
    for dist in dists:
        try:
            name = (dist.metadata["Name"] or "").strip()
            version = (dist.metadata["Version"] or "").strip()
        except Exception:
            continue
        key = name.lower()
        if not name or key in seen:
            continue
        seen.add(key)
        pkgs.append({
            "name": name,
            "version": version,
            "modules": _top_levels(dist),
        })
    pkgs.sort(key=lambda p: p["name"].lower())
    return {
        "ok": True,
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "packages": pkgs,
    }


def _kind(obj) -> str:
    if inspect.ismodule(obj):
        return "module"
    if inspect.isclass(obj):
        return "class"
    if inspect.ismethoddescriptor(obj) or inspect.isfunction(obj) or inspect.isbuiltin(obj) or inspect.ismethod(obj):
        return "function"
    if inspect.isdatadescriptor(obj) or isinstance(obj, property):
        return "property"
    if callable(obj):
        return "function"
    return "attr"


def _signature(obj) -> str:
    try:
        if isinstance(obj, property) and obj.fget:
            obj = obj.fget
        if not callable(obj):
            return ""
        sig = str(inspect.signature(obj))
        return sig[:300]
    except Exception:
        return ""


def _docline(obj) -> str:
    try:
        doc = inspect.getdoc(obj) or ""
        line = ""
        for raw in doc.strip().splitlines():
            line = raw.strip()
            if line:
                break
        return line[:_MAX_DOC]
    except Exception:
        return ""


def _qual_type(ann, fallback_mod: str = "") -> str:
    if ann is None:
        return ""
    if isinstance(ann, str):
        text = ann.strip()
        if not text:
            return ""
        if "." in text or not fallback_mod:
            return text[:180]
        return (fallback_mod + "." + text)[:180]
    try:
        origin = getattr(ann, "__origin__", None)
        if origin is not None and hasattr(ann, "__args__") and ann.__args__:
            return _qual_type(ann.__args__[0], fallback_mod)
    except Exception:
        pass
    name = getattr(ann, "__qualname__", None) or getattr(ann, "__name__", "") or ""
    mod = getattr(ann, "__module__", "") or ""
    if not name:
        try:
            return str(ann)[:180]
        except Exception:
            return ""
    if mod and mod not in ("builtins", "typing", "types"):
        return (mod + "." + name)[:180]
    return name[:180]


def _returns(obj, fallback_mod: str = "") -> str:
    try:
        if isinstance(obj, property) and obj.fget:
            obj = obj.fget
        ann = getattr(obj, "__annotations__", None) or {}
        return _qual_type(ann.get("return"), fallback_mod)
    except Exception:
        return ""


def _allowed_module(name: str) -> bool:
    if not _ok_name(name):
        return False
    top = name.split(".", 1)[0]
    if top in _stdlib():
        return True
    try:
        for dist in metadata.distributions():
            if top in _top_levels(dist):
                return True
    except Exception:
        pass
    return False


def _resolve_target(name: str):
    """Import a module, or import a prefix and walk remaining attributes (classes)."""
    sys.path[:] = [p for p in sys.path if p not in ("", ".")]
    parts = name.split(".")
    last_err = None
    # Longest importable prefix, then getattr the rest (Workbook, etc.).
    for i in range(len(parts), 0, -1):
        prefix = ".".join(parts[:i])
        if not _allowed_module(prefix):
            continue
        try:
            obj = importlib.import_module(prefix)
        except Exception as exc:
            last_err = exc
            continue
        try:
            for attr in parts[i:]:
                obj = getattr(obj, attr)
        except Exception as exc:
            last_err = exc
            continue
        return obj, None
    return None, last_err


def members(module: str, prefix: str = "") -> dict:
    if not _allowed_module(module.split(".", 1)[0] if module else ""):
        return {
            "ok": True,
            "module": module,
            "items": [],
            "reason": "not-an-installed-or-stdlib-module",
        }
    # Drop cwd / '' so a typo cannot import user files.
    sys.path[:] = [p for p in sys.path if p not in ("", ".")]
    if not _ok_name(module):
        return {"ok": True, "module": module, "items": [], "reason": "invalid-module"}
    mod, err = _resolve_target(module)
    if mod is None:
        return {"ok": True, "module": module, "items": [], "reason": "import-failed", "error": str(err or "")[:200]}
    file_path = ""
    try:
        file_path = str(getattr(mod, "__file__", "") or "")
    except Exception:
        file_path = ""
    pkg_name, pkg_ver = "", ""
    top = module.split(".", 1)[0]
    try:
        dist = metadata.distribution(top)
        pkg_name = dist.metadata["Name"]
        pkg_ver = dist.metadata["Version"]
    except Exception:
        try:
            # Some dists don't match the import name (Pillow / PIL).
            for dist in metadata.distributions():
                if top in _top_levels(dist):
                    pkg_name = dist.metadata["Name"]
                    pkg_ver = dist.metadata["Version"]
                    break
        except Exception:
            pass
    if not pkg_name and top in _stdlib():
        pkg_name = "Python"
        pkg_ver = sys.version.split()[0]

    pre = (prefix or "").lower()
    items = []
    seen = set()

    def add(name, obj, *, submodule=False):
        if name in seen:
            return
        if name.startswith("_") and name not in ("__version__", "__all__"):
            return
        if pre and not name.lower().startswith(pre):
            return
        seen.add(name)
        kind = "module" if submodule else _kind(obj)
        fallback = getattr(obj, "__module__", "") or module
        rec = {
            "name": name,
            "kind": kind,
            "signature": _signature(obj) if not submodule else "",
            "doc": _docline(obj),
            "returns": _returns(obj, fallback) if not submodule else "",
            "module": module,
            "package": pkg_name,
            "version": pkg_ver,
        }
        items.append(rec)

    try:
        names = [n for n in dir(mod) if n]
    except Exception:
        names = []
    for name in names:
        try:
            obj = getattr(mod, name)
        except Exception:
            continue
        add(name, obj)

    # Public submodules (from openpyxl import workbook, etc.)
    try:
        paths = getattr(mod, "__path__", None)
        if paths:
            for info in pkgutil.iter_modules(paths):
                add(info.name, None, submodule=True)
    except Exception:
        pass

    # Prefer public names, then shorter, then alpha; cap the list.
    def rank(it):
        k = {"module": 0, "class": 1, "function": 2, "property": 3, "attr": 4}.get(it["kind"], 9)
        return (k, it["name"].startswith("_"), len(it["name"]), it["name"].lower())

    items.sort(key=rank)
    return {
        "ok": True,
        "module": module,
        "package": pkg_name,
        "version": pkg_ver,
        "file": file_path,
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "items": items[:_MAX_MEMBERS],
    }


def main() -> int:
    raw = sys.stdin.read() or ""
    try:
        req = json.loads(raw) if raw.strip() else {}
    except Exception:
        json.dump({"ok": False, "error": "invalid-json"}, sys.stdout)
        return 1
    if not isinstance(req, dict):
        json.dump({"ok": False, "error": "invalid-request"}, sys.stdout)
        return 1
    op = str(req.get("op") or "members")
    try:
        if op == "packages":
            out = list_packages()
        elif op == "members":
            out = members(str(req.get("module") or ""), str(req.get("prefix") or ""))
        else:
            out = {"ok": False, "error": "unknown-op"}
    except Exception as exc:
        out = {"ok": False, "error": str(exc)[:200], "trace": traceback.format_exc()[-400:]}
    json.dump(out, sys.stdout, ensure_ascii=False, default=str)
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
