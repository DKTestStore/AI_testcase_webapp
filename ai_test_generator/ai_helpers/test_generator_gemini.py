"""Gemini test case generator."""
import os
from google import genai

def generate(feature: str, prompt: str) -> str:
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    model = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
    resp = client.models.generate_content(
        model=model,
        contents=prompt + "\n\nFeature description:\n" + feature
    )
    return resp.text
