"""Per-provider model registry and optional daily limits (non-secret, SQLite app settings).

Seeded from already-configured model IDs (GEMINI_MODEL, GROQ_MODEL, …) via settings_store
(no new .env keys; this module does not write .env). Existing single-model Settings fields
remain the fallback when the registry has no enabled row for a provider.
Example prices are labelled as such — they are not live vendor rates.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# Example catalog used only to pre-fill additional rows (and default rates/context).
# The starred default is the model already configured for that provider, when set.
EXAMPLE_RATES = {
    "gemini": {"inn": 0.10, "out": 0.40, "ctx": 1_048_576, "div": 4.12},
    "groq": {"inn": 0.20, "out": 0.25, "ctx": 128_000, "div": 4.0},
    "openai": {"inn": 0.15, "out": 0.60, "ctx": 128_000, "div": 4.21, "exact": True},
    "codex": {"inn": 0.15, "out": 0.60, "ctx": 128_000, "div": 4.21, "exact": True},
    "claude": {"inn": 3.00, "out": 15.00, "ctx": 200_000, "div": 3.98},
    "grok": {"inn": 0.20, "out": 0.50, "ctx": 131_072, "div": 4.0},
    "ollama": {"inn": 0.0, "out": 0.0, "ctx": 8192, "div": 3.81, "local": True},
    "nvidia": {"inn": 0.0, "out": 0.0, "ctx": 262144, "div": 4.0},
}

EXTRA_MODELS = {
    "gemini": [
        {"id": "gemini-2.5-pro", "inn": 1.25, "out": 10.00, "ctx": 1_048_576, "div": 4.15},
        {"id": "gemini-2.5-flash", "inn": 0.10, "out": 0.40, "ctx": 1_048_576, "div": 4.12},
        {"id": "gemini-2.5-flash-lite", "inn": 0.04, "out": 0.15, "ctx": 1_048_576, "div": 4.10},
    ],
    "groq": [
        {"id": "openai/gpt-oss-120b", "inn": 0.20, "out": 0.25, "ctx": 128_000, "div": 4.0},
        {"id": "openai/gpt-oss-20b", "inn": 0.10, "out": 0.15, "ctx": 128_000, "div": 4.0},
        {"id": "qwen/qwen3-32b", "inn": 0.15, "out": 0.20, "ctx": 128_000, "div": 3.90},
        {"id": "llama-3.3-70b-versatile", "inn": 0.59, "out": 0.79, "ctx": 128_000, "div": 4.0},
    ],
    "openai": [
        {"id": "gpt-4o-mini", "inn": 0.15, "out": 0.60, "ctx": 128_000, "div": 4.21, "exact": True},
        {"id": "gpt-4o", "inn": 2.50, "out": 10.00, "ctx": 128_000, "div": 4.21, "exact": True},
    ],
    "codex": [
        {"id": "gpt-5-mini", "inn": 0.15, "out": 0.60, "ctx": 128_000, "div": 4.21, "exact": True},
    ],
    "claude": [
        {"id": "claude-sonnet-4", "inn": 3.00, "out": 15.00, "ctx": 200_000, "div": 3.98},
        {"id": "claude-haiku-4", "inn": 0.80, "out": 4.00, "ctx": 200_000, "div": 3.98},
    ],
    "grok": [
        {"id": "grok-2", "inn": 0.20, "out": 0.50, "ctx": 131_072, "div": 4.0},
        {"id": "grok-2-mini", "inn": 0.10, "out": 0.20, "ctx": 131_072, "div": 4.0, "enabled": False},
    ],
    "ollama": [
        {"id": "gemma3:4b", "inn": 0.0, "out": 0.0, "ctx": 8192, "div": 3.81, "local": True},
        {"id": "llama3.2:3b", "inn": 0.0, "out": 0.0, "ctx": 2048, "div": 3.81, "local": True},
    ],
    "nvidia": [
        # Prices are 0 (NVIDIA free trial — enter rates if billed). Super stays the default.
        {"id": "nvidia/nemotron-3.5-super-vl-120b-a12b", "inn": 0.0, "out": 0.0, "ctx": 262144, "div": 4.0,
         "note": "NVIDIA free trial — enter rates if billed", "star": True},
        {"id": "mistralai/mistral-large-4-1t-a52b", "inn": 0.0, "out": 0.0, "ctx": 262144, "div": 4.0,
         "note": "NVIDIA free trial — enter rates if billed"},
        {"id": "z-ai/glm-5.3-flash", "inn": 0.0, "out": 0.0, "ctx": 1048576, "div": 4.0,
         "note": "NVIDIA free trial — enter rates if billed"},
        {"id": "minimaxai/minimax-m3.1-flash", "inn": 0.0, "out": 0.0, "ctx": 262144, "div": 4.0,
         "note": "NVIDIA free trial — enter rates if billed"},
        {"id": "nvidia/nemotron-3.5-lightning-30b-a3b", "inn": 0.0, "out": 0.0, "ctx": 1048576, "div": 4.0,
         "note": "NVIDIA free trial — enter rates if billed"},
        {"id": "nvidia/nemotron-3.5-bolt-e4b", "inn": 0.0, "out": 0.0, "ctx": 65536, "div": 4.0,
         "note": "NVIDIA free trial — enter rates if billed"},
        {"id": "openai/gpt-oss-20b", "inn": 0.0, "out": 0.0, "ctx": 131072, "div": 4.0,
         "note": "NVIDIA free trial — enter rates if billed"},
    ],
}

ENV_KEYS = {
    "gemini": "GEMINI_MODEL",
    "groq": "GROQ_MODEL",
    "openai": "OPENAI_MODEL",
    "codex": "CODEX_MODEL",
    "claude": "CLAUDE_MODEL",
    "grok": "GROK_MODEL",
    "ollama": "OLLAMA_MODEL",
    "nvidia": "NVIDIA_MODEL",
}

PROVIDER_IDS = ("gemini", "groq", "openai", "codex", "claude", "grok", "ollama", "nvidia")
PROVIDER_NAMES = {
    "gemini": "Gemini", "groq": "Groq", "openai": "OpenAI", "codex": "Codex",
    "claude": "Claude", "grok": "Grok", "ollama": "Ollama", "nvidia": "NVIDIA",
}


def _norm_row(raw: Any, pid: str) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    mid = str(raw.get("id") or raw.get("model") or "").strip()
    if not mid:
        return None
    base = dict(EXAMPLE_RATES.get(pid) or {"inn": 0.0, "out": 0.0, "ctx": 128000, "div": 4.0})
    try:
        inn = float(raw.get("inn", raw.get("input", base["inn"])))
        out = float(raw.get("out", raw.get("output", base["out"])))
        ctx = int(raw.get("ctx", raw.get("context", base["ctx"])) or base["ctx"])
        div = float(raw.get("div", base.get("div") or 4.0)) or 4.0
    except (TypeError, ValueError):
        inn, out, ctx, div = base["inn"], base["out"], int(base["ctx"]), float(base.get("div") or 4)
    if inn < 0 or out < 0 or ctx < 1 or ctx > 10_000_000:
        return None
    enabled = True if raw.get("enabled") is None else bool(raw.get("enabled"))
    note = str(raw.get("note") or "").strip()[:200]
    row = {
        "id": mid[:160],
        "inn": inn,
        "out": out,
        "ctx": ctx,
        "div": div,
        "exact": bool(raw.get("exact", base.get("exact", False))),
        "enabled": enabled,
        "star": bool(raw.get("star") or raw.get("default")),
        "local": bool(raw.get("local", base.get("local", pid == "ollama"))),
    }
    if note:
        row["note"] = note
    row["default"] = row["star"]
    return row


def _configured_model(pid: str) -> str:
    """Read the already-configured model id through settings_store (no direct .env I/O)."""
    try:
        from . import settings_store
        key = ENV_KEYS.get(pid)
        if not key:
            return ""
        for f in settings_store.get_settings():
            if f.get("key") == key and not f.get("secret"):
                return str(f.get("value") or "").strip()
    except Exception:
        pass
    if pid == "ollama":
        return "gemma3:4b"
    return ""


def _ollama_ctx() -> int:
    try:
        from . import settings_store
        for f in settings_store.get_settings():
            if f.get("key") == "OLLAMA_NUM_CTX" and f.get("value"):
                n = int(str(f.get("value")).strip())
                if 256 <= n <= 1_000_000:
                    return n
    except Exception:
        pass
    return 8192


def _seed_provider(pid: str) -> List[Dict[str, Any]]:
    configured = _configured_model(pid)
    rows: List[Dict[str, Any]] = []
    seen = set()
    if configured:
        base = dict(EXAMPLE_RATES.get(pid) or {})
        if pid == "ollama":
            base["ctx"] = _ollama_ctx()
        extra_hit = next((e for e in (EXTRA_MODELS.get(pid) or []) if e.get("id") == configured), None)
        if extra_hit:
            for k in ("inn", "out", "ctx", "div", "note"):
                if k in extra_hit:
                    base[k] = extra_hit[k]
        row = _norm_row({"id": configured, "star": True, "enabled": True, **base}, pid)
        if row:
            rows.append(row)
            seen.add(row["id"])
    for extra in EXTRA_MODELS.get(pid) or []:
        if extra.get("id") in seen:
            # already the configured model — keep star on that row, copy rates if richer
            continue
        row = _norm_row(extra, pid)
        if row:
            if not configured and not any(r["star"] for r in rows):
                row["star"] = True
            rows.append(row)
            seen.add(row["id"])
    if rows and not any(r["star"] for r in rows):
        rows[0]["star"] = True
    return rows


def default_registry() -> Dict[str, Any]:
    return {
        "providers": [
            {"id": pid, "name": PROVIDER_NAMES[pid], "models": _seed_provider(pid)}
            for pid in PROVIDER_IDS
        ]
    }


def _load_raw() -> Any:
    from . import settings_store
    return settings_store._app().get("token_models")



def _seed_ids(pid: str) -> List[str]:
    return [str(e.get("id") or "").strip() for e in (EXTRA_MODELS.get(pid) or []) if str(e.get("id") or "").strip()]


def _removed_ids(p: Any) -> List[str]:
    if not isinstance(p, dict):
        return []
    raw = p.get("removed") or p.get("removed_models") or []
    if not isinstance(raw, list):
        return []
    out, seen = [], set()
    for x in raw:
        sid = str(x or "").strip()
        if sid and sid not in seen:
            out.append(sid)
            seen.add(sid)
    return out


def _catalog_touch_existing(row: Dict[str, Any], pid: str) -> bool:
    """Narrow catalog corrections on an untouched seed row. Never overwrites edited rates/ctx."""
    extra = next((e for e in (EXTRA_MODELS.get(pid) or []) if e.get("id") == row.get("id")), None)
    if not extra:
        return False
    changed = False
    # Previous NVIDIA Super seed used 131072; bump only if prices and ctx still look like that seed.
    if (row.get("id") == "nvidia/nemotron-3.5-super-vl-120b-a12b"
            and float(row.get("inn") or 0) == 0 and float(row.get("out") or 0) == 0
            and int(row.get("ctx") or 0) == 131072 and int(extra.get("ctx") or 0) == 262144):
        row["ctx"] = 262144
        changed = True
    if not row.get("note") and extra.get("note") and float(row.get("inn") or 0) == 0 and float(row.get("out") or 0) == 0:
        row["note"] = str(extra.get("note")).strip()[:200]
        changed = True
    return changed


def _merge_missing_seeds(pid: str, models: List[Dict[str, Any]], removed: List[str]) -> bool:
    """Append catalog seed rows that are not present and not in the user's removed list.

    Existing rows (rates, star, enabled, custom ctx) are left as-is except the narrow
    catalog touch in _catalog_touch_existing. Newly merged rows are never starred if a
    default already exists.
    """
    changed = False
    seen = {m["id"] for m in models}
    blocked = set(removed)
    has_star = any(m.get("star") and m.get("enabled") for m in models)
    for m in models:
        if _catalog_touch_existing(m, pid):
            changed = True
    for extra in EXTRA_MODELS.get(pid) or []:
        row = _norm_row(extra, pid)
        if not row or row["id"] in seen or row["id"] in blocked:
            continue
        if has_star:
            row["star"] = False
        models.append(row)
        seen.add(row["id"])
        changed = True
    return changed


def get_registry(*, persist_seed: bool = False) -> Dict[str, Any]:
    raw = _load_raw()
    if not raw or not isinstance(raw, dict) or not raw.get("providers"):
        seeded = default_registry()
        if persist_seed:
            try:
                from .db import update_app_settings
                update_app_settings({"token_models": seeded})
            except Exception:
                pass
        return seeded
    out = []
    seen_p = set()
    changed = False
    for p in raw.get("providers") or []:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id") or "").strip().lower()
        if pid not in PROVIDER_IDS or pid in seen_p:
            continue
        seen_p.add(pid)
        models = []
        seen_m = set()
        for m in p.get("models") or []:
            row = _norm_row(m, pid)
            if row and row["id"] not in seen_m:
                models.append(row)
                seen_m.add(row["id"])
        removed = [r for r in _removed_ids(p) if r not in seen_m]
        merged = _merge_missing_seeds(pid, models, removed)
        if models and not any(m["star"] and m["enabled"] for m in models):
            for m in models:
                if m["enabled"]:
                    m["star"] = True
                    break
            else:
                models[0]["star"] = True
        # one star per provider
        starred = False
        for m in models:
            if m["star"] and m["enabled"] and not starred:
                starred = True
            elif m["star"] and starred:
                m["star"] = False
        rec = {"id": pid, "name": PROVIDER_NAMES[pid], "models": models}
        if removed:
            rec["removed"] = removed
        out.append(rec)
        if merged:
            changed = True
    for pid in PROVIDER_IDS:
        if pid not in seen_p:
            out.append({"id": pid, "name": PROVIDER_NAMES[pid], "models": _seed_provider(pid)})
            changed = True
    result = {"providers": out}
    if persist_seed and changed:
        try:
            from .db import update_app_settings
            update_app_settings({"token_models": result})
        except Exception:
            pass
    return result


def set_registry(data) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError("Model registry must be an object.")
    src = data.get("providers") or data.get("token_models") or data
    if isinstance(src, dict) and "providers" in src:
        src = src["providers"]
    if not isinstance(src, list):
        raise ValueError("Model registry must include a providers list.")
    wrapped = {"providers": src}
    # validate via get path
    # normalize with a temporary shape
    raw_models = []
    seen_p = set()
    prev_raw = _load_raw()
    prev_providers = (prev_raw.get("providers") if isinstance(prev_raw, dict) else None) or []
    for p in src:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id") or "").strip().lower()
        if pid not in PROVIDER_IDS or pid in seen_p:
            continue
        seen_p.add(pid)
        models = []
        seen_m = set()
        for m in p.get("models") or []:
            row = _norm_row(m, pid)
            if row and row["id"] not in seen_m:
                models.append(row)
                seen_m.add(row["id"])
        if len(models) > 40:
            raise ValueError(f"{PROVIDER_NAMES[pid]} can have at most 40 models.")
        if models and not any(m["star"] and m["enabled"] for m in models):
            for m in models:
                if m["enabled"]:
                    m["star"] = True
                    break
        starred = False
        for m in models:
            if m["star"] and m["enabled"] and not starred:
                starred = True
            elif m["star"] and starred:
                m["star"] = False
        # Track seed IDs the user removed (were in the saved registry, not in this payload).
        # Missing seeds that were never saved are not treated as deletions (they still merge on read).
        prev_p = next((x for x in (prev_providers or []) if isinstance(x, dict) and str(x.get("id") or "").strip().lower() == pid), None)
        prev_ids = set()
        if prev_p:
            for m in prev_p.get("models") or []:
                mid = str((m or {}).get("id") or (m or {}).get("model") or "").strip()
                if mid:
                    prev_ids.add(mid)
        removed = set(_removed_ids(p) or _removed_ids(prev_p or {}))
        for sid in _seed_ids(pid):
            if sid in prev_ids and sid not in seen_m:
                removed.add(sid)
        removed = [x for x in removed if x not in seen_m]
        rec = {"id": pid, "name": PROVIDER_NAMES[pid], "models": models}
        if removed:
            rec["removed"] = removed
        raw_models.append(rec)
    for pid in PROVIDER_IDS:
        if pid not in seen_p:
            raw_models.append({"id": pid, "name": PROVIDER_NAMES[pid], "models": []})
    out = {"providers": raw_models}
    from .db import update_app_settings
    update_app_settings({"token_models": out})
    return out


def find_model(provider: str, model_id: str = "") -> Optional[Dict[str, Any]]:
    pid = str(provider or "").strip().lower()
    mid = str(model_id or "").strip()
    reg = get_registry()
    p = next((x for x in reg["providers"] if x["id"] == pid), None)
    if not p:
        return None
    models = p.get("models") or []
    if mid:
        hit = next((m for m in models if m["id"] == mid), None)
        if hit:
            return {**hit, "provider": pid}
    hit = next((m for m in models if m.get("star") and m.get("enabled")), None)
    if hit:
        return {**hit, "provider": pid}
    hit = next((m for m in models if m.get("enabled")), None)
    if hit:
        return {**hit, "provider": pid}
    return None


def resolved_model_id(provider: str, model_id: str = "") -> str:
    """Registry default, else the configured Settings / env model (fallback)."""
    mid = str(model_id or "").strip()
    if mid:
        return mid
    m = find_model(provider, "")
    if m and m.get("id"):
        return m["id"]
    return _configured_model(str(provider or "").strip().lower())


def enabled_models(provider: str) -> List[Dict[str, Any]]:
    pid = str(provider or "").strip().lower()
    reg = get_registry()
    p = next((x for x in reg["providers"] if x["id"] == pid), None)
    if not p:
        return []
    return [m for m in (p.get("models") or []) if m.get("enabled")]


def get_calc_prefs() -> Dict[str, Any]:
    from . import settings_store
    raw = settings_store._app().get("token_calc") or {}
    if not isinstance(raw, dict):
        raw = {}
    return {
        "tiktoken": True if raw.get("tiktoken") is None else bool(raw.get("tiktoken")),
        "provider_count_api": bool(raw.get("provider_count_api")),
    }


def set_calc_prefs(data) -> Dict[str, Any]:
    data = data or {}
    cur = get_calc_prefs()
    if "tiktoken" in data:
        cur["tiktoken"] = bool(data.get("tiktoken"))
    if "provider_count_api" in data:
        cur["provider_count_api"] = bool(data.get("provider_count_api"))
    from .db import update_app_settings
    update_app_settings({"token_calc": cur})
    return cur


def get_limits() -> Dict[str, Dict[str, Any]]:
    from . import settings_store
    raw = settings_store._app().get("token_provider_limits") or {}
    if not isinstance(raw, dict):
        raw = {}
    out = {}
    for pid in PROVIDER_IDS:
        item = raw.get(pid) or {}
        if not isinstance(item, dict):
            item = {}
        tok = item.get("daily_tokens")
        cost = item.get("daily_cost")
        try:
            tok = int(tok) if tok not in (None, "", 0, "0") else None
        except (TypeError, ValueError):
            tok = None
        try:
            cost = float(cost) if cost not in (None, "") else None
        except (TypeError, ValueError):
            cost = None
        if tok is not None and tok < 1:
            tok = None
        if cost is not None and cost < 0:
            cost = None
        out[pid] = {"daily_tokens": tok, "daily_cost": cost}
    return out


def set_limits(data) -> Dict[str, Dict[str, Any]]:
    if not isinstance(data, dict):
        raise ValueError("Daily limits must be an object keyed by provider.")
    # allow {limits: {...}} or flat
    if "limits" in data and isinstance(data["limits"], dict):
        data = data["limits"]
    clean = {}
    for pid in PROVIDER_IDS:
        item = data.get(pid) or {}
        if not isinstance(item, dict):
            continue
        tok, cost = item.get("daily_tokens"), item.get("daily_cost")
        def _tok(v):
            if v in (None, "", "optional"):
                return None
            n = int(str(v).strip())
            if n < 1 or n > 1e12:
                raise ValueError(f"{PROVIDER_NAMES[pid]} daily token limit must be a whole number ≥ 1, or blank.")
            return n
        def _cost(v):
            if v in (None, "", "optional"):
                return None
            n = float(str(v).strip())
            if n < 0 or n > 1e9:
                raise ValueError(f"{PROVIDER_NAMES[pid]} daily cost limit must be ≥ 0, or blank.")
            return n
        try:
            t = _tok(tok) if "daily_tokens" in item else get_limits()[pid]["daily_tokens"]
            c = _cost(cost) if "daily_cost" in item else get_limits()[pid]["daily_cost"]
        except ValueError:
            raise
        except Exception:
            raise ValueError(f"Invalid daily limits for {PROVIDER_NAMES[pid]}.")
        clean[pid] = {"daily_tokens": t, "daily_cost": c}
    from .db import update_app_settings
    update_app_settings({"token_provider_limits": clean})
    return get_limits()


def cost_for(tokens_in: int, tokens_out: int, provider: str, model_id: str = "") -> Dict[str, Any]:
    """Return cost and rate_source (model | legacy_global)."""
    m = find_model(provider, model_id)
    if m and (m.get("id") == (model_id or m.get("id"))):
        c = (tokens_in / 1e6) * float(m.get("inn") or 0) + (tokens_out / 1e6) * float(m.get("out") or 0)
        return {"cost": c, "rate_source": "model", "inn": m.get("inn") or 0, "out": m.get("out") or 0,
                "ctx": m.get("ctx") or 0, "model": m.get("id")}
    from . import token_usage
    st = token_usage.get_settings()
    c = (tokens_in / 1e6) * st["token_rate_input"] + (tokens_out / 1e6) * st["token_rate_output"]
    return {"cost": c, "rate_source": "legacy_global", "inn": st["token_rate_input"],
            "out": st["token_rate_output"], "ctx": 0, "model": model_id or ""}
