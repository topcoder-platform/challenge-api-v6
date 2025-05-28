const { BaseMigrator } = require('./_baseMigrator');
const { Prisma } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

/**
 * Migrator for TimelineTemplatePhase model
 */
class TimelineTemplatePhaseMigrator extends BaseMigrator {
    constructor() {
        super('TimelineTemplatePhase', 2);
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

module.exports = { TimelineTemplatePhaseMigrator }