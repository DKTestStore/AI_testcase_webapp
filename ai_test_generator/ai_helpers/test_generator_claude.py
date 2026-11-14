"""Claude (Anthropic) test-case helper — Messages API via requests (no extra package)."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple

import requests
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


class ProviderError(Exception):
    """Raised with a clear message for the web UI (never swallowed)."""


def _key() -> str:
    return (os.getenv("ANTHROPIC_API_KEY") or "").strip()


def _model() -> str:
    return (os.getenv("CLAUDE_MODEL") or "").strip().strip("\"'")


def _timeout() -> float:
    try:
        return float(os.getenv("CLAUDE_TIMEOUT") or 120)
    except ValueError:
        return 120.0


def _max_tokens() -> int:
    try:
        return max(256, int(os.getenv("CLAUDE_MAX_TOKENS") or 8192))
    except ValueError:
        return 8192


def complete(system_prompt: str, user_content: str, *, temperature: float = 0.2,
             max_output_tokens: Optional[int] = None, model_name: Optional[str] = None) -> Tuple[str, Dict[str, Any]]:
    key = _key()
    model = (model_name or "").strip() or _model()
    if not key:
        raise ProviderError("ANTHROPIC_API_KEY is not set. Add it in Settings.")
    if not model:
        raise ProviderError("CLAUDE_MODEL is not set. Enter a model ID in Settings (from Anthropic).")
    max_tok = int(max_output_tokens) if max_output_tokens else _max_tokens()
    print(f"Generating with Claude (model={model})... please wait.\n")
    headers = {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    body: Dict[str, Any] = {
        "model": model,
        "max_tokens": max_tok,
        "temperature": temperature,
        "messages": [{"role": "user", "content": user_content}],
    }
    if system_prompt:
        body["system"] = system_prompt
    try:
        r = requests.post(ANTHROPIC_URL, headers=headers, json=body, timeout=_timeout())
    except requests.Timeout as ex:
        raise ProviderError(f"Claude timed out after {_timeout():.0f}s (model '{model}'). "
                            "Increase CLAUDE_TIMEOUT in Settings.") from ex
    except Exception as ex:
        raise ProviderError(f"Claude request failed: {type(ex).__name__}: {ex}") from ex
    if r.status_code >= 400:
        detail = (r.text or "")[:500]
        raise ProviderError(f"Claude API error HTTP {r.status_code} (model '{model}'): {detail}")
    try:
        data = r.json()
    except Exception as ex:
        raise ProviderError(f"Claude returned non-JSON: {ex}") from ex
    parts = []
    for block in data.get("content") or []:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text") or "")
    text = "\n".join(parts).strip()
    if not text:
        raise ProviderError(f"Claude returned an empty response (model '{model}', stop={data.get('stop_reason')}).")
    usage_raw = data.get("usage") or {}
    inp = int(usage_raw.get("input_tokens") or 0)
    out = int(usage_raw.get("output_tokens") or 0)
    usage = {"input_tokens": inp, "output_tokens": out, "total_tokens": inp + out,
             "model": "claude", "model_name": model, "provider": "claude"}
    print(f"Claude tokens — in={inp} out={out} total={inp + out}\n")
    return text, usage


def generate_test_cases(target_code_or_feature, test_case_generation_prompt):
    text, _ = complete(test_case_generation_prompt, target_code_or_feature, temperature=0.2)
    return text


def review_test_cases(test_cases, reviewer_prompt):
    text, _ = complete(reviewer_prompt, test_cases, temperature=0.0)
    return text
