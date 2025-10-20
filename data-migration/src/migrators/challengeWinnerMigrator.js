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
 * Migrator for ChallengeWinner model
 */
class ChallengeWinnerMigrator extends BaseMigrator {
    constructor() {
        super('ChallengeWinner', 3);
    }

    async loadData() {
        // Load nested data from the Migration Manager
        const nestedData = this.manager.getNestedData(this.modelName);

        return nestedData;
    }

    beforeValidation(record) {
        if(!record.type) {
            // Default to placement if type is not defined
            record.type = "placement";
        }

        return record;
    }

    customizeRecordData(record) {
        if(record[this.getIdField()] === Prisma.skip) {
            // Ensure id field is defined before upsert
            record[this.getIdField()] = uuidv4();
        }

        if (typeof record.userId === 'string') {
            const trimmedUserId = record.userId.trim();
            if (/^-?\d+$/.test(trimmedUserId)) {
                record.userId = Number.parseInt(trimmedUserId, 10);
            }
        }

        if (typeof record.placement === 'string') {
            const trimmedPlacement = record.placement.trim();
            if (/^-?\d+$/.test(trimmedPlacement)) {
                record.placement = Number.parseInt(trimmedPlacement, 10);
            }
        }

        if (record.type) {
            record.type = prizeSetTypeMap[record.type] || Prisma.skip;
        }

        return record;
    }

}

module.exports = { ChallengeWinnerMigrator }
