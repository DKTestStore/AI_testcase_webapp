"""Map generated/library paths onto an existing project framework tree.

Used when generating into a framework, adding a library bundle, applying
changes, and the Normalize folders review. Does not change the Review-page
Generate Automation Script prompt.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

_TYPE_ALIAS = {
    "web": "ui",
    "database": "db",
    "databases": "db",
    "data": "db",
}
_PAGE_CANDIDATES = ("pages/", "page_objects/", "src/pages/", "keywords/")
_CONFTEST_PREF = (
    "fixtures/conftest.py",
    "tests/conftest.py",
    "conftest.py",
    "tests/ui/conftest.py",
)
_RESERVED_DIRS = {
    "pages/", "page_objects/", "src/", "src/pages/", "keywords/",
    "fixtures/", "config/", "utils/", "test_data/", "reports/",
    "tests/", "tests/ui/", "tests/api/", "tests/db/", "tests/mobile/",
}
_STRAY_CONFTEST_PREFIXES = ("ui/", "web/", "tests/web/", "api/", "db/", "mobile/")

# Duplicate trees we normalize *from* (not used as targets when pages/ + tests/<area>/ exist).
_NESTED_WEB = True


def _slash(path: str) -> str:
    return str(path or "").replace("\\", "/").strip().lstrip("/")


def existing_dirs(paths: Iterable[str]) -> set:
    dirs: set = set()
    for raw in paths:
        p = _slash(raw)
        if not p:
            continue
        if p.endswith("/"):
            dirs.add(p)
            parts = p.rstrip("/").split("/")
        else:
            parts = p.split("/")[:-1]
        acc = ""
        for part in parts:
            acc += part + "/"
            dirs.add(acc)
    return dirs


def _has(prefix: str, dirs: set, files: Iterable[str]) -> bool:
    if prefix in dirs:
        return True
    return any(str(p).startswith(prefix) for p in files)


def page_root(dirs: set, files: Iterable[str]) -> str:
    for cand in _PAGE_CANDIDATES:
        if _has(cand, dirs, files):
            return cand
    return "pages/"


def _is_invented_web_tree(dirs: set, files: Iterable[str]) -> bool:
    """True when tests/web is the nested pages/tests layout, not a flat test area."""
    return _has("tests/web/pages/", dirs, files) or _has("tests/web/tests/", dirs, files)


def test_root(dirs: set, files: Iterable[str], typ: str = "ui") -> str:
    typ = _TYPE_ALIAS.get((typ or "ui").lower(), (typ or "ui").lower()) or "ui"
    cand = f"tests/{typ}/"
    if _has(cand, dirs, files):
        return cand
    if typ == "ui" and _has("tests/web/", dirs, files) and not _is_invented_web_tree(dirs, files):
        return "tests/web/"
    if typ == "ui" and _has("tests/", dirs, files):
        # Prefer tests/ui/ when the seed layout (or tests/api|db) is present.
        if any(_has(f"tests/{a}/", dirs, files) for a in ("ui", "api", "db", "mobile")):
            return "tests/ui/"
    return cand


def existing_conftest(files: Iterable[str]) -> str:
    file_set = { _slash(p) for p in files }
    for p in _CONFTEST_PREF:
        if p in file_set:
            return p
    others = [
        p for p in file_set
        if p.endswith("conftest.py") and not p.startswith(_STRAY_CONFTEST_PREFIXES)
    ]
    return others[0] if others else "fixtures/conftest.py"


def _type_from_path(path: str) -> str:
    p = _slash(path)
    if p.startswith(("api/", "tests/api/")):
        return "api"
    if p.startswith(("db/", "database/", "tests/db/", "tests/database/")):
        return "db"
    if p.startswith(("mobile/", "tests/mobile/")):
        return "mobile"
    return "ui"


def remap_path(path: str, existing: Iterable[str], types: Optional[Sequence[str]] = None) -> str:
    """Rewrite one incoming path onto the project's existing layout.

    Unrecognised paths are returned unchanged (after slash normalisation).
    """
    p = _slash(path)
    if not p:
        return p
    files = [_slash(x) for x in existing]
    dirs = existing_dirs(list(files) + [p])
    root = page_root(dirs, files)
    name = p.split("/")[-1]

    # Extra conftest from invented trees (and config/ when a preferred one exists).
    if name == "conftest.py":
        preferred = existing_conftest(files)
        if p.startswith(_STRAY_CONFTEST_PREFIXES) or p.startswith("tests/web/"):
            return preferred
        if p == "config/conftest.py" and preferred != p and preferred in set(files):
            return preferred

    for prefix in ("ui/pages/", "tests/web/pages/", "web/pages/", "tests/pages/"):
        if p.startswith(prefix):
            rest = p[len(prefix):]
            return (root + rest) if rest else root.rstrip("/")

    m = re.match(r"^(ui|api|db|database|mobile|web)/tests/(.*)$", p)
    if m:
        dest = test_root(dirs, files, m.group(1))
        rest = m.group(2)
        return dest + rest if rest else dest.rstrip("/")

    m = re.match(r"^tests/web/tests/(.*)$", p)
    if m:
        dest = test_root(dirs, files, "ui")
        rest = m.group(1)
        return dest + rest if rest else dest.rstrip("/")

    # Flat files under tests/web/ when that folder is the invented nested tree.
    if p.startswith("tests/web/") and _is_invented_web_tree(dirs, files):
        rest = p[len("tests/web/"):]
        if rest.startswith("pages/"):
            return root + rest[len("pages/"):]
        if rest.startswith("tests/"):
            return test_root(dirs, files, "ui") + rest[len("tests/"):]
        dest = test_root(dirs, files, "ui")
        return dest + rest

    # Top-level type folder: ui/test_foo.py, ui/products_page.py, ui/__init__.py
    m = re.match(r"^(ui|api|db|database|mobile|web)/([^/]+)$", p)
    if m:
        typ, fname = m.group(1), m.group(2)
        low = fname.lower()
        if fname in ("conftest.py",):
            return existing_conftest(files)
        if fname.startswith("test_") or fname.startswith("tests_") or fname == "__init__.py":
            return test_root(dirs, files, typ) + fname
        if low.endswith("_page.py") or low.endswith("_pages.py") or "page" in low:
            return root + fname
        # Other files under ui/ stay put unless they look like tests.
        typ_n = _TYPE_ALIAS.get(typ, typ)
        if typ_n in ("api", "db", "mobile") and (low.endswith("_test.py") or low.startswith("test")):
            return test_root(dirs, files, typ) + fname

    return p


def remap_files_map(
    existing: Dict[str, str],
    incoming: Dict[str, str],
    mapping: Optional[List[Dict[str, Any]]] = None,
    types: Optional[Sequence[str]] = None,
) -> Tuple[Dict[str, str], List[Dict[str, Any]], Dict[str, List[str]]]:
    """Return remapped incoming files, mapping entries, and dest -> [original paths]."""
    new_incoming: Dict[str, str] = {}
    sources: Dict[str, List[str]] = {}
    for path, content in (incoming or {}).items():
        src = _slash(path)
        dest = remap_path(src, existing, types)
        sources.setdefault(dest, [])
        if src not in sources[dest]:
            sources[dest].append(src)
        if dest in new_incoming and new_incoming[dest] and src != dest:
            # Prefer a payload already written to the canonical path.
            if src == dest:
                new_incoming[dest] = content or ""
            continue
        new_incoming[dest] = content or ""
    new_mapping: List[Dict[str, Any]] = []
    for raw in mapping or []:
        m = dict(raw or {})
        for key in ("file", "path"):
            if m.get(key):
                m[key] = remap_path(str(m[key]), existing, types)
        new_mapping.append(m)
    return new_incoming, new_mapping, sources


def attach_remap_meta(changes: List[Dict[str, Any]], sources: Dict[str, List[str]]) -> List[Dict[str, Any]]:
    for ch in changes or []:
        path = _slash(ch.get("path") or "")
        origs = [p for p in (sources.get(path) or []) if p and p != path]
        if origs:
            ch["from_path"] = origs[0]
            if len(origs) > 1:
                ch["from_paths"] = origs
    return changes


def _folder_list(paths: Iterable[str]) -> List[str]:
    dirs = sorted(existing_dirs(paths))
    return dirs


def _sample_paths(paths: Iterable[str], n: int = 24) -> List[str]:
    files = sorted(_slash(p) for p in paths if p and not str(p).endswith("/"))
    preferred = [
        p for p in files
        if p.startswith(("pages/", "page_objects/", "src/pages/", "tests/ui/", "tests/api/",
                         "tests/db/", "tests/mobile/", "fixtures/", "keywords/"))
        or p.endswith("conftest.py")
    ]
    rest = [p for p in files if p not in preferred]
    out = preferred + rest
    return out[:n]


def framework_tree_context(existing: Dict[str, str], types: Optional[Sequence[str]] = None) -> str:
    """Prompt addendum for generate-into-framework. Does not replace _build_prompt."""
    files = list(existing or {})
    dirs = existing_dirs(files)
    root = page_root(dirs, files)
    type_list = list(types or []) or ["ui"]
    test_lines = []
    for t in type_list:
        dest = test_root(dirs, files, t)
        test_lines.append(f"- {t} tests under {dest}")
    conf = existing_conftest(files)
    folders = _folder_list(files)
    samples = _sample_paths(files)
    lines = [
        "The project already has this folder structure. Reuse it.",
        "Do not invent a parallel tree such as ui/, ui/pages/, ui/tests/, tests/web/pages, or tests/web/tests.",
        "Put page objects under " + root + ".",
        "Place tests as follows:",
        *test_lines,
        "Reuse the existing conftest at " + conf + ". Do not add ui/conftest.py or a second config/conftest.py when this file exists.",
        "",
        "Existing folders:",
    ]
    if folders:
        lines.extend("- " + d for d in folders)
    else:
        lines.append("- (none listed yet; use pages/ and tests/<area>/ )")
    lines.append("")
    lines.append("Sample existing files (reuse these paths and modules):")
    if samples:
        lines.extend("- " + p for p in samples)
    else:
        lines.append("- (no files yet)")
    lines.append("")
    lines.append("Existing shared files:")
    shared = [
        (p, existing[p]) for p in files
        if p.startswith(("pages/", "fixtures/", "config/", "utils/", "src/", "resources/", "keywords/",
                         "page_objects/"))
    ]
    for p, c in shared[:30]:
        lines.append(f"\n--- {p} ---\n{(c or '')[:4000]}")
    # A few test-file headers so the model sees tests/ui/ etc.
    tests = [
        p for p in files
        if p.startswith("tests/") and p.endswith(".py")
    ]
    if tests:
        lines.append("\nExisting test files (paths and start of file):")
        for p in tests[:8]:
            head = "\n".join((existing.get(p) or "").splitlines()[:20])
            lines.append(f"\n--- {p} ---\n{head[:1500]}")
    return "\n".join(lines)


def normalize_proposals(existing: Dict[str, str]) -> List[Dict[str, Any]]:
    """Propose moves/merges for files that sit outside the detected layout."""
    files = list(existing or {})
    items: List[Dict[str, Any]] = []
    seen_src = set()
    for src in sorted(files):
        if src.endswith("/") or src in seen_src:
            continue
        dest = remap_path(src, files)
        if dest == src:
            continue
        # Don't propose moving a file onto itself after slash norm only
        src_c = existing.get(src) or ""
        dest_exists = dest in existing
        dest_c = existing.get(dest) or "" if dest_exists else ""
        same = dest_exists and (src_c == dest_c)
        if dest_exists and same:
            action = "reuse"
            kind_status = "same"
        elif dest_exists:
            action = "conflict"
            kind_status = "differs"
        else:
            action = "move"
            kind_status = "new"
        if "/pages/" in ("/" + src) or src.startswith(tuple("ui/pages/ tests/web/pages/ web/pages/ tests/pages/".split())):
            kind = "page"
        elif src.endswith("conftest.py"):
            kind = "conftest"
        else:
            kind = "test"
        items.append({
            "id": str(len(items) + 1),
            "action": action,
            "from": src,
            "to": dest,
            "kind": kind,
            "from_content": src_c,
            "to_content": dest_c if dest_exists else None,
            "dest_exists": dest_exists,
            "same": same,
            "status": kind_status,
            "include": True,
            "resolution": "keep" if action == "conflict" else ("take" if action == "move" else "keep"),
        })
        seen_src.add(src)
    return items


def path_to_module(path: str) -> Optional[str]:
    p = _slash(path)
    if not p.endswith(".py"):
        return None
    return p[:-3].replace("/", ".")


def import_pairs(moves: List[Tuple[str, str]], remaining_old: Optional[Iterable[str]] = None) -> List[Tuple[str, str]]:
    """(old_module, new_module) pairs, longest first. Package prefixes only when unused."""
    remaining = { _slash(p) for p in (remaining_old or []) }
    pairs: List[Tuple[str, str]] = []
    seen = set()
    for src, dest in moves:
        old = path_to_module(src)
        new = path_to_module(dest)
        if old and new and old != new and old not in seen:
            pairs.append((old, new))
            seen.add(old)
    # Package prefixes when no remaining file still lives under that package.
    pkg_map = {
        "tests.web.pages": "pages",
        "tests.web.tests": "tests.ui",
        "ui.pages": "pages",
        "ui.tests": "tests.ui",
        "web.pages": "pages",
        "web.tests": "tests.ui",
    }
    def still_used(mod: str) -> bool:
        prefix = mod.replace(".", "/") + "/"
        return any(p.startswith(prefix) or path_to_module(p) == mod for p in remaining)

    for old, new in pkg_map.items():
        if old in seen:
            continue
        if still_used(old):
            continue
        # Only add if we actually moved something under that package
        if any(
            (path_to_module(s) or "").startswith(old + ".") or path_to_module(s) == old
            for s, _d in moves
        ):
            pairs.append((old, new))
            seen.add(old)
    pairs.sort(key=lambda x: len(x[0]), reverse=True)
    return pairs


def rewrite_imports(text: str, pairs: Sequence[Tuple[str, str]]) -> str:
    out = text or ""
    for old, new in pairs:
        if not old or old == new:
            continue
        out = re.sub(
            r"(?m)^([ \t]*)(from[ \t]+)" + re.escape(old) + r"([ \t]+import\b)",
            r"\1\2" + new + r"\3",
            out,
        )
        out = re.sub(
            r"(?m)^([ \t]*)(import[ \t]+)" + re.escape(old) + r"(\b)",
            r"\1\2" + new + r"\3",
            out,
        )
    return out


def parent_dirs_of(path: str) -> List[str]:
    p = _slash(path)
    if p.endswith("/"):
        parts = p.rstrip("/").split("/")
    else:
        parts = p.split("/")[:-1]
    out = []
    acc = ""
    for part in parts:
        acc += part + "/"
        out.append(acc)
    return out


def empty_leftover_dirs(all_paths: Iterable[str], removed_sources: Iterable[str]) -> List[str]:
    """Dir paths (deepest first) that are now empty and were parents of moved/removed files."""
    remaining = { _slash(p) for p in all_paths }
    candidates = set()
    for src in removed_sources:
        for d in parent_dirs_of(src):
            if d not in _RESERVED_DIRS:
                candidates.add(d)
    empty = []
    for d in sorted(candidates, key=lambda x: x.count("/"), reverse=True):
        if d in _RESERVED_DIRS:
            continue
        has = any((p != d) and p.startswith(d) for p in remaining)
        if not has:
            empty.append(d)
            remaining.discard(d)
    return empty
