const { BaseMigrator } = require('./_baseMigrator');
const { Prisma, ChallengeStatusEnum } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const statusMap = {
  "New": ChallengeStatusEnum.NEW,
  "Draft": ChallengeStatusEnum.DRAFT,
  "Approved": ChallengeStatusEnum.APPROVED,
  "Active": ChallengeStatusEnum.ACTIVE,
  "Completed": ChallengeStatusEnum.COMPLETED,
  "Deleted": ChallengeStatusEnum.DELETED,
  "Cancelled": ChallengeStatusEnum.CANCELLED,
  "Cancelled - Failed Review": ChallengeStatusEnum.CANCELLED_FAILED_REVIEW,
  "Cancelled - Failed Screening": ChallengeStatusEnum.CANCELLED_FAILED_SCREENING,
  "Cancelled - Zero Submissions": ChallengeStatusEnum.CANCELLED_ZERO_SUBMISSIONS,
  "Cancelled - Winner Unresponsive": ChallengeStatusEnum.CANCELLED_WINNER_UNRESPONSIVE,
  "Cancelled - Client Request": ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST,
  "Cancelled - Requirements Infeasible": ChallengeStatusEnum.CANCELLED_REQUIREMENTS_INFEASIBLE,
  "Cancelled - Zero Registrations": ChallengeStatusEnum.CANCELLED_ZERO_REGISTRATIONS,
  "Cancelled - Payment Failed": ChallengeStatusEnum.CANCELLED_PAYMENT_FAILED
};

/**
 * Migrator for Challenge model
 */
class ChallengeMigrator extends BaseMigrator {
    constructor() {
        super('Challenge', 2, true);
    }

    isCountersOnly() {
        const migratorConfig = this.manager.config.migrator?.[this.modelName] || {};
        return Boolean(migratorConfig.countersOnly || this.manager.config.CHALLENGE_COUNTERS_ONLY);
    }

    async migrate() {
        if (!this.isCountersOnly()) {
            return await super.migrate();
        }

        this.manager.logger.info('Challenge migrator running in counters-only mode (numOfRegistrants & numOfSubmissions)');

        const rawData = await this.loadData();
        const data = await this.beforeMigration(rawData);

        const idField = this.getIdField();
        const counters = ['numOfRegistrants', 'numOfSubmissions'];

        let processed = 0;
        let skipped = 0;
        const errors = [];

        for (const record of data) {
            const id = record[idField];
            if (!id) {
                this.manager.logger.warn('Skipping challenge record without id while updating counters');
                skipped++;
                continue;
            }

            const updateData = {};

            for (const field of counters) {
                const rawValue = record[field];
                if (rawValue === undefined || rawValue === null) {
                    continue;
                }

                const numericValue = typeof rawValue === 'string' && rawValue.trim() !== ''
                    ? Number(rawValue)
                    : rawValue;

                if (typeof numericValue === 'number' && Number.isFinite(numericValue)) {
                    updateData[field] = numericValue;
                } else {
                    this.manager.logger.warn(`Skipping ${field} for challenge ${id}; expected numeric value, received ${rawValue}`);
                }
            }

            if (!Object.keys(updateData).length) {
                this.manager.logger.debug(`No counter updates found for challenge ${id}; skipping`);
                skipped++;
                continue;
            }

            try {
                await this.manager.prisma[this.queryName].update({
                    where: { [idField]: id },
                    data: updateData
                });
                this.validIds.add(id);
                processed++;
            } catch (error) {
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                    this.manager.logger.warn(`Skipping challenge ${id}; record not found in database while updating counters`);
                } else {
                    this.manager.logger.error(`Failed to update counters for challenge ${id}`, error);
                    errors.push({ id, message: error.message });
                }
                skipped++;
            }
        }

        await this.afterMigration({ processed, skipped, errors });

        this.manager.logger.info(`Updated counter fields for ${processed} challenges (skipped ${skipped})`);

        return { processed, skipped, errors };
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
        if(record.overview) {
            record.overviewTotalPrizes = record.overview.totalPrizes;
        }

        if(record.task) {
            record.taskIsTask = record.task.isTask;
            record.taskIsAssigned = record.task.isAssigned;
            record.taskMemberId = String(record.task.memberId);
        }

        if(record.created) {
            record.createdAt = record.created
        }

