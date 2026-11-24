"""Screenshot + Notes helpers: image sanitization, vision-model check, case merge.

No new dependencies. Image bytes are accepted as base64 (optionally as data URLs).
Capability is inferred from well-known model-name patterns and can be overridden
with ATG_VISION_MODELS / ATG_TEXT_ONLY_MODELS (comma-separated substrings).
"""
from __future__ import annotations

import base64
import os
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Client already downscales; these are server-side caps so a huge payload is rejected.
MAX_IMAGES = 12
MAX_BYTES_EACH = 1_500_000
MAX_BYTES_TOTAL = 8_000_000
MAX_CAPTION = 400
MAX_NOTES = 50_000
ALLOWED_MIME = ("image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif")

# Force text-only when the model id matches (checked first, except env allow-list).
_TEXT_PATTERNS = (
    "text-embedding", "embedding", "tts", "whisper", "dall-e", "dalle", "imagen",
    "veo", "moderation", "gpt-3.5", "gpt-3.5-turbo", "davinci", "babbage", "curie",
    "text-davinci", "codex-mini",
)
# Vision if the model id contains any of these (provider-specific lists also apply).
_VISION_PATTERNS = (
    "vision", "gpt-4o", "gpt-4.1", "gpt-4-turbo", "gpt-4-vision", "gpt-4.5", "gpt-5",
    "omni", "llava", "bakllava", "moondream", "minicpm", "pixtral", "maverick",
    "scout", "llama-4", "llama4", "llama-3.2-vision", "llama3.2-vision",
    "qwen2.5-vl", "qwen2-vl", "qwen2.5vl", "qwen3-vl", "qwen3vl", "gemma3",
    "nemotron-3.5-super-vl", "-vl-", "vl-120", "granite-vision", "grok-2-vision",
    "grok-2v", "claude-3", "claude-4", "claude-sonnet", "claude-opus", "claude-haiku",
    "gemini-1.5", "gemini-2", "gemini-3", "gemini-pro-vision", "gemini-flash",
    "o3", "o4",
)

# Providers whose current flagship models almost all accept images.
_PROVIDER_DEFAULT_VISION = {"gemini", "claude"}

_ID_RE = re.compile(r"^(.*?)(\d+)$")


