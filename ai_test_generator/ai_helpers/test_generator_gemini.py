"""Gemini entry point. The actual call lives in llm.py so every provider shares one client."""
from .llm import DAILY_REQUEST_LIMIT, LLMError, bump_gemini_quota, complete, gemini_blocked, load_gemini_quota


def get_today_quota():
    return load_gemini_quota()


def save_quota(usage_data):
    from .llm import save_gemini_quota
    save_gemini_quota(usage_data)


def generate_test_cases(target_code_or_feature, test_case_generation_prompt):
    if gemini_blocked():
        print(f"Gemini daily request limit ({DAILY_REQUEST_LIMIT}) reached.")
        return None
    print("Generating test cases with Gemini... please wait.\n")
    try:
        result = complete("gemini", test_case_generation_prompt, target_code_or_feature, temperature=0.2)
    except LLMError as ex:
        print(f"Gemini error: {ex}")
        return None
    bump_gemini_quota(result.total_tokens)
    _, today = load_gemini_quota()
    print("\n========== TOKEN USAGE & QUOTA ==========")
    print(f"Input Tokens  : {result.input_tokens}")
    print(f"Output Tokens : {result.output_tokens}")
    print(f"Total Tokens  : {result.total_tokens}")
    print("-----------------------------------------")
    print(f"Requests Used Today : {today['requests_used']} | Requests Left : {today['requests_left']}")
    print(f"Tokens Used Today   : {today['tokens_used']} | Tokens Left   : {today['tokens_left']}")
    print("=========================================\n")
    return result.text
