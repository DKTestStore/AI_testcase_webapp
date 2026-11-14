"""Token counting and pre-call estimates.

Default method is characters ÷ 4 (or the model's `div`). tiktoken is optional and
used only when the package is already installed and the calculator pref is on
(OpenAI / Codex models). Provider count APIs (Gemini countTokens, Anthropic
count_tokens) are opt-in and off by default because they make a real API call.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from . import token_registry as reg

log = logging.getLogger("atg.tokens")


def _tiktoken_count(text: str, model_id: str) -> Optional[int]:
    try:
        import tiktoken  # optional — not a required dependency
    except Exception:
        return None
    try:
        try:
            enc = tiktoken.encoding_for_model(model_id)
        except Exception:
            enc = tiktoken.get_encoding("o200k_base")
        return len(enc.encode(text or ""))
    except Exception:
        log.debug("tiktoken count failed for %s", model_id, exc_info=True)
        return None


def count_text(text: str, provider: str = "", model_id: str = "") -> Dict[str, Any]:
    text = text or ""
    chars = len(text)
    words = len(text.split()) if text.strip() else 0
    prefs = reg.get_calc_prefs()
    mid = reg.resolved_model_id(provider, model_id)
    m = reg.find_model(provider, mid)
    method = "estimate"
    exact = False
    tokens = max(0, round(chars / float((m or {}).get("div") or 4.0)))
    pid = str(provider or "").strip().lower()
    if prefs.get("tiktoken") and pid in ("openai", "codex"):
        n = _tiktoken_count(text, mid or (m or {}).get("id") or "gpt-4o-mini")
        if n is not None:
            tokens, method, exact = n, "tiktoken", True
    # Provider count APIs are opt-in (off by default) and may use quota. We only
    # attempt them when enabled; failures fall back to the estimate above.
    if prefs.get("provider_count_api") and not exact:
        n = _provider_count(text, pid, mid)
        if n is not None:
            tokens, method, exact = n, "provider_api", True
    return {
        "tokens": int(tokens),
        "chars": chars,
        "words": words,
        "method": method,
        "exact": exact,
        "provider": pid,
        "model": mid or (m or {}).get("id") or "",
        "ctx": int((m or {}).get("ctx") or 0),
        "div": float((m or {}).get("div") or 4.0),
    }


def _provider_count(text: str, provider: str, model_id: str) -> Optional[int]:
    """Best-effort provider count; never raises. Off unless the pref is on."""
    try:
        if provider == "gemini" and model_id:
            # Lazy import — do not fail if the Gemini client is not configured.
            from .config import env
            # We do not invent a live call path that requires keys in unit tests.
            # If google-genai is present and a client can be built, try count_tokens.
            try:
                from ai_test_generator.ai_helpers import test_generator as g
                client = getattr(g, "client", None)
                if client and getattr(client, "models", None):
                    fn = getattr(client.models, "count_tokens", None)
                    if callable(fn):
                        r = fn(model=model_id or env("GEMINI_MODEL"), contents=text)
                        n = getattr(r, "total_tokens", None)
                        if n is None:
                            n = getattr(r, "total_token_count", None)
                        if n is not None:
                            return int(n)
            except Exception:
                log.debug("gemini count_tokens skipped", exc_info=True)
        if provider == "claude" and model_id:
            # Anthropic count_tokens is a live API call; skip unless a helper exists.
            return None
    except Exception:
        log.debug("provider count failed", exc_info=True)
    return None


def estimate(text: str, provider: str = "", model_id: str = "", expected_output: int = 800) -> Dict[str, Any]:
    c = count_text(text, provider, model_id)
    try:
        out_n = int(expected_output or 0)
    except (TypeError, ValueError):
        out_n = 800
    if out_n < 0:
        out_n = 0
    if out_n > 1_000_000:
        out_n = 1_000_000
    priced = reg.cost_for(c["tokens"], out_n, provider, c["model"])
    used = c["tokens"] + out_n
    ctx = c.get("ctx") or 0
    pct = (used / ctx * 100) if ctx else 0
    fits = (used <= ctx) if ctx else True
    return {
        **c,
        "est_input": c["tokens"],
        "est_output": out_n,
        "est_cost": round(priced["cost"], 6),
        "rate_source": priced["rate_source"],
        "inn": priced["inn"],
        "out": priced["out"],
        "fit_pct": round(pct, 1),
        "fits": fits,
        "example_prices": priced["rate_source"] == "model",
    }


def estimate_from_payload(data: Dict[str, Any], run: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    data = data or {}
    run = run or {}
    text = data.get("text")
    if text is None:
        feat = str(run.get("feature_text") or data.get("feature_text") or "")
        prompt = str(data.get("prompt") or "")
        extra = str(data.get("extra") or "")
        text = "\n\n".join(x for x in (feat, prompt, extra) if x)
    provider = str(data.get("provider") or data.get("model") or run.get("model") or "").strip()
    mid = str(data.get("model_name") or data.get("model_id") or run.get("model_name") or "").strip()
    expected = data.get("expected_output", 800)
    return estimate(str(text), provider, mid, expected)
