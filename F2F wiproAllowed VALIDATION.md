# Topcoder Challenge API - Add field for "wiproAllowed"

## Validation

When DB is already setup and running (following setup described in F2F wiproAllowed README.md), we can start validating the changes.

Run the application:

```
npm start
```

### Postman

Load the updated postman files and link the environment:

- /docs/test challenge creation/Test Challenge Creation.postman_collection.json
- /docs/test challenge creation/Test challenge creation.postman_environment.json

Also load new postman file:

- /docs/wiproAllowed Challenge.postman_collection.json


#### Running Tests

1.  Before creating any new challenges, verify that data loaded from "data-migration" returns correct value for "wiproAllowed".
2.  Open /wiproAllowed Challenge/Get Challenges, "Send" request, validate that "wiproAllowed" of migrated data are "true".

Sample result (excerpt only, cut on purposes):

```json
[
    {
        "id": "c60a3665-4dd9-4df2-8cae-5606279bc15c",
        "name": "Test AI 10/4",
        "description": "public spec",
        "challengeSource": null,
        "descriptionFormat": "markdown",
        "projectId": 100315,
        "typeId": "927abff4-7af9-4145-8ba1-577c16e64e2e",
        "trackId": "36e6a8d0-7e1e-4608-a673-64279d99c115",
        "timelineTemplateId": "f1bcb2c7-3ee4-4fb5-8d0b-efe52c015963",
        "currentPhaseNames": [
            "Registration"
        ],
        "wiproAllowed": true,
        "tags": [
            "QA",
            "AI"
        ],
        "groups": [],
        "submissionStartDate": "2025-04-10T04:46:00.000Z",
```

3.  Now create a new challenge for testing.  Open "/Test Challenge Creation/Development/Create Challenge", "Send" request.  This should result in code "201 Created".
4.  Verify that newly created challenge includes correct value for "wiproAllowed".  Open "/Test Challenge Creation/Verify/Verify V5 Challenge was created".  "Send" request.  Verify that it returned correct value for "wiproAllowed".
    
    You can try different variations when creating a new challenge.  The following can be tested:
    - "wiproAllowed": true
    - "wiproAllowed": false
    - wiproAllowed is not present in payload (this will default to false when saved)
5.  You can also test Put and Patch challenges.  Open the following postman requests to test:

    - "/Test Challenge Creation/Development/PUT Challenge"
    - "/Test Challenge Creation/Development/Patch Challenge"

    When done with updating challenge, go back to GET challenge request to verify if "wiproAllowed" value is updated.
6.  You can test DELETE Challenge by opening "/Test Challenge Creation/Development/Delete Challenge".  You may need to find a valid challenge that can be deleted.

### Swagger

Updated swagger can be found in /docs/swagger.yaml




