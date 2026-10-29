import os
import json
from datetime import datetime
from dotenv import load_dotenv
from google import genai
from google.genai import types
from .ai_helpers_utils import *

load_dotenv() 

# ---------------------------------------------------------
# QUOTA TRACKER SETUP
# ---------------------------------------------------------
# 1. Get the directory of the current script (ai_helpers folder)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# 2. Navigate one level up to 'ai_test_generator' and into 'reports'
REPORTS_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "reports"))

# 3. Ensure the reports folder actually exists before trying to save to it
os.makedirs(REPORTS_DIR, exist_ok=True)

# 4. Set the final file path
TRACKER_FILE = os.path.join(REPORTS_DIR, "gemini_usage.json")

DAILY_REQUEST_LIMIT = 400
DAILY_TOKEN_LIMIT = 5000000

def get_today_str():
    return datetime.today().strftime('%Y-%m-%d')

def get_today_quota():
    """Loads the JSON as a historical list, safely normalizes keys, and returns today's entry."""
    today = get_today_str()
    usage_data = []
    
    if os.path.exists(TRACKER_FILE):
        try:
            with open(TRACKER_FILE, 'r') as f:
                raw_data = json.load(f)
                if isinstance(raw_data, list):
                    usage_data = raw_data
                elif isinstance(raw_data, dict):
                    usage_data = [raw_data]
        except (json.JSONDecodeError, IOError):
            usage_data = []

    # Normalize existing entries to ensure backwards compatibility
    for item in usage_data:
        if "requests_used" not in item:
            item["requests_used"] = item.pop("requests", 0)
        if "requests_left" not in item:
            item["requests_left"] = DAILY_REQUEST_LIMIT - item["requests_used"]
        if "tokens_used" not in item:
            item["tokens_used"] = item.pop("tokens", 0)
        if "tokens_left" not in item:
            item["tokens_left"] = DAILY_TOKEN_LIMIT - item["tokens_used"]
                
    # Find today's record in the appended history
    today_entry = next((item for item in usage_data if item.get("date") == today), None)
    
    # If today's entry does not exist, create a fresh one
    if not today_entry:
        today_entry = {
            "date": today,
            "requests_used": 0,
            "requests_left": DAILY_REQUEST_LIMIT,
            "tokens_used": 0,
            "tokens_left": DAILY_TOKEN_LIMIT
        }
        usage_data.append(today_entry)
        
    return usage_data, today_entry

def save_quota(usage_data):
    """Saves the entire appended history array back to the JSON file."""
    with open(TRACKER_FILE, 'w') as f:
        json.dump(usage_data, f, indent=4)

# ---------------------------------------------------------
# INITIALIZE Google GenAI Client
# ---------------------------------------------------------
def get_gemini_client():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not found in environment variables.")
    return genai.Client(api_key=api_key)

client = get_gemini_client()
gemini_model =os.getenv("GEMINI_MODEL")

# ---------------------------------------------------------
# GENERATE TEST CASES 
# ---------------------------------------------------------
def generate_test_cases(target_code_or_feature, test_case_generation_prompt):
    
    usage_data, today_entry = get_today_quota()
    
    # 1. Enforce safety limit silently
    if today_entry.get("requests_used", 0) >= DAILY_REQUEST_LIMIT:
        return None

    print("Generating test cases with Gemini... please wait.\n")

    # 2. Call API directly
    try:
        response = client.models.generate_content(
            model=gemini_model,
            contents=target_code_or_feature,
            config=types.GenerateContentConfig(
                system_instruction=test_case_generation_prompt,
                temperature=0.2,
            )
        )
    except Exception:
        return None

    # 3. Extract token metrics safely
    usage = response.usage_metadata
    input_tokens = usage.prompt_token_count if usage else 0
    output_tokens = usage.candidates_token_count if usage else 0
    total_tokens = usage.total_token_count if usage else 0

    # 4. Update metrics
    today_entry["requests_used"] = today_entry.get("requests_used", 0) + 1
    today_entry["requests_left"] = DAILY_REQUEST_LIMIT - today_entry["requests_used"]
    today_entry["tokens_used"] = today_entry.get("tokens_used", 0) + total_tokens
    today_entry["tokens_left"] = DAILY_TOKEN_LIMIT - today_entry["tokens_used"]
    
    # 5. Save updated historical list to JSON
    save_quota(usage_data)

    # 6. Print required format structure
    print("\n========== TOKEN USAGE & QUOTA ==========")
    print(f"Input Tokens  : {input_tokens}")
    print(f"Output Tokens : {output_tokens}")
    print(f"Total Tokens  : {total_tokens}")
    print("-----------------------------------------")
    print(f"Requests Used Today : {today_entry['requests_used']} | Requests Left : {today_entry['requests_left']}")
    print(f"Tokens Used Today   : {today_entry['tokens_used']} | Tokens Left   : {today_entry['tokens_left']}")
    print("=========================================\n")
    
    return response.text

# Review the test case using Google Gemini model
# def review_test_cases(generate_test_cases_details, reviewer_prompt):
#     """
#     Agent 2: Acts as the QA Lead to validate and clean the formatting.
#     """
#     print("Agent 2 (Reviewer) is checking formatting and constraints...\n")
#     #client = genai.Client()

#     try:
#         # Note: temperature=0.0 makes the AI strict and deterministic
#         response = client.models.generate_content(
#             model=GEMINI_MODEL, 
#             contents=generate_test_cases_details,
#             config=types.GenerateContentConfig(
#                 system_instruction=reviewer_prompt,
#                 temperature=0.0, 
#             )
#         )

#         usage = response.usage_metadata
#         print("\n========== REVIEWER TOKEN USAGE ==========")
#         print(f"Input Tokens : {usage.prompt_token_count}")
#         print(f"Output Tokens : {usage.candidates_token_count}")
#         print(f"Total Tokens : {usage.total_token_count}")
#         print("==========================================\n")

#         return response.text
#     except Exception as e:
#         print(f"Reviewer Agent encountered an API error: {e}")
#         # If the reviewer fails (e.g., a 503 error), return the original draft so data isn't lost
#         return generate_test_cases_details