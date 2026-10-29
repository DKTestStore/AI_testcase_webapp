"""Main generation pipeline entry point."""
from ..ai_helpers.test_generator_gemini import generate as gen_gemini
from ..prompt import test_cases_generator_prompt

def run_pipeline(feature: str) -> str:
    prompt = open("ai_test_generator/prompt/test_cases_generator_prompt.md").read()
    return gen_gemini(feature, prompt)
