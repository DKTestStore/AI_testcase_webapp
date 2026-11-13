"""Unit tests for Help Assistant docs split/ranking (no network, no provider calls).

run:  python -m pytest -q tests/test_help_search.py
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from backend import help as H  # noqa: E402


FIXTURE = """# Product

Intro text about the app.

## Workflow

Generate test cases from a Jira story or local text, then Review and upload to qTest.

## Zephyr Scale Cloud

Zephyr Scale Cloud upload is not implemented yet. Settings store ZEPHYR_BASE_URL and ZEPHYR_API_KEY only.

## Connect Jira

Set JIRA_URL, JIRA_EMAIL and JIRA_API_TOKEN, then fetch a story on Input.
"""

FAQ = """# Help FAQ

## Parse errors

A parse error means the model reply could not be turned into test-case cards. The parser looks for Test Case ID headings.

## Groq model 404

If Groq returns HTTP 404, set GROQ_MODEL to a model on your account such as openai/gpt-oss-120b. The default llama-3.3-70b-versatile may 404.
"""


def _secs():
    return H.split_markdown(FIXTURE, "README") + H.split_markdown(FAQ, "FAQ")


def test_split_markdown_by_headings():
    secs = H.split_markdown(FIXTURE, "README")
    titles = [s["title"] for s in secs]
    assert titles == ["Product", "Workflow", "Zephyr Scale Cloud", "Connect Jira"]
    assert all(s["source"] == "README" for s in secs)
    z = next(s for s in secs if "Zephyr" in s["title"])
    assert "not implemented" in z["text"].lower()
    assert z["anchor"] == "zephyr-scale-cloud"


def test_split_keeps_preamble_without_heading():
    secs = H.split_markdown("Just a blurb about qTest upload.\n\n# Later\nBody", "README")
    assert secs[0]["title"] == "README"
    assert "qTest" in secs[0]["text"]
    assert secs[1]["title"] == "Later"


def test_rank_empty_or_stopwords_only_returns_empty():
    secs = _secs()
    assert H.rank_sections("", secs) == []
    assert H.rank_sections("the and or", secs) == []


def test_rank_prefers_title_match():
    secs = _secs()
    ranked = H.rank_sections("jira", secs, limit=3)
    assert ranked, "expected at least one Jira hit"
    assert ranked[0]["title"] == "Connect Jira"


def test_rank_zephyr_hits_not_implemented_section():
    ranked = H.rank_sections("upload to zephyr", _secs(), limit=3)
    titles = [s["title"] for s in ranked]
    assert "Zephyr Scale Cloud" in titles
    z = next(s for s in ranked if "Zephyr" in s["title"])
    assert "not implemented" in z["text"].lower()


def test_rank_parse_error_hits_faq():
    ranked = H.rank_sections("fix parse error", _secs(), limit=3)
    assert any("Parse" in s["title"] and s["source"] == "FAQ" for s in ranked)


def test_snippet_window_around_term():
    text = "AAAA " + ("padding " * 40) + "Zephyr Scale Cloud upload is not implemented yet. " + ("tail " * 40)
    sn = H.snippet(text, "zephyr upload", width=80)
    assert "Zephyr" in sn
    assert "not implemented" in sn
    assert sn.startswith("…") or sn.endswith("…") or len(text) <= 80


def test_search_docs_shape_and_limit():
    hits = H._hits("zephyr", _secs(), limit=2)
    assert len(hits) <= 2
    assert hits and set(hits[0]) >= {"title", "anchor", "source", "snippet"}
    assert "Zephyr" in hits[0]["title"] or "zephyr" in hits[0]["snippet"].lower()


def test_load_docs_includes_readme_zephyr():
    """Smoke check against the real README (still no network / no provider)."""
    docs = H.load_docs()
    assert any(s.get("source") == "README" for s in docs)
    ranked = H.rank_sections("zephyr scale upload", docs, limit=5)
    assert ranked
    blob = " ".join((s["title"] + " " + s["text"]).lower() for s in ranked)
    assert "zephyr" in blob
    assert "not implemented" in blob


def test_slugify():
    assert H.slugify("Zephyr Scale Cloud") == "zephyr-scale-cloud"
    assert H.slugify("") == "section"
