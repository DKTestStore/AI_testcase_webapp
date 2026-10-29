"""Helpers to parse AI-generated test case text into structured data."""
import re

def parse_test_cases(text: str):
    cases = []
    blocks = re.split(r"\n(?=#+\s|\*\*|Test Case)", text)
    for b in blocks:
        b = b.strip()
        if not b:
            continue
        title = b.split("\n")[0].lstrip("#* ").strip()
        cases.append({"title": title, "body": b})
    return cases
