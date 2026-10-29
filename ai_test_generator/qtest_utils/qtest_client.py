"""qTest API client."""
import os, requests

class QTestClient:
    def __init__(self):
        self.base = os.getenv("QTEST_BASE_URL", "").rstrip("/")
        self.token = os.getenv("QTEST_TOKEN", "")
        self.project = os.getenv("QTEST_PROJECT_ID", "")

    def headers(self):
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def create_test_case(self, name: str, description: str):
        url = f"{self.base}/api/v3/projects/{self.project}/test-cases"
        payload = {"name": name, "description": description}
        r = requests.post(url, json=payload, headers=self.headers())
        return r.json()
