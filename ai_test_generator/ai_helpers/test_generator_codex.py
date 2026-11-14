"""Codex (OpenAI family) helper — uses OPENAI_API_KEY; model from CODEX_MODEL / OPENAI_MODEL / legacy default."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

# Legacy module-level default kept for older imports that read MODEL.
MODEL = "gpt-5-mini"

client = None  # refreshed by services._codex_module when Settings change
_webapp_key = None


class ProviderError(Exception):
    """Raised with a clear message for the web UI (never swallowed)."""


def _key() -> str:
    return (os.getenv("OPENAI_API_KEY") or "").strip()


def resolve_model() -> str:
    """CODEX_MODEL → OPENAI_MODEL → legacy MODEL constant. Never invents a new id."""
    for k in ("CODEX_MODEL", "OPENAI_MODEL"):
        v = (os.getenv(k) or "").strip().strip("\"'")
        if v:
            return v
    return MODEL


def _timeout() -> float:
    try:
        return float(os.getenv("OPENAI_TIMEOUT") or os.getenv("CODEX_TIMEOUT") or 120)
    except ValueError:
        return 120.0


def _get_client() -> OpenAI:
    global client, _webapp_key
    key = _key()
    if not key:
        raise ProviderError("OPENAI_API_KEY is not set. Add it in Settings to use Codex (OpenAI).")
    if client is None or _webapp_key != key:
        client = OpenAI(api_key=key, timeout=_timeout())
        _webapp_key = key
    return client


def _usage_from(resp) -> Dict[str, Any]:
    u = getattr(resp, "usage", None)
    inp = int(getattr(u, "input_tokens", 0) or 0) if u else 0
    out = int(getattr(u, "output_tokens", 0) or 0) if u else 0
    tot = int(getattr(u, "total_tokens", 0) or 0) if u else (inp + out)
    return {"input_tokens": inp, "output_tokens": out, "total_tokens": tot or (inp + out)}


def complete(system_prompt: str, user_content: str, *, temperature: float = 0.2,
             max_output_tokens: Optional[int] = None, model_name: Optional[str] = None) -> Tuple[str, Dict[str, Any]]:
    model = (model_name or "").strip() or resolve_model()
    print(f"Generating with Codex/OpenAI (model={model})... please wait.\n")
    kwargs: Dict[str, Any] = {
        "model": model,
        "instructions": system_prompt or None,
        "input": user_content,
        "temperature": temperature,
    }
    if max_output_tokens:
        kwargs["max_output_tokens"] = int(max_output_tokens)
    try:
        c = _get_client()
        resp = c.responses.create(**{k: v for k, v in kwargs.items() if v is not None})
    except ProviderError:
        raise
    except Exception as ex:
        msg = str(ex).lower()
        if "temperature" in msg:
            try:
                kwargs.pop("temperature", None)
                c = _get_client()
                resp = c.responses.create(**{k: v for k, v in kwargs.items() if v is not None})
            except Exception as ex2:
                raise ProviderError(f"Codex/OpenAI API error (model '{model}'): {type(ex2).__name__}: {ex2}") from ex2
        else:
            raise ProviderError(f"Codex/OpenAI API error (model '{model}'): {type(ex).__name__}: {ex}") from ex
    text = (getattr(resp, "output_text", None) or "").strip()
    if not text:
        raise ProviderError(f"Codex/OpenAI returned an empty response (model '{model}').")
    usage = _usage_from(resp)
    usage.update({"model": "codex", "model_name": model, "provider": "codex"})
    print(f"Codex tokens — in={usage['input_tokens']} out={usage['output_tokens']} total={usage['total_tokens']}\n")
    return text, usage


def generate_test_cases(acceptance_criteria, test_case_generation_prompt, html_source=""):
    user_input = f"""
        Acceptance Criteria:
        {acceptance_criteria}
        HTML Page Source:
        {html_source}
        Please generate test cases based on the provided acceptance criteria and HTML page source.
        """
    text, _ = complete(test_case_generation_prompt, user_input, temperature=0.2)
    return text


def review_test_cases(test_cases, reviewer_prompt):
    text, _ = complete(reviewer_prompt, test_cases, temperature=0.0)
    return text
