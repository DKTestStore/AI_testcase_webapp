"""Unit tests for the Groq provider (fully mocked — no network, no real key).

run:  python -m pytest -q tests/test_groq_provider.py
"""
import sys, pathlib
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from ai_test_generator.ai_helpers import test_generator_groq as G  # noqa: E402


class FakeRateLimit(Exception):
    """Stands in for openai.RateLimitError (status_code 429 + response headers)."""

    def __init__(self, retry_after=None):
        super().__init__("429 Too Many Requests")
        self.status_code = 429
        headers = {"retry-after": str(retry_after)} if retry_after is not None else {}
        self.response = SimpleNamespace(headers=headers)


def _resp(text="| TC | Steps |", inp=11, out=22):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=text))],
        usage=SimpleNamespace(prompt_tokens=inp, completion_tokens=out, total_tokens=inp + out),
    )


class FakeClient:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.calls.append(kw)
        o = self.outcomes.pop(0)
        if isinstance(o, Exception):
            raise o
        return o


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    monkeypatch.delenv("GROQ_MODEL", raising=False)
    monkeypatch.delenv("GROQ_MAX_TOKENS", raising=False)
    return monkeypatch


def _use(monkeypatch, client):
    monkeypatch.setattr(G, "_client", lambda: client)


def test_missing_key_raises(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    with pytest.raises(G.ProviderError, match="GROQ_API_KEY"):
        G.complete("sys", "story")


def test_client_uses_groq_base_url(env):
    c = G._client()
    assert str(c.base_url).rstrip("/") == G.GROQ_BASE
    assert c.max_retries == 0


def test_default_model_and_usage(env):
    fc = FakeClient([_resp("hello", 5, 7)])
    _use(env, fc)
    text, usage = G.complete("sys prompt", "story text", temperature=0.1)
    assert text == "hello"
    kw = fc.calls[0]
    assert kw["model"] == "llama-3.3-70b-versatile"
    assert kw["messages"][0] == {"role": "system", "content": "sys prompt"}
    assert kw["messages"][1] == {"role": "user", "content": "story text"}
    assert kw["max_tokens"] == 8192
    assert usage["provider"] == "groq" and usage["model"] == "groq"
    assert usage["model_name"] == "llama-3.3-70b-versatile"
    assert (usage["input_tokens"], usage["output_tokens"], usage["total_tokens"]) == (5, 7, 12)


def test_model_and_max_tokens_from_env(env):
    env.setenv("GROQ_MODEL", "openai/gpt-oss-20b")
    env.setenv("GROQ_MAX_TOKENS", "2048")
    fc = FakeClient([_resp()])
    _use(env, fc)
    G.complete("s", "u")
    assert fc.calls[0]["model"] == "openai/gpt-oss-20b"
    assert fc.calls[0]["max_tokens"] == 2048


def test_retry_on_429_uses_retry_after(env):
    fc = FakeClient([FakeRateLimit(retry_after=3), _resp("ok")])
    _use(env, fc)
    slept = []
    text, _ = G.complete("s", "u", _sleep=slept.append)
    assert text == "ok"
    assert slept == [3.0]
    assert len(fc.calls) == 2


def test_retry_after_is_capped(env):
    fc = FakeClient([FakeRateLimit(retry_after=999), _resp("ok")])
    _use(env, fc)
    slept = []
    G.complete("s", "u", _sleep=slept.append)
    assert slept == [G.MAX_RETRY_WAIT]


def test_gives_up_after_two_retries_with_429(env):
    fc = FakeClient([FakeRateLimit(1), FakeRateLimit(1), FakeRateLimit(1)])
    _use(env, fc)
    slept = []
    with pytest.raises(G.ProviderError) as ei:
        G.complete("s", "u", _sleep=slept.append)
    assert ei.value.status == 429
    assert "rate limit" in str(ei.value).lower()
    assert len(fc.calls) == 3 and len(slept) == 2


def test_other_errors_not_retried(env):
    fc = FakeClient([ValueError("boom")])
    _use(env, fc)
    with pytest.raises(G.ProviderError, match="Groq API error"):
        G.complete("s", "u", _sleep=lambda s: pytest.fail("should not sleep"))
    assert len(fc.calls) == 1


def test_empty_response_raises(env):
    _use(env, FakeClient([_resp("")]))
    with pytest.raises(G.ProviderError, match="empty"):
        G.complete("s", "u")


def test_services_maps_groq_and_429():
    from backend import services as S
    assert S._norm_provider("Groq") == "groq"
    assert S._norm_provider("grok") == "grok"          # unchanged
    assert "groq" in S.KNOWN_PROVIDERS
    err = S._provider_error(G.ProviderError("Groq rate limit reached", status=429))
    assert err.status == 429
    other = S._provider_error(G.ProviderError("Groq API error: boom"))
    assert other.status == 502
