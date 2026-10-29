import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
MODEL = "gpt-5-mini"

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY")
)

def generate_test_cases(acceptance_criteria, test_case_generation_prompt, html_source=""):

    try:
        user_input = f"""
        Acceptance Criteria:
        {acceptance_criteria}
        HTML Page Source:
        {html_source}
        Please generate test cases based on the provided acceptance criteria and HTML page source.
        """
        print("Generating test cases using OpenAI...\n")

        response = client.responses.create(
            model=MODEL,
            instructions=test_case_generation_prompt,
            input=user_input,
            temperature=0.2
        )

        if not response:
            print("ERROR: No response received from OpenAI.")
            return None

        usage = response.usage

        print("\n========== TOKEN USAGE ==========")
        print(f"Input Tokens  : {usage.input_tokens}")
        print(f"Output Tokens : {usage.output_tokens}")
        print(f"Total Tokens  : {usage.total_tokens}")
        print("=================================\n")

        return response.output_text

    except Exception as ex:
        print("\n========== ERROR ==========")
        print("Failed to generate test cases.")
        print(f"Error: {str(ex)}")
        print("===========================\n")
        return None


def review_test_cases(test_cases, reviewer_prompt):
    try:
        print("Reviewer Agent validating test cases...\n")
        response = client.responses.create(
            model=MODEL,
            instructions=reviewer_prompt,
            input=test_cases,
            temperature=0.0
        )

        if not response:
            print("ERROR: No response received from Reviewer Agent.")
            return None

        usage = response.usage

        print("\n========== REVIEW TOKEN USAGE ==========")
        print(f"Input Tokens  : {usage.input_tokens}")
        print(f"Output Tokens : {usage.output_tokens}")
        print(f"Total Tokens  : {usage.total_tokens}")
        print("========================================\n")
        return response.output_text

    except Exception as ex:
        print("\n========== REVIEW ERROR ==========")
        print("Failed to review test cases.")
        print(f"Error: {str(ex)}")
        print("==================================\n")
        return None