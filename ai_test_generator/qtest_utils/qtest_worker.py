"""Background-style worker for qTest uploads."""
from .qtest_helpers import upload_test_cases

def process_upload(session_data: dict):
    cases = session_data.get("test_cases", [])
    return upload_test_cases(cases)
