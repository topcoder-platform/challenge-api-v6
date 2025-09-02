const { PrismaClient, ChallengeStatusEnum, DiscussionTypeEnum, PrizeSetTypeEnum, ChallengeTrackEnum } = require('@prisma/client');
const { loadData } = require('../src/utils/dataLoader');
const path = require('path');
const fs = require('fs');
const { parseStringArray } = require('../src/utils/helper');



jest.setTimeout(30000); // Set timeout to 30 seconds
const prisma = new PrismaClient();
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

const discussionTypeMap = {
    "challenge": DiscussionTypeEnum.CHALLENGE,
}

const prizeSetTypeMap = {
    "placement": PrizeSetTypeEnum.PLACEMENT,
    "copilot": PrizeSetTypeEnum.COPILOT,
    "reviewer": PrizeSetTypeEnum.REVIEWER,
    "checkpoint": PrizeSetTypeEnum.CHECKPOINT,
}

const trackMap = {
    "Development": ChallengeTrackEnum.DEVELOP,
    "Data Science": ChallengeTrackEnum.DATA_SCIENCE,
    "Design": ChallengeTrackEnum.DESIGN,
    "Quality Assurance": ChallengeTrackEnum.QA,
}


let skippedIdsByModel = {};
try {
    const logContent = fs.readFileSync(path.join(__dirname, '../logs/migration.log'), 'utf8');

    // Process line by line
    const lines = logContent.split('\n');
    for (const line of lines) {
        const match = line.match(/Skipping (\w+) \[id: ([a-f0-9-]+)\]:/);
        if (match) {
            const [ , modelName, modelId] = match;

            if (!skippedIdsByModel[modelName]) {
                skippedIdsByModel[modelName] = new Set();
            }

            skippedIdsByModel[modelName].add(modelId);
        }
    }

    // Convert Sets to arrays
    for (const modelName in skippedIdsByModel) {
        skippedIdsByModel[modelName] = [...skippedIdsByModel[modelName]];
        console.log(`Found ${skippedIdsByModel[modelName].length} skipped ${modelName} IDs in logs`);
    }
} catch (error) {
    console.error('Error reading log file:', error);
}

