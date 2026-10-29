import ollama

def generate_test_cases(target_code_or_feature):
    # This system prompt sets the AI's role and output format
    system_prompt = """
    You are an expert QA automation engineer specializing in Python and Playwright. 
    Analyze the provided feature or code snippet and generate comprehensive test cases.
    Include functional, negative, and boundary test scenarios.
    Output the test cases in a clear list format. Do not include introductory text.
    Follow this format such as 
    Test Case ID | Test Case Description | Precondition | Test Steps[List of steps] | Expected Result[Expected outcome for Each step]
    Each test case should be unique and cover different aspects of the feature or code provided.
    Atleast 7 test Steps should be included in each test case.
    """

    print("Generating test cases... please wait.\n")
    
    response = ollama.chat(
        model='gemma3:4b',
        messages=[
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': target_code_or_feature}
        ]
    )
    
    print(response['message']['content'])

# Example usage:
feature_description = """
A web login form with two fields: 'username' and 'password', and a 'Submit' button.
Passwords must be at least 8 characters long and contain a special character.
"""

if __name__ == "__main__":
    generate_test_cases(feature_description)