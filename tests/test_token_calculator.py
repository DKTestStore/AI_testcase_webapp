"""Mocked unit tests for the Token Calculator, model registry rates, ledger filters, and estimates.

No network, no provider calls, no app startup, no .env reads. Do not run unless the owner asks.

run:  python -m pytest -q tests/test_token_calculator.py
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from backend import token_estimate, token_registry, token_usage, dashboard  # noqa: E402


GROQ_MODEL = {
    "id": "gpt-oss-120b", "inn": 0.20, "out": 0.25, "ctx": 131072, "div": 4,
    "enabled": True, "default": True,
}


def _no_api_prefs():
    return {"tiktoken": False, "provider_count_api": False}


def test_count_text_uses_chars_div_when_tiktoken_off(monkeypatch):
    monkeypatch.setattr(token_registry, "get_calc_prefs", _no_api_prefs)
    monkeypatch.setattr(token_registry, "find_model", lambda p, m: GROQ_MODEL)
    monkeypatch.setattr(token_registry, "resolved_model_id", lambda p, m: m or GROQ_MODEL["id"])
    # 40 characters / 4 = 10 tokens
    r = token_estimate.count_text("abcd" * 10, "groq", "gpt-oss-120b")
    assert r["tokens"] == 10
    assert r["chars"] == 40
    assert r["method"] == "estimate"
    assert r["exact"] is False


def test_estimate_uses_model_rates(monkeypatch):
    monkeypatch.setattr(token_registry, "get_calc_prefs", _no_api_prefs)
    monkeypatch.setattr(token_registry, "find_model", lambda p, m: GROQ_MODEL)
    monkeypatch.setattr(token_registry, "resolved_model_id", lambda p, m: m or GROQ_MODEL["id"])
    r = token_estimate.estimate("x" * 400, "groq", "gpt-oss-120b", expected_output=800)
    assert r["est_input"] == 100
    assert r["est_output"] == 800
    assert r["rate_source"] == "model"
    # 100 * 0.20 / 1e6 + 800 * 0.25 / 1e6 = 0.00022
    assert abs(r["est_cost"] - 0.00022) < 1e-9
    assert r["fits"] is True


def test_estimate_over_limit(monkeypatch):
    small = dict(GROQ_MODEL, ctx=100)
    monkeypatch.setattr(token_registry, "get_calc_prefs", _no_api_prefs)
    monkeypatch.setattr(token_registry, "find_model", lambda p, m: small)
    monkeypatch.setattr(token_registry, "resolved_model_id", lambda p, m: m or small["id"])
    r = token_estimate.estimate("x" * 400, "groq", "gpt-oss-120b", expected_output=800)
    assert r["fits"] is False
    assert r["fit_pct"] > 100


def test_cost_for_falls_back_to_legacy_global(monkeypatch):
    monkeypatch.setattr(token_registry, "find_model", lambda p, m: None)
    monkeypatch.setattr(token_usage, "get_settings", lambda: {
        "token_daily_limit": 1_000_000, "token_rate_input": 0.30, "token_rate_output": 2.50,
    })
    r = token_registry.cost_for(1_000_000, 1_000_000, "unknown", "no-such-model")
    assert r["rate_source"] == "legacy_global"
    assert abs(r["cost"] - 2.80) < 1e-9


def test_resolved_model_id_prefers_override_then_registry(monkeypatch):
    monkeypatch.setattr(token_registry, "find_model", lambda p, m: GROQ_MODEL if not m else None)
    monkeypatch.setattr(token_registry, "_configured_model", lambda p: "llama-3.3-70b-versatile")
    assert token_registry.resolved_model_id("groq", "custom-model") == "custom-model"
    assert token_registry.resolved_model_id("groq", "") == "gpt-oss-120b"
    monkeypatch.setattr(token_registry, "find_model", lambda p, m: None)
    assert token_registry.resolved_model_id("groq", "") == "llama-3.3-70b-versatile"


def test_match_supports_provider_and_action_and_keeps_mode():
    e = {"ts": "2026-11-14T10:00:00", "mode": "local", "model": "gpt-oss-120b",
         "provider": "groq", "action": "Generate"}
    assert token_usage._match(e, "2026-11-14", "2026-11-14", "local", "gpt-oss-120b", "groq", "Generate")
    assert not token_usage._match(e, "2026-11-14", "2026-11-14", "local", "all", "gemini", "Generate")
    assert not token_usage._match(e, "2026-11-14", "2026-11-14", "jira", "all", "groq", "Generate")
    assert token_usage._match(e, "", "", "all", "all", "all", "all")


def _sample_rows():
    return [
        {"id": "TU-old", "ts": "2026-11-05T09:00:00", "action": "Generate", "mode": "local",
         "model": "gemini-2.5-pro", "provider": "gemini", "input": 100, "output": 50, "total": 150,
         "est_input": 0, "est_output": 0, "est_cost": 0, "actual_cost": 0, "rate_source": "legacy_global",
         "rid": "RUN-1", "story_id": "ST-1", "title": "legacy", "source": "local", "mock": False},
        {"id": "TU-new", "ts": "2026-11-14T11:00:00", "action": "Generate", "mode": "local",
         "model": "gpt-oss-120b", "provider": "groq", "input": 1248, "output": 1840, "total": 3088,
         "est_input": 1200, "est_output": 1800, "est_cost": 0.00069, "actual_cost": 0.00071,
         "rate_source": "model", "rid": "RUN-2", "story_id": "ST-2", "title": "new", "source": "local", "mock": False},
        {"id": "TU-rev", "ts": "2026-11-14T12:00:00", "action": "AI review", "mode": "local",
         "model": "gpt-oss-120b", "provider": "groq", "input": 3388, "output": 912, "total": 4300,
         "est_input": 3200, "est_output": 900, "est_cost": 0.00086, "actual_cost": 0.00091,
         "rate_source": "model", "rid": "RUN-2", "story_id": "ST-2", "title": "review", "source": "local", "mock": False},
    ]


def test_query_adds_provider_breakdown_and_keeps_action_breakdown(monkeypatch):
    monkeypatch.setattr(token_usage, "_load", _sample_rows)
    monkeypatch.setattr(token_usage, "get_settings", lambda: dict(token_usage.DEFAULTS))
    q = token_usage.query(d_from="2026-11-01", d_to="2026-11-14")
    assert "breakdown" in q and any(b["action"] == "Generate" for b in q["breakdown"])
    assert q["breakdown_providers"]
    groq = next(p for p in q["breakdown_providers"] if p["provider"] == "groq")
    assert groq["total"] == 3088 + 4300
    assert q["accuracy"]
    assert "cost_model" in q["month"]
    assert "legacy_global" in {e.get("rate_source") for e in _sample_rows()}


def test_export_csv_appends_new_columns_and_keeps_existing(monkeypatch):
    monkeypatch.setattr(token_usage, "_load", _sample_rows)
    csv_body = token_usage.export_csv()
    header = csv_body.splitlines()[0]
    for col in ("time", "run_id", "mode", "action", "model", "input_tokens", "output_tokens", "total_tokens", "mock"):
        assert col in header
    for col in ("provider", "est_input", "est_output", "est_cost", "actual_cost", "rate_source"):
        assert col in header
    assert "legacy_global" in csv_body
    assert "gpt-oss-120b" in csv_body


def test_record_stores_estimate_and_model_rate(monkeypatch):
    saved = {}
    monkeypatch.setattr(token_usage, "_load", lambda: [])
    monkeypatch.setattr(token_usage, "_save", lambda rows: saved.setdefault("rows", rows))
    monkeypatch.setattr(token_registry, "cost_for", lambda inp, out, p, m: {
        "cost": 0.001, "rate_source": "model", "inn": 0.2, "out": 0.25,
    })
    token_usage.record(
        action="Generate",
        usage={"provider": "groq", "model_name": "gpt-oss-120b", "input_tokens": 100, "output_tokens": 80, "total_tokens": 180},
        run={"model": "groq", "model_name": "gpt-oss-120b", "source": "local", "rid": "R1"},
        mode="local",
        estimate={"est_input": 90, "est_output": 80, "est_cost": 0.0009, "rate_source": "model"},
    )
    assert saved["rows"]
    row = saved["rows"][0]
    assert row["est_input"] == 90 and row["est_output"] == 80
    assert row["rate_source"] == "model"
    assert row["provider"] == "groq"
    assert row["model"] == "gpt-oss-120b"
    assert row["actual_cost"] == 0.001


def test_dashboard_near_limit_only_when_user_sets_a_cap(monkeypatch):
    rows = _sample_rows()
    # Pretend the new rows are today so the daily cap can fire.
    today = __import__("datetime").datetime.now().date().isoformat()
    for e in rows:
        if e["provider"] == "groq":
            e["ts"] = today + "T10:00:00"
    monkeypatch.setattr(token_registry, "get_limits", lambda: {
        "groq": {"daily_tokens": 5000, "daily_cost": None},
        "gemini": {"daily_tokens": None, "daily_cost": None},
    })
    summary = dashboard._token_summary(rows, today, today)
    assert summary["near_limit"]
    hit = next(n for n in summary["near_limit"] if n["provider"] == "groq")
    assert hit["metric"] == "tokens"
    assert hit["pct"] >= 80
    # No cap → no warning
    monkeypatch.setattr(token_registry, "get_limits", lambda: {
        "groq": {"daily_tokens": None, "daily_cost": None},
        "gemini": {"daily_tokens": None, "daily_cost": None},
    })
    summary2 = dashboard._token_summary(rows, today, today)
    assert summary2["near_limit"] == []


def test_migration_004_is_additive():
    import importlib.util
    path = pathlib.Path(__file__).resolve().parents[1] / "migrations" / "versions" / "004_token_calculator.py"
    spec = importlib.util.spec_from_file_location("m004", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.down_revision == "003_provider_testdata"
    assert "est_input" in (mod.upgrade.__doc__ or "") or "est_input" in path.read_text()
    src = path.read_text()
    assert "server_default=\"legacy_global\"" in src or "server_default='legacy_global'" in src
    assert "op.add_column" in src
    assert "op.drop_column" in src  # downgrade only; upgrade is additive
