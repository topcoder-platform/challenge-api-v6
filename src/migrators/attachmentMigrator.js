const { BaseMigrator } = require('./_baseMigrator');
const { Prisma } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

/**
 * Migrator for Attachment model
 */
class AttachmentMigrator extends BaseMigrator {
    constructor() {
        super('Attachment', 3);
    }

    customizeRecordData(record) {
        if(record[this.getIdField()] === Prisma.skip) {
            // Ensure id field is defined before upsert
            record[this.getIdField()] = uuidv4();
        }
    }

}

module.exports = { AttachmentMigrator }