const { BaseMigrator } = require('./_baseMigrator');
const { Prisma } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_REVIEW_TYPE = 'INTERNAL';
const VALID_REVIEW_TYPES = new Set(['INTERNAL', 'COMMUNITY']);
const REVIEW_TYPE_NORMALIZATION_MAP = Object.freeze({
    internal: 'INTERNAL',
    community: 'COMMUNITY',
    system: 'INTERNAL'
});

/**
 * Migrator for ChallengeLegacy model
 */
class ChallengeLegacyMigrator extends BaseMigrator {
    constructor() {
        super('ChallengeLegacy', 3);
        this.unknownReviewTypes = new Set();
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

        const logFallback = (originalValue) => {
            const logger = this.manager?.logger;
            const normalizedValue = typeof originalValue === 'string'
                ? originalValue.trim()
                : String(originalValue ?? 'null');

            if (!this.unknownReviewTypes.has(normalizedValue)) {
                this.unknownReviewTypes.add(normalizedValue);
                logger?.warn(
                    `Unsupported reviewType "${normalizedValue}" encountered for ChallengeLegacy ` +
                    `record ${record.challengeId || record[this.getIdField()] || 'unknown'} – ` +
                    `defaulting to ${DEFAULT_REVIEW_TYPE}`
                );
            }
        };

        const applyDefaultIfNeeded = (originalValue) => {
            record.reviewType = DEFAULT_REVIEW_TYPE;
            if (originalValue !== undefined && originalValue !== null && originalValue !== DEFAULT_REVIEW_TYPE) {
                logFallback(originalValue);
            }
        };

        if (typeof record.reviewType === 'string') {
            const trimmedType = record.reviewType.trim();
            const normalizedType = trimmedType.toLowerCase();
            const mappedType = REVIEW_TYPE_NORMALIZATION_MAP[normalizedType];

            if (mappedType) {
                record.reviewType = mappedType;
            } else {
                const upperCaseCandidate = trimmedType.toUpperCase();
                if (VALID_REVIEW_TYPES.has(upperCaseCandidate)) {
                    record.reviewType = upperCaseCandidate;
                } else {
                    applyDefaultIfNeeded(trimmedType);
                }
            }
        } else if (!VALID_REVIEW_TYPES.has(record.reviewType)) {
            applyDefaultIfNeeded(record.reviewType);
        }

        return record;
    }

}

module.exports = { ChallengeLegacyMigrator }
