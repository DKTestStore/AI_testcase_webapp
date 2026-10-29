"""Ollama local model generator."""
import os, requests

def generate(feature: str, prompt: str) -> str:
    host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    model = os.getenv("OLLAMA_MODEL", "llama3")
    r = requests.post(f"{host}/api/generate", json={
        "model": model,
        "prompt": prompt + "\n\nFeature:\n" + feature,
        "stream": False
    })
    return r.json().get("response", "")
