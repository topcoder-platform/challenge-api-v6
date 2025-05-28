const { BaseMigrator } = require('./_baseMigrator');
const { Prisma } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

/**
 * Migrator for ChallengeBilling model
 */
class ChallengeBillingMigrator extends BaseMigrator {
    constructor() {
        super('ChallengeBilling', 3);
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

        if(record.billingAccountId !== Prisma.skip) {
            // Ensure billingAccountId is a string or null
            record.billingAccountId = String(record.billingAccountId);
            // If billingAccountId is empty, set it to null
            record.billingAccountId = record.billingAccountId || null;
        }

        return record;
    }

}

module.exports = { ChallengeBillingMigrator }