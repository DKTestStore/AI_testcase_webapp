"""Unit tests for the Record feature fixes (no browser needed).  run:  python -m pytest -q tests/test_recorder_unit.py"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from backend import recorder as R


def test_c1_headed_on_windows_and_macos_without_display():
    assert R.want_headless("win32", {}) is False
    assert R.want_headless("darwin", {}) is False
    assert R.want_headless("cygwin", {}) is False


def test_c1_linux_uses_display_or_wayland():
    assert R.want_headless("linux", {}) is True
    assert R.want_headless("linux", {"DISPLAY": ":0"}) is False
    assert R.want_headless("linux", {"WAYLAND_DISPLAY": "wayland-0"}) is False


def test_c1_force_headless_env():
    assert R.want_headless("win32", {"ATG_REC_HEADLESS": "1"}) is True
    assert R.want_headless("linux", {"DISPLAY": ":0", "ATG_REC_HEADLESS": "true"}) is True
    assert R.want_headless("win32", {"ATG_REC_HEADLESS": "0"}) is False


def test_h4_origin():
    assert R._origin("https://A.example.com/login?x=1") == "https://a.example.com"
    assert R._origin("http://127.0.0.1:8090/index.html") != R._origin("https://kubota-ts-expointel-dev.azurewebsites.net/")


def test_m6_friendly_errors():
    assert "could not be found" in R.friendly_nav_error("https://x.invalid", "Page.goto: net::ERR_NAME_NOT_RESOLVED at ...")
    assert "30 seconds" in R.friendly_nav_error("http://10.255.255.1/", "Page.goto: Timeout 30000ms exceeded.")


def _rec(steps, groups):
    return {"setup": {"name": "Login and Logout"}, "steps": steps, "params": {}, "groups": groups}


def test_h3_every_split_test_starts_with_goto():
    steps = [{"id": "a", "kind": "navigate", "url": "http://h/index.html", "loc": {"url": "http://h/index.html"}},
             {"id": "b", "kind": "click", "url": "http://h/index.html", "loc": {"id": "go", "tag": "button"}},
             {"id": "c", "kind": "checkpoint", "url": "http://h/dash.html", "expected": "x", "loc": {"assert": "url", "url": "/dash.html"}},
             {"id": "d", "kind": "click", "url": "http://h/dash.html", "loc": {"id": "orders", "tag": "a"}}]
    rec = _rec(steps, [{"name": "One", "ids": ["a", "b", "c"]}, {"name": "Two", "ids": ["d"]}])
    py = R.build_script(rec, "py")["script"]
    assert py.count('page.goto("http://h/index.html")') == 1 and 'def test_two(page: Page):\n    page.goto("http://h/dash.html")' in py
    js = R.build_script(rec, "js")["script"]
    assert 'await page.goto("http://h/dash.html");' in js
    java = R.build_script(rec, "java")["script"]
    assert 'driver.get("http://h/dash.html");' in java


def test_h2_iframe_locators():
    steps = [{"id": "a", "kind": "navigate", "url": "http://h/", "loc": {"url": "http://h/"}},
             {"id": "b", "kind": "type", "url": "http://h/", "value": "u", "loc": {"label": "Username", "tag": "input", "frame": "#login", "id": "username"}}]
    rec = _rec(steps, [{"name": "F", "ids": ["a", "b"]}])
    assert 'page.frame_locator("#login").get_by_label("Username").fill("u")' in R.build_script(rec, "py")["script"]
    assert 'page.frameLocator("#login").getByLabel("Username").fill("u")' in R.build_script(rec, "js")["script"]
    j = R.build_script(rec, "java")["script"]
    assert "frameToBeAvailableAndSwitchToIt" in j and "switchTo().defaultContent()" in j
