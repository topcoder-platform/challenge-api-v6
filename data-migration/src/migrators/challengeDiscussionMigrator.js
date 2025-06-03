const { BaseMigrator } = require('./_baseMigrator');
const { Prisma, DiscussionTypeEnum } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const discussionTypeMap = {
    "challenge": DiscussionTypeEnum.CHALLENGE,
}

/**
 * Migrator for ChallengeDiscussion model
 */
class ChallengeDiscussionMigrator extends BaseMigrator {
    constructor() {
        super('ChallengeDiscussion', 3);
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

    beforeValidation(record) {
        if(!record.discussionId && record.id) {
            record.discussionId = record.id;
            record.id = Prisma.skip;
        }

        return record;
    }

    customizeRecordData(record) {
        if(record[this.getIdField()] === Prisma.skip) {
            // Ensure id field is defined before upsert
            record[this.getIdField()] = uuidv4();
        }

        if (record.type) {
            record.type = discussionTypeMap[record.type] || Prisma.skip;
        }

        return record;
    }

    afterUpsert(dbData, record, _prisma) {
        this.validIds.add(dbData[this.getIdField()]);

        if (record.options) {
            this.manager.storeNestedData('ChallengeDiscussionOption', {
                ...record.options,
                discussionId: dbData[this.getIdField()],
                createdAt: dbData.createdAt,
                updatedAt: dbData.updatedAt,
                createdBy: dbData.createdBy,
                updatedBy: dbData.updatedBy
            });
        }
    }

    afterMigration(_result) {
        // Register valid IDs for dependency validation
        this.manager.registerDependency(this.modelName, this.validIds);
    }

}

module.exports = { ChallengeDiscussionMigrator }