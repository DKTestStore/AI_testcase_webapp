"""Business logic for test case generation, review, and integrations."""
from typing import Dict, Any

def generate_test_cases(feature: str, model: str = "gemini") -> str:
    # Dispatch to the appropriate AI helper
    if model == "gemini":
        from ai_test_generator.ai_helpers.test_generator_gemini import generate
    elif model == "codex":
        from ai_test_generator.ai_helpers.test_generator_codex import generate
    else:
        from ai_test_generator.ai_helpers.test_generator_ollama import generate
    prompt = open("ai_test_generator/prompt/test_cases_generator_prompt.md").read()
    return generate(feature, prompt)

def review_test_cases(cases: str) -> str:
    from ai_test_generator.ai_helpers.test_generator_gemini import generate
    prompt = open("ai_test_generator/prompt/test_cases_reviewer_prompt.md").read()
    return generate(cases, prompt)
