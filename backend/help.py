"""Help Assistant — docs-grounded chat and keyword search.

Loads README.md and docs/help_faq.md, splits them by markdown headings, and
keyword-ranks sections. POST /api/help/chat sends the top excerpts to an
existing AI provider via services._complete. GET /api/help/search is the
no-AI fallback (ranked sections + snippets). No new dependencies, no .env keys.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Body, Query, Request

from .config import ROOT_DIR
from .services import KNOWN_PROVIDERS, ServiceError, _complete, _norm_provider, _provider_error

router = APIRouter()

DOC_FILES: Tuple[Tuple[str, str], ...] = (
    ("README.md", "README"),
    ("docs/help_faq.md", "FAQ"),
)

# Short stopwords so ranking stays on feature terms (jira, zephyr, parse, …).
_STOP = {
    "a", "an", "the", "and", "or", "to", "of", "in", "on", "for", "is", "it",
    "this", "that", "with", "from", "how", "do", "i", "my", "me", "we", "you",
    "what", "when", "where", "why", "can", "a", "be", "are", "was", "at", "as",
    "by", "if", "into", "about", "please", "tell", "show",
}

_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_WORD = re.compile(r"[a-z0-9][a-z0-9_./-]{1,}", re.I)

_cache: Dict[str, Any] = {"sig": None, "sections": None}


def slugify(title: str) -> str:
    s = re.sub(r"[^\w\s-]", "", (title or "").lower(), flags=re.UNICODE)
    s = re.sub(r"[-\s]+", "-", s).strip("-")
    return s or "section"


def tokenize(text: str) -> List[str]:
    return [w for w in (t.lower() for t in _WORD.findall(text or "")) if w not in _STOP and len(w) > 1]


def split_markdown(text: str, source: str) -> List[Dict[str, Any]]:
    """Split markdown into heading-bounded sections. Preamble (before the first heading) is kept."""
    sections: List[Dict[str, Any]] = []
    title = source
    level = 0
    buf: List[str] = []

    def flush() -> None:
        body = "\n".join(buf).strip()
        if not (title or body):
            return
        # Skip a preamble that is only a duplicate of the source label
        if not body and title == source and level == 0:
            return
        sections.append({
            "title": title.strip() or source,
            "anchor": slugify(title or source),
            "source": source,
            "text": body,
            "level": level,
        })

    for line in (text or "").splitlines():
        m = _HEADING.match(line)
        if m:
            flush()
            level = len(m.group(1))
            title = m.group(2).strip()
            buf = []
        else:
            buf.append(line)
    flush()
    return sections


def load_docs() -> List[Dict[str, Any]]:
    """Load and cache README + FAQ, invalidated when file mtimes change."""
    paths = []
    sig: List[float] = []
    for rel, _src in DOC_FILES:
        p = ROOT_DIR / rel
        paths.append((p, _src))
        try:
            sig.append(p.stat().st_mtime if p.exists() else 0.0)
        except OSError:
            sig.append(0.0)
    key = tuple(sig)
    if _cache["sections"] is not None and _cache["sig"] == key:
        return _cache["sections"]
    sections: List[Dict[str, Any]] = []
    for p, src in paths:
        if not p.exists():
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except OSError:
            continue
        sections.extend(split_markdown(text, src))
    _cache["sig"] = key
    _cache["sections"] = sections
    return sections


def rank_sections(query: str, sections: Optional[List[Dict[str, Any]]] = None,
                  limit: int = 5) -> List[Dict[str, Any]]:
    """Keyword-rank sections. Title matches score higher than body matches."""
    terms = tokenize(query)
    if not terms:
        return []
    pool = sections if sections is not None else load_docs()
    scored: List[Tuple[int, Dict[str, Any]]] = []
    for s in pool:
        title = (s.get("title") or "").lower()
        hay = (title + "\n" + (s.get("text") or "") + "\n" + (s.get("source") or "")).lower()
        score = 0
        for t in terms:
            if t in title:
                score += 5
                if re.search(r"\b" + re.escape(t) + r"\b", title):
                    score += 3
            score += hay.count(t)
            if re.search(r"\b" + re.escape(t) + r"\b", hay):
                score += 2
        if score > 0:
            scored.append((score, s))
    scored.sort(key=lambda x: (-x[0], x[1].get("title") or ""))
    return [s for _, s in scored[: max(0, limit)]]


def snippet(text: str, query: str, width: int = 200) -> str:
    """Window around the first query-term hit, trimmed to `width` characters."""
    body = re.sub(r"\s+", " ", (text or "")).strip()
    if not body:
        return ""
    terms = tokenize(query)
    lower = body.lower()
    idx = -1
    for t in terms:
        i = lower.find(t)
        if i >= 0 and (idx < 0 or i < idx):
            idx = i
    if idx < 0:
        return body[:width] + ("…" if len(body) > width else "")
    start = max(0, idx - width // 3)
    end = min(len(body), start + width)
    piece = body[start:end]
    if start > 0:
        piece = "…" + piece
    if end < len(body):
        piece = piece + "…"
    return piece


def _hits(query: str, sections: Optional[List[Dict[str, Any]]] = None,
          limit: int = 5) -> List[Dict[str, Any]]:
    return [
        {
            "title": s["title"],
            "anchor": s["anchor"],
            "source": s["source"],
            "snippet": snippet(s.get("text") or "", query),
        }
        for s in rank_sections(query, sections, limit=limit)
    ]


def search_docs(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Public helper used by the search endpoint and unit tests."""
    return _hits(query, load_docs(), limit=limit)


def _resolve_provider(raw: str, run=None, run_model: str = "") -> str:
    p = (raw or "").strip().lower()
    if p in ("none", "no-ai", "noai", "search", "docs"):
        return "none"
    if p in ("generate", "default", ""):
        cand = (run_model or "").strip() or ((run or {}).get("model") or "").strip()
        if cand:
            n = _norm_provider(cand)
            if n in KNOWN_PROVIDERS:
                return n
        try:
            from .settings_store import get_default_provider
            return get_default_provider()
        except Exception:
            return "gemini"
    n = _norm_provider(p)
    if n not in KNOWN_PROVIDERS:
        raise ServiceError(
            f"Unknown provider '{raw}'. Choose Gemini, Grok, Groq, Claude, OpenAI, Codex (OpenAI), Ollama, or No AI.",
            400,
        )
    return n


def _trim(text: str, n: int) -> str:
    t = (text or "").strip()
    return t if len(t) <= n else t[: n - 1] + "…"


SYSTEM_PROMPT = (
    "You are the Help Assistant for AI TestCase Generator, an in-app helper. "
    "Answer ONLY from the documentation excerpts provided below. "
    "Keep answers short and practical — prefer a brief intro and numbered steps. "
    "If the docs say a feature is not implemented or not supported, say so clearly and do not invent a workaround that the app does not have. "
    "If the excerpts do not cover the question, say you do not have that in the docs and point to the closest heading. "
    "Do not invent settings, API routes, model IDs, or behaviour that is not in the excerpts. "
    "Do not claim you changed any data, ran Generate, or uploaded anything. "
    "You may mention the source heading (README or FAQ) when it helps."
)


def _build_user_content(question: str, screen: str, history: List[Dict[str, Any]],
                        excerpts: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
    if screen:
        parts.append(f"Current screen: {screen}")
    turns = []
    for h in (history or [])[-6:]:
        if not isinstance(h, dict):
            continue
        role = "User" if str(h.get("role") or "").lower() in ("user", "human") else "Assistant"
        content = _trim(str(h.get("content") or h.get("text") or ""), 800)
        if content:
            turns.append(f"{role}: {content}")
    if turns:
        parts.append("Recent conversation:\n" + "\n".join(turns))
    parts.append("Question: " + question)
    blocks = []
    for s in excerpts:
        body = _trim(s.get("text") or "", 1400)
        blocks.append(f"## {s.get('source')} › {s.get('title')}\n{body}")
    parts.append("Documentation excerpts:\n\n" + ("\n\n".join(blocks) if blocks else "(no matching sections)"))
    return "\n\n".join(parts)


@router.get("/api/help/search")
def api_search(q: str = Query("", description="Keyword query")):
    q = (q or "").strip()
    if not q:
        return {"ok": True, "hits": []}
    if len(q) > 400:
        raise ServiceError("Search query is too long.", 400)
    return {"ok": True, "hits": search_docs(q, limit=5)}


@router.post("/api/help/chat")
def api_chat(data: Dict[str, Any] = Body(...), request: Request = None):
    question = str((data or {}).get("question") or "").strip()
    if not question:
        raise ServiceError("Enter a question.", 400)
    if len(question) > 4000:
        raise ServiceError("Question is too long.", 400)

    raw_provider = str((data or {}).get("provider") or "").strip()
    run_model = str((data or {}).get("run_model") or "").strip()
    run = None
    try:
        from . import session_store
        sid = request.cookies.get("atg_session") if request is not None else ""
        sess = session_store.get(sid) if sid else None
        if sess:
            run = sess.get("run") or {}
    except Exception:
        run = None
    # Frontend may send "none" for docs search; also allow an explicit search path.
    if _resolve_provider(raw_provider, run=run, run_model=run_model) == "none" or str((data or {}).get("mode") or "").lower() in ("search", "none"):
        # If they posted chat with no-AI, just return ranked hits (no model call).
        hits = search_docs(question, limit=5)
        return {
            "ok": True,
            "answer": "",
            "hits": hits,
            "sources": [{"title": h["title"], "anchor": h["anchor"], "source": h["source"]} for h in hits],
            "provider": "none",
            "model": "",
        }

    provider = _resolve_provider(raw_provider, run=run, run_model=run_model)
    model_name = str((data or {}).get("model_name") or "").strip() or None
    screen = str((data or {}).get("screen") or "").strip()[:80]
    history = (data or {}).get("history") or []
    if not isinstance(history, list):
        history = []

    docs = load_docs()
    excerpts = rank_sections(question, docs, limit=6)
    if screen:
        for s in rank_sections(screen, docs, limit=2):
            if s["anchor"] not in {e["anchor"] for e in excerpts} or s["source"] not in {e["source"] for e in excerpts if e["anchor"] == s["anchor"]}:
                # append unique
                if not any(e["title"] == s["title"] and e["source"] == s["source"] for e in excerpts):
                    excerpts.append(s)
        excerpts = excerpts[:7]

    sources = [{"title": s["title"], "anchor": s["anchor"], "source": s["source"]} for s in excerpts]
    user_content = _build_user_content(question, screen, history, excerpts)

    try:
        result = _complete(provider, SYSTEM_PROMPT, user_content, temperature=0.2, model_name=model_name)
    except ServiceError:
        raise
    except Exception as ex:
        raise _provider_error(ex)

    text = (result or {}).get("text") or ""
    usage = (result or {}).get("usage") or {}
    model = usage.get("model_name") or usage.get("model") or ""

    try:
        from . import token_usage
        from . import token_estimate
        est = token_estimate.estimate(question, provider, usage.get("model_name") or model_name or "", 200)
        token_usage.record(action="Help chat", usage=usage, run=None, mode="help", estimate=est)
    except Exception:
        pass

    return {
        "ok": True,
        "answer": text.strip(),
        "sources": sources,
        "provider": usage.get("provider") or provider,
        "model": model,
    }
