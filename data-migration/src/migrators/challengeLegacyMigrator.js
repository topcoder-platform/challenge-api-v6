const { BaseMigrator } = require('./_baseMigrator');
const { Prisma } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

/**
 * Migrator for ChallengeLegacy model
 */
class ChallengeLegacyMigrator extends BaseMigrator {
    constructor() {
        super('ChallengeLegacy', 3);
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

        if (typeof record.reviewType === 'string') {
            const normalizedType = record.reviewType.trim().toLowerCase();
            const reviewTypeMap = {
                internal: 'INTERNAL',
                community: 'COMMUNITY'
            };

            if (reviewTypeMap[normalizedType]) {
                record.reviewType = reviewTypeMap[normalizedType];
            }
        }

        return record;
    }

}

module.exports = { ChallengeLegacyMigrator }
