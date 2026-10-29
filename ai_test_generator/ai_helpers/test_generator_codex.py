"""Codex / OpenAI-compatible test case generator."""
import os
from openai import OpenAI

def generate(feature: str, prompt: str) -> str:
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt + "\n\nFeature:\n" + feature}]
    )
    return resp.choices[0].message.content
