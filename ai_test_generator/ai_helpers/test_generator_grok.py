"""Grok (xAI) test-case helper — OpenAI-compatible Responses API at https://api.x.ai/v1."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

XAI_BASE = "https://api.x.ai/v1"


class ProviderError(Exception):
    """Raised with a clear message for the web UI (never swallowed)."""


def _key() -> str:
    return (os.getenv("GROK_API_KEY") or os.getenv("XAI_API_KEY") or "").strip()


def _model() -> str:
    return (os.getenv("GROK_MODEL") or "").strip().strip("\"'")


def _timeout() -> float:
    try:
        return float(os.getenv("GROK_TIMEOUT") or 120)
    except ValueError:
        return 120.0


def _client() -> OpenAI:
    key = _key()
    if not key:
        raise ProviderError("GROK_API_KEY is not set. Add it in Settings.")
    return OpenAI(api_key=key, base_url=XAI_BASE, timeout=_timeout())


def _usage_from(resp) -> Dict[str, Any]:
    u = getattr(resp, "usage", None)
    inp = int(getattr(u, "input_tokens", 0) or 0) if u else 0
    out = int(getattr(u, "output_tokens", 0) or 0) if u else 0
    tot = int(getattr(u, "total_tokens", 0) or 0) if u else (inp + out)
    return {"input_tokens": inp, "output_tokens": out, "total_tokens": tot or (inp + out)}


def complete(system_prompt: str, user_content: str, *, temperature: float = 0.2,
             max_output_tokens: Optional[int] = None, model_name: Optional[str] = None) -> Tuple[str, Dict[str, Any]]:
    model = (model_name or "").strip() or _model()
    if not model:
        raise ProviderError("GROK_MODEL is not set. Enter a model ID in Settings (from your xAI console).")
    print(f"Generating with Grok (model={model}, host={XAI_BASE})... please wait.\n")
    kwargs: Dict[str, Any] = {
        "model": model,
        "instructions": system_prompt or None,
        "input": user_content,
        "temperature": temperature,
    }
    if max_output_tokens:
        kwargs["max_output_tokens"] = int(max_output_tokens)
    try:
        client = _client()
        resp = client.responses.create(**{k: v for k, v in kwargs.items() if v is not None})
    except ProviderError:
        raise
    except Exception as ex:
        raise ProviderError(f"Grok API error (model '{model}'): {type(ex).__name__}: {ex}") from ex
    text = (getattr(resp, "output_text", None) or "").strip()
    if not text:
        raise ProviderError(f"Grok returned an empty response (model '{model}').")
    usage = _usage_from(resp)
    usage.update({"model": "grok", "model_name": model, "provider": "grok"})
    print(f"Grok tokens — in={usage['input_tokens']} out={usage['output_tokens']} total={usage['total_tokens']}\n")
    return text, usage


def generate_test_cases(target_code_or_feature, test_case_generation_prompt):
    text, _ = complete(test_case_generation_prompt, target_code_or_feature, temperature=0.2)
    return text


def review_test_cases(test_cases, reviewer_prompt):
    text, _ = complete(reviewer_prompt, test_cases, temperature=0.0)
    return text
