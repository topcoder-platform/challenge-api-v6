const { BaseMigrator } = require('./_baseMigrator');
const { Prisma } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

/**
 * Migrator for ChallengeTimelineTemplate model
 */
class ChallengeTimelineTemplateMigrator extends BaseMigrator {
    constructor() {
        super('ChallengeTimelineTemplate', 2);
    }

    customizeRecordData(record) {
        if(record[this.getIdField()] === Prisma.skip) {
            // Ensure id field is defined before upsert
            record[this.getIdField()] = uuidv4();
        }
        
        return record;
    }


}

module.exports = { ChallengeTimelineTemplateMigrator }