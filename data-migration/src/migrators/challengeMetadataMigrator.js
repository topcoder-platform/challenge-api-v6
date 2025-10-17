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

        if (record.value !== Prisma.skip && typeof record.value === 'boolean') {
            // Prisma schema stores metadata value as string; convert booleans to string form
            record.value = record.value ? 'true' : 'false';
        }

        return record;
    }

}

module.exports = { ChallengeMetadataMigrator }
