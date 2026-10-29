import os
import re
import base64
from dotenv import load_dotenv
from fastmcp import FastMCP
from jira import JIRA
from jira.exceptions import JIRAError
import json
import re
from typing import Dict, List, Any

# Load environment variables from a .env file (if present)
load_dotenv()

# Initialize the isolated Jira MCP Server
mcp = FastMCP("Jira Worker")

def extract_brd_links(text: str) -> list[str]:
    """
    Extracts URLs from the description that are likely BRD links.

    Handles Jira/Confluence "smart-link" wiki markup of the form
    [display_text|https://url|smart-link] and HTML anchors, both of
    which previously caused the pipe "|" character to be swallowed
    into the URL match (merging duplicate URLs and trailing text like
    "|smart-link" into a single broken string).
    """
    if not text:
        return []

    # Regex pattern to find standard HTTP/HTTPS URLs.
    # NOTE: "|" is now excluded so smart-link markup [text|url|smart-link]
    # and duplicated href/title/text URLs in HTML anchors are not merged
    # into one oversized match.
    url_pattern = r'https?://[^\s><"\'\]\)\|]+'
    raw_urls = re.findall(url_pattern, text)

    # Strip common trailing markdown/wiki punctuation (e.g. "*", "_", ",", ".")
    # and de-duplicate while preserving first-seen order (Jira often repeats
    # the same URL in href, title, and visible text of an anchor tag).
    seen = set()
    all_urls = []
    for url in raw_urls:
        cleaned = url.rstrip('*_,.;:')
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            all_urls.append(cleaned)

    # Filter for common documentation keywords/domains or return all found links
    brd_keywords = ["confluence", "sharepoint", "docs.google", "drive.google", ".pdf", ".docx", "brd", "document"]
    brd_links = [url for url in all_urls if any(kw in url.lower() for kw in brd_keywords)]

    # Fallback to returning all extracted URLs if no keyword-matched BRD link is filtered
    return brd_links if brd_links else all_urls


def extract_brd_marked_links(text: str) -> list[str]:
    """
    Specifically finds the link(s) that appear immediately after a "BRD"
    label in the description, regardless of casing or spacing variants:
    "BRD:", "BRD :", "BRD", "brd:", "brd :", "brd", etc.

    Unlike extract_brd_links() (which returns ANY documentation-looking
    link found anywhere in the text based on keyword matching), this
    targets only the link(s) explicitly tagged with a "BRD" label so
    downstream consumers (e.g. an LLM test-case generator) can reliably
    fetch the correct Business Requirements Document, as opposed to
    other links in the ticket (ClickUp ticket, production info sheets,
    Loop research docs, etc.).
    """
    if not text:
        return []

    # (?i) case-insensitive; \bBRD\b matches the whole word "BRD"/"brd";
    # optional colon and whitespace; optional opening "[" from wiki markup;
    # then capture the URL, stopping at whitespace/quotes/brackets/pipe.
    pattern = r'(?i)\bBRD\b\s*:?\s*\[?\s*(https?://[^\s"\'<>\]\)\|]+)'
    raw_matches = re.findall(pattern, text)

    seen = set()
    brd_marked_links = []
    for url in raw_matches:
        cleaned = url.rstrip('*_,.;:')
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            brd_marked_links.append(cleaned)
    return brd_marked_links


def classify_sharepoint_doc_type(url: str) -> str:
    """
    Infers the document type of a SharePoint share link from its
    ":x:" style path segment marker (e.g. ":w:" = Word, ":x:" = Excel).
    Falls back to "unknown" for non-SharePoint links or unrecognized markers.
    """
    match = re.search(r'sharepoint\.com/:([a-z]{1,2}):', url, re.IGNORECASE)
    if not match:
        return "unknown"

    marker = match.group(1).lower()
    type_map = {
        "w": "word_document",
        "x": "excel_spreadsheet",
        "p": "powerpoint_presentation",
        "b": "pdf",
        "f": "folder",
        "fl": "loop_document",
        "u": "onenote"
    }
    return type_map.get(marker, "unknown")


def find_field_id_by_name(jira_client: JIRA, target_names: list[str]) -> str | None:
    """
    Looks up a Jira custom field's internal id (e.g. 'customfield_10041') by its
    human-readable display name (case-insensitive, partial match allowed).

    This is needed because many Jira projects store "Acceptance Criteria" /
    "Scenario(s)" in a DEDICATED custom field rather than inside the main
    Description field. If we only ever read `issue.fields.description`, we
    will silently miss that content even though it is clearly visible on the
    ticket in the browser.
    """
    try:
        for f in jira_client.fields():
            name = (f.get("name") or "").strip().lower()
            for target in target_names:
                if target.lower() in name:
                    return f.get("id")
    except Exception:
        pass
    return None


def get_additional_text_fields(jira_client: JIRA, issue) -> str:
    """
    Pulls in text from commonly-used custom fields (Acceptance Criteria,
    Scenario(s), Testing Scenario) so that AC/Scenario content is found
    regardless of whether it lives in Description or in its own field.
    Returns a combined string (may be empty if no such fields exist/are set).
    """
    extra_text_parts = []
    field_name_groups = [
        ["Acceptance Criteria"],
        ["Testing Scenario", "Scenario"],
    ]
    for names in field_name_groups:
        field_id = find_field_id_by_name(jira_client, names)
        if not field_id:
            continue
        try:
            value = getattr(issue.fields, field_id, None)
        except Exception:
            value = None
        if value:
            if isinstance(value, str):
                extra_text_parts.append(value)
            else:
                extra_text_parts.append(str(value))
    return "\n\n".join(extra_text_parts)


@mcp.tool
def pull_jira_story(issue_key: str) -> dict:
    """
    Fetches the summary, description, BRD links, and Base64 encoded screenshots 
    of a Jira issue for LLM test case generation.
    """
    # Securely retrieve credentials from environment variables without hardcoded fallbacks
    jira_url = os.environ.get("JIRA_URL","").strip()
    jira_email = os.environ.get("JIRA_EMAIL","").strip()
    jira_token = os.environ.get("JIRA_API_TOKEN","").strip()

    #print("jira url is : " + jira_url)
    #print("jira email is : " + jira_email)
    #print("jira token is : " + jira_token)

    if not all([jira_url, jira_email, jira_token]):
        return {
            "status": "error",
            "message": "Missing required Jira environment variables (JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN)."
        }

    try:
        jira_client = JIRA(server=jira_url, basic_auth=(jira_email, jira_token))
        issue = jira_client.issue(issue_key)

        summary = issue.fields.summary
        description = issue.fields.description or "No description provided."

        # --- FIX #1 ------------------------------------------------------------
        # Acceptance Criteria / Scenario content can live in a SEPARATE Jira
        # custom field instead of (or in addition to) the Description field.
        # Merge it in here so nothing downstream is missed.
        extra_fields_text = get_additional_text_fields(jira_client, issue)
        if extra_fields_text and extra_fields_text.strip() not in description:
            description = f"{description}\n\n{extra_fields_text}"
        # -------------------------------------------------------------------------

        # 1. Extract BRD Document Links from Description
        brd_links = extract_brd_links(description)

        # 1b. Extract link(s) specifically tagged with a "BRD" label
        #     (handles BRD:, BRD :, brd:, brd, etc.) and package them as
        #     a separate, clearly-identified object for downstream LLM
        #     consumption -- distinct from the general brd_links list.
        brd_marked_urls = extract_brd_marked_links(description)
        brd_documents = [
            {
                "url": url,
                "file_type": classify_sharepoint_doc_type(url)
            }
            for url in brd_marked_urls
        ]

        # 2. Extract and Process Image Attachments / Screenshots
        images_data = []
        if hasattr(issue.fields, "attachment") and issue.fields.attachment:
            for attachment in issue.fields.attachment:
                # Check for standard image mime types
                if attachment.mimeType.startswith("image/"):
                    try:
                        # Authenticated fetch of the attachment content
                        response = jira_client._session.get(attachment.content)
                        if response.status_code == 200:
                            encoded_image = base64.b64encode(response.content).decode("utf-8")
                            images_data.append({
                                "filename": attachment.filename,
                                "mime_type": attachment.mimeType,
                                "base64": encoded_image
                            })
                    except Exception as img_err:
                        images_data.append({
                            "filename": attachment.filename,
                            "error": f"Failed to download image: {str(img_err)}"
                        })

        # Structured response suitable for downstream LLM prompts
        return {
            "status": "success",
            "issue_key": issue_key,
            "summary": summary,
            "description": description,           # FULL, untouched description text -- nothing removed or skipped,
                                                    # even the line(s) containing the BRD link stay in place.
                                                    # BRD link(s) are ALSO captured below in brd_links/brd_documents.
            "brd_links": brd_links,
            "brd_documents": brd_documents,
            "screenshots": images_data
        }

    except JIRAError as e:
        return {"status": "error", "message": f"Jira API Error: {e.text} (Status Code: {e.status_code})"}
    except Exception as e:
        return {"status": "error", "message": f"System Error pulling Jira story: {str(e)}"}



def find_brd_links(result: Dict[str, Any]) -> List:
    # --- FIX ------------------------------------------------------------------
    # Previously this scanned str(result) -- the Python string-repr of the
    # WHOLE dict. That repr turns real newline characters into the two literal
    # characters "\" + "n" (not whitespace), so the URL-matching regex (which
    # only stops at real whitespace/quotes) would keep consuming characters
    # past the end of the actual URL and swallow trailing description text
    # into what should have been a clean, isolated link
    # (e.g. ".../RS-22747-BRD.docx\n\nAcceptance" instead of just
    # ".../RS-22747-BRD.docx"). Scanning the actual description/brd_links
    # fields directly (real text, real newlines) avoids this corruption
    # entirely, and also means we no longer accidentally pick up incidental
    # URLs from unrelated dict keys (e.g. screenshot base64 blobs).
    description_text = str(result.get("description", ""))
    already_found_links = result.get("brd_links") or []
    payload_text = (description_text + " " + " ".join(already_found_links)).lower()

    urls = re.findall(r'https?://[^\s"\'<>\]\)\|]+', description_text)
    # Also fold in any links already captured upstream (e.g. by
    # extract_brd_links/extract_brd_marked_links in pull_jira_story), in case
    # description_text isn't available for some caller.
    urls.extend(already_found_links)
    # -----------------------------------------------------------------------------

    brd_links = []
    for url in urls:
        cleaned = url.rstrip('*_,.;:')
        lower_url = cleaned.lower()
        if (
            "brd" in lower_url
            or "requirements" in lower_url
            or "requirement" in lower_url
            or "specification" in lower_url
            or "spec" in lower_url
            or "sharepoint" in lower_url and ("brd" in payload_text or "requirement" in payload_text)
        ):
            brd_links.append(cleaned)

    return list(dict.fromkeys(brd_links))



def extract_ac_and_scenarios(description):
    result = {
        "acceptance_criteria": "",
        "scenarios": "",
        "scenario_list": [],
        "has_scenarios": False,
        "has_acceptance_criteria": False
    }

    if not description:
        return result

    text = description.replace("\r\n", "\n").strip()

    # --- FIX: line-anchored headings (avoids matching the word "scenario" mid-sentence) ---
    HEADING_PREFIX = r"^[ \t]*(?:\|{1,2}|#{1,6}|h[1-6]\.|\*+)?[ \t]*"

    ac_patterns = [
        HEADING_PREFIX + r"Acceptance\s+Criteria(?:\s*\d+)?\s*[:\-\u2013]?\s*\|{0,2}\s*\n?(.*?)"
        r"(?=\n[ \t]*(?:\|{1,2}|#{1,6}|h[1-6]\.|\*+)?[ \t]*(?:Testing\s+Scenarios?|Scenarios?)\b\s*[:\-]?|\Z)"
    ]
    for pattern in ac_patterns:
        ac_match = re.search(pattern, text, re.IGNORECASE | re.DOTALL | re.MULTILINE)
        if ac_match:
            result["acceptance_criteria"] = ac_match.group(1).strip()
            break

    scenario_patterns = [
        HEADING_PREFIX + r"Testing\s+Scenarios?\s*[:\-\u2013]?\s*\|{0,2}\s*\n?(.*?)"
        r"(?=\n[ \t]*(?:\|{1,2}|#{1,6}|h[1-6]\.|\*+)?[ \t]*(?:Acceptance\s+Criteria|Testing\s+Scenarios?)\b\s*[:\-]?|\Z)",
        HEADING_PREFIX + r"Scenarios?\s*[:\-\u2013]?\s*\|{0,2}\s*\n?(.*?)"
        r"(?=\n[ \t]*(?:\|{1,2}|#{1,6}|h[1-6]\.|\*+)?[ \t]*(?:Acceptance\s+Criteria|Testing\s+Scenarios?)\b\s*[:\-]?|\Z)",
    ]
    for pattern in scenario_patterns:
        sc_match = re.search(pattern, text, re.IGNORECASE | re.DOTALL | re.MULTILINE)
        if sc_match:
            result["scenarios"] = sc_match.group(1).strip()
            break

    if result["scenarios"]:
        scenario_items = re.split(r"\n\s*(?:[-*]|\d+\.)\s*", result["scenarios"])
        result["scenario_list"] = [item.strip() for item in scenario_items if item.strip()]

    # --- FIX: presence flags decoupled from fragile text-span extraction ---
    has_ac_heading = bool(re.search(r"Acceptance\s+Criteria", text, re.IGNORECASE))
    has_scenario_heading = bool(re.search(
        r"^[ \t]*(?:\|{1,2}|#{1,6}|h[1-6]\.|\*+)?[ \t]*(?:Testing\s+)?Scenarios?\b\s*[:\-]",
        text, re.IGNORECASE | re.MULTILINE))
    has_gherkin = bool(re.search(r"\bGiven\b", text, re.IGNORECASE)) and \
                  bool(re.search(r"\bWhen\b", text, re.IGNORECASE)) and \
                  bool(re.search(r"\bThen\b", text, re.IGNORECASE))

    result["has_acceptance_criteria"] = bool(result["acceptance_criteria"]) or has_ac_heading
    result["has_scenarios"] = bool(result["scenario_list"]) or has_scenario_heading or has_gherkin

    return result



def analyze_story(result: Dict[str, Any]) -> Dict[str, Any]:
    # Use the FULL, unmodified description -- no lines are ever removed or
    # skipped, including the line containing the BRD link. The BRD link is
    # captured separately into brd_links (see find_brd_links below), while
    # extract_ac_and_scenarios() independently scans this same full text for
    # Acceptance Criteria / Scenario content, so finding a BRD link never
    # blocks reading the rest of the description.
    description = result.get("description", "").strip()
    extracted = extract_ac_and_scenarios(description)
    brd_links = find_brd_links(result)

    response = {
        "status": "",
        "message": "",
        "acceptance_criteria": extracted["acceptance_criteria"],
        "scenarios": extracted["scenarios"],
        "scenario_list": extracted["scenario_list"],
        "brd_links": brd_links
    }

    # Priority 1: Scenarios always win
    if extracted["has_scenarios"]:
        response["status"] = "READY_USING_SCENARIOS"
        response["message"] = "Scenarios found. Generate test cases from scenarios."
        return response

    # Priority 2: Acceptance Criteria if no scenarios
    if extracted["has_acceptance_criteria"]:
        response["status"] = "READY_USING_ACCEPTANCE_CRITERIA"
        response["message"] = "Acceptance criteria found. Generate test cases from acceptance criteria."
        return response

    # Priority 3: BRD only if no AC/scenarios at all
    if brd_links:
        response["status"] = "USE_BRD_FOR_TEST_CASES"
        response["message"] = (
           "BRD link found in the description, but no Acceptance Criteria or Scenario was found. "
            "Please configure local mode and run the pipeline."
        )
        return response

    # Priority 4: Nothing usable
    response["status"] = "INSUFFICIENT_REQUIREMENTS"
    response["message"] = (
        "No Acceptance Criteria, Testing Scenario, Scenario, or BRD link found in the description. "
        "Please update the Jira description or configure local mode and run the pipeline."
    )
    return response