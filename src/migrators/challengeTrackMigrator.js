const { BaseMigrator } = require('./_baseMigrator');
const { Prisma, ChallengeTrackEnum } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const trackMap = {
    "Development": ChallengeTrackEnum.DEVELOP,
    "Data Science": ChallengeTrackEnum.DATA_SCIENCE,
    "Design": ChallengeTrackEnum.DESIGN,
    "Quality Assurance": ChallengeTrackEnum.QA,
}


/**
 * Migrator for ChallengeTrack model
 */
class ChallengeTrackMigrator extends BaseMigrator {
    constructor() {
        super('ChallengeTrack', 1);
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

        // Map track names to enum values
        record.track = trackMap[record.name] || Prisma.skip;

        return record;
    }

    afterUpsert(modelData, _prisma) {
        this.validIds.add(modelData[this.getIdField()]);
    }

    afterMigration(_result) {
        // Register valid IDs for dependency validation
        this.manager.registerDependency(this.modelName, this.validIds);
    }

}

module.exports = { ChallengeTrackMigrator }