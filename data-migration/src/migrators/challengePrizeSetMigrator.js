const { BaseMigrator } = require('./_baseMigrator');
const { Prisma, PrizeSetTypeEnum } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const prizeSetTypeMap = {
    "placement": PrizeSetTypeEnum.PLACEMENT,
    "copilot": PrizeSetTypeEnum.COPILOT,
    "reviewer": PrizeSetTypeEnum.REVIEWER,
    "checkpoint": PrizeSetTypeEnum.CHECKPOINT,
}

/**
 * Migrator for ChallengePrizeSet model
 */
class ChallengePrizeSetMigrator extends BaseMigrator {
    constructor() {
        super('ChallengePrizeSet', 3);
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

        if (record.type) {
            record.type = prizeSetTypeMap[record.type] || Prisma.skip;
        }

        return record;
    }

    afterUpsert(dbData, record, _prisma) {
        this.validIds.add(dbData[this.getIdField()]);

        if (record.prizes) {
            record.prizes.forEach(prize => {
                this.manager.storeNestedData('Prize', {
                    ...prize,
                    prizeSetId: dbData[this.getIdField()],
                    createdAt: dbData.createdAt,
                    updatedAt: dbData.updatedAt,
                    createdBy: dbData.createdBy,
                    updatedBy: dbData.updatedBy
                });
            });
        }
    }

    afterMigration(_result) {
        // Register valid IDs for dependency validation
        this.manager.registerDependency(this.modelName, this.validIds);
    }

}

module.exports = { ChallengePrizeSetMigrator }