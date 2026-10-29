import json
from typing import Any, Dict, List
import requests


# --------------------------------------------------------------------------- #
# 5. POST HELPERS (single + bulk) - reused from earlier script
# --------------------------------------------------------------------------- #

def create_test_case(url: str, token: str, payload: Dict[str, Any], timeout: int = 30,) -> Dict[str, Any]:
    """POST a single payload to qTest's create-test-case endpoint."""
    # Headers must include the token for authorization and specify JSON content type
    headers = {"Content-Type": "application/json", "Authorization": token}

    #Actually send the POST request to qTest with the payload
    response = requests.post(url, headers=headers, data=json.dumps(payload), timeout=timeout)

    try:
        body = response.json()
    except ValueError:
        body = {"raw_text": response.text}
    if response.status_code in (200, 201):
        print(f"SUCCESS ({response.status_code}): '{payload.get('name')}' -> id={body.get('pid')}")
    else:
        print(f"FAILED ({response.status_code}): '{payload.get('name')}' -> {body}")

    return {"status_code": response.status_code, "response": body}


def create_test_cases_bulk( url: str, token: str,payloads: List[Dict[str, Any]],) -> List[Dict[str, Any]]:
    """
    POST a list of payloads sequentially (qTest has no native bulk-create
    endpoint). Returns a list of per-test-case results.
    """
    results = []

    for idx, payload in enumerate(payloads, start=1):
        print(f"[{idx}/{len(payloads)}] Creating '{payload.get('name')}' ...")
        results.append(create_test_case(url, token, payload))
    return results  



# This Function to call the qTest API to link test cases to a requirement
def post_call_create_link_between_testcase_and_requriment(url,token,payload, timeout: int = 30, ):
    """
    Link test cases to a requirement in qTest.
    """
    headers = {"Content-Type": "application/json", "Authorization": token}

    #Actually send the POST request to qTest with the payload
    response = requests.post(url, headers=headers, data=json.dumps(payload), timeout=timeout)
    try:
        if response.status_code in (200, 201):
                print(f"SUCCESS :{response.status_code}")
    except ValueError:
        print(f"FAILED {response.status_code}")

    
def post_call_create_module_test_design(
    url: str, parent_id: Any, token: str, payload: Dict[str, Any], timeout: int = 30
    ) -> Dict[str, Any]:
    """
    This API call creates a Module (Folder) under a parent module in qTest.

    IMPORTANT: If parent_id is None/empty, the "parentId" query param is
    omitted entirely rather than sent as an empty string. Sending
    "?parentId=" (blank) is silently treated by qTest as "no parent",
    so the module lands at the project ROOT instead of nesting under
    the module you actually intended.
    """
    params = {}
    if parent_id not in (None, "", 0, "0"):
        params["parentId"] = parent_id
    else:
        print(
            "WARNING: parent_id is empty/None -> parentId param omitted. "
            "Module will be created under the project ROOT, not a specific parent. "
            "Check QTEST_PARENT_MODULE_ID in your .env file."
        )

    headers = {"Content-Type": "application/json", "Authorization": token}

    print(f"POST {url} | params={params} | payload={payload}")
    response = requests.post(url, params=params, headers=headers, data=json.dumps(payload), timeout=timeout)
    print(f"Final URL sent: {response.request.url}")

    try:
        body = response.json()
    except ValueError:
        body = {"raw_text": response.text}

    if response.status_code in (200, 201):
        print(f"SUCCESS ({response.status_code}): module '{payload.get('name')}' -> id={body.get('id')}, parent_id={body.get('parent_id')}")
    else:
        print(f"FAILED ({response.status_code}): module '{payload.get('name')}' -> {body}")

    return {"status_code": response.status_code, "response": body}

