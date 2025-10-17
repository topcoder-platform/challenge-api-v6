const { BaseMigrator } = require('./_baseMigrator');
const { Prisma } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

/**
 * Migrator for ChallengeMetadata model
 */
class ChallengeMetadataMigrator extends BaseMigrator {
    constructor() {
        super('ChallengeMetadata', 3);
    }

    async loadData() {
        // Load nested data from the Migration Manager
        const nestedData = this.manager.getNestedData(this.modelName);

        return nestedData;
    }

    customizeRecordData(record) {
        if(record[this.getIdField()] === Prisma.skip) {
            // Ensure id field is defined before upsert
            record[this.getIdField()] = uuidv4();
        }

        if (record.value !== Prisma.skip) {
            if (typeof record.value === 'boolean') {
                // Prisma schema stores metadata value as string; convert booleans to string form
                record.value = record.value ? 'true' : 'false';
            } else if (typeof record.value === 'number' && Number.isFinite(record.value)) {
                // Accept numeric values (including ints) and persist them as strings for Prisma
                record.value = record.value.toString();
            } else if (typeof record.value === 'bigint') {
                // Avoid bigint serialization errors by converting to string
                record.value = record.value.toString();
            }
        }

        return record;
    }

}

module.exports = { ChallengeMetadataMigrator }