class VisionError(ValueError):
    """Raised for a clear, user-facing screenshot / vision failure."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


def _norm_mime(raw: str) -> str:
    m = (raw or "").strip().lower().split(";")[0].strip()
    if m == "image/jpg":
        m = "image/jpeg"
    return m


def _env_list(name: str) -> List[str]:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return []
    return [p.strip().lower() for p in raw.split(",") if p.strip()]


def _has_any(name: str, pats: Iterable[str]) -> bool:
    n = (name or "").lower()
    return any(p and p in n for p in pats)


def vision_supported(provider: str, model_name: str = "") -> Dict[str, Any]:
    """Return {ok, provider, model, reason, hint} for the selected provider/model."""
    p = (provider or "").strip().lower()
    mid = (model_name or "").strip()
    low = mid.lower()
    allow = _env_list("ATG_VISION_MODELS")
    deny = _env_list("ATG_TEXT_ONLY_MODELS")
    hint = ("Screenshot analysis needs a vision-capable model (for example Gemini, "
            "OpenAI GPT-4o, or a vision model on Groq, Ollama, or NVIDIA).")

    if allow and _has_any(low, allow):
        return {"ok": True, "provider": p, "model": mid, "reason": "Listed in ATG_VISION_MODELS.", "hint": hint}
    if deny and _has_any(low, deny):
        return {"ok": False, "provider": p, "model": mid,
                "reason": f"Model '{mid or p}' is listed as text-only (ATG_TEXT_ONLY_MODELS).", "hint": hint}
    if mid and _has_any(low, _TEXT_PATTERNS):
        return {"ok": False, "provider": p, "model": mid,
                "reason": f"Model '{mid}' is treated as text-only.", "hint": hint}

    if mid and _has_any(low, _VISION_PATTERNS):
        return {"ok": True, "provider": p, "model": mid, "reason": "Known vision-capable model name.", "hint": hint}

    # Provider-family defaults when the name is empty or unrecognized.
    if p in _PROVIDER_DEFAULT_VISION:
        if not mid:
            return {"ok": True, "provider": p, "model": mid,
                    "reason": f"{p.capitalize()} models typically accept images.", "hint": hint}
        # Unrecognized gemini/claude id: still likely vision unless it looked text-only above.
        if p == "gemini" and "gemini" in low:
            return {"ok": True, "provider": p, "model": mid, "reason": "Gemini model (vision assumed).", "hint": hint}
        if p == "claude" and "claude" in low:
            return {"ok": True, "provider": p, "model": mid, "reason": "Claude model (vision assumed).", "hint": hint}
        if not mid or p in ("gemini", "claude"):
            return {"ok": True, "provider": p, "model": mid,
                    "reason": f"{p.capitalize()} models typically accept images.", "hint": hint}

    label = mid or (p or "the selected model")
    return {"ok": False, "provider": p, "model": mid,
            "reason": f"'{label}' is not recognized as a vision-capable model.", "hint": hint}


def _b64_decode(raw: str) -> bytes:
    s = (raw or "").strip()
    if s.startswith("data:") and "," in s:
        s = s.split(",", 1)[1]
    s = re.sub(r"\s+", "", s)
    try:
        return base64.b64decode(s, validate=False)
    except Exception as ex:
        raise VisionError(f"A screenshot could not be decoded (invalid base64): {ex}") from ex


def normalize_images(raw: Any) -> List[Dict[str, str]]:
    """Validate and return [{mime, data, caption}] (data is bare base64)."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise VisionError("screenshots must be sent as a list of images.")
    if len(raw) > MAX_IMAGES:
        raise VisionError(f"Too many screenshots (max {MAX_IMAGES}). Remove some and try again.")
    out: List[Dict[str, str]] = []
    total = 0
    for i, item in enumerate(raw, 1):
        if not isinstance(item, dict):
            raise VisionError(f"Screenshot {i} is not a valid image object.")
        data_raw = item.get("data") or item.get("base64") or item.get("src") or ""
        mime = _norm_mime(str(item.get("mime") or item.get("type") or ""))
        if isinstance(data_raw, str) and data_raw.startswith("data:") and ";base64," in data_raw:
            header, _ = data_raw.split(";base64,", 1)
            if not mime:
                mime = _norm_mime(header[5:])
        if mime not in ALLOWED_MIME and mime != "image/jpeg":
            # Try sniff from the payload header if mime was omitted.
            if not mime and isinstance(data_raw, str) and data_raw.startswith("data:"):
                raise VisionError(f"Screenshot {i} is missing a MIME type.")
            if mime not in ("image/png", "image/jpeg", "image/webp", "image/gif"):
                raise VisionError(
                    f"Screenshot {i} uses unsupported type '{mime or 'unknown'}'. "
                    "Use PNG, JPEG, WebP, or GIF.")
        blob = _b64_decode(str(data_raw))
        if not blob:
            raise VisionError(f"Screenshot {i} is empty.")
        if len(blob) > MAX_BYTES_EACH:
            raise VisionError(
                f"Screenshot {i} is too large after encoding (max {MAX_BYTES_EACH // 1000} KB). "
                "The editor should downscale large images before sending.")
        total += len(blob)
        if total > MAX_BYTES_TOTAL:
            raise VisionError(
                f"Screenshots together exceed {MAX_BYTES_TOTAL // 1_000_000} MB. "
                "Remove some, or use a smaller resolution.")
        if mime == "image/jpg":
            mime = "image/jpeg"
        cap = str(item.get("caption") or item.get("note") or "").strip()[:MAX_CAPTION]
        b64 = base64.b64encode(blob).decode("ascii")
        out.append({"mime": mime or "image/png", "data": b64, "caption": cap})
    return out


def compose_feature_text(*, notes: str = "", module: str = "", story_id: str = "",
                         focus: Optional[Iterable[str]] = None,
                         images: Optional[List[Dict[str, Any]]] = None,
                         mode: str = "", active: Optional[Dict[str, Any]] = None) -> str:
    """Plain-text payload that accompanies the images in the generate request."""
    parts: List[str] = []
    if module.strip():
        parts.append(f"Feature / module: {module.strip()}")
    if story_id.strip():
        parts.append(f"Story ID: {story_id.strip()}")
    foci = [str(f).strip() for f in (focus or []) if str(f).strip()]
    if foci:
        parts.append("Focus: " + ", ".join(foci))
    notes = (notes or "").strip()[:MAX_NOTES]
    if notes:
        parts.append("Feature & screenshot notes:\n" + notes)
    if images:
        lines = ["Screenshots attached (in order):"]
        for i, im in enumerate(images, 1):
            cap = (im.get("caption") or "").strip() or "(no caption)"
            lines.append(f"{i}. {cap}")
        parts.append("\n".join(lines))
    if not parts:
        parts.append("The user provided screenshot(s) of a feature. Infer the flow, fields, "
                     "validation and expected results from the images and write manual test cases.")
    else:
        parts.append("Use the screenshot(s) together with the notes to write concrete, testable "
                     "manual test cases (steps and expected results). Do not invent features that "
                     "are not visible or described.")
    mode = (mode or "").strip().lower()
    if mode == "same" and active:
        steps = active.get("steps") or []
        step_txt = "\n".join(
            f"{i}. {s.get('description') or '-'} => {s.get('expected') or '-'}"
            for i, s in enumerate(steps, 1)
        ) or "(no steps yet)"
        parts.append(
            "ITERATION MODE: Continue as Same Test.\n"
            f"Extend the existing test case {active.get('id') or ''} "
            f"“{active.get('name') or ''}”. Keep the same Test Case ID and name unless a small "
            "clarification is needed. Return the COMPLETE test case (existing steps plus any new "
            "steps and assertions from the new screenshot(s) and notes) using the required output "
            "template.\n"
            f"Current description: {active.get('description') or '(none)'}\n"
            f"Current precondition: {active.get('precondition') or '(none)'}\n"
            f"Current steps:\n{step_txt}"
        )
    elif mode == "new":
        parts.append(
            "ITERATION MODE: Generate a New Test Case.\n"
            "Write a separate new test case from the new screenshot(s) and notes. "
            "Do not repeat the already-generated test case; focus on the new material."
        )
    return "\n\n".join(parts)


