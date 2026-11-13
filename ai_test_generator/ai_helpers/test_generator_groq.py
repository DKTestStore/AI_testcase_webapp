"""Groq test-case helper — OpenAI-compatible Chat Completions API at https://api.groq.com/openai/v1.

Mirrors test_generator_grok.py. Differences:
- Groq exposes the Chat Completions API (not the Responses API), so this uses
  client.chat.completions.create().
- GROQ_MODEL falls back to a sensible default when blank.
- Rate limits (HTTP 429) are retried up to 2 times, honouring the retry-after
  header; after that a ProviderError with status=429 is raised so the web UI
  shows a clear "rate limited" message.
"""
from __future__ import annotations

import os
import time
from typing import Any, Dict, Optional, Tuple

from dotenv import load_dotenv
from openai import OpenAI

try:  # openai>=1.0 exposes RateLimitError at top level
    from openai import RateLimitError
except Exception:  # pragma: no cover - very old SDKs
    RateLimitError = None  # type: ignore

load_dotenv()

GROQ_BASE = "https://api.groq.com/openai/v1"
DEFAULT_MODEL = "llama-3.3-70b-versatile"
DEFAULT_MAX_TOKENS = 8192
MAX_RETRIES = 2          # extra attempts after the first call, on HTTP 429 only
MAX_RETRY_WAIT = 30.0    # never sleep longer than this per retry (seconds)


class ProviderError(Exception):
    """Raised with a clear message for the web UI (never swallowed).

    ``status`` lets backend/services.py map the error to an HTTP status (e.g. 429).
    """

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


def _key() -> str:
    return (os.getenv("GROQ_API_KEY") or "").strip()


def _model() -> str:
    return (os.getenv("GROQ_MODEL") or "").strip().strip("\"'") or DEFAULT_MODEL


def _timeout() -> float:
    try:
        return float(os.getenv("GROQ_TIMEOUT") or 120)
    except ValueError:
        return 120.0


def _max_tokens() -> int:
    try:
        return max(256, int(os.getenv("GROQ_MAX_TOKENS") or DEFAULT_MAX_TOKENS))
    except ValueError:
        return DEFAULT_MAX_TOKENS


def _client() -> OpenAI:
    key = _key()
    if not key:
        raise ProviderError("GROQ_API_KEY is not set. Add it in Settings.")
    # max_retries=0: 429 retries are handled explicitly below (max 2, retry-after aware)
    return OpenAI(api_key=key, base_url=GROQ_BASE, timeout=_timeout(), max_retries=0)


def _is_rate_limit(ex: Exception) -> bool:
    if RateLimitError is not None and isinstance(ex, RateLimitError):
        return True
    return getattr(ex, "status_code", None) == 429


def _retry_after(ex: Exception, attempt: int) -> float:
    """Seconds to wait before the next attempt: retry-after header, else 2s, 4s."""
    wait = None
    resp = getattr(ex, "response", None)
    headers = getattr(resp, "headers", None) or {}
    try:
        raw = headers.get("retry-after") or headers.get("Retry-After")
        if raw is not None:
            wait = float(raw)
    except (TypeError, ValueError, AttributeError):
        wait = None
    if wait is None or wait < 0:
        wait = 2.0 * (2 ** attempt)
    return min(wait, MAX_RETRY_WAIT)


def _usage_from(resp) -> Dict[str, Any]:
    u = getattr(resp, "usage", None)
    inp = int(getattr(u, "prompt_tokens", 0) or getattr(u, "input_tokens", 0) or 0) if u else 0
    out = int(getattr(u, "completion_tokens", 0) or getattr(u, "output_tokens", 0) or 0) if u else 0
    tot = int(getattr(u, "total_tokens", 0) or 0) if u else (inp + out)
    return {"input_tokens": inp, "output_tokens": out, "total_tokens": tot or (inp + out)}


def _text_from(resp) -> str:
    try:
        choices = getattr(resp, "choices", None) or []
        if not choices:
            return ""
        msg = getattr(choices[0], "message", None)
        return (getattr(msg, "content", None) or "").strip()
    except Exception:
        return ""


def complete(system_prompt: str, user_content: str, *, temperature: float = 0.2,
             max_output_tokens: Optional[int] = None,
             _sleep=time.sleep) -> Tuple[str, Dict[str, Any]]:
    model = _model()
    print(f"Generating with Groq (model={model}, host={GROQ_BASE})... please wait.\n")
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_content})
    kwargs: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": int(max_output_tokens) if max_output_tokens else _max_tokens(),
    }
    client = _client()   # raises ProviderError if the key is missing
    resp = None
    attempt = 0
    while True:
        try:
            resp = client.chat.completions.create(**kwargs)
            break
        except Exception as ex:
            if _is_rate_limit(ex):
                if attempt < MAX_RETRIES:
                    wait = _retry_after(ex, attempt)
                    print(f"Groq rate limit hit (model '{model}'); retrying in {wait:.1f}s "
                          f"({attempt + 1}/{MAX_RETRIES})...\n")
                    _sleep(wait)
                    attempt += 1
                    continue
                raise ProviderError(
                    f"Groq rate limit reached (model '{model}') after {MAX_RETRIES} retries. "
                    f"Free-tier limits are per minute and per day — wait a moment and try again. ({ex})",
                    status=429) from ex
            raise ProviderError(f"Groq API error (model '{model}'): {type(ex).__name__}: {ex}") from ex
    text = _text_from(resp)
    if not text:
        raise ProviderError(f"Groq returned an empty response (model '{model}').")
    usage = _usage_from(resp)
    usage.update({"model": "groq", "model_name": model, "provider": "groq"})
    print(f"Groq tokens — in={usage['input_tokens']} out={usage['output_tokens']} total={usage['total_tokens']}\n")
    return text, usage


def generate_test_cases(target_code_or_feature, test_case_generation_prompt):
    text, _ = complete(test_case_generation_prompt, target_code_or_feature, temperature=0.2)
    return text


def review_test_cases(test_cases, reviewer_prompt):
    text, _ = complete(reviewer_prompt, test_cases, temperature=0.0)
    return text
