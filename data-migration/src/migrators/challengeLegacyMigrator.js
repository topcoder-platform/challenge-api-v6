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
        const idField = this.getIdField();

        if (record[idField] === Prisma.skip) {
            // Ensure id field is defined before upsert
            record[idField] = uuidv4();
        }

        const logger = this.manager?.logger;
        const recordIdentifier = record.challengeId || record[idField] || 'unknown';

        const logFallback = (originalValue) => {
            const normalizedValue = typeof originalValue === 'string'
                ? originalValue.trim()
                : String(originalValue ?? 'null');

            if (!this.unknownReviewTypes.has(normalizedValue)) {
                this.unknownReviewTypes.add(normalizedValue);
                logger?.warn(
                    `Unsupported reviewType "${normalizedValue}" encountered for ChallengeLegacy ` +
                    `record ${recordIdentifier} – ` +
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

        const normalizeOptionalIntField = (fieldName) => {
            const value = record[fieldName];

            if (value === Prisma.skip || value === undefined || value === null) {
                return;
            }

            if (typeof value === 'number') {
                return;
            }

            if (typeof value === 'string') {
                const trimmed = value.trim();

                if (!trimmed) {
                    delete record[fieldName];
                    return;
                }

                if (/^-?\d+$/.test(trimmed)) {
                    const parsed = Number.parseInt(trimmed, 10);

                    if (Number.isSafeInteger(parsed)) {
                        record[fieldName] = parsed;
                        return;
                    }
                }
            }

            logger?.warn(
                `ChallengeLegacy record ${recordIdentifier}: unable to coerce ${fieldName} value "${value}" to integer; omitting field.`
            );
            delete record[fieldName];
        };

        normalizeOptionalIntField('directProjectId');

        return record;
    }

}

module.exports = { ChallengeLegacyMigrator }
