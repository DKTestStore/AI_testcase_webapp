"""One client for every model.

The rest of the app passes a short name ("gemini", "codex", "ollama") or a
LiteLLM model id ("gemini/gemini-2.5-pro", "openai/gpt-5-mini",
"ollama/gemma3:4b", "huggingface/org/model"). Adding a provider does not
need a new file.
"""
import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

DAILY_REQUEST_LIMIT = 400
DAILY_TOKEN_LIMIT = 5_000_000
_TRACKER = Path(__file__).resolve().parents[1] / "reports" / "gemini_usage.json"


class LLMError(Exception):
    pass


@dataclass
class LLMResult:
    text: str
    model_id: str
    input_tokens: int
    output_tokens: int
    total_tokens: int


def _clean(value: str) -> str:
    return (value or "").strip().strip("\"'")


def resolve_model(name: str) -> str:
    """Map a UI name to a LiteLLM model id. Ids that already contain '/' pass through."""
    key = _clean(name) or "gemini"
    low = key.lower()
    if "/" in key and low not in ("gemini", "codex", "openai", "ollama"):
        return key
    if low == "gemini":
        model = _clean(os.getenv("GEMINI_MODEL", ""))
        if not model:
            raise LLMError("GEMINI_MODEL is not set (e.g. gemini-2.5-pro). Add it in Settings.")
        return model if "/" in model else f"gemini/{model}"
    if low in ("codex", "openai"):
        model = _clean(os.getenv("OPENAI_MODEL", "")) or "gpt-5-mini"
        return model if "/" in model else f"openai/{model}"
    if low == "ollama":
        model = _clean(os.getenv("OLLAMA_MODEL", "")) or "gemma3:4b"
        return model if model.startswith("ollama/") else f"ollama/{model}"
    if "/" not in key:
        raise LLMError(
            f"Unknown model '{key}'. Use gemini, codex, ollama, or a provider/model id "
            "(for example huggingface/org/model)."
        )
    return key


def is_gemini(name: str) -> bool:
    try:
        return resolve_model(name).startswith("gemini/")
    except LLMError:
        return (name or "").strip().lower() == "gemini"


def _require_key(model_id: str) -> None:
    if model_id.startswith("gemini/") and not _clean(os.getenv("GEMINI_API_KEY", "")):
        raise LLMError("GEMINI_API_KEY is not set. Add it in Settings.")
    if model_id.startswith(("openai/", "gpt-")) and not _clean(os.getenv("OPENAI_API_KEY", "")):
        raise LLMError("OPENAI_API_KEY is not set. Add it in Settings to use Codex.")
    if model_id.startswith("huggingface/") and not (
        _clean(os.getenv("HUGGINGFACE_API_KEY", "")) or _clean(os.getenv("HF_TOKEN", ""))
    ):
        raise LLMError("HUGGINGFACE_API_KEY is not set. Add it in Settings to use a Hugging Face model.")


def complete(model: str, system: str, user: str, temperature: float = 0.2, json_mode: bool = False) -> LLMResult:
    """One call. system is the prompt, user is the story / draft."""
    try:
        import litellm
    except Exception as ex:
        raise LLMError(f"litellm is not installed ({ex}). Run: pip install -r requirements.txt")

    model_id = resolve_model(model)
    _require_key(model_id)
    kwargs = {}
    if model_id.startswith("ollama/"):
        host = _clean(os.getenv("OLLAMA_HOST", ""))
        if host:
            if not host.startswith("http"):
                host = "http://" + host
            kwargs["api_base"] = host
    if json_mode and not model_id.startswith("ollama/"):
        kwargs["response_format"] = {"type": "json_object"}
    try:
        resp = litellm.completion(
            model=model_id,
            messages=[
                {"role": "system", "content": system or ""},
                {"role": "user", "content": user or ""},
            ],
            temperature=temperature,
            **kwargs,
        )
    except Exception as ex:
        raise LLMError(f"{model_id}: {ex}") from ex

    text = ""
    try:
        text = resp.choices[0].message.content or ""
    except Exception:
        text = ""
    usage = getattr(resp, "usage", None)
    inp = int(getattr(usage, "prompt_tokens", 0) or 0)
    out = int(getattr(usage, "completion_tokens", 0) or 0)
    total = int(getattr(usage, "total_tokens", 0) or 0) or (inp + out)
    return LLMResult(text=text, model_id=model_id, input_tokens=inp, output_tokens=out, total_tokens=total)


def _today() -> str:
    return datetime.today().strftime("%Y-%m-%d")


def load_gemini_quota():
    """Same gemini_usage.json shape the Settings/usage card already reads."""
    usage_data = []
    if _TRACKER.exists():
        try:
            raw = json.loads(_TRACKER.read_text(encoding="utf-8"))
            usage_data = raw if isinstance(raw, list) else [raw] if isinstance(raw, dict) else []
        except (json.JSONDecodeError, OSError):
            usage_data = []
    for item in usage_data:
        if "requests_used" not in item:
            item["requests_used"] = item.pop("requests", 0)
        if "requests_left" not in item:
            item["requests_left"] = DAILY_REQUEST_LIMIT - item["requests_used"]
        if "tokens_used" not in item:
            item["tokens_used"] = item.pop("tokens", 0)
        if "tokens_left" not in item:
            item["tokens_left"] = DAILY_TOKEN_LIMIT - item["tokens_used"]
    today = _today()
    today_entry = next((item for item in usage_data if item.get("date") == today), None)
    if not today_entry:
        today_entry = {
            "date": today,
            "requests_used": 0,
            "requests_left": DAILY_REQUEST_LIMIT,
            "tokens_used": 0,
            "tokens_left": DAILY_TOKEN_LIMIT,
        }
        usage_data.append(today_entry)
    return usage_data, today_entry


def save_gemini_quota(usage_data) -> None:
    _TRACKER.parent.mkdir(parents=True, exist_ok=True)
    _TRACKER.write_text(json.dumps(usage_data, indent=4), encoding="utf-8")


def gemini_blocked() -> bool:
    _, today = load_gemini_quota()
    return int(today.get("requests_used") or 0) >= DAILY_REQUEST_LIMIT


def bump_gemini_quota(total_tokens: int) -> None:
    data, today = load_gemini_quota()
    today["requests_used"] = int(today.get("requests_used") or 0) + 1
    today["requests_left"] = DAILY_REQUEST_LIMIT - today["requests_used"]
    today["tokens_used"] = int(today.get("tokens_used") or 0) + int(total_tokens or 0)
    today["tokens_left"] = DAILY_TOKEN_LIMIT - today["tokens_used"]
    save_gemini_quota(data)
