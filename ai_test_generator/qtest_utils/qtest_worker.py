from pathlib import Path
from ai_test_generator.qtest_utils.qtest_client import *
from ai_test_generator.qtest_utils.qtest_helpers import *
from ai_test_generator.qtest_utils.qtest_paths import *
from dotenv import load_dotenv

load_dotenv()

qtest_base_url = os.environ.get("QTEST_BASE_URL","").strip()
qtest_token = os.environ.get("QTEST_TOKEN","").strip()
qtest_project_id = os.environ.get("QTEST_PROJECT_ID","").strip()
qtest_requriment_id = os.environ.get("QTEST_REQUIREMENT_ID","").strip()
qtest_parent_module_id = os.environ.get("QTEST_PARENT_MODULE_ID","").strip()

# Save payloads to the reports folder for debugging purposes
reports_dir = Path(__file__).resolve().parent.parent / "reports"
reports_dir.mkdir(parents=True, exist_ok=True)

## 1. QTEST WORKER - main entry point for creating test cases in qTest
def qtest_create_testcase(excel_path,module_id):

    if not os.path.exists(excel_path):
        raise FileNotFoundError(f"Excel file not found: {excel_path}")

    parent_id = (int(module_id)
        if module_id
        else None
    )

    # Building the payloads for each test case from the Excel file
    test_cases = read_test_cases_from_excel(excel_path)
    print(f"Parsed {len(test_cases)} test cases")
    bulk_payloads = build_bulk_payloads(test_cases,parent_id)

     
    payload_file = reports_dir / "qtest_create_testcase_payloads.json"
    with open(payload_file, "w", encoding="utf-8") as fp:
        json.dump(bulk_payloads, fp, indent=2)

    results = create_test_cases_bulk(create_test_case_url(qtest_base_url, qtest_project_id), qtest_token, bulk_payloads)

    #print(f"Results from  qtest worker : {results}")
    success_count = sum(1
        for result in results
         if result["status_code"] in (200, 201)
    )
    print(f"Created {success_count}/{len(results)} test cases")

    save_qtest_results_to_excel(excel_path, bulk_payloads, results)
    return results

## Collect qTest Internal IDs from successful test case creation results
def collect_testcase_ids(results):
    """
    Extract qTest Internal IDs from successful test case creation results.
    """
    testcase_ids = []
    for result in results:
        response = result.get("response", {})

        if result.get("status_code") in (200, 201):
            tc_id = response.get("id")

            if tc_id:
                testcase_ids.append(tc_id)

    return testcase_ids

# Link Test case and Requriment in qTest
def link_testcase_to_requirement(testcase_ids):
    """
    Link test cases to a requirement in qTest.
    """
    if not testcase_ids:
        print("No test case IDs provided for linking.")

    # Build payload for linking test cases to a requirement.
    raw_payload = build_payload_for_linking_requirement_and_testcase(
        testcase_ids, qtest_requriment_id
    )

    # Save payloads to the reports folder for debugging purposes
    payload_file = reports_dir / "qtest_link_testcase_to_requirement_payloads.json"
    with open(payload_file, "w", encoding="utf-8") as fp:
        json.dump(raw_payload, fp, indent=2)

    # Actually send the POST request to qTest with the payload
    result = post_call_create_link_between_testcase_and_requriment(
        link_testcase_and_requirement_url(qtest_base_url, qtest_project_id), qtest_token, raw_payload
    )

    return result



def create_module_for_test_design(payload_name):
    """
    Create a Module (Folder) under the configured parent module in qTest.
    Returns the newly created module's ID, or None if creation failed.
    """
    url = create_Module_url(qtest_base_url, qtest_project_id)
    payload = build_payload_for_create_module(payload_name)
    print(qtest_parent_module_id)
    response = post_call_create_module_test_design(url, qtest_parent_module_id, qtest_token, payload)

    module_id = None
    if response and response.get("status_code") in (200, 201):
        module_id = response.get("response", {}).get("id")
        print(f"Module created successfully. module_id={module_id}")
    else:
        print("Module is not Created")

    return module_id




    
