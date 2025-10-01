# NOTE
- Auditlog amd Attachment have mismatching `challengeId` and are therefore omitted  
- Event arrays in source data are empty  
- No data pertaining to `ChallengeConstraint` found in the source data. Only constraints for `ChallengePhaseConstraint` seem to be present.  
- No data for ChallengeDiscussionOption found in given data.  


# JSON to PostgreSQL Migration Tool

A modular, configurable tool for migrating JSON data to PostgreSQL databases using Prisma ORM.

## Overview

This tool provides a robust framework for migrating data from JSON files to a PostgreSQL database using Prisma. It follows a modular architecture with separate migrators for each model, allowing for flexible and maintainable code.

## Features

- **Modular Architecture**: Separate migrators for each model
- **Configurable Behavior**: Control how missing fields are handled
- **Dependency Management**: Proper handling of relationships between models
- **Batch Processing**: Efficient migration of large datasets
- **Transaction Support**: Ensures data integrity during migration
- **Detailed Logging**: Configurable logging levels
- **Migration Statistics**: Comprehensive reporting of migration results
- **Validation Testing**: Verify data integrity after migration

## Project Structure

/migration-tool/  
├── .env                    # Environment variables  
├── logs/                   # Migration logs folder  
├── data/                   # JSON data files for migration  
│   ├── challenges.json  
│   ├── phases.json  
│   ├── ...    
├── prisma/                 # Prisma configuration  
│   ├── schema.prisma       # Database schema definition  
│   └── migrations/         # Generated Prisma migrations  
├── src/                    # Source code  
│   ├── config.js           # Configuration from environment variables  
│   ├── index.js            # Main entry point  
│   ├── migrationManager.js # Core migration manager  
│   ├── migrators/          # Model-specific migrators  
│   │   ├── _baseMigrator.js  
│   │   ├── challengeMigrator.js  
│   │   ├── phaseMigrator.js  
│   │   └── ...
│   └── utils/              # Utility functions  
│   │   └── dataLoader.js   # JSON data loading utilities  


## Installation

1. **Install dependencies**:  
   ```bash
   npm install
   ```

2. **Configure your environment variables**:  
   - Environment variables are stored in `.env` file in the root  
   - Update the database connection strings and other settings if necessary.

3. **Generate Prisma client**:  
   ```bash
   npx prisma generate
   ```

## Usage

### Preparing Your Data

Place your JSON data files in the `data` directory:

Filenames can be configured in the `.env` as follows:
```
CHALLENGE_FILE=challenge-api.challenge.json
CHALLENGE_TYPE_FILE=ChallengeType_dynamo_data.json
CHALLENGE_TRACK_FILE=ChallengeTrack_dynamo_data.json
TIMELINE_TEMPLATE_FILE=TimelineTemplate_dynamo_data.json
CHALLENGE_TIMELINE_TEMPLATE_FILE=ChallengeTimelineTemplate_dynamo_data.json
AUDIT_LOG_FILE=AuditLog_dynamo_data.json
ATTACHMENT_FILE=Attachment_dynamo_data.json
PHASE_FILE=Phase_dynamo_data.json
```

### Start the local database
```
# Start the docker postgresql database
npm run db:up

# Additional commands
npm run db:down # Shut down the docker db
npm run db:reset # Reset the db
```

### Create the necessary tables
```
npx prisma migrate dev
```

### Running the Migration
```
npm run migrate

# Additional commands
npm run migrate:reset # Reset the db and run the migration tool
```
### Configuration Options
You can configure the migration behavior through environment variables:
```
# Database connection
DATABASE_URL=postgresql://username:password@localhost:5432/database_name

# Migration settings
DATA_DIRECTORY=./data
BATCH_SIZE=100
CONCURRENCY_LIMIT=10
LOG_LEVEL=info

# Migration behavior
SKIP_MISSING_REQUIRED=false
USE_TRANSACTIONS=true
CHALLENGE_COUNTERS_ONLY=false
MIGRATORS_ONLY=

# Migration attribution
CREATED_BY=migration
UPDATED_BY=migration
```
`SKIP_MISSING_REQUIRED` skips the record if required fields are missing. When `false`, default values for required fields must be configured in `src/config.js`  
Logfiles are by default stored in `logs/migration.log`  
It can be configured using the env variable `LOG_FILE`  
Log levels(increasing level of information): `error`, `warn`, `info`, `debug`  
Further migration configuration can also be done in `src/config.js`

### Updating Challenge Counters Only

Set `CHALLENGE_COUNTERS_ONLY=true` to re-run the `Challenge` migrator without touching other fields. In this mode the tool will skip normal validations and only update `numOfRegistrants` and `numOfSubmissions` for challenges that already exist in the database. Make sure the JSON payload still includes the challenge `id` and the counter values you want to refresh.

### Selecting Specific Migrators

Use `MIGRATORS_ONLY` (comma-separated list) to limit which migrators run. The filter matches either the model name or the migrator class name without the `Migrator` suffix. Examples:

- `MIGRATORS_ONLY=Challenge` runs the challenge migrator only.
- `MIGRATORS_ONLY=Challenge,ChallengeType,ChallengeTrack` runs those three migrators.

Combine with `CHALLENGE_COUNTERS_ONLY=true` to update just the challenge counters for existing rows.

## Testing
The project includes comprehensive tests to validate that data has been migrated correctly:
```
# Run all tests
npm run test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage

# Additional commands
npm run migrate:test       # Run migration tool and then run tests
npm run migrate:reset:test # Reset db, run migration, and then run tests
```
## Migration Process
The migration follows these steps:  
- ResourceRole Migration: Migrates the source of truth model first 
- Independent Model Migration: Migrates MemberProfile and MemberStats  
- Dependent Model Migration: Migrates ResourceRolePhaseDependency and Resource with relationship validation  
- Validation: Verifies data integrity and relationships  

## Extending the Tool
### Adding a New Model
Create a new entry in the `migrator` obj of `src/config.js`
```
migrator: {
  modelName: {
    idField: String
    priority: Int
    requiredFields: Array(String)
    // Rest of the model config ...
  }
}
```  
Create a new migrator in `src/migrators/`:
```
const { BaseMigrator } = require('./_baseMigrator');

class NewModelMigrator extends BaseMigrator {
  constructor() {
    super('NewModel', 2);
  }
  
  async migrate() {
    // Implementation
  }
}

module.exports = { NewModelMigrator };
```
Register the migrator in `src/index.js`:
```
manager.registerMigrator(new NewModelMigrator());
```
### Seeding
The tool can be integrated into prisma seeding by modifying the `package.json` and adding
```
"prisma": {
    "seed": "node src/index.js"
}
```
Run the seed command:
```
npx prisma db seed
```
Prisma will automatically run the seed script in these scenarios:
- When you run prisma migrate reset
- When the database is reset during prisma migrate dev
- When the database is created by prisma migrate dev  
If you want to skip seeding during these operations, you can use the `--skip-seed` flag:
```
npx prisma migrate dev --skip-seed
```