def _tc_num(cid: Any) -> int:
    m = re.search(r"(\d+)$", str(cid or "").strip())
    return int(m.group(1)) if m else 0


def id_formatter(cases: List[Dict[str, Any]]):
    for c in cases or []:
        m = _ID_RE.match(str(c.get("id") or "").strip())
        if m:
            prefix, num = m.group(1), m.group(2)
            width = len(num)
            return lambda n, p=prefix, w=width: f"{p}{n:0{w}d}"
    return lambda n: f"TC-{n:03d}"


def find_case(cases: List[Dict[str, Any]], cid: str) -> Optional[Dict[str, Any]]:
    cid = str(cid or "").strip()
    if not cid:
        return cases[0] if cases else None
    for c in cases:
        if str(c.get("id") or "").strip() == cid:
            return c
    # Loose match: TC-001 vs TC001
    compact = re.sub(r"[\s-]", "", cid).lower()
    for c in cases:
        if re.sub(r"[\s-]", "", str(c.get("id") or "")).lower() == compact:
            return c
    return cases[0] if cases else None


def apply_iteration(existing: List[Dict[str, Any]], new_cases: List[Dict[str, Any]],
                    mode: str, active_id: str = "") -> Tuple[List[Dict[str, Any]], str]:
    """Merge newly generated cases into the run. Returns (cases, new_or_kept active id)."""
    mode = (mode or "").strip().lower()
    existing = list(existing or [])
    new_cases = list(new_cases or [])
    if not existing or mode not in ("same", "new"):
        aid = (new_cases[0].get("id") if new_cases else "") or active_id
        return new_cases, str(aid or "")
    if mode == "new":
        start = max((_tc_num(c.get("id")) for c in existing), default=0)
        fmt = id_formatter(existing)
        for i, c in enumerate(new_cases):
            c["id"] = fmt(start + i + 1)
        aid = new_cases[0]["id"] if new_cases else active_id
        return existing + new_cases, str(aid or "")
    target = find_case(existing, active_id)
    if not target or not new_cases:
        return existing, str((target or {}).get("id") or active_id)
    incoming = find_case(new_cases, str(target.get("id") or "")) or new_cases[0]
    old_steps = [s for s in (target.get("steps") or []) if (s.get("description") or s.get("expected"))]
    new_steps = [s for s in (incoming.get("steps") or []) if (s.get("description") or s.get("expected"))]
    # Prefer a complete rewrite when the model returned at least as many steps (asked for full case).
    if len(new_steps) >= len(old_steps) and new_steps:
        target["steps"] = new_steps
    else:
        target["steps"] = old_steps + new_steps
    for key in ("description", "precondition", "name", "priority", "type"):
        val = (incoming.get(key) or "").strip() if isinstance(incoming.get(key), str) else incoming.get(key)
        if val and not (target.get(key) or "").strip():
            target[key] = val
        elif key == "description" and val and val != (target.get("description") or ""):
            # Keep original; append a short addition when it looks new.
            if val not in (target.get("description") or ""):
                target["description"] = ((target.get("description") or "").rstrip() + " " + val).strip()
    return existing, str(target.get("id") or active_id)


def strip_bytes_for_history(obj: Any) -> Any:
    """Deep-copy-ish walk that drops raw image data from history snapshots."""
    if isinstance(obj, dict):
        if isinstance(obj.get("screenshot"), dict):
            out = {k: (strip_bytes_for_history(v) if k != "screenshot" else None) for k, v in obj.items()}
            ss = dict(obj["screenshot"])
            imgs = ss.get("images") if isinstance(ss.get("images"), list) else []
            ss["images"] = [
                {"caption": (im or {}).get("caption", ""), "mime": (im or {}).get("mime", ""), "stored": False}
                for im in imgs if isinstance(im, dict)
            ]
            ss["image_count"] = len([im for im in imgs if isinstance(im, dict)])
            ss["bytes_omitted"] = True
            out["screenshot"] = ss
            return out
        return {k: strip_bytes_for_history(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [strip_bytes_for_history(x) for x in obj]
    return obj


def public_screenshot(ss: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Live-session screenshot payload (images included so the Input tab can restore thumbs)."""
    if not isinstance(ss, dict):
        return None
    return ss
