# Topcoder Challenge API - Add field for "wiproAllowed"

## Project Setup

Please read main "README.md" file to have general knowledge on how to setup and deploy the project.
Please follow under "Local Deployment" section.  Follow steps:

1. ⚙ Local config
2. 🚢 Start docker-compose with services which are required to start Topcoder Challenges API locally
3. ♻ Running mock-api:

Then create database tables, you can run:
```bash
   npm run create-tables
```

Note: Please request AUTH0_* config details in forum.  This will be required so secure endpoints can be called like create/update challenge.

## Test Data

Since migration is also updated to cater for new field "wiproAllowed", test data would be coming from "data-migration".

Please read "/data-migration/README.md" to have general idea on how to setup and run data migration.

Please note the following:
- DATABASE_URL in .env should be same as in main application.
- get JSON data files from forum and place in 'data' folder under "data-migration"

When DB is already up and tables have been created, run the following to migrate data:

```bash
npm run migrate
```

## Run the App

```bash
npm start
```

