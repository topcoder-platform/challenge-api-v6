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
- **Incremental Updates**: Date-filtered migrations with selective field updates for efficient data synchronization

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
```bash
# Run full migration (default)
npm run migrate

# Run incremental migration with date filter
MIGRATION_MODE=incremental INCREMENTAL_SINCE_DATE=2024-01-15T00:00:00Z npm run migrate

# Run incremental migration with selective field updates
MIGRATION_MODE=incremental INCREMENTAL_SINCE_DATE=2024-01-15T00:00:00Z INCREMENTAL_FIELDS=status,updatedAt npm run migrate
```

For more details on incremental migrations, see the `Incremental Updates` section below.

```bash
# Additional commands
npm run migrate:reset # Reset the db and run the migration tool
```

### Prize Set Comparison Utility

Fix up prize sets that may have drifted during incremental imports. Use the helper to review differences between the legacy payload and v6:
```
npm run compare:prizesets -- --since 2025-01-01T00:00:00Z
```

Add `--verbose` to print the full legacy/v6 arrays when you need additional context. Include `--apply` to overwrite the v6 prize sets with the legacy values for each mismatch:
```
npm run compare:prizesets -- --since 2025-01-01T00:00:00Z --apply
```

When `--apply` is omitted, the script simply reports any differences and suggests next steps.

### Configuration Options

The migration tool is configurable through environment variables. You can set these in your `.env` file or pass them directly on the command line.

**Database Configuration**
```
DATABASE_URL=postgresql://username:password@localhost:5432/database_name
```

**Migration Settings**
```
DATA_DIRECTORY=./data
BATCH_SIZE=100
CONCURRENCY_LIMIT=10
LOG_LEVEL=info
```

**Migration Behavior**
```
SKIP_MISSING_REQUIRED=false
USE_TRANSACTIONS=true
CHALLENGE_COUNTERS_ONLY=false
MIGRATION_MODE=full
INCREMENTAL_SINCE_DATE=
INCREMENTAL_FIELDS=
MIGRATORS_ONLY=
```

**Migration Attribution**
```
CREATED_BY=migration
UPDATED_BY=migration
```

`SKIP_MISSING_REQUIRED` skips the record if required fields are missing. When `false`, default values for required fields must be configured in `src/config.js`.  
`MIGRATION_MODE` controls the migration strategy. Set to `full` for complete data loads or `incremental` for date-filtered updates. Defaults to `full`. See the `Incremental Updates` section below for detailed usage.  
`INCREMENTAL_SINCE_DATE` specifies the cutoff date for incremental migrations (ISO 8601 format, e.g., `2024-01-15T00:00:00Z`). Only records with `updatedAt` or `updated` fields after this date are processed. Required when `MIGRATION_MODE=incremental`.  
`INCREMENTAL_FIELDS` is an optional comma-separated list of field names (e.g., `status,updatedAt,name`) that restricts which fields are updated during incremental migrations. When omitted, all fields are updated. The fields `updatedAt` and `updatedBy` are always included. Useful for targeted updates like status changes or counter refreshes.  
Logfiles are by default stored in `logs/migration.log`.  
You can set a custom location with the `LOG_FILE` environment variable.  
Log levels (in increasing verbosity): `error`, `warn`, `info`, `debug`.  
Further migration configuration can also be done in `src/config.js`.

## Incremental Updates

Incremental updates let you run a full migration once and then keep the database in sync with smaller, targeted refreshes. After the initial load, you can filter subsequent runs to only process records changed after a specific date. The migrators handle both updates to existing rows and insertion of new records while leaving untouched data in place. This will help cut down on the time needed to migrate the data on the final cutover date.

### How It Works
1. **Date filtering**: Only records with `updatedAt` or `updated` values later than `INCREMENTAL_SINCE_DATE` are loaded into memory.
2. **Selective field updates**: When `INCREMENTAL_FIELDS` is set, only those fields are updated on matching database records; otherwise, all fields are considered for updates.
3. **Upsert behavior**: New records are inserted in full, while existing records receive partial or full updates based on your configuration.

All standard validation rules, dependency checks, and relational guarantees remain in effect while running in incremental mode.

### Configuration
- `MIGRATION_MODE`: Set to `incremental` to enable this workflow (defaults to `full`).
- `INCREMENTAL_SINCE_DATE`: ISO 8601 timestamp that defines the cutoff date (e.g., `2024-01-15T00:00:00Z`). Only records updated after this value are processed.
- `INCREMENTAL_FIELDS`: Optional comma-separated list to limit which fields are updated (e.g., `status,updatedAt,name`). When omitted, all fields are updated; when set, the tool automatically includes `updatedAt` and `updatedBy`.

### Limitations
- Records without `updatedAt` or `updated` fields will be skipped in incremental mode (a warning is logged).
- The `INCREMENTAL_FIELDS` configuration applies globally to all migrators; model-specific field lists are not currently supported.
- Deleted records in the source data are not removed from the database; incremental mode only handles updates and inserts.
- Dependency validation still requires related records to exist; ensure dependent models are included in the incremental run.

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
