const { BaseMigrator } = require('./_baseMigrator');
const { Prisma } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

/**
 * Migrator for ChallengePhase model
 */
class ChallengePhaseMigrator extends BaseMigrator {
    constructor() {
        super('ChallengePhase', 3);
    }

    async loadData() {
        // Load nested data from the Migration Manager
        const nestedData = this.manager.getNestedData(this.modelName);

        return nestedData;
    }

    async beforeMigration(data) {
        // Add exisitng IDs to validIds set
        const existing = await this.manager.prisma[this.queryName].findMany({
            select: { id: true }
        });
        existing.forEach(element => this.validIds.add(element[this.getIdField()]));
        this.manager.logger.debug(`Found ${existing.length} existing ${this.modelName} records in the database`);
        return data;
    }

    customizeRecordData(record) {
        if(record[this.getIdField()] === Prisma.skip) {
            // Ensure id field is defined before upsert
            record[this.getIdField()] = uuidv4();
        }

        return record;
    }

    afterUpsert(dbData, record, _prisma) {
        this.validIds.add(dbData[this.getIdField()]);

        // Store nested data with proper challengePhaseId
        if (record.constraints) {
            record.constraints.forEach(constraint => {
                this.manager.storeNestedData('ChallengePhaseConstraint', {
                    ...constraint,
                    challengePhaseId: dbData[this.getIdField()]
                });
            });
        }
    }

    afterMigration(_result) {
        // Register valid IDs for dependency validation
        this.manager.registerDependency(this.modelName, this.validIds);
    }

}

module.exports = { ChallengePhaseMigrator }