const { BaseMigrator } = require('./_baseMigrator');
const { Prisma } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const { parseStringArray } = require('../utils/helper');

/**
 * Migrator for TimelineTemplate model
 */
class TimelineTemplateMigrator extends BaseMigrator {
    constructor() {
        super('TimelineTemplate', 1);
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

        // Store nested data with proper timelineTemplateId
        if (record.phases) {
            parseStringArray(record.phases, 'TimelineTemplatePhase').forEach(phase => {
                this.manager.storeNestedData('TimelineTemplatePhase', {
                    ...phase,
                    timelineTemplateId: dbData[this.getIdField()]
                });
            });
        }
    }

    afterMigration(_result) {
        // Register valid IDs for dependency validation
        this.manager.registerDependency(this.modelName, this.validIds);
    }

}

module.exports = { TimelineTemplateMigrator }