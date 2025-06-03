const { BaseMigrator } = require('./_baseMigrator');
const { Prisma } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

/**
 * Migrator for ChallengePhaseConstraint model
 */
class ChallengePhaseConstraintMigrator extends BaseMigrator {
    constructor() {
        super('ChallengePhaseConstraint', 4);
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

        return record;
    }

}

module.exports = { ChallengePhaseConstraintMigrator }