"""Jira integration worker."""
import os
from jira import JIRA

def get_jira():
    return JIRA(
        server=os.getenv("JIRA_URL"),
        basic_auth=(os.getenv("JIRA_EMAIL"), os.getenv("JIRA_API_TOKEN"))
    )

def create_issue(summary: str, description: str, project: str = "TEST"):
    jira = get_jira()
    return jira.create_issue(project=project, summary=summary, description=description, issuetype={"name": "Task"})
