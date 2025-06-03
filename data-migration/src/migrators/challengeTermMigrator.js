const { BaseMigrator } = require('./_baseMigrator');
const { Prisma } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

/**
 * Migrator for ChallengeTerm model
 */
class ChallengeTermMigrator extends BaseMigrator {
    constructor() {
        super('ChallengeTerm', 3);
    }

    async loadData() {
        // Load nested data from the Migration Manager
        const nestedData = this.manager.getNestedData(this.modelName);

        return nestedData;
    }

    beforeValidation(record) {
        if(!record.termId && record.id) {
            record.termId = record.id;
            record.id = Prisma.skip;
        }

        return record;
    }

    customizeRecordData(record) {
        if(record[this.getIdField()] === Prisma.skip) {
            // Ensure id field is defined before upsert
            record[this.getIdField()] = uuidv4();
        }

        return record;
    }

}

module.exports = { ChallengeTermMigrator }