"""OpenAI (chat / Responses API) test-case helper — separate from Codex profile."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()


class ProviderError(Exception):
    """Raised with a clear message for the web UI (never swallowed)."""


def _key() -> str:
    return (os.getenv("OPENAI_API_KEY") or "").strip()


def _model() -> str:
    return (os.getenv("OPENAI_MODEL") or "").strip().strip("\"'")


def _timeout() -> float:
    try:
        return float(os.getenv("OPENAI_TIMEOUT") or 120)
    except ValueError:
        return 120.0


def _client() -> OpenAI:
    key = _key()
    if not key:
        raise ProviderError("OPENAI_API_KEY is not set. Add it in Settings.")
    return OpenAI(api_key=key, timeout=_timeout())


def _usage_from(resp) -> Dict[str, Any]:
    u = getattr(resp, "usage", None)
    inp = int(getattr(u, "input_tokens", 0) or getattr(u, "prompt_tokens", 0) or 0) if u else 0
    out = int(getattr(u, "output_tokens", 0) or getattr(u, "completion_tokens", 0) or 0) if u else 0
    tot = int(getattr(u, "total_tokens", 0) or 0) if u else (inp + out)
    return {"input_tokens": inp, "output_tokens": out, "total_tokens": tot or (inp + out)}


def complete(system_prompt: str, user_content: str, *, temperature: float = 0.2,
             max_output_tokens: Optional[int] = None) -> Tuple[str, Dict[str, Any]]:
    model = _model()
    if not model:
        raise ProviderError("OPENAI_MODEL is not set. Enter a model ID in Settings.")
    print(f"Generating with OpenAI (model={model})... please wait.\n")
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
        # Some models reject temperature; retry once without it.
        msg = str(ex).lower()
        if "temperature" in msg:
            try:
                kwargs.pop("temperature", None)
                client = _client()
                resp = client.responses.create(**{k: v for k, v in kwargs.items() if v is not None})
            except Exception as ex2:
                raise ProviderError(f"OpenAI API error (model '{model}'): {type(ex2).__name__}: {ex2}") from ex2
        else:
            raise ProviderError(f"OpenAI API error (model '{model}'): {type(ex).__name__}: {ex}") from ex
    text = (getattr(resp, "output_text", None) or "").strip()
    if not text:
        raise ProviderError(f"OpenAI returned an empty response (model '{model}').")
    usage = _usage_from(resp)
    usage.update({"model": "openai", "model_name": model, "provider": "openai"})
    print(f"OpenAI tokens — in={usage['input_tokens']} out={usage['output_tokens']} total={usage['total_tokens']}\n")
    return text, usage


def generate_test_cases(target_code_or_feature, test_case_generation_prompt):
    text, _ = complete(test_case_generation_prompt, target_code_or_feature, temperature=0.2)
    return text


def review_test_cases(test_cases, reviewer_prompt):
    text, _ = complete(reviewer_prompt, test_cases, temperature=0.0)
    return text
