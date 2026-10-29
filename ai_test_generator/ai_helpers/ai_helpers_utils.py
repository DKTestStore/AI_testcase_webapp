"""Shared utilities for AI helpers."""
import os
from pathlib import Path

def load_prompt(name: str) -> str:
    p = Path(__file__).parent.parent / "prompt" / name
    return p.read_text() if p.exists() else ""

def get_model_config(model: str) -> dict:
    if model == "gemini":
        return {"api_key": os.getenv("GEMINI_API_KEY"), "model": os.getenv("GEMINI_MODEL", "gemini-1.5-flash")}
    return {}
