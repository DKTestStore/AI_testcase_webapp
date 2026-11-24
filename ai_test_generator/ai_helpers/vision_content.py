"""Format screenshot payloads into each provider's native image message shape.

Helpers are pure (no network, no new deps). `images` is a list of
{mime, data} where data is bare base64.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _items(images: Optional[List[Dict[str, Any]]]) -> List[Dict[str, str]]:
    out = []
    for im in images or []:
        if not isinstance(im, dict):
            continue
        mime = (im.get("mime") or "image/png").split(";")[0].strip() or "image/png"
        if mime == "image/jpg":
            mime = "image/jpeg"
        data = (im.get("data") or "").strip()
        if data.startswith("data:") and "," in data:
            data = data.split(",", 1)[1]
        if not data:
            continue
        out.append({"mime": mime, "data": data})
    return out


def data_url(im: Dict[str, str]) -> str:
    return f"data:{im['mime']};base64,{im['data']}"


def openai_responses_input(text: str, images: Optional[List[Dict[str, Any]]]) -> Any:
    """Responses API `input` value: a string when there are no images, else a user turn."""
    items = _items(images)
    if not items:
        return text
    content: List[Dict[str, Any]] = [{"type": "input_text", "text": text or ""}]
    for im in items:
        content.append({"type": "input_image", "image_url": data_url(im)})
    return [{"role": "user", "content": content}]


def openai_chat_user_content(text: str, images: Optional[List[Dict[str, Any]]]) -> Any:
    """chat.completions user `content`: a string, or a list of text + image_url parts."""
    items = _items(images)
    if not items:
        return text
    parts: List[Dict[str, Any]] = [{"type": "text", "text": text or ""}]
    for im in items:
        parts.append({"type": "image_url", "image_url": {"url": data_url(im)}})
    return parts


def claude_user_content(text: str, images: Optional[List[Dict[str, Any]]]) -> Any:
    items = _items(images)
    if not items:
        return text
    parts: List[Dict[str, Any]] = []
    for im in items:
        parts.append({
            "type": "image",
            "source": {"type": "base64", "media_type": im["mime"], "data": im["data"]},
        })
    parts.append({"type": "text", "text": text or ""})
    return parts


def ollama_user_message(text: str, images: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
    msg: Dict[str, Any] = {"role": "user", "content": text or ""}
    items = _items(images)
    if items:
        msg["images"] = [im["data"] for im in items]
    return msg


def gemini_parts(types_mod, text: str, images: Optional[List[Dict[str, Any]]]):
    """google-genai Part list, or the plain text string when there are no images."""
    items = _items(images)
    if not items:
        return text
    import base64
    parts = [types_mod.Part.from_text(text=text or "")]
    for im in items:
        raw = base64.b64decode(im["data"])
        try:
            parts.append(types_mod.Part.from_bytes(data=raw, mime_type=im["mime"]))
        except Exception:
            blob = types_mod.Blob(data=raw, mime_type=im["mime"])
            parts.append(types_mod.Part(inline_data=blob))
    return parts