        if(record.updated) {
            record.updatedAt = record.updated
        }

        if (record.projectId !== undefined) {
            if (record.projectId === null) {
                // keep as null
            } else if (typeof record.projectId === 'string') {
                const trimmedProjectId = record.projectId.trim();

                if (!trimmedProjectId || trimmedProjectId.toLowerCase() === 'null') {
                    record.projectId = null;
                } else {
                    const parsedProjectId = Number(trimmedProjectId);
                    if (Number.isFinite(parsedProjectId) && Number.isInteger(parsedProjectId)) {
                        record.projectId = parsedProjectId;
                    } else {
                        this.manager.logger.warn(`Skipping projectId for challenge ${record[this.getIdField()]}; non-integer value "${record.projectId}"`);
                        record.projectId = Prisma.skip;
                    }
                }
            } else if (typeof record.projectId !== 'number') {
                const parsedProjectId = Number(record.projectId);
                if (Number.isFinite(parsedProjectId) && Number.isInteger(parsedProjectId)) {
                    record.projectId = parsedProjectId;
                } else {
                    this.manager.logger.warn(`Skipping projectId for challenge ${record[this.getIdField()]}; non-integer value "${record.projectId}"`);
                    record.projectId = Prisma.skip;
                }
            } else if (!Number.isInteger(record.projectId)) {
                this.manager.logger.warn(`Skipping projectId for challenge ${record[this.getIdField()]}; non-integer value "${record.projectId}"`);
                record.projectId = Prisma.skip;
            }
        }

        if (record.legacyId !== undefined) {
            if (record.legacyId === null) {
                // keep as null
            } else if (typeof record.legacyId === 'string') {
                const trimmedLegacyId = record.legacyId.trim();

                if (!trimmedLegacyId || trimmedLegacyId.toLowerCase() === 'null') {
                    record.legacyId = null;
                } else {
                    const parsedLegacyId = Number(trimmedLegacyId);
                    if (Number.isFinite(parsedLegacyId)) {
                        record.legacyId = parsedLegacyId;
                    } else {
                        this.manager.logger.warn(`Skipping legacyId for challenge ${record[this.getIdField()]}; non-numeric value "${record.legacyId}"`);
                        record.legacyId = Prisma.skip;
                    }
                }
            } else if (typeof record.legacyId !== 'number') {
                const parsedLegacyId = Number(record.legacyId);
                if (Number.isFinite(parsedLegacyId)) {
                    record.legacyId = parsedLegacyId;
                } else {
                    this.manager.logger.warn(`Skipping legacyId for challenge ${record[this.getIdField()]}; non-numeric value "${record.legacyId}"`);
                    record.legacyId = Prisma.skip;
                }
            }
        }

        if (record.tags !== undefined) {
            if (Array.isArray(record.tags)) {
                const cleanedTags = [];

                for (const rawTag of record.tags) {
                    if (rawTag === null || rawTag === undefined) {
                        continue;
                    }

                    if (typeof rawTag !== 'string') {
                        this.manager.logger.warn(`Skipping invalid tag value for challenge ${record[this.getIdField()]}; expected string, received ${typeof rawTag}`);
                        continue;
                    }

                    const trimmedTag = rawTag.trim();
                    if (!trimmedTag || trimmedTag.toLowerCase() === 'null') {
                        continue;
                    }

                    cleanedTags.push(trimmedTag);
                }

                record.tags = cleanedTags;
            } else if (record.tags === null) {
                record.tags = [];
            } else if (typeof record.tags === 'string') {
                const trimmedTag = record.tags.trim();
                record.tags = trimmedTag && trimmedTag.toLowerCase() !== 'null' ? [trimmedTag] : [];
            } else {
                this.manager.logger.warn(`Replacing unexpected tags value for challenge ${record[this.getIdField()]}; defaulting to empty array`);
                record.tags = [];
            }
        }

