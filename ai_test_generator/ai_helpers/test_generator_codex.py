"""OpenAI / Codex entry point. Switching the model is OPENAI_MODEL, not a new file."""
import os

from .llm import LLMError, complete

MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")


def generate_test_cases(acceptance_criteria, test_case_generation_prompt, html_source=""):
    user_input = f"""
        Acceptance Criteria:
        {acceptance_criteria}
        HTML Page Source:
        {html_source}
        Please generate test cases based on the provided acceptance criteria and HTML page source.
        """
    print("Generating test cases using OpenAI...\n")
    try:
        result = complete("codex", test_case_generation_prompt, user_input, temperature=0.2)
    except LLMError as ex:
        print("\n========== ERROR ==========")
        print("Failed to generate test cases.")
        print(f"Error: {ex}")
        print("===========================\n")
        return None
    _print_usage("TOKEN USAGE", result)
    return result.text


def review_test_cases(test_cases, reviewer_prompt):
    print("Reviewer Agent validating test cases...\n")
    try:
        result = complete("codex", reviewer_prompt, test_cases, temperature=0.0)
    except LLMError as ex:
        print("\n========== REVIEW ERROR ==========")
        print("Failed to review test cases.")
        print(f"Error: {ex}")
        print("==================================\n")
        return None
    _print_usage("REVIEW TOKEN USAGE", result)
    return result.text


def _print_usage(title, result):
    print(f"\n========== {title} ==========")
    print(f"Model         : {result.model_id}")
    print(f"Input Tokens  : {result.input_tokens}")
    print(f"Output Tokens : {result.output_tokens}")
    print(f"Total Tokens  : {result.total_tokens}")
    print("=================================\n")
