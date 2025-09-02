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