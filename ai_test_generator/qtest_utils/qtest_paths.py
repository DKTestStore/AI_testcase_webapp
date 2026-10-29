from ai_test_generator.qtest_utils.qtest_helpers import *



# create the URL for creating test cases in qTest
def create_test_case_url(QTEST_BASE_URL,QTEST_PROJECT_ID):
    return f"{QTEST_BASE_URL}/{QTEST_PROJECT_ID}/test-cases/"


# gets the requirement URL for qTest
def get_requirement_url(QTEST_BASE_URL,QTEST_PROJECT_ID):
    return f"{QTEST_BASE_URL}/{QTEST_PROJECT_ID}/requirements/"


# Create the URL for Link Requirement and Test Case in qTest
def link_testcase_and_requirement_url(QTEST_BASE_URL,QTEST_PROJECT_ID):
    return f"{QTEST_BASE_URL}/{QTEST_PROJECT_ID}/req-tc-links/"


#Create the URL for Creating Module or Folder Before Uploading Test case 
def create_Module_url(QTEST_BASE_URL,QTEST_PROJECT_ID):
    return f"{QTEST_BASE_URL}/{QTEST_PROJECT_ID}/modules"