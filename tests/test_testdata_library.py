"""Mocked unit tests for test data, Edge library, boost coverage, Gherkin, sanitize, provider resolve.

No network, no provider calls, no app startup. Do not run unless the owner asks.

run:  python -m pytest -q tests/test_testdata_library.py
"""
import io
import json
import pathlib
import sys
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from backend import parsing, services, testdata  # noqa: E402


STORY = (
    "As a registered user I want to reset my forgotten password so that I can sign in again.\n"
    "Email jordan.lee@example.com. New password 8–64 characters, 1 upper, 1 lower, 1 digit."
)

CASES = [
    {"id": "TC001", "name": "Valid email receives the reset mail", "description": "Happy path",
     "precondition": "The user is registered", "type": "Positive", "status": "not",
     "steps": [{"description": "Enter jordan.lee@example.com in the Email field and submit",
                "expected": "A generic confirmation is shown"}]},
    {"id": "TC002", "name": "Empty email is rejected", "description": "Invalid empty email",
     "type": "Negative", "status": "not",
     "steps": [{"description": "Leave Email empty and submit", "expected": "A required-field error is shown"}]},
    {"id": "TC003", "name": "New password of 8 characters is accepted",
     "description": "Minimum length with complexity", "type": "Boundary", "status": "not",
     "steps": [{"description": "Enter a complex new password of 8 characters and confirm it",
                "expected": "The password is accepted"}]},
]


def _prefs_all_on():
    return {"enabled": True, "disabled": [], "custom": [], "custom_categories": []}


def test_library_loads_builtin_catalog():
    cat = testdata.load_catalog()
    ids = [c["id"] for c in cat["categories"]]
    assert "emails" in ids and "security" in ids and "custom" in ids
    sec = next(c for c in cat["categories"] if c["id"] == "security")
    assert sec.get("testing_only") is True
    assert any("OR 1=1" in (it.get("v") or "") for it in sec["items"])


def test_library_public_respects_disabled_categories(monkeypatch):
    monkeypatch.setattr(testdata, "_prefs", lambda: {
        "enabled": True, "disabled": ["security"], "custom": [{"value": "MY-CUSTOM", "label": "mine"}],
        "custom_categories": [],
    })
    pub = testdata.library_public()
    by = {c["id"]: c for c in pub["categories"]}
    assert by["security"]["enabled"] is False
    assert any(it["v"] == "MY-CUSTOM" for it in by["custom"]["items"])
    assert pub["enabled"] is True


def test_generate_library_source_tags_library_values(monkeypatch):
    monkeypatch.setattr(testdata, "_prefs", _prefs_all_on)
    out = testdata.generate(CASES, source="library", feature_text=STORY)
    email = next(f for f in out["fields"] if f["key"] == "email")
    assert email["source"] == "library"
    assert any(it.get("src") == "lib" for it in email["values"]["invalid"])
    assert all(it.get("src") != "ai" for kind in email["values"].values() for it in kind)


def test_generate_ai_source_uses_story_email(monkeypatch):
    monkeypatch.setattr(testdata, "_prefs", _prefs_all_on)
    out = testdata.generate(CASES, source="ai", feature_text=STORY)
    email = next(f for f in out["fields"] if f["key"] == "email")
    vals = [it["v"] for it in email["values"]["valid"]]
    assert "jordan.lee@example.com" in vals
    assert all(it.get("src") == "ai" for kind in email["values"].values() for it in kind)
    # proposed cases have test_data on the email step
    tc1 = next(c for c in out["test_cases"] if c["id"] == "TC001")
    assert tc1["steps"][0].get("test_data")
    assert "Valid:" in (tc1["steps"][0].get("data") or testdata.format_test_data(tc1["steps"][0]["test_data"]))


def test_password_bounds_and_boundary_samples(monkeypatch):
    monkeypatch.setattr(testdata, "_prefs", _prefs_all_on)
    assert testdata.password_bounds(STORY) == (8, 64)
    vals = testdata.values_for_field("password", "ai", STORY)
    blob = " ".join(it["v"] for it in vals["boundary"])
    assert "8" in blob and "64" in blob


def test_boost_preview_suggests_negative_boundary_security(monkeypatch):
    monkeypatch.setattr(testdata, "_prefs", _prefs_all_on)
    prev = testdata.boost_preview(CASES, feature_text=STORY, story_id="EXPO-33")
    types = {s["type"] for s in prev["suggestions"]}
    assert {"Negative", "Boundary", "Security"} <= types
    assert prev["current"]["Positive"] == 1
    assert prev["current"]["Negative"] == 1
    assert prev["add"]["Negative"] >= 1
    assert prev["next"]["Negative"] == prev["current"]["Negative"] + prev["add"]["Negative"]
    # existing 8-char password case should not be re-suggested as a duplicate
    names = " ".join(s["name"] for s in prev["suggestions"]).lower()
    assert "8 characters (minimum)" not in names
    added = testdata.suggestions_to_cases(prev["suggestions"], start_n=4)
    assert added[0]["id"] == "TC004"
    assert added[0].get("added") is True
    assert added[0]["type"] in ("Negative", "Boundary", "Security")


def test_gherkin_feature_tags_and_outline(monkeypatch):
    monkeypatch.setattr(testdata, "_prefs", _prefs_all_on)
    run = {"story_id": "EXPO-33", "jira": {"summary": "Reset forgotten password"},
           "feature_text": STORY, "test_cases": CASES}
    feat = testdata.gherkin_for_run(run, outline=False, tags=True, background=True)
    assert feat.startswith("@jira-EXPO-33")
    assert "Feature: Reset forgotten password" in feat
    assert "Background:" in feat
    assert "Scenario: Valid email receives the reset mail" in feat
    assert "@negative" in feat
    outline = testdata.gherkin_for_run(run, outline=True, tags=True, background=True)
    assert "Scenario Outline:" in outline
    assert "Examples:" in outline
    assert "| value" in outline.lower() or "| value" in outline
    assert testdata.gherkin_filename(run).endswith(".feature")
    assert testdata.gherkin_filename(run).startswith("EXPO-33")


def test_gherkin_zip_multiple_stories():
    files = [("A-tests.feature", "Feature: A\n"), ("B-tests.feature", "Feature: B\n")]
    raw = testdata.zip_features(files)
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        assert set(zf.namelist()) == {"A-tests.feature", "B-tests.feature"}
        assert zf.read("A-tests.feature").decode() == "Feature: A\n"


def test_sanitize_preserves_test_data_type_and_added():
    raw = [{
        "id": "TC010", "name": "SQLi is rejected", "description": "Security",
        "type": "Security", "added": True, "priority": "High", "status": "not",
        "steps": [{
            "description": "Enter payload", "expected": "Rejected",
            "test_data": {"invalid": [{"v": "' OR 1=1 --", "src": "lib"}], "valid": [], "boundary": []},
        }],
    }]
    out = parsing.sanitize_cases(raw)
    assert out[0]["type"] == "Security"
    assert out[0]["added"] is True
    st = out[0]["steps"][0]
    assert st["test_data"]["invalid"][0]["v"] == "' OR 1=1 --"
    assert "OR 1=1" in (st.get("data") or "")
    # unknown type dropped; Edge still allowed
    edge = parsing.sanitize_cases([{"id": "TC011", "name": "Edge", "type": "Edge",
                                    "steps": [{"description": "x", "expected": "y"}]}])
    assert edge[0]["type"] == "Edge"
    junk = parsing.sanitize_cases([{"id": "TC012", "name": "X", "type": "Whatever", "steps": []}])
    assert "type" not in junk[0]


def test_coverage_type_maps_edge_to_boundary():
    assert testdata.coverage_type({"type": "Edge", "name": "", "description": ""}) == "Boundary"
    assert testdata.coverage_type({"type": "Security", "name": "", "description": ""}) == "Security"
    assert testdata.coverage_counts(CASES)["Positive"] == 1
    assert testdata.coverage_counts(CASES)["Boundary"] == 1


def test_resolve_provider_override_run_and_settings(monkeypatch):
    monkeypatch.setattr(services, "resolve_provider", services.resolve_provider)
    from backend import settings_store
    monkeypatch.setattr(settings_store, "get_default_provider", lambda: "grok")
    assert services.resolve_provider({"model": "groq"}, "claude") == "claude"
    assert services.resolve_provider({"model": "groq"}) == "groq"
    assert services.resolve_provider({"model": ""}) == "grok"
    assert services.resolve_provider({}) == "grok"
    assert services.resolve_provider(None) == "grok"


def test_format_and_parse_test_data():
    td = {"valid": [{"v": "a@b.co", "src": "lib"}], "invalid": [{"v": "not-an-email", "src": "ai"}],
          "boundary": []}
    s = testdata.format_test_data(td)
    assert "Valid: a@b.co" in s and "Invalid: not-an-email" in s
    parsed = testdata.parse_test_data(td)
    assert parsed["valid"][0]["v"] == "a@b.co"
    assert testdata.parse_test_data("plain")["valid"][0]["v"] == "plain"
