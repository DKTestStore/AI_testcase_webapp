import os
import json
import sys
from pathlib import Path

# Add parent directory to path so we can import modules

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv

from ai_test_generator.ai_helpers.ai_helpers_utils import (
    read_test_case_generator_prompt_file,
    save_to_excel
)
#from worker.qtest_worker import *
from ai_test_generator.ai_helpers.test_generator_gemini import (
    generate_test_cases,
)


from ai_test_generator.qtest_utils.qtest_worker import *

from ai_test_generator.worker.jira_worker import *


# Load API Key from .env file
load_dotenv()

def read_local_feature_description(BASE_DIR: str) -> str:
    feature_file = os.path.join(BASE_DIR, "input", "feature_description.txt")
    if os.path.exists(feature_file):
        with open(feature_file, "r", encoding="utf-8") as f:
            return f.read().strip()
    print(f"File not found: {feature_file}")
    return ""

def fetch_jira_feature_description(issue_key) -> str:
    result = pull_jira_story(issue_key)

    if result.get("status") != "success":
        print(f"Jira pull failed: {result}")
        return ""


    description = result.get("description", "")
    if not description:
        print("No Jira description found.")
        return ""
    # ---------------------------------------------------------
    # SET DYNAMIC PATH FOR JIRA OUTPUT
    # ---------------------------------------------------------
    # 1. Get the directory of the current script (test_runner folder)
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

    # 2. Navigate one level up to 'ai_test_generator' and into 'reports'
    REPORTS_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "reports"))

    # 3. Ensure the reports folder exists before saving
    os.makedirs(REPORTS_DIR, exist_ok=True)

    # 4. Set the precise file path
    JIRA_OUTPUT_FILE = os.path.join(REPORTS_DIR, "jira_story_output.json")

    # ---------------------------------------------------------
    # SAVE PAYLOAD
    # ---------------------------------------------------------
    # Save raw Jira payload for downstream use in the reports folder
    with open(JIRA_OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    sections=analyze_story(result)
    status = sections.get("status", "")
    message = sections.get("message", "")

    if status in ("USE_BRD_FOR_TEST_CASES", "INSUFFICIENT_REQUIREMENTS"):
        print(message)
        return ""
    
    acceptance_criteria = (sections.get("acceptance_criteria") or "").strip()
    scenarios = (sections.get("scenarios") or "").strip()

    if scenarios:
        print(f"Scenario={scenarios}")
        return scenarios
    if acceptance_criteria:
        print(f"acceptance_criteria={acceptance_criteria}")
        return acceptance_criteria

    return description


def main_pipeline():

    # Define paths to the prompt files
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    use_jira_raw = os.environ.get("ENABLE_JIRA_REQURIMENT", "").strip().lower()
    use_jira = use_jira_raw in ("1", "true", "yes", "y")

    Story_Id= os.environ.get("STORY_ID","").strip()
    print(f"use_jira={use_jira}")

    if use_jira==True:
        print("Jira mode enabled. Pulling data from Jira...")
        feature_description = fetch_jira_feature_description(Story_Id)
    else:
        print("Local file mode enabled.")
        feature_description = read_local_feature_description(BASE_DIR)

    if not feature_description:
        print("No feature description available to generate tests. Stopping pipeline.")
        return

    # Load Prompt File and Generate Test case
    GENERATOR_PROMPT = os.path.join(BASE_DIR,"prompt","test_cases_generator_prompt.md")
    test_generator_prompt = read_test_case_generator_prompt_file(GENERATOR_PROMPT)
        
    if not test_generator_prompt:
        print("Stopping execution due to missing prompt files.")
        return

    draft_markdown = generate_test_cases(feature_description, test_generator_prompt)


    REPORTS_DIR = os.path.join(BASE_DIR, "reports")
    os.makedirs(REPORTS_DIR, exist_ok=True)  # Create reports directory if it doesn't exist
    MANUAL_TEST_CASES_FILE = os.path.join(REPORTS_DIR, "Manual_test_cases.xlsx")
    save_to_excel(draft_markdown, MANUAL_TEST_CASES_FILE)


    # #Create Module or Folder which should Link with Test case 
    # module_id=create_module_for_test_design(Story_Id)
    
    # # Upload the Test Cases to qTest
    # results = qtest_create_testcase(MANUAL_TEST_CASES_FILE,module_id)

    # # Collect qTest Internal IDs from successful test case creation results
    # testcase_ids = collect_testcase_ids(results)
    # print(f"Collected qTest Internal IDs: {testcase_ids}")

    # # Link Test case and Requirement in qTest
    # link_results = link_testcase_to_requirement(testcase_ids)
    # print(f"Linking test cases to requirement result: {link_results}")

if __name__ == "__main__":
    main_pipeline()
    