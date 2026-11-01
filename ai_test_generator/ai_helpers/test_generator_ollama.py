"""Local Ollama entry point. Model name comes from OLLAMA_MODEL."""
from .llm import LLMError, complete

_DEFAULT_SYSTEM = """
    You are an expert QA automation engineer specializing in Python and Playwright.
    Analyze the provided feature or code snippet and generate comprehensive test cases.
    Include functional, negative, and boundary test scenarios.
    Output the test cases in a clear list format. Do not include introductory text.
    Follow this format such as
    Test Case ID | Test Case Description | Precondition | Test Steps[List of steps] | Expected Result[Expected outcome for Each step]
    Each test case should be unique and cover different aspects of the feature or code provided.
    Atleast 7 test Steps should be included in each test case.
    """


def generate_test_cases(target_code_or_feature, system_prompt=None):
    print("Generating test cases... please wait.\n")
    try:
        result = complete("ollama", system_prompt or _DEFAULT_SYSTEM, target_code_or_feature, temperature=0.2)
    except LLMError as ex:
        print(f"Ollama error: {ex}")
        return None
    print(result.text)
    return result.text


if __name__ == "__main__":
    generate_test_cases(
        "A web login form with two fields: 'username' and 'password', and a 'Submit' button.\n"
        "Passwords must be at least 8 characters long and contain a special character.\n"
    )
