"""Higher-level qTest helpers."""
from .qtest_client import QTestClient

def upload_test_cases(cases: list):
    client = QTestClient()
    results = []
    for c in cases:
        results.append(client.create_test_case(c.get("title", "Untitled"), c.get("body", "")))
    return results
