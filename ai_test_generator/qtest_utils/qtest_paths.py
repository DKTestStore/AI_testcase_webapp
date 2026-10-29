from pathlib import Path

REPORTS = Path(__file__).resolve().parent.parent / "reports"
REPORTS.mkdir(exist_ok=True)

def report_path(name: str) -> Path:
    return REPORTS / name