describe('Challenge Migration Tests', () => {
    // Shared variables
    let sourceData = [];
    let batchedData = [];

    // Helper functions
    const compareNullableField = (dbValue, sourceValue) => {
        if (sourceValue === undefined) {
            expect(dbValue).toBeNull();
        } else {
            expect(dbValue).toBe(sourceValue);
        }
    };

    const compareDateField = (dbDate, sourceDate) => {
        if (!sourceDate) return;
        expect(new Date(dbDate).getTime()).toBe(new Date(sourceDate).getTime());
    };

    // Setup - load and prepare data
    beforeAll(async () => {
        // Load source data
        sourceData = await loadData(path.join(__dirname, '../data'), process.env.CHALLENGE_FILE, true);
        if (sourceData.array) {
            sourceData = sourceData.array;
        }

        // Filter out skipped records
        sourceData = sourceData.filter(challenge => !skippedIdsByModel.Challenge.includes(challenge.id));
        console.log(`Total filtered source data: ${sourceData.length} records`);

        // Prepare batched data for testing
        const BATCH_SIZE = 100;
        batchedData = [];

        for (let i = 0; i < sourceData.length; i += BATCH_SIZE) {
            console.log(`Preparing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(sourceData.length / BATCH_SIZE)}`);

            const batch = sourceData.slice(i, i + BATCH_SIZE);
            const batchIds = batch.map(challenge => challenge.id);

            const dbChallenges = await prisma.challenge.findMany({
                where: {
                    id: { in: batchIds }
                },
                include: {
                    metadata: true,
                    phases: {
                        include: {
                            constraints: true
                        }
                    },
                    prizeSets: {
                        include: {
                            prizes: true
                        }
                    },
                    winners: true,
                    attachments: true,
                    terms: true,
                    skills: true,
                    events: true,
                    billingRecord: true,
                    legacyRecord: true,
                    discussions: {
                        include: {
                            options: true
                        }
                    },
                    timelineTemplate: true,
                    type: true,
                    track: true
                }
            });

            const dbChallengeMap = new Map(
                dbChallenges.map(challenge => [challenge.id, challenge])
            );

            batchedData.push({
                batch,
                dbChallengeMap
            });
        }
    }, 60000);

    afterAll(async () => {
        await prisma.$disconnect();
    });

    // Test 1: Verify all records were migrated
    test('should have migrated all valid records from JSON to database', async () => {
        const dbChallenges = await prisma.challenge.findMany({
            select: { id: true }
        });

        const sourceIds = sourceData.map(challenge => challenge.id);
        const dbIds = dbChallenges.map(challenge => challenge.id);

        for (const sourceId of sourceIds) {
            expect(dbIds).toContain(sourceId);
        }

        console.log(`Verified ${sourceIds.length} records were properly migrated`);
    });

    // Test suite for field validation
    describe('Field validation', () => {
        // Test 2: Basic fields
        test('should correctly migrate basic fields', () => {
            let count = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    count++;
                    expect(dbChallenge.name).toBe(sourceChallenge.name);
                    expect(dbChallenge.typeId).toBe(sourceChallenge.typeId);
                    expect(dbChallenge.trackId).toBe(sourceChallenge.trackId);
                    expect(dbChallenge.status).toBe(statusMap[sourceChallenge.status || 'New']);
                });
            });

            console.log(`Validated basic fields for ${count} records`);
        });

        // Test 3: Nullable fields
        test('should correctly migrate nullable fields', () => {
            let count = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    count++;
                    compareNullableField(dbChallenge.description, sourceChallenge.description);
                    compareNullableField(dbChallenge.privateDescription, sourceChallenge.privateDescription);
                    compareNullableField(dbChallenge.descriptionFormat, sourceChallenge.descriptionFormat);
                    compareNullableField(dbChallenge.challengeSource, sourceChallenge.challengeSource);
                    compareNullableField(dbChallenge.projectId, sourceChallenge.projectId);
                    compareNullableField(dbChallenge.timelineTemplateId, sourceChallenge.timelineTemplateId);

                    // Handle nested fields
                    if (sourceChallenge.overview === undefined) {
                        expect(dbChallenge.overviewTotalPrizes).toBeNull();
                    } else if (sourceChallenge.overview.totalPrizes === undefined) {
                        expect(dbChallenge.overviewTotalPrizes).toBeNull();
                    } else {
                        expect(dbChallenge.overviewTotalPrizes).toBe(sourceChallenge.overview.totalPrizes);
                    }

                    if (sourceChallenge.task === undefined) {
                        expect(dbChallenge.taskMemberId).toBeNull();
                    } else if (sourceChallenge.task.memberId === undefined) {
                        expect(dbChallenge.taskMemberId).toBeNull();
                    } else {
                        expect(dbChallenge.taskMemberId).toBe(String(sourceChallenge.task.memberId));
                    }
                });
            });

            console.log(`Validated nullable fields for ${count} records`);
        });

        // Test 4: Array fields
        test('should correctly migrate array fields', () => {
            let count = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    count++;
                    expect([...dbChallenge.currentPhaseNames].sort())
                        .toEqual([...sourceChallenge.currentPhaseNames || []].sort());
                    expect([...dbChallenge.tags].sort())
                        .toEqual([...sourceChallenge.tags || []].sort());
                    expect([...dbChallenge.groups].sort())
                        .toEqual([...sourceChallenge.groups || []].sort());
                });
            });

            console.log(`Validated array fields for ${count} records`);
        });

        // Test 5: Boolean fields
        test('should correctly migrate boolean fields', () => {
            let count = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    count++;
                    if (sourceChallenge.task === undefined) {
                        expect(dbChallenge.taskIsTask).toBe(false);
                        expect(dbChallenge.taskIsAssigned).toBe(false);
                    } else {
                        expect(dbChallenge.taskIsTask).toBe(sourceChallenge.task.isTask === true);
                        expect(dbChallenge.taskIsAssigned).toBe(sourceChallenge.task.isAssigned === true);
                    }
                });
            });

            console.log(`Validated boolean fields for ${count} records`);
        });

        // Test 6: Date fields
        test('should correctly migrate date fields', () => {
            let count = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    count++;
                    compareDateField(dbChallenge.submissionStartDate, sourceChallenge.submissionStartDate);
                    compareDateField(dbChallenge.submissionEndDate, sourceChallenge.submissionEndDate);
                    compareDateField(dbChallenge.registrationStartDate, sourceChallenge.registrationStartDate);
                    compareDateField(dbChallenge.registrationEndDate, sourceChallenge.registrationEndDate);
                    compareDateField(dbChallenge.startDate, sourceChallenge.startDate);
                    compareDateField(dbChallenge.endDate, sourceChallenge.endDate);
                    compareDateField(dbChallenge.createdAt, sourceChallenge.created);
                    compareDateField(dbChallenge.updatedAt, sourceChallenge.updated);
                });
            });

            console.log(`Validated date fields for ${count} records`);
        });
    });

    // Test suite for relations
    describe('Relation validation', () => {

        // ChallengeBilling relation
        test('should correctly migrate challenge billing data', () => {
            let count = 0;
            let missingCount = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    // Check if source has billing data
                    if (sourceChallenge.billing) {
                        count++;

                        // Fetch the billing record for this challenge
                        expect(dbChallenge.billingRecord).toBeDefined();

                        if (dbChallenge.billingRecord) {
                            // Verify billing fields
                            if (sourceChallenge.billing.billingAccountId !== undefined) {
                                expect(dbChallenge.billingRecord.billingAccountId).toBe(String(sourceChallenge.billing.billingAccountId));
                            }

                            if (sourceChallenge.billing.markup !== undefined) {
                                expect(dbChallenge.billingRecord.markup).toBe(sourceChallenge.billing.markup);
                            }

                            if (sourceChallenge.billing.clientBillingRate !== undefined) {
                                expect(dbChallenge.billingRecord.clientBillingRate).toBe(sourceChallenge.billing.clientBillingRate);
                            }

                            // Verify audit fields
                            expect(dbChallenge.billingRecord.challengeId).toBe(dbChallenge.id);

                            // Check created/updated fields if they exist in source
                            if (sourceChallenge.billing.created) {
                                const sourceDate = new Date(sourceChallenge.billing.created).getTime();
                                const dbDate = new Date(dbChallenge.billingRecord.createdAt).getTime();
                                expect(dbDate).toBe(sourceDate);
                            }

                            if (sourceChallenge.billing.updated) {
                                const sourceDate = new Date(sourceChallenge.billing.updated).getTime();
                                const dbDate = new Date(dbChallenge.billingRecord.updatedAt).getTime();
                                expect(dbDate).toBe(sourceDate);
                            }

                            // Verify createdBy and updatedBy if they exist in source
                            if (sourceChallenge.billing.createdBy) {
                                expect(dbChallenge.billingRecord.createdBy).toBe(sourceChallenge.billing.createdBy);
                            }

                            if (sourceChallenge.billing.updatedBy) {
                                expect(dbChallenge.billingRecord.updatedBy).toBe(sourceChallenge.billing.updatedBy);
                            }
                        }
                    } else if (dbChallenge.billingRecord) {
                        // If source doesn't have billing but DB does, count it
                        console.warn(`Challenge ${dbChallenge.id} has billing in database but not in source`);
                        missingCount++;
                    }
                });
            });
            console.log(`Validated billing relation for ${count} records (Challenge had ${missingCount} exclusive billing in DB but not in source)`);
        });

        // ChallengeLegacy relation
        test('should correctly migrate challenge legacy data', () => {
            let count = 0;
            let missingCount = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    // Check if source has legacy data
                    if (sourceChallenge.legacy) {
                        count++;

                        // Verify the legacy record exists
                        expect(dbChallenge.legacyRecord).toBeDefined();

                        if (dbChallenge.legacyRecord) {
                            // Verify legacy fields
                            if (sourceChallenge.legacy.reviewType !== undefined) {
                                expect(dbChallenge.legacyRecord.reviewType).toBe(sourceChallenge.legacy.reviewType);
                            }

                            if (sourceChallenge.legacy.confidentialityType !== undefined) {
                                expect(dbChallenge.legacyRecord.confidentialityType).toBe(sourceChallenge.legacy.confidentialityType);
                            }

                            // Verify nullable integer fields
                            compareNullableField(dbChallenge.legacyRecord.forumId, sourceChallenge.legacy.forumId);
                            compareNullableField(dbChallenge.legacyRecord.directProjectId, sourceChallenge.legacy.directProjectId);
                            compareNullableField(dbChallenge.legacyRecord.screeningScorecardId, sourceChallenge.legacy.screeningScorecardId);
                            compareNullableField(dbChallenge.legacyRecord.reviewScorecardId, sourceChallenge.legacy.reviewScorecardId);

                            // Verify boolean fields
                            expect(dbChallenge.legacyRecord.isTask).toBe(sourceChallenge.legacy.isTask === true);
                            expect(dbChallenge.legacyRecord.useSchedulingAPI).toBe(sourceChallenge.legacy.useSchedulingAPI === true);
                            expect(dbChallenge.legacyRecord.pureV5Task).toBe(sourceChallenge.legacy.pureV5Task === true);
                            expect(dbChallenge.legacyRecord.pureV5).toBe(sourceChallenge.legacy.pureV5 === true);
                            expect(dbChallenge.legacyRecord.selfService).toBe(sourceChallenge.legacy.selfService === true);

                            // Verify nullable string fields
                            compareNullableField(dbChallenge.legacyRecord.selfServiceCopilot, sourceChallenge.legacy.selfServiceCopilot);
                            compareNullableField(dbChallenge.legacyRecord.track, sourceChallenge.legacy.track);
                            compareNullableField(dbChallenge.legacyRecord.subTrack, sourceChallenge.legacy.subTrack);

                            // Verify legacySystemId matches the source legacyId
                            if (sourceChallenge.legacy.legacyId !== undefined) {
                                expect(dbChallenge.legacyRecord.legacySystemId).toBe(sourceChallenge.legacy.legacyId);
                            }

                            // Verify relation field
                            expect(dbChallenge.legacyRecord.challengeId).toBe(dbChallenge.id);

                            // Verify audit fields if they exist in source
                            if (sourceChallenge.legacy.created) {
                                const sourceDate = new Date(sourceChallenge.legacy.created).getTime();
                                const dbDate = new Date(dbChallenge.legacyRecord.createdAt).getTime();
                                expect(dbDate).toBe(sourceDate);
                            }

                            if (sourceChallenge.legacy.updated) {
                                const sourceDate = new Date(sourceChallenge.legacy.updated).getTime();
                                const dbDate = new Date(dbChallenge.legacyRecord.updatedAt).getTime();
                                expect(dbDate).toBe(sourceDate);
                            }

                            if (sourceChallenge.legacy.createdBy) {
                                expect(dbChallenge.legacyRecord.createdBy).toBe(sourceChallenge.legacy.createdBy);
                            }

                            if (sourceChallenge.legacy.updatedBy) {
                                expect(dbChallenge.legacyRecord.updatedBy).toBe(sourceChallenge.legacy.updatedBy);
                            }
                        }
                    } else if (dbChallenge.legacyRecord) {
                        // If source doesn't have legacy but DB does, count it
                        console.warn(`Challenge ${dbChallenge.id} has legacy in database but not in source`);
                        missingCount++;
                    }
                });
            });

            console.log(`Validated legacy relation for ${count} records (Challenge had ${missingCount} exclusive legacy in DB but not in source)`);
        });

        // ChallengeEvent relation
        test('should correctly migrate challenge event data', () => {
            let count = 0;
            let missingCount = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    // Check if source has events data
                    if (sourceChallenge.events && Array.isArray(sourceChallenge.events) && sourceChallenge.events.length > 0) {

                        // Verify the events exist in the database
                        expect(dbChallenge.events).toBeDefined();
                        expect(Array.isArray(dbChallenge.events)).toBe(true);

                        // Verify the number of events matches
                        expect(dbChallenge.events.length).toBe(sourceChallenge.events.length);

                        // Check each event
                        sourceChallenge.events.forEach(sourceEvent => {
                            // Find matching event in database by eventId
                            const dbEvent = dbChallenge.events.find(e => e.eventId === sourceEvent.eventId);

                            // Verify the event exists
                            expect(dbEvent).toBeDefined();

                            if (dbEvent) {
                                // Verify event fields
                                expect(dbEvent.eventId).toBe(sourceEvent.eventId);

                                // Verify nullable string fields
                                compareNullableField(dbEvent.name, sourceEvent.name);
                                compareNullableField(dbEvent.key, sourceEvent.key);

                                // Verify relation field
                                expect(dbEvent.challengeId).toBe(dbChallenge.id);

                                // Verify audit fields if they exist in source
                                if (sourceEvent.created) {
                                    const sourceDate = new Date(sourceEvent.created).getTime();
                                    const dbDate = new Date(dbEvent.createdAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourceEvent.updated) {
                                    const sourceDate = new Date(sourceEvent.updated).getTime();
                                    const dbDate = new Date(dbEvent.updatedAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourceEvent.createdBy) {
                                    expect(dbEvent.createdBy).toBe(sourceEvent.createdBy);
                                }

                                if (sourceEvent.updatedBy) {
                                    expect(dbEvent.updatedBy).toBe(sourceEvent.updatedBy);
                                }
                            }
                            count++;
                        });
                    }
                    // If DB has events but source doesn't, this might be expected in some cases
                    else if ((!sourceChallenge.events || !Array.isArray(sourceChallenge.events) || sourceChallenge.events.length === 0) &&
                        dbChallenge.events && dbChallenge.events.length > 0) {
                        console.warn(`Challenge ${dbChallenge.id} has events in database but not in source`);
                        missingCount++;
                    }
                });
            });

            console.log(`Validated events relation for ${count} records (Challenge had ${missingCount} exclusive events in DB but not in source)`);
        });


        test('should correctly migrate challenge discussion and options data', () => {
            let count = 0;
            let missingCount = 0;

            let _count = 0;
            let _missingCount = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    // Check if source has discussions data
                    if (sourceChallenge.discussions && Array.isArray(sourceChallenge.discussions) && sourceChallenge.discussions.length > 0) {
                        count++;

                        // Verify the discussions exist in the database
                        expect(dbChallenge.discussions).toBeDefined();
                        expect(Array.isArray(dbChallenge.discussions)).toBe(true);

                        // Verify the number of discussions matches
                        expect(dbChallenge.discussions.length).toBe(sourceChallenge.discussions.length);

                        // Check each discussion
                        sourceChallenge.discussions.forEach(sourceDiscussion => {
                            // Find matching discussion in database by name and type (assuming these make a unique combination)
                            const dbDiscussion = dbChallenge.discussions.find(d =>
                                d.discussionId === sourceDiscussion.id
                            );

                            // Verify the discussion exists
                            expect(dbDiscussion).toBeDefined();

                            if (dbDiscussion) {
                                // Verify discussion fields
                                expect(dbDiscussion.name).toBe(sourceDiscussion.name);
                                expect(dbDiscussion.type).toBe(discussionTypeMap[sourceDiscussion.type]);
                                expect(dbDiscussion.provider).toBe(sourceDiscussion.provider);

                                // Verify nullable fields
                                compareNullableField(dbDiscussion.discussionId, sourceDiscussion.id);
                                compareNullableField(dbDiscussion.url, sourceDiscussion.url);

                                // Verify relation field
                                expect(dbDiscussion.challengeId).toBe(dbChallenge.id);

                                // Verify options if they exist
                                if (sourceDiscussion.options && Array.isArray(sourceDiscussion.options) && sourceDiscussion.options.length > 0) {
                                    expect(dbDiscussion.options).toBeDefined();
                                    expect(Array.isArray(dbDiscussion.options)).toBe(true);
                                    expect(dbDiscussion.options.length).toBe(sourceDiscussion.options.length);

                                    // Check each option
                                    sourceDiscussion.options.forEach(sourceOption => {
                                        const dbOption = dbDiscussion.options.find(o =>
                                            o.optionKey === sourceOption.key
                                        );

                                        expect(dbOption).toBeDefined();
                                        if (dbOption) {
                                            expect(dbOption.optionKey).toBe(sourceOption.key);
                                            expect(dbOption.optionValue).toBe(sourceOption.value);
                                            expect(dbOption.discussionId).toBe(dbDiscussion.id);

                                            // Verify audit fields if they exist in source
                                            if (sourceOption.created) {
                                                const sourceDate = new Date(sourceOption.created).getTime();
                                                const dbDate = new Date(dbOption.createdAt).getTime();
                                                expect(dbDate).toBe(sourceDate);
                                            }

                                            if (sourceOption.updated) {
                                                const sourceDate = new Date(sourceOption.updated).getTime();
                                                const dbDate = new Date(dbOption.updatedAt).getTime();
                                                expect(dbDate).toBe(sourceDate);
                                            }

                                            if (sourceOption.createdBy) {
                                                expect(dbOption.createdBy).toBe(sourceOption.createdBy);
                                            }

                                            if (sourceOption.updatedBy) {
                                                expect(dbOption.updatedBy).toBe(sourceOption.updatedBy);
                                            }
                                        }
                                        _count++;
                                    });
                                }
                                // If DB has discussion options but source doesn't, this might be expected in some cases
                                else if ((!sourceDiscussion.options || !Array.isArray(sourceDiscussion.options) || sourceDiscussion.options.length === 0) &&
                                    dbDiscussion.options && dbDiscussion.options.length > 0) {
                                    console.warn(`ChallengeDiscussion ${dbDiscussion.id} has discussion options in database but not in source`);
                                    _missingCount++;
                                }

                                // Verify audit fields if they exist in source
                                if (sourceDiscussion.created) {
                                    const sourceDate = new Date(sourceDiscussion.created).getTime();
                                    const dbDate = new Date(dbDiscussion.createdAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourceDiscussion.updated) {
                                    const sourceDate = new Date(sourceDiscussion.updated).getTime();
                                    const dbDate = new Date(dbDiscussion.updatedAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourceDiscussion.createdBy) {
                                    expect(dbDiscussion.createdBy).toBe(sourceDiscussion.createdBy);
                                }

                                if (sourceDiscussion.updatedBy) {
                                    expect(dbDiscussion.updatedBy).toBe(sourceDiscussion.updatedBy);
                                }
                            }
                        });
                    }
                    // If DB has discussions but source doesn't, this might be expected in some cases
                    else if ((!sourceChallenge.discussions || !Array.isArray(sourceChallenge.discussions) || sourceChallenge.discussions.length === 0) &&
                        dbChallenge.discussions && dbChallenge.discussions.length > 0) {
                        console.warn(`Challenge ${dbChallenge.id} has discussions in database but not in source`);
                        missingCount++;
                    }
                });
            });

            console.log(`Validated discussions relation for ${count} records (Challenge had ${missingCount} exclusive discussions in DB but not in source)`);
            console.log(`Validated discussion options relation for ${_count} records (ChallengeDiscussion had ${_missingCount} exclusive discussion options in DB but not in source)`);
        });

        test('should correctly migrate challenge metadata', () => {
            let count = 0;
            let missingCount = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    // Check if source has metadata
                    if (sourceChallenge.metadata && Array.isArray(sourceChallenge.metadata) && sourceChallenge.metadata.length > 0) {

                        // Verify the metadata exists in the database
                        expect(dbChallenge.metadata).toBeDefined();
                        expect(Array.isArray(dbChallenge.metadata)).toBe(true);

                        // Verify the number of metadata items matches
                        expect(dbChallenge.metadata.length).toBe(sourceChallenge.metadata.length);

                        // Check each metadata item
                        sourceChallenge.metadata.forEach(sourceMetadata => {
                            // Find matching metadata in database by name
                            const dbMetadata = dbChallenge.metadata.find(m => m.name === sourceMetadata.name);

                            // Verify the metadata exists
                            expect(dbMetadata).toBeDefined();

                            if (dbMetadata) {
                                // Verify metadata fields
                                expect(dbMetadata.name).toBe(sourceMetadata.name);
                                expect(dbMetadata.value).toBe(String(sourceMetadata.value));

                                // Verify relation field
                                expect(dbMetadata.challengeId).toBe(dbChallenge.id);

                                // Verify audit fields if they exist in source
                                if (sourceMetadata.created) {
                                    const sourceDate = new Date(sourceMetadata.created).getTime();
                                    const dbDate = new Date(dbMetadata.createdAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourceMetadata.updated) {
                                    const sourceDate = new Date(sourceMetadata.updated).getTime();
                                    const dbDate = new Date(dbMetadata.updatedAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourceMetadata.createdBy) {
                                    expect(dbMetadata.createdBy).toBe(sourceMetadata.createdBy);
                                }

                                if (sourceMetadata.updatedBy) {
                                    expect(dbMetadata.updatedBy).toBe(sourceMetadata.updatedBy);
                                }
                            }
                            count++;
                        });
                    }
                    // If DB has metadata but source doesn't, this might be expected in some cases
                    else if ((!sourceChallenge.metadata || !Array.isArray(sourceChallenge.metadata) || sourceChallenge.metadata.length === 0) &&
                        dbChallenge.metadata && dbChallenge.metadata.length > 0) {
                        console.warn(`Challenge ${dbChallenge.id} has metadata in database but not in source`);
                        missingCount++;
                    }
                });
            });

            console.log(`Validated metadata relation for ${count} records (Challenge had ${missingCount} exclusive metadata in DB but not in source)`);
        });

        test('should correctly migrate challenge winner data', () => {
            let count = 0;
            let missingCount = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    // Check if source has winners data
                    if (sourceChallenge.winners && Array.isArray(sourceChallenge.winners) && sourceChallenge.winners.length > 0) {

                        // Verify the winners exist in the database
                        expect(dbChallenge.winners).toBeDefined();
                        expect(Array.isArray(dbChallenge.winners)).toBe(true);

                        // Verify the number of winners matches
                        expect(dbChallenge.winners.length).toBe(sourceChallenge.winners.length);

                        // Check each winner
                        sourceChallenge.winners.forEach(sourceWinner => {
                            // Find matching winner in database by userId and placement
                            const dbWinner = dbChallenge.winners.find(w =>
                                w.userId === sourceWinner.userId &&
                                w.placement === sourceWinner.placement
                            );

                            // Verify the winner exists
                            expect(dbWinner).toBeDefined();

                            if (dbWinner) {
                                // Verify winner fields
                                expect(dbWinner.userId).toBe(sourceWinner.userId);
                                expect(dbWinner.handle).toBe(sourceWinner.handle);
                                expect(dbWinner.placement).toBe(sourceWinner.placement);
                                expect(dbWinner.type).toBe(prizeSetTypeMap[sourceWinner.type || 'placement']);

                                // Verify relation field
                                expect(dbWinner.challengeId).toBe(dbChallenge.id);

                                // Verify audit fields if they exist in source
                                if (sourceWinner.created) {
                                    const sourceDate = new Date(sourceWinner.created).getTime();
                                    const dbDate = new Date(dbWinner.createdAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourceWinner.updated) {
                                    const sourceDate = new Date(sourceWinner.updated).getTime();
                                    const dbDate = new Date(dbWinner.updatedAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourceWinner.createdBy) {
                                    expect(dbWinner.createdBy).toBe(sourceWinner.createdBy);
                                }

                                if (sourceWinner.updatedBy) {
                                    expect(dbWinner.updatedBy).toBe(sourceWinner.updatedBy);
                                }
                            }
                            count++;
                        });
                    }
                    // If DB has winners but source doesn't, this might be expected in some cases
                    else if ((!sourceChallenge.winners || !Array.isArray(sourceChallenge.winners) || sourceChallenge.winners.length === 0) &&
                        dbChallenge.winners && dbChallenge.winners.length > 0) {
                        console.warn(`Challenge ${dbChallenge.id} has winners in database but not in source`);
                        missingCount++;
                    }
                });
            });

            console.log(`Validated winners relation for ${count} records (Challenge had ${missingCount} exclusive winners in DB but not in source)`);
        });

        test('should correctly migrate challenge term data', () => {
            let count = 0;
            let missingCount = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    // Check if source has terms data
                    if (sourceChallenge.terms && Array.isArray(sourceChallenge.terms) && sourceChallenge.terms.length > 0) {

                        // Verify the terms exist in the database
                        expect(dbChallenge.terms).toBeDefined();
                        expect(Array.isArray(dbChallenge.terms)).toBe(true);

                        // Verify the number of terms matches
                        expect(dbChallenge.terms.length).toBe(sourceChallenge.terms.length);

                        // Check each term
                        sourceChallenge.terms.forEach(sourceTerm => {
                            // Find matching term in database by termId
                            const dbTerm = dbChallenge.terms.find(t =>
                                t.termId === sourceTerm.id
                            );

                            // Verify the term exists
                            expect(dbTerm).toBeDefined();

                            if (dbTerm) {
                                // Verify term fields
                                expect(dbTerm.termId).toBe(sourceTerm.id);
                                expect(dbTerm.roleId).toBe(sourceTerm.roleId);

                                // Verify relation field
                                expect(dbTerm.challengeId).toBe(dbChallenge.id);

                                // Verify audit fields if they exist in source
                                if (sourceTerm.created) {
                                    const sourceDate = new Date(sourceTerm.created).getTime();
                                    const dbDate = new Date(dbTerm.createdAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourceTerm.updated) {
                                    const sourceDate = new Date(sourceTerm.updated).getTime();
                                    const dbDate = new Date(dbTerm.updatedAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourceTerm.createdBy) {
                                    expect(dbTerm.createdBy).toBe(sourceTerm.createdBy);
                                }

                                if (sourceTerm.updatedBy) {
                                    expect(dbTerm.updatedBy).toBe(sourceTerm.updatedBy);
                                }
                            }
                            count++;
                        });
                    }
                    // If DB has terms but source doesn't, this might be expected in some cases
                    else if ((!sourceChallenge.terms || !Array.isArray(sourceChallenge.terms) || sourceChallenge.terms.length === 0) &&
                        dbChallenge.terms && dbChallenge.terms.length > 0) {
                        console.warn(`Challenge ${dbChallenge.id} has terms in database but not in source`);
                        missingCount++;
                    }
                });
            });

            console.log(`Validated terms relation for ${count} records (Challenge had ${missingCount} exclusive terms in DB but not in source)`);
        });

        test('should correctly migrate challenge skill data', () => {
            let count = 0;
            let missingCount = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    // Check if source has skills data
                    if (sourceChallenge.skills && Array.isArray(sourceChallenge.skills) && sourceChallenge.skills.length > 0) {

                        // Verify the skills exist in the database
                        expect(dbChallenge.skills).toBeDefined();
                        expect(Array.isArray(dbChallenge.skills)).toBe(true);

                        // Verify the number of skills matches
                        expect(dbChallenge.skills.length).toBe(sourceChallenge.skills.length);

                        // Check each skill
                        sourceChallenge.skills.forEach(sourceSkill => {
                            // Find matching skill in database by skillId
                            const dbSkill = dbChallenge.skills.find(s => s.skillId === sourceSkill.id);

                            // Verify the skill exists
                            expect(dbSkill).toBeDefined();

                            if (dbSkill) {
                                // Verify skill fields
                                expect(dbSkill.skillId).toBe(sourceSkill.id);

                                // Verify relation field
                                expect(dbSkill.challengeId).toBe(dbChallenge.id);

                                // Verify audit fields if they exist in source
                                if (sourceSkill.created) {
                                    const sourceDate = new Date(sourceSkill.created).getTime();
                                    const dbDate = new Date(dbSkill.createdAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourceSkill.updated) {
                                    const sourceDate = new Date(sourceSkill.updated).getTime();
                                    const dbDate = new Date(dbSkill.updatedAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourceSkill.createdBy) {
                                    expect(dbSkill.createdBy).toBe(sourceSkill.createdBy);
                                }

                                if (sourceSkill.updatedBy) {
                                    expect(dbSkill.updatedBy).toBe(sourceSkill.updatedBy);
                                }
                            }
                            count++;
                        });
                    }
                    // If DB has skills but source doesn't, this might be expected in some cases
                    else if ((!sourceChallenge.skills || !Array.isArray(sourceChallenge.skills) || sourceChallenge.skills.length === 0) &&
                        dbChallenge.skills && dbChallenge.skills.length > 0) {
                        console.warn(`Challenge ${dbChallenge.id} has skills in database but not in source`);
                        missingCount++;
                    }
                });
            });

            console.log(`Validated skills relation for ${count} records (Challenge had ${missingCount} exclusive skills in DB but not in source)`);
        });

        test('should correctly migrate challenge prize set and prize data', () => {
            let count = 0;
            let missingCount = 0;

            let _count = 0;
            let _missingCount = 0;
        
            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    // Check if source has prizeSets data
                    if (sourceChallenge.prizeSets && Array.isArray(sourceChallenge.prizeSets) && sourceChallenge.prizeSets.length > 0) {

                        // Verify the prizeSets exist in the database
                        expect(dbChallenge.prizeSets).toBeDefined();
                        expect(Array.isArray(dbChallenge.prizeSets)).toBe(true);

                        // Verify the number of prizeSets matches
                        expect(dbChallenge.prizeSets.length).toBe(sourceChallenge.prizeSets.length);

                        // Check each prizeSet
                        sourceChallenge.prizeSets.forEach(sourcePrizeSet => {
                            // Find matching prizeSet in database by type and description
                            const dbPrizeSet = dbChallenge.prizeSets.find(ps =>
                                ps.type === prizeSetTypeMap[sourcePrizeSet.type] &&
                                (ps.description === sourcePrizeSet.description ||
                                    (!ps.description && !sourcePrizeSet.description))
                            );

                            // Verify the prizeSet exists
                            expect(dbPrizeSet).toBeDefined();

                            if (dbPrizeSet) {
                                // Verify prizeSet fields
                                expect(dbPrizeSet.type).toBe(prizeSetTypeMap[sourcePrizeSet.type]);
                                compareNullableField(dbPrizeSet.description, sourcePrizeSet.description);

                                // Verify relation field
                                expect(dbPrizeSet.challengeId).toBe(dbChallenge.id);

                                // Verify prizes if they exist
                                if (sourcePrizeSet.prizes && Array.isArray(sourcePrizeSet.prizes)) {
                                    expect(dbPrizeSet.prizes).toBeDefined();
                                    expect(Array.isArray(dbPrizeSet.prizes)).toBe(true);
                                    expect(dbPrizeSet.prizes.length).toBe(sourcePrizeSet.prizes.length);

                                    // Check each prize
                                    sourcePrizeSet.prizes.forEach(sourcePrize => {
                                        // Find matching prize in database by type and value
                                        const dbPrize = dbPrizeSet.prizes.find(p =>
                                            p.type === sourcePrize.type &&
                                            p.value === sourcePrize.value
                                        );

                                        expect(dbPrize).toBeDefined();
                                        if (dbPrize) {
                                            // Verify prize fields
                                            expect(dbPrize.type).toBe(sourcePrize.type);
                                            expect(dbPrize.value).toBe(sourcePrize.value);
                                            compareNullableField(dbPrize.description, sourcePrize.description);

                                            // Verify relation field
                                            expect(dbPrize.prizeSetId).toBe(dbPrizeSet.id);

                                            // Verify audit fields if they exist in source
                                            if (sourcePrize.created) {
                                                const sourceDate = new Date(sourcePrize.created).getTime();
                                                const dbDate = new Date(dbPrize.createdAt).getTime();
                                                expect(dbDate).toBe(sourceDate);
                                            }

                                            if (sourcePrize.updated) {
                                                const sourceDate = new Date(sourcePrize.updated).getTime();
                                                const dbDate = new Date(dbPrize.updatedAt).getTime();
                                                expect(dbDate).toBe(sourceDate);
                                            }

                                            if (sourcePrize.createdBy) {
                                                expect(dbPrize.createdBy).toBe(sourcePrize.createdBy);
                                            }

                                            if (sourcePrize.updatedBy) {
                                                expect(dbPrize.updatedBy).toBe(sourcePrize.updatedBy);
                                            }
                                        }
                                        _count++;
                                    });
                                }
                                // If DB has prizes but source doesn't, this might be expected in some cases
                                else if ((!sourcePrizeSet.prizes || !Array.isArray(sourcePrizeSet.prizes) || sourcePrizeSet.prizes.length === 0) &&
                                dbPrizeSet.prizes && dbPrizeSet.prizes.length > 0) {
                                    console.warn(`ChallengePrizeSet ${dbPrizeSet.id} has prizes in database but not in source`);
                                    _missingCount++;
                                }

                                // Verify audit fields if they exist in source
                                if (sourcePrizeSet.created) {
                                    const sourceDate = new Date(sourcePrizeSet.created).getTime();
                                    const dbDate = new Date(dbPrizeSet.createdAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourcePrizeSet.updated) {
                                    const sourceDate = new Date(sourcePrizeSet.updated).getTime();
                                    const dbDate = new Date(dbPrizeSet.updatedAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourcePrizeSet.createdBy) {
                                    expect(dbPrizeSet.createdBy).toBe(sourcePrizeSet.createdBy);
                                }

                                if (sourcePrizeSet.updatedBy) {
                                    expect(dbPrizeSet.updatedBy).toBe(sourcePrizeSet.updatedBy);
                                }
                            }
                            count++;
                        });
                    }
                    // If DB has prizeSets but source doesn't, this might be expected in some cases
                    else if ((!sourceChallenge.prizeSets || !Array.isArray(sourceChallenge.prizeSets) || sourceChallenge.prizeSets.length === 0) &&
                        dbChallenge.prizeSets && dbChallenge.prizeSets.length > 0) {
                        console.warn(`Challenge ${dbChallenge.id} has prizeSets in database but not in source`);
                        missingCount++;
                    }
                });
            });

            console.log(`Validated prizeSets relation for ${count} records (Challenge had ${missingCount} exclusive prizeSets in DB but not in source)`);
            console.log(`Validated prizes relation for ${_count} records (ChallengePrizeSet had ${_missingCount} exclusive prizes in DB but not in source)`);
        });

        // Test for ChallengeConstraint relation
        test('should correctly migrate challenge constraint data', () => {
            let count = 0;
            let missingCount = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    // Check if source has constraint data
                    if (sourceChallenge.constraint) {
                        count++;

                        // Verify the constraint exists in the database
                        expect(dbChallenge.constraintRecord).toBeDefined();

                        if (dbChallenge.constraintRecord) {
                            // Verify relation field
                            expect(dbChallenge.constraintRecord.challengeId).toBe(dbChallenge.id);

                            // Verify array field - sort before comparing to handle order differences
                            if (sourceChallenge.constraint.allowedRegistrants) {
                                expect([...dbChallenge.constraintRecord.allowedRegistrants].sort())
                                    .toEqual([...sourceChallenge.constraint.allowedRegistrants].sort());
                            } else {
                                // If source doesn't have allowedRegistrants, DB should have empty array (default)
                                expect(dbChallenge.constraintRecord.allowedRegistrants).toEqual([]);
                            }

                            // Verify audit fields if they exist in source
                            if (sourceChallenge.constraint.created) {
                                const sourceDate = new Date(sourceChallenge.constraint.created).getTime();
                                const dbDate = new Date(dbChallenge.constraintRecord.createdAt).getTime();
                                expect(dbDate).toBe(sourceDate);
                            }

                            if (sourceChallenge.constraint.updated) {
                                const sourceDate = new Date(sourceChallenge.constraint.updated).getTime();
                                const dbDate = new Date(dbChallenge.constraintRecord.updatedAt).getTime();
                                expect(dbDate).toBe(sourceDate);
                            }

                            if (sourceChallenge.constraint.createdBy) {
                                expect(dbChallenge.constraintRecord.createdBy).toBe(sourceChallenge.constraint.createdBy);
                            }

                            if (sourceChallenge.constraint.updatedBy) {
                                expect(dbChallenge.constraintRecord.updatedBy).toBe(sourceChallenge.constraint.updatedBy);
                            }
                        }
                    }
                    // If DB has constraint but source doesn't, this might be expected in some cases
                    else if (!sourceChallenge.constraint && dbChallenge.constraintRecord) {
                        console.warn(`Challenge ${dbChallenge.id} has constraint in database but not in source`);
                        missingCount++;
                    }
                });
            });

            console.log(`Validated constraint relation for ${count} records (Challenge had ${missingCount} exclusive constraint in DB but not in source)`);
        });
    });

    // Test for Phase, ChallengePhase, and ChallengePhaseConstraint relations
    describe('Phase model validation', () => {
        let sourcePhases = [];

        beforeAll(async () => {
            // Load phase data from separate file
            sourcePhases = await loadData(path.join(__dirname, '../data'), process.env.PHASE_FILE);

            if (sourcePhases.array) {
                sourcePhases = sourcePhases.array;
            }

            console.log(`Loaded ${sourcePhases.length} phases from source data`);
        });

        test('should have migrated all phases from source data', async () => {
            // Get all phases from the database
            const dbPhases = await prisma.phase.findMany();

            // Get all names from source data
            const sourcePhaseNames = sourcePhases.map(phase => phase.name);

            // Get all names from database
            const dbPhaseNames = dbPhases.map(phase => phase.name);

            // Check if all source phase names exist in the database
            for (const sourceName of sourcePhaseNames) {
                expect(dbPhaseNames).toContain(sourceName);
            }

            console.log(`Verified ${sourcePhaseNames.length} phases were properly migrated`);
        });

        test('should have correctly migrated phase fields', async () => {
            // Get all phases from the database with a name index for faster lookup
            const dbPhases = await prisma.phase.findMany();
            const dbPhasesByName = new Map(dbPhases.map(phase => [phase.name, phase]));

            // Check each source phase
            for (const sourcePhase of sourcePhases) {
                const dbPhase = dbPhasesByName.get(sourcePhase.name);

                // Skip if not found (should be caught by previous test)
                if (!dbPhase) continue;

                // Verify phase fields
                expect(dbPhase.name).toBe(sourcePhase.name);
                compareNullableField(dbPhase.description, sourcePhase.description);
                expect(dbPhase.isOpen).toBe(sourcePhase.isOpen === true);
                expect(dbPhase.duration).toBe(sourcePhase.duration);

                // Verify audit fields if they exist in source
                if (sourcePhase.created) {
                    const sourceDate = new Date(sourcePhase.created).getTime();
                    const dbDate = new Date(dbPhase.createdAt).getTime();
                    expect(dbDate).toBe(sourceDate);
                }

                if (sourcePhase.updated) {
                    const sourceDate = new Date(sourcePhase.updated).getTime();
                    const dbDate = new Date(dbPhase.updatedAt).getTime();
                    expect(dbDate).toBe(sourceDate);
                }

                if (sourcePhase.createdBy) {
                    expect(dbPhase.createdBy).toBe(sourcePhase.createdBy);
                }

                if (sourcePhase.updatedBy) {
                    expect(dbPhase.updatedBy).toBe(sourcePhase.updatedBy);
                }
            }
        });

        test('should correctly migrate challenge phases and constraints', () => {
            let count = 0;
            let missingCount = 0;

            let _count = 0;
            let _missingCount = 0;
        
            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    // Check if source has phases data
                    if (sourceChallenge.phases && Array.isArray(sourceChallenge.phases) && sourceChallenge.phases.length > 0) {

                        // Verify the phases exist in the database
                        expect(dbChallenge.phases).toBeDefined();
                        expect(Array.isArray(dbChallenge.phases)).toBe(true);

                        // Verify the number of phases matches
                        expect(dbChallenge.phases.length).toBe(sourceChallenge.phases.length);

                        // Check each phase
                        sourceChallenge.phases.forEach(sourcePhase => {
                            // Find matching phase in database by name
                            const dbPhase = dbChallenge.phases.find(p =>
                                p.id === sourcePhase.id
                            );

                            // Verify the phase exists
                            expect(dbPhase).toBeDefined();

                            if (dbPhase) {
                                // Verify phase fields
                                expect(dbPhase.name).toBe(sourcePhase.name);
                                compareNullableField(dbPhase.description, sourcePhase.description);

                                if (sourcePhase.isOpen !== undefined) {
                                    expect(dbPhase.isOpen).toBe(sourcePhase.isOpen);
                                }

                                compareNullableField(dbPhase.predecessor, sourcePhase.predecessor);
                                compareNullableField(dbPhase.duration, sourcePhase.duration);

                                // Verify date fields
                                if (sourcePhase.scheduledStartDate) {
                                    const sourceDate = new Date(sourcePhase.scheduledStartDate).getTime();
                                    const dbDate = new Date(dbPhase.scheduledStartDate).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourcePhase.scheduledEndDate) {
                                    const sourceDate = new Date(sourcePhase.scheduledEndDate).getTime();
                                    const dbDate = new Date(dbPhase.scheduledEndDate).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourcePhase.actualStartDate) {
                                    const sourceDate = new Date(sourcePhase.actualStartDate).getTime();
                                    const dbDate = new Date(dbPhase.actualStartDate).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourcePhase.actualEndDate) {
                                    const sourceDate = new Date(sourcePhase.actualEndDate).getTime();
                                    const dbDate = new Date(dbPhase.actualEndDate).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                // Verify relation fields
                                expect(dbPhase.challengeId).toBe(dbChallenge.id);

                                // Verify constraints if they exist
                                if (sourcePhase.constraints && Array.isArray(sourcePhase.constraints) && sourcePhase.constraints.length > 0) {
                                    expect(dbPhase.constraints).toBeDefined();
                                    expect(Array.isArray(dbPhase.constraints)).toBe(true);
                                    expect(dbPhase.constraints.length).toBe(sourcePhase.constraints.length);

                                    // Check each constraint
                                    sourcePhase.constraints.forEach(sourceConstraint => {
                                        const dbConstraint = dbPhase.constraints.find(c => c.name === sourceConstraint.name);

                                        expect(dbConstraint).toBeDefined();
                                        if (dbConstraint) {
                                            expect(dbConstraint.name).toBe(sourceConstraint.name);
                                            expect(dbConstraint.value).toBe(sourceConstraint.value);
                                            expect(dbConstraint.challengePhaseId).toBe(dbPhase.id);
                                        }
                                        _count++;
                                    });
                                }
                                // If DB has phases but source doesn't, this might be expected in some cases
                                else if ((!sourcePhase.constraints || !Array.isArray(sourcePhase.constraints) || sourcePhase.constraints.length === 0) &&
                                    dbPhase.constraints && dbPhase.constraints.length > 0) {
                                    console.warn(`ChallengePhase ${dbPhase.id} has phase constraints in database but not in source`);
                                    _missingCount++;
                                }

                                // Verify audit fields if they exist in source
                                if (sourcePhase.created) {
                                    const sourceDate = new Date(sourcePhase.created).getTime();
                                    const dbDate = new Date(dbPhase.createdAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourcePhase.updated) {
                                    const sourceDate = new Date(sourcePhase.updated).getTime();
                                    const dbDate = new Date(dbPhase.updatedAt).getTime();
                                    expect(dbDate).toBe(sourceDate);
                                }

                                if (sourcePhase.createdBy) {
                                    expect(dbPhase.createdBy).toBe(sourcePhase.createdBy);
                                }

                                if (sourcePhase.updatedBy) {
                                    expect(dbPhase.updatedBy).toBe(sourcePhase.updatedBy);
                                }
                            }
                            count++;
                        });
                    }
                    // If DB has phases but source doesn't, this might be expected in some cases
                    else if ((!sourceChallenge.phases || !Array.isArray(sourceChallenge.phases) || sourceChallenge.phases.length === 0) &&
                        dbChallenge.phases && dbChallenge.phases.length > 0) {
                        console.warn(`Challenge ${dbChallenge.id} has phases in database but not in source`);
                        missingCount++;
                    }
                });
            });

            console.log(`Validated challenge phases relation for ${count} records (Challenge had ${missingCount} exclusive phases in DB but not in source)`);
            console.log(`Validated challenge phase constraints relation for ${_count} records (ChallengePhase had ${_missingCount} exclusive phase constraints in DB but not in source)`);
        });
    });

    // Test for TimelineTemplate, TimelineTemplatePhase, and ChallengeTimelineTemplate relations
    describe('TimelineTemplate relation validation', () => {
        let sourceTimelineTemplates = [];
        let sourceChallengeTimelineTemplates = [];

        beforeAll(async () => {
            // Load timeline template data from separate files
            sourceTimelineTemplates = await loadData(path.join(__dirname, '../data'), process.env.TIMELINE_TEMPLATE_FILE);
            sourceChallengeTimelineTemplates = await loadData(path.join(__dirname, '../data'), process.env.CHALLENGE_TIMELINE_TEMPLATE_FILE);

            if (sourceTimelineTemplates.array) {
                sourceTimelineTemplates = sourceTimelineTemplates.array;
            }

            if (sourceChallengeTimelineTemplates.array) {
                sourceChallengeTimelineTemplates = sourceChallengeTimelineTemplates.array;
            }

            console.log(`Loaded ${sourceTimelineTemplates.length} timeline templates and ${sourceChallengeTimelineTemplates.length} challenge timeline templates from source data`);
        });

        test('should have migrated all timeline templates from source data', async () => {
            // Get all timeline templates from the database
            const dbTimelineTemplates = await prisma.timelineTemplate.findMany();

            // Get all names from source data
            const sourceNames = sourceTimelineTemplates.map(template => template.name);

            // Get all names from database
            const dbNames = dbTimelineTemplates.map(template => template.name);

            // Check if all source template names exist in the database
            for (const sourceName of sourceNames) {
                expect(dbNames).toContain(sourceName);
            }

            // If DB has timeline templates but source doesn't, this might be expected in some cases
            const missingCount = (dbNames.length - sourceNames.length) > 0 ? dbNames.length - sourceNames.length : 0;

            console.log(`Verified ${sourceNames.length} timeline templates were properly migrated (${missingCount} timeline templates in DB but not in source)`);
        });

        test('should have correctly migrated timeline template fields and timeline template phases', async () => {
            let count = 0;
            let missingCount = 0;
            // Get all timeline templates from the database with a name index for faster lookup
            const dbTimelineTemplates = await prisma.timelineTemplate.findMany({
                include: {
                    phases: true
                }
            });
            const dbTemplatesByName = new Map(dbTimelineTemplates.map(template => [template.name, template]));

            // Check each source template
            for (const sourceTemplate of sourceTimelineTemplates) {
                const dbTemplate = dbTemplatesByName.get(sourceTemplate.name);

                // Skip if not found (should be caught by previous test)
                if (!dbTemplate) continue;

                // Verify template fields
                expect(dbTemplate.name).toBe(sourceTemplate.name);
                compareNullableField(dbTemplate.description, sourceTemplate.description);
                expect(dbTemplate.isActive).toBe(sourceTemplate.isActive !== false); // Default is true

                // Verify phases if they exist
                sourceTemplate.phases = parseStringArray(sourceTemplate.phases, 'TimelineTemplatePhase');
                if (sourceTemplate.phases && Array.isArray(sourceTemplate.phases) && sourceTemplate.phases.length > 0) {
                    expect(dbTemplate.phases).toBeDefined();
                    expect(Array.isArray(dbTemplate.phases)).toBe(true);
                    expect(dbTemplate.phases.length).toBe(sourceTemplate.phases.length);

                    // Check each phase
                    sourceTemplate.phases.forEach(sourcePhase => {
                        // Find matching phase in database by phaseId
                        const dbPhase = dbTemplate.phases.find(p => p.phaseId === sourcePhase.phaseId);

                        expect(dbPhase).toBeDefined();
                        if (dbPhase) {
                            expect(dbPhase.phaseId).toBe(sourcePhase.phaseId);
                            compareNullableField(dbPhase.predecessor, sourcePhase.predecessor);
                            expect(dbPhase.defaultDuration).toBe(sourcePhase.defaultDuration);
                            expect(dbPhase.timelineTemplateId).toBe(dbTemplate.id);

                            // Verify audit fields if they exist in source
                            if (sourcePhase.created) {
                                const sourceDate = new Date(sourcePhase.created).getTime();
                                const dbDate = new Date(dbPhase.createdAt).getTime();
                                expect(dbDate).toBe(sourceDate);
                            }

                            if (sourcePhase.updated) {
                                const sourceDate = new Date(sourcePhase.updated).getTime();
                                const dbDate = new Date(dbPhase.updatedAt).getTime();
                                expect(dbDate).toBe(sourceDate);
                            }

                            if (sourcePhase.createdBy) {
                                expect(dbPhase.createdBy).toBe(sourcePhase.createdBy);
                            }

                            if (sourcePhase.updatedBy) {
                                expect(dbPhase.updatedBy).toBe(sourcePhase.updatedBy);
                            }
                        }
                        count++;
                    });
                }
                // If DB has phases but source doesn't, this might be expected in some cases
                else if ((!sourceTemplate.phases || !Array.isArray(sourceTemplate.phases) || sourceTemplate.phases.length === 0) &&
                dbTemplate.phases &&dbTemplate.phases.length > 0) {
                console.warn(`TimelineTemplate ${sourceTemplate.id} has phases in database but not in source`);
                missingCount++;
            }

                // Verify audit fields if they exist in source
                if (sourceTemplate.created) {
                    const sourceDate = new Date(sourceTemplate.created).getTime();
                    const dbDate = new Date(dbTemplate.createdAt).getTime();
                    expect(dbDate).toBe(sourceDate);
                }

                if (sourceTemplate.updated) {
                    const sourceDate = new Date(sourceTemplate.updated).getTime();
                    const dbDate = new Date(dbTemplate.updatedAt).getTime();
                    expect(dbDate).toBe(sourceDate);
                }

                if (sourceTemplate.createdBy) {
                    expect(dbTemplate.createdBy).toBe(sourceTemplate.createdBy);
                }

                if (sourceTemplate.updatedBy) {
                    expect(dbTemplate.updatedBy).toBe(sourceTemplate.updatedBy);
                }
            }
            console.log(`Validated timeline template phases relation for ${count} records (Timeline template had ${missingCount} exclusive phases in DB but not in source)`);
        });

        test('should have migrated all challenge timeline templates from source data', async () => {
            // Get all challenge timeline templates from the database
            const dbChallengeTimelineTemplates = await prisma.challengeTimelineTemplate.findMany();

            // Get all IDs from source data
            const sourceIds = sourceChallengeTimelineTemplates.map(template => template.id);

            // Get all IDs from database
            const dbIds = dbChallengeTimelineTemplates.map(template => template.id);

            // Check if all source IDs exist in the database (excluding skipped ones)
            const skippedIds = skippedIdsByModel['ChallengeTimelineTemplate'] || [];
            const validSourceIds = sourceIds.filter(id => !skippedIds.includes(id));

            for (const sourceId of validSourceIds) {
                expect(dbIds).toContain(sourceId);
            }

            console.log(`Verified ${validSourceIds.length} challenge timeline templates were properly migrated (${skippedIds.length} skipped)`);
        });

        test('should have correctly migrated challenge timeline template fields', async () => {
            // Get all challenge timeline templates from the database
            const dbChallengeTimelineTemplates = await prisma.challengeTimelineTemplate.findMany({
                include: {
                    timelineTemplate: true,
                    track: true,
                    type: true
                }
            });
            const dbTemplatesById = new Map(dbChallengeTimelineTemplates.map(template => [template.id, template]));

            // Get skipped IDs
            const skippedIds = skippedIdsByModel['ChallengeTimelineTemplate'] || [];

            // Check each source template
            for (const sourceTemplate of sourceChallengeTimelineTemplates) {
                // Skip if this template was skipped during migration
                if (skippedIds.includes(sourceTemplate.id)) continue;

                const dbTemplate = dbTemplatesById.get(sourceTemplate.id);

                // Skip if not found (should be caught by previous test)
                if (!dbTemplate) continue;

                // Verify template fields
                expect(dbTemplate.typeId).toBe(sourceTemplate.typeId);
                expect(dbTemplate.trackId).toBe(sourceTemplate.trackId);
                expect(dbTemplate.timelineTemplateId).toBe(sourceTemplate.timelineTemplateId);
                expect(dbTemplate.isDefault).toBe(sourceTemplate.isDefault === true);

                // Verify relations exist
                expect(dbTemplate.timelineTemplate).toBeDefined();
                expect(dbTemplate.track).toBeDefined();
                expect(dbTemplate.type).toBeDefined();

                // Verify audit fields if they exist in source
                if (sourceTemplate.created) {
                    const sourceDate = new Date(sourceTemplate.created).getTime();
                    const dbDate = new Date(dbTemplate.createdAt).getTime();
                    expect(dbDate).toBe(sourceDate);
                }

                if (sourceTemplate.updated) {
                    const sourceDate = new Date(sourceTemplate.updated).getTime();
                    const dbDate = new Date(dbTemplate.updatedAt).getTime();
                    expect(dbDate).toBe(sourceDate);
                }

                if (sourceTemplate.createdBy) {
                    expect(dbTemplate.createdBy).toBe(sourceTemplate.createdBy);
                }

                if (sourceTemplate.updatedBy) {
                    expect(dbTemplate.updatedBy).toBe(sourceTemplate.updatedBy);
                }
            }
        });

        test('should correctly link challenges to timeline templates', () => {
            let count = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    // Check if source has timelineTemplateId
                    if (sourceChallenge.timelineTemplateId) {
                        count++;

                        // Verify the timelineTemplate relation exists
                        expect(dbChallenge.timelineTemplateId).toBe(sourceChallenge.timelineTemplateId);

                        if (dbChallenge.timelineTemplate) {
                            expect(dbChallenge.timelineTemplate.id).toBe(sourceChallenge.timelineTemplateId);
                        }
                    }
                });
            });

            console.log(`Validated timeline template relation for ${count} challenges`);
        });
    });

    // Test for ChallengeType and ChallengeTrack relations
    describe('ChallengeType and ChallengeTrack relation validation', () => {
        let sourceChallengeTypes = [];
        let sourceChallengeTracks = [];

        beforeAll(async () => {
            // Load challenge type and track data from separate files
            sourceChallengeTypes = await loadData(path.join(__dirname, '../data'), process.env.CHALLENGE_TYPE_FILE);
            sourceChallengeTracks = await loadData(path.join(__dirname, '../data'), process.env.CHALLENGE_TRACK_FILE);

            if (sourceChallengeTypes.array) {
                sourceChallengeTypes = sourceChallengeTypes.array;
            }

            if (sourceChallengeTracks.array) {
                sourceChallengeTracks = sourceChallengeTracks.array;
            }

            console.log(`Loaded ${sourceChallengeTypes.length} challenge types and ${sourceChallengeTracks.length} challenge tracks from source data`);
        });

        test('should have migrated all challenge types from source data', async () => {
            // Get all challenge types from the database
            const dbChallengeTypes = await prisma.challengeType.findMany();

            // Get all IDs from source data
            const sourceIds = sourceChallengeTypes.map(type => type.id);

            // Get all IDs from database
            const dbIds = dbChallengeTypes.map(type => type.id);

            // Check if all source IDs exist in the database
            const skippedIds = skippedIdsByModel['ChallengeType'] || [];
            const validSourceIds = sourceIds.filter(id => !skippedIds.includes(id));

            for (const sourceId of validSourceIds) {
                expect(dbIds).toContain(sourceId);
            }

            console.log(`Verified ${validSourceIds.length} challenge types were properly migrated (${skippedIds.length} skipped)`);
        });

        test('should have correctly migrated challenge type fields', async () => {
            // Get all challenge types from the database
            const dbChallengeTypes = await prisma.challengeType.findMany();
            const dbTypeById = new Map(dbChallengeTypes.map(type => [type.id, type]));

            // Get skipped IDs
            const skippedIds = skippedIdsByModel['ChallengeType'] || [];

            // Check each source type
            for (const sourceType of sourceChallengeTypes) {
                // Skip if this type was skipped during migration
                if (skippedIds.includes(sourceType.id)) continue;

                const dbType = dbTypeById.get(sourceType.id);

                // Skip if not found (should be caught by previous test)
                if (!dbType) continue;

                // Verify type fields
                expect(dbType.name).toBe(sourceType.name);
                compareNullableField(dbType.description, sourceType.description);
                expect(dbType.isActive).toBe(sourceType.isActive !== false); // Default is true
                expect(dbType.isTask).toBe(sourceType.isTask === true); // Default is false
                expect(dbType.abbreviation).toBe(sourceType.abbreviation);

                // Verify audit fields if they exist in source
                if (sourceType.created) {
                    const sourceDate = new Date(sourceType.created).getTime();
                    const dbDate = new Date(dbType.createdAt).getTime();
                    expect(dbDate).toBe(sourceDate);
                }

                if (sourceType.updated) {
                    const sourceDate = new Date(sourceType.updated).getTime();
                    const dbDate = new Date(dbType.updatedAt).getTime();
                    expect(dbDate).toBe(sourceDate);
                }

                if (sourceType.createdBy) {
                    expect(dbType.createdBy).toBe(sourceType.createdBy);
                }

                if (sourceType.updatedBy) {
                    expect(dbType.updatedBy).toBe(sourceType.updatedBy);
                }
            }
        });

        test('should have migrated all challenge tracks from source data', async () => {
            // Get all challenge tracks from the database
            const dbChallengeTracks = await prisma.challengeTrack.findMany();

            // Get all IDs from source data
            const sourceIds = sourceChallengeTracks.map(track => track.id);

            // Get all IDs from database
            const dbIds = dbChallengeTracks.map(track => track.id);

            // Check if all source IDs exist in the database
            const skippedIds = skippedIdsByModel['ChallengeTrack'] || [];
            const validSourceIds = sourceIds.filter(id => !skippedIds.includes(id));

            for (const sourceId of validSourceIds) {
                expect(dbIds).toContain(sourceId);
            }

            console.log(`Verified ${validSourceIds.length} challenge tracks were properly migrated (${skippedIds.length} skipped)`);
        });

        test('should have correctly migrated challenge track fields', async () => {
            // Get all challenge tracks from the database
            const dbChallengeTracks = await prisma.challengeTrack.findMany();
            const dbTrackById = new Map(dbChallengeTracks.map(track => [track.id, track]));

            // Get skipped IDs
            const skippedIds = skippedIdsByModel['ChallengeTrack'] || [];

            // Check each source track
            for (const sourceTrack of sourceChallengeTracks) {
                // Skip if this track was skipped during migration
                if (skippedIds.includes(sourceTrack.id)) continue;

                const dbTrack = dbTrackById.get(sourceTrack.id);

                // Skip if not found (should be caught by previous test)
                if (!dbTrack) continue;

                // Verify track fields
                expect(dbTrack.name).toBe(sourceTrack.name);
                compareNullableField(dbTrack.description, sourceTrack.description);
                expect(dbTrack.isActive).toBe(sourceTrack.isActive);
                expect(dbTrack.abbreviation).toBe(sourceTrack.abbreviation);
                compareNullableField(dbTrack.legacyId, sourceTrack.legacyId);
                compareNullableField(dbTrack.track, trackMap[sourceTrack.name]);

                // Verify audit fields if they exist in source
                if (sourceTrack.created) {
                    const sourceDate = new Date(sourceTrack.created).getTime();
                    const dbDate = new Date(dbTrack.createdAt).getTime();
                    expect(dbDate).toBe(sourceDate);
                }

                if (sourceTrack.updated) {
                    const sourceDate = new Date(sourceTrack.updated).getTime();
                    const dbDate = new Date(dbTrack.updatedAt).getTime();
                    expect(dbDate).toBe(sourceDate);
                }

                if (sourceTrack.createdBy) {
                    expect(dbTrack.createdBy).toBe(sourceTrack.createdBy);
                }

                if (sourceTrack.updatedBy) {
                    expect(dbTrack.updatedBy).toBe(sourceTrack.updatedBy);
                }
            }
        });

        test('should correctly link challenges to types and tracks', () => {
            let typeCount = 0;
            let trackCount = 0;

            batchedData.forEach(({ batch, dbChallengeMap }) => {
                batch.forEach(sourceChallenge => {
                    const dbChallenge = dbChallengeMap.get(sourceChallenge.id);
                    if (!dbChallenge) return;

                    // Check type relation
                    if (sourceChallenge.typeId) {
                        typeCount++;
                        expect(dbChallenge.typeId).toBe(sourceChallenge.typeId);

                        // Verify the type relation exists if included in the query
                        if (dbChallenge.type) {
                            expect(dbChallenge.type.id).toBe(sourceChallenge.typeId);
                        }
                    }

                    // Check track relation
                    if (sourceChallenge.trackId) {
                        trackCount++;
                        expect(dbChallenge.trackId).toBe(sourceChallenge.trackId);

                        // Verify the track relation exists if included in the query
                        if (dbChallenge.track) {
                            expect(dbChallenge.track.id).toBe(sourceChallenge.trackId);
                        }
                    }
                });
            });

            console.log(`Validated type relation for ${typeCount} challenges and track relation for ${trackCount} challenges`);
        });
    });
});    