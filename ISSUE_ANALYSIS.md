# Challenge API v6 - Issue Analysis

## 1. Prize Value Display Issue (#1)
- **Description**: Prize values are being incorrectly divided by 100 in the API response.
- **Current Behavior**:
  - Database value: 20 (correct)
  - API response: 0.2 (incorrect)
- **Expected Behavior**:
  - API should return the exact prize value as stored in the database
- **Affected Endpoint**: Challenge details endpoint
- **Suspected Location**: Prize formatting/processing logic
- **Data Type Impact**: Numeric value handling

## 2. Incomplete Skills Data (#2)
- **Description**: Skills data is incomplete in the API response.
- **Current Behavior**:
  - Only returns skill ID
  - Missing: skill name, category name, category ID
- **Expected Behavior**:
  - Should include full skill details from the skills API
  - Should match v5 API response structure
- **Example Missing Data**:
  ```json
  {
    "name": "Behavior-Driven Development (BDD)",
    "id": "7f26d1d1-7bf8-48f4-8a26-2bd1cd02c82d",
    "category": {
      "name": "Programming and Development",
      "id": "481b5ebc-2fe6-45ed-a90c-736936d458d7"
    }
  }
  ```
- **Affected Endpoint**: Challenge details endpoint
- **Suspected Location**: Skills data retrieval and transformation logic

- **Affected Endpoint**: Challenge details endpoint
- **Suspected Location**: Billing data retrieval and transformation logic

## 4. Missing "Task" Challenge Type (#4)
- **Description**: "Task" challenge type is missing from the challenge types list.
- **Current Behavior**:
  - Only returns: Marathon Match, Challenge, First2Finish
- **Expected Behavior**:
  - Should include "Task" challenge type
  - Complete list should be:
    1. Task
    2. Marathon Match
    3. Challenge
    4. First2Finish
- **Affected Endpoint**: `/v6/challenge-types`
- **Suspected Location**: Challenge types retrieval logic

## 5. Challenge Creation Fails (#5)
- **Description**: Challenge creation results in a 500 error.
- **Error Details**:
  ```
  THIS IS ABOUT THE CHALLENGE CREATION IN GENERAL

## Common Patterns and Observations
1. **Data Type Issues**: Multiple issues related to data type handling (prize values, billingAccountId)
2. **Incomplete Data**: Several endpoints returning incomplete data compared to v5
3. **Consistency**: Some responses don't match the expected v5 API contract
4. **Error Handling**: Some validation errors result in 500 instead of proper error responses

## Next Steps
1. Investigate and fix the prize value formatting
2. Update skills data retrieval to include full details
3. Add billing information to the response
4. Fix challenge types retrieval to include "Task"
5. Resolve the type mismatch in challenge creation
