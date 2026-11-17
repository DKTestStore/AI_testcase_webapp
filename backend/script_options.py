"""Script option catalogue (languages, types, frameworks) stored in app_settings prefs.

Built-in defaults are merged on read. Deleted built-ins go into a removed list so
saved scripts keep their stored language/framework values, while Generate hides
the option. Custom items are stored alongside overrides.
"""
from __future__ import annotations

from typing import Any, Dict, List

from . import settings_store

# --------------------------------------------------------------------------- defaults

_LANGS = [
    {"id": "java", "name": "Java", "code": "java", "ext": ".java", "default_runner": "testng", "enabled": True},
    {"id": "python", "name": "Python", "code": "py", "ext": ".py", "default_runner": "pytest", "enabled": True},
    {"id": "dotnet", "name": ".NET (C#)", "code": "cs", "ext": ".cs", "default_runner": "nunit", "enabled": True},
    {"id": "javascript", "name": "JavaScript", "code": "js", "ext": ".js", "default_runner": "jest", "enabled": True},
    {"id": "typescript", "name": "TypeScript", "code": "ts", "ext": ".ts", "default_runner": "jest", "enabled": True},
    {"id": "robot", "name": "Robot Framework", "code": "robot", "ext": ".robot", "default_runner": "", "enabled": True},
]

_TYPES = [
    {"id": "ui", "name": "UI", "icon": "🖥", "color": "#2563eb", "enabled": True},
    {"id": "api", "name": "API", "icon": "🔌", "color": "#7c3aed", "enabled": True},
    {"id": "database", "name": "Database", "icon": "🗄", "color": "#0f766e", "enabled": True},
    {"id": "mobile", "name": "Mobile", "icon": "📱", "color": "#c2410c", "enabled": True},
]


def _fw(fid, name, langs, types, category, hint, enabled=True):
    return {
        "id": fid, "name": name, "languages": list(langs), "types": list(types),
        "category": category, "hint": hint, "enabled": enabled,
    }


_ALL_LANG = ["java", "python", "dotnet", "javascript", "typescript"]
_NO_ROBOT = list(_ALL_LANG)
_JVM_PY_NET_JS = ["java", "python", "dotnet", "javascript"]
_JS_TS = ["javascript", "typescript"]
_MOBILE_LANG = ["java", "python", "dotnet", "javascript", "typescript"]

_FWS = [
    _fw("playwright", "Playwright", _NO_ROBOT, ["ui", "api"], "library",
        "Use official Playwright test syntax for the selected language. Prefer getByRole / getByTestId / getByLabel over raw CSS. Share a browser context. When POM is on, put locators in page classes under pages/."),
    _fw("selenium", "Selenium", _JVM_PY_NET_JS, ["ui"], "library",
        "Use Selenium WebDriver for the selected language. Explicit waits over sleeps. Locators: id, name, accessible names, then CSS. Page objects when POM is on."),
    _fw("rest_assured", "Rest Assured", ["java"], ["api"], "library",
        "Java API tests with Rest Assured. Given/When/Then style, schema or status/body assertions, reusable RequestSpec with the API base URL and auth."),
    _fw("requests", "Requests", ["python"], ["api"], "library",
        "Python API tests with the requests library. Session with base URL and auth, JSON assertions, clear function names per test case."),
    _fw("restsharp", "RestSharp / HttpClient", ["dotnet"], ["api"], "library",
        "C# API tests using RestSharp or HttpClient. Share a client with base URL and auth. Assert status codes and payloads."),
    _fw("axios", "Axios / SuperTest", _JS_TS, ["api"], "library",
        "JavaScript/TypeScript API tests with Axios or SuperTest. Share a baseURL and auth headers. Assert status and body."),
    _fw("appium", "Appium", _MOBILE_LANG, ["mobile"], "library",
        "Mobile tests with Appium for the selected language and platform (iOS/Android). Use accessibility ids when possible, then platform locators. Desired capabilities from the mobile context."),
    _fw("webdriverio", "WebdriverIO", _JS_TS, ["ui", "mobile"], "library",
        "WebdriverIO tests in JS/TS. Use $ / $$ or locators; wdio page objects when POM is on. Works for web and native/hybrid mobile."),
    _fw("jdbc", "JDBC", ["java"], ["database"], "library",
        "Java database checks with JDBC. Use a placeholder connection URL (do not invent real credentials). Assert row counts or query results after the action under test."),
    _fw("sqlalchemy", "SQLAlchemy / pyodbc", ["python"], ["database"], "library",
        "Python database checks with SQLAlchemy or pyodbc. Use a placeholder connection string. Assert query results; never hard-code secrets."),
    _fw("ado_net", "ADO.NET / Dapper", ["dotnet"], ["database"], "library",
        "C# database checks with ADO.NET or Dapper. Placeholder connection string. Assert reader/query results."),
    _fw("pg", "pg / mysql2", _JS_TS, ["database"], "library",
        "JavaScript/TypeScript database checks with pg or mysql2. Placeholder connection. Assert query rows."),
    _fw("testng", "TestNG", ["java"], ["ui", "api", "database", "mobile"], "runner",
        "Organize tests with TestNG annotations (@Test, @BeforeMethod). One test method per mapped test case when requested."),
    _fw("junit5", "JUnit 5", ["java"], ["ui", "api", "database", "mobile"], "runner",
        "Organize tests with JUnit 5 (@Test, @BeforeEach, Assertions). One test method per mapped test case when requested."),
    _fw("pytest", "pytest", ["python"], ["ui", "api", "database", "mobile"], "runner",
        "pytest functions (test_*) and fixtures. One test function per mapped test case when requested. Use pytest.raises / assert."),
    _fw("nunit", "NUnit", ["dotnet"], ["ui", "api", "database", "mobile"], "runner",
        "NUnit [Test] / [SetUp] for C#. One test method per mapped test case when requested."),
    _fw("xunit", "xUnit", ["dotnet"], ["ui", "api", "database", "mobile"], "runner",
        "xUnit [Fact] / constructor fixtures for C#. One test method per mapped test case when requested."),
    _fw("mstest", "MSTest", ["dotnet"], ["ui", "api", "database", "mobile"], "runner",
        "MSTest [TestMethod] / [TestInitialize] for C#. One test method per mapped test case when requested."),
    _fw("jest", "Jest", _JS_TS, ["ui", "api", "database", "mobile"], "runner",
        "Jest describe/test (or it) blocks. One test per mapped test case when requested."),
    _fw("mocha", "Mocha", _JS_TS, ["ui", "api", "database", "mobile"], "runner",
        "Mocha describe/it blocks with an assertion library already in use (chai or node assert)."),
    _fw("cucumber", "Cucumber", ["java", "javascript", "typescript", "dotnet"], ["ui", "api", "database", "mobile"], "bdd",
        "BDD: write Gherkin .feature files plus step definitions in the selected language. Map each test case to a scenario."),
    _fw("pytest_bdd", "pytest-bdd", ["python"], ["ui", "api", "database", "mobile"], "bdd",
        "BDD: Gherkin .feature files with pytest-bdd step definitions. Map each test case to a scenario."),
    _fw("seleniumlibrary", "SeleniumLibrary", ["robot"], ["ui"], "robot",
        "Robot Framework SeleniumLibrary keywords. One test case per mapped case. Use variables for the UI base URL."),
    _fw("browserlibrary", "Browser", ["robot"], ["ui"], "robot",
        "Robot Framework Browser (Playwright) library keywords. Use Get Element / Click / Fill Text. Variables for the base URL."),
    _fw("requestslibrary", "RequestsLibrary", ["robot"], ["api"], "robot",
        "Robot Framework RequestsLibrary. Create a session with the API base URL and auth. Assert status and JSON."),
    _fw("appiumlibrary", "AppiumLibrary", ["robot"], ["mobile"], "robot",
        "Robot Framework AppiumLibrary keywords. Use accessibility ids when possible. Capabilities from the mobile context."),
    _fw("databaselibrary", "DatabaseLibrary", ["robot"], ["database"], "robot",
        "Robot Framework DatabaseLibrary. Connect using a placeholder string. Query and assert results."),
]

DEFAULT_MODES = {"language": "single", "type": "multi", "framework": "multi"}

DEFAULT_AUTOMATION_PREFS = {
    "default_language": "java",
    "default_types": ["ui"],
    "default_frameworks": ["playwright", "testng"],
    "ui_base_url": "",
    "api_base_url": "",
    "api_auth": "none",
    "db_type": "",
    "db_connection": "",
    "mobile_platform": "",
    "mobile_device": "",
    "mobile_app": "",
    "output_folder_hint": "tests/",
    "use_pom": True,
    "include_assertions": True,
    "one_file_per_test": False,
}


def default_languages() -> List[Dict[str, Any]]:
    return [dict(x) for x in _LANGS]


def default_types() -> List[Dict[str, Any]]:
    return [dict(x) for x in _TYPES]


def default_frameworks() -> List[Dict[str, Any]]:
    return [dict(x, languages=list(x["languages"]), types=list(x["types"])) for x in _FWS]


def default_catalogue() -> Dict[str, Any]:
    return {
        "languages": default_languages(),
        "types": default_types(),
        "frameworks": default_frameworks(),
        "modes": dict(DEFAULT_MODES),
        "removed": {"languages": [], "types": [], "frameworks": []},
    }


# --------------------------------------------------------------------------- merge / persist

_GROUPS = ("languages", "types", "frameworks")


def _idx(items: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    out = {}
    for it in items or []:
        if isinstance(it, dict) and it.get("id"):
            out[str(it["id"])] = it
    return out


def _clean_item(kind: str, it: Dict[str, Any]) -> Dict[str, Any] | None:
    if not isinstance(it, dict):
        return None
    iid = str(it.get("id") or "").strip()[:40]
    name = str(it.get("name") or "").strip()[:80]
    if not iid or not name:
        return None
    enabled = True if it.get("enabled") is None else bool(it.get("enabled"))
    custom = bool(it.get("custom"))
    if kind == "languages":
        return {
            "id": iid, "name": name, "code": str(it.get("code") or iid)[:20],
            "ext": str(it.get("ext") or "")[:16],
            "default_runner": str(it.get("default_runner") or "")[:40],
            "enabled": enabled, "custom": custom,
        }
    if kind == "types":
        return {
            "id": iid, "name": name, "icon": str(it.get("icon") or "")[:8],
            "color": str(it.get("color") or "")[:20],
            "enabled": enabled, "custom": custom,
        }
    langs = [str(x) for x in (it.get("languages") or []) if str(x).strip()][:20]
    types = [str(x) for x in (it.get("types") or []) if str(x).strip()][:20]
    return {
        "id": iid, "name": name, "languages": langs, "types": types,
        "category": str(it.get("category") or "library")[:20],
        "hint": str(it.get("hint") or "")[:2000],
        "enabled": enabled, "custom": custom,
    }


def merge_catalogue(raw: Dict[str, Any] | None) -> Dict[str, Any]:
    """Defaults + saved overrides, minus the removed built-in list, plus custom items."""
    raw = raw if isinstance(raw, dict) else {}
    removed_in = raw.get("removed") if isinstance(raw.get("removed"), dict) else {}
    base = default_catalogue()
    modes = dict(DEFAULT_MODES)
    saved_modes = raw.get("modes") if isinstance(raw.get("modes"), dict) else {}
    for k in modes:
        v = str(saved_modes.get(k) or modes[k]).lower()
        modes[k] = "single" if v == "single" else "multi"
    out: Dict[str, Any] = {"modes": modes, "removed": {g: [] for g in _GROUPS}}
    for g in _GROUPS:
        defaults = _idx(base[g])
        removed = [str(x) for x in (removed_in.get(g) or raw.get("removed_" + g) or []) if str(x).strip()]
        # only built-in ids belong in removed
        removed = [x for x in removed if x in defaults]
        out["removed"][g] = removed
        saved_items = raw.get(g) if isinstance(raw.get(g), list) else []
        saved_map = _idx(saved_items)
        order = [str(x.get("id")) for x in saved_items if isinstance(x, dict) and x.get("id")]
        merged: List[Dict[str, Any]] = []
        seen = set()
        # first, saved order (overrides + custom)
        for iid in order:
            if iid in seen or iid in removed:
                continue
            if iid in defaults:
                item = dict(defaults[iid])
                ov = _clean_item(g, saved_map[iid]) if iid in saved_map else None
                if ov:
                    for k, val in ov.items():
                        if k in ("id", "custom"):
                            continue
                        item[k] = val
                item["custom"] = False
                merged.append(item)
                seen.add(iid)
            else:
                item = _clean_item(g, saved_map.get(iid) or {})
                if item:
                    item["custom"] = True
                    merged.append(item)
                    seen.add(iid)
        # then any new built-ins not yet in the saved list
        for iid, dflt in defaults.items():
            if iid in seen or iid in removed:
                continue
            item = dict(dflt)
            item["custom"] = False
            merged.append(item)
            seen.add(iid)
        out[g] = merged
    return out


def get_catalogue() -> Dict[str, Any]:
    raw = settings_store._app().get("script_options")
    return merge_catalogue(raw if isinstance(raw, dict) else {})


def set_catalogue(value) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Script options must be an object.")
    if value.get("reset"):
        from .db import update_app_settings
        update_app_settings({"script_options": {}})
        return get_catalogue()
    merged = merge_catalogue(value)
    from .db import update_app_settings
    update_app_settings({"script_options": {
        "languages": merged["languages"],
        "types": merged["types"],
        "frameworks": merged["frameworks"],
        "modes": merged["modes"],
        "removed": merged["removed"],
    }})
    return get_catalogue()


def get_automation_prefs() -> Dict[str, Any]:
    raw = settings_store._app().get("automation_prefs")
    if not isinstance(raw, dict):
        raw = {}
    out = dict(DEFAULT_AUTOMATION_PREFS)
    for k, dflt in DEFAULT_AUTOMATION_PREFS.items():
        if k not in raw:
            continue
        v = raw[k]
        if isinstance(dflt, bool):
            out[k] = bool(v)
        elif isinstance(dflt, list):
            out[k] = [str(x) for x in (v or []) if str(x).strip()][:20]
        else:
            out[k] = str(v or "")[:300]
    return out


def set_automation_prefs(value) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Automation preferences must be an object.")
    cur = get_automation_prefs()
    for k in DEFAULT_AUTOMATION_PREFS:
        if k in value:
            dflt = DEFAULT_AUTOMATION_PREFS[k]
            v = value[k]
            if isinstance(dflt, bool):
                cur[k] = bool(v)
            elif isinstance(dflt, list):
                cur[k] = [str(x) for x in (v or []) if str(x).strip()][:20]
            else:
                cur[k] = str(v or "")[:300]
    from .db import update_app_settings
    update_app_settings({"automation_prefs": cur})
    return get_automation_prefs()


def enabled_catalogue() -> Dict[str, Any]:
    cat = get_catalogue()
    return {
        "languages": [x for x in cat["languages"] if x.get("enabled")],
        "types": [x for x in cat["types"] if x.get("enabled")],
        "frameworks": [x for x in cat["frameworks"] if x.get("enabled")],
        "modes": cat["modes"],
        "prefs": get_automation_prefs(),
    }


def find_framework(fid: str, cat: Dict[str, Any] | None = None) -> Dict[str, Any] | None:
    cat = cat or get_catalogue()
    fid = str(fid or "")
    for x in cat.get("frameworks") or []:
        if x.get("id") == fid or x.get("name") == fid:
            return x
    return None