        return record;
    }

    customizeRecordData(record) {
        if(record[this.getIdField()] === Prisma.skip) {
            // Ensure id field is defined before upsert
            record[this.getIdField()] = uuidv4();
        }

        if(record.status) {
            record.status = statusMap[record.status] || Prisma.skip;
        }

        // for each old record, wiproAllowed is true
        record.wiproAllowed = true;

        return record;
    }

    afterUpsert(dbData, record, _prisma) {
        this.validIds.add(dbData[this.getIdField()]);

         // Store nested data with proper challengeId
        if (record.billing) {
            this.manager.storeNestedData('ChallengeBilling', {
                ...record.billing,
                challengeId: dbData[this.getIdField()],
                createdAt: dbData.createdAt,
                updatedAt: dbData.updatedAt,
                createdBy: dbData.createdBy,
                updatedBy: dbData.updatedBy
            });
        }

        if (record.legacy) {
            this.manager.storeNestedData('ChallengeLegacy', {
                ...record.legacy,
                challengeId: dbData[this.getIdField()],
                legacySystemId: record.legacyId,
                createdAt: dbData.createdAt,
                updatedAt: dbData.updatedAt,
                createdBy: dbData.createdBy,
                updatedBy: dbData.updatedBy
            });
        }

        if (record.events) {
            record.events.forEach(event => {
                this.manager.storeNestedData('ChallengeEvent', {
                    ...event,
                    challengeId: dbData[this.getIdField()],
                    createdAt: dbData.createdAt,
                    updatedAt: dbData.updatedAt,
                    createdBy: dbData.createdBy,
                    updatedBy: dbData.updatedBy
                });
            });
        }

        if (record.discussions) {
            record.discussions.forEach(discussion => {
                this.manager.storeNestedData('ChallengeDiscussion', {
                    ...discussion,
                    challengeId: dbData[this.getIdField()],
                    createdAt: dbData.createdAt,
                    updatedAt: dbData.updatedAt,
                    createdBy: dbData.createdBy,
                    updatedBy: dbData.updatedBy
                });
            });
        }

        if (record.metadata) {
            record.metadata.forEach(element => {
                this.manager.storeNestedData('ChallengeMetadata', {
                    ...element,
                    challengeId: dbData[this.getIdField()],
                    createdAt: dbData.createdAt,
                    updatedAt: dbData.updatedAt,
                    createdBy: dbData.createdBy,
                    updatedBy: dbData.updatedBy
                });
            });
        }

        if (record.phases) {
            record.phases.forEach(phase => {
                this.manager.storeNestedData('ChallengePhase', {
                    ...phase,
                    challengeId: dbData[this.getIdField()],
                    createdAt: dbData.createdAt,
                    updatedAt: dbData.updatedAt,
                    createdBy: dbData.createdBy,
                    updatedBy: dbData.updatedBy
                });
            });
        }

        if (record.prizeSets) {
            record.prizeSets.forEach(prizeSet => {
                this.manager.storeNestedData('ChallengePrizeSet', {
                    ...prizeSet,
                    challengeId: dbData[this.getIdField()],
                    createdAt: dbData.createdAt,
                    updatedAt: dbData.updatedAt,
                    createdBy: dbData.createdBy,
                    updatedBy: dbData.updatedBy
                });
            });
        }

        if (record.winners) {
            record.winners.forEach(winner => {
                this.manager.storeNestedData('ChallengeWinner', {
                    ...winner,
                    challengeId: dbData[this.getIdField()],
                    createdAt: dbData.createdAt,
                    updatedAt: dbData.updatedAt,
                    createdBy: dbData.createdBy,
                    updatedBy: dbData.updatedBy
                });
            });
        }

        if (record.terms) {
            record.terms.forEach(term => {
                this.manager.storeNestedData('ChallengeTerm', {
                    ...term,
                    challengeId: dbData[this.getIdField()],
                    createdAt: dbData.createdAt,
                    updatedAt: dbData.updatedAt,
                    createdBy: dbData.createdBy,
                    updatedBy: dbData.updatedBy
                });
            });
        }

        if (record.skills) {
            record.skills.forEach(skill => {
                this.manager.storeNestedData('ChallengeSkill', {
                    ...skill,
                    challengeId: dbData[this.getIdField()],
                    createdAt: dbData.createdAt,
                    updatedAt: dbData.updatedAt,
                    createdBy: dbData.createdBy,
                    updatedBy: dbData.updatedBy
                });
            });
        }

        if (record.constraints) {
            this.manager.storeNestedData('ChallengeConstraint', {
                ...record.constraints,
                challengeId: dbData[this.getIdField()],
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

module.exports = { ChallengeMigrator }
