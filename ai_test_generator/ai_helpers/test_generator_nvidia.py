"""NVIDIA API Catalog / NIM test-case helper — OpenAI-compatible Chat Completions API.

Default host: https://integrate.api.nvidia.com/v1
Uses the existing `openai` package (same approach as Groq). No new dependency.
Non-streaming. Reasoning / thinking tokens are discarded; only message.content is used.
"""
from __future__ import annotations

import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
from openai import OpenAI

try:
    from openai import RateLimitError
except Exception:  # pragma: no cover - very old SDKs
    RateLimitError = None  # type: ignore

load_dotenv()

DEFAULT_BASE = "https://integrate.api.nvidia.com/v1"
DEFAULT_MODEL = "nvidia/nemotron-3.5-super-vl-120b-a12b"
DEFAULT_MAX_TOKENS = 16384
DEFAULT_TOP_P = 0.95
DEFAULT_TIMEOUT = 120.0
MAX_RETRIES = 2
MAX_RETRY_WAIT = 30.0


class ProviderError(Exception):
    """Raised with a clear message for the web UI (never swallowed).

    ``status`` lets backend/services.py map the error to an HTTP status (e.g. 429).
    """

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


def _key() -> str:
    return (os.getenv("NVIDIA_API_KEY") or "").strip()


def _model() -> str:
    return (os.getenv("NVIDIA_MODEL") or "").strip().strip("\"'") or DEFAULT_MODEL


def _base_url() -> str:
    raw = (os.getenv("NVIDIA_BASE_URL") or "").strip().strip("\"'") or DEFAULT_BASE
    return raw.rstrip("/") or DEFAULT_BASE


def _timeout() -> float:
    try:
        return float(os.getenv("NVIDIA_TIMEOUT") or DEFAULT_TIMEOUT)
    except ValueError:
        return DEFAULT_TIMEOUT


def _max_tokens() -> int:
    try:
        return max(256, int(os.getenv("NVIDIA_MAX_TOKENS") or DEFAULT_MAX_TOKENS))
    except ValueError:
        return DEFAULT_MAX_TOKENS


def _top_p() -> float:
    raw = (os.getenv("NVIDIA_TOP_P") or "").strip()
    if not raw:
        return DEFAULT_TOP_P
    try:
        v = float(raw)
    except ValueError:
        return DEFAULT_TOP_P
    return min(1.0, max(0.0, v))


def _settings_temperature() -> Optional[float]:
    """Optional Connection override. Blank = honour the caller (0.2 generate / 0.0 review)."""
    raw = (os.getenv("NVIDIA_TEMPERATURE") or "").strip()
    if not raw:
        return None
    try:
        return min(2.0, max(0.0, float(raw)))
    except ValueError:
        return None


def _thinking() -> bool:
    v = (os.getenv("NVIDIA_ENABLE_THINKING") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _client() -> OpenAI:
    key = _key()
    if not key:
        raise ProviderError("NVIDIA_API_KEY is not set. Add it in Settings.")
    return OpenAI(api_key=key, base_url=_base_url(), timeout=_timeout(), max_retries=0)


def _is_rate_limit(ex: Exception) -> bool:
    if RateLimitError is not None and isinstance(ex, RateLimitError):
        return True
    return getattr(ex, "status_code", None) == 429


def _retry_after(ex: Exception, attempt: int) -> float:
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


def _content_text(msg) -> str:
    """Use only message.content. Ignore reasoning_content / thinking traces."""
    if msg is None:
        return ""
    raw = getattr(msg, "content", None)
    if raw is None and isinstance(msg, dict):
        raw = msg.get("content")
    if isinstance(raw, list):
        parts = []
        for p in raw:
            if isinstance(p, str):
                parts.append(p)
            elif isinstance(p, dict) and p.get("type") in ("text", "output_text"):
                parts.append(str(p.get("text") or ""))
            else:
                text = getattr(p, "text", None)
                if text:
                    parts.append(str(text))
        raw = "".join(parts)
    text = (raw or "").strip() if isinstance(raw, str) else ""
    if text:
        text = re.sub(r"<think\b[^>]*>.*?</think>", "", text, flags=re.IGNORECASE | re.DOTALL).strip()
    return text


def _text_from(resp) -> str:
    try:
        choices = getattr(resp, "choices", None) or []
        if not choices:
            return ""
        return _content_text(getattr(choices[0], "message", None))
    except Exception:
        return ""


def complete(system_prompt: str, user_content: str, *, temperature: float = 0.2,
             max_output_tokens: Optional[int] = None, model_name: Optional[str] = None,
             images: Optional[List[Dict[str, Any]]] = None,
             _sleep=time.sleep) -> Tuple[str, Dict[str, Any]]:
    model = (model_name or "").strip() or _model()
    base = _base_url()
    print(f"Generating with NVIDIA (model={model}, host={base})... please wait.\n")
    from .vision_content import openai_chat_user_content
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": openai_chat_user_content(user_content, images)})
    temp = _settings_temperature()
    if temp is None:
        temp = temperature
    kwargs: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temp,
        "top_p": _top_p(),
        "max_tokens": int(max_output_tokens) if max_output_tokens else _max_tokens(),
    }
    if _thinking():
        kwargs["extra_body"] = {"chat_template_kwargs": {"enable_thinking": True}}
    client = _client()
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
                    print(f"NVIDIA rate limit hit (model '{model}'); retrying in {wait:.1f}s "
                          f"({attempt + 1}/{MAX_RETRIES})...\n")
                    _sleep(wait)
                    attempt += 1
                    continue
                raise ProviderError(
                    f"NVIDIA rate limit reached (model '{model}') after {MAX_RETRIES} retries. "
                    f"Wait a moment and try again. ({ex})",
                    status=429) from ex
            raise ProviderError(f"NVIDIA API error (model '{model}'): {type(ex).__name__}: {ex}") from ex
    text = _text_from(resp)
    if not text:
        raise ProviderError(
            f"NVIDIA returned an empty response (model '{model}'). "
            "If Enable thinking is on, turn it off and retry — the app uses only the final message content.")
    usage = _usage_from(resp)
    usage.update({"model": "nvidia", "model_name": model, "provider": "nvidia"})
    print(f"NVIDIA tokens — in={usage['input_tokens']} out={usage['output_tokens']} total={usage['total_tokens']}\n")
    return text, usage


def generate_test_cases(target_code_or_feature, test_case_generation_prompt):
    text, _ = complete(test_case_generation_prompt, target_code_or_feature, temperature=0.2)
    return text


def review_test_cases(test_cases, reviewer_prompt):
    text, _ = complete(reviewer_prompt, test_cases, temperature=0.0)
    return text
