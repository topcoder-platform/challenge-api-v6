/*
 * Unit tests of challenge service
 */

if (!process.env.REVIEW_DB_URL && process.env.DATABASE_URL) {
  process.env.REVIEW_DB_URL = process.env.DATABASE_URL;
}

require("../../app-bootstrap");
const _ = require("lodash");
const axios = require("axios");
const config = require("config");
const { v4: uuid } = require("uuid");
const chai = require("chai");
const constants = require("../../app-constants");
const service = require("../../src/services/ChallengeService");
const helper = require("../../src/common/helper");
const m2mHelper = require("../../src/common/m2m-helper");
const challengeHelper = require("../../src/common/challenge-helper");
const projectHelper = require("../../src/common/project-helper");
const testHelper = require("../testHelper");
const { getClient, ChallengeStatusEnum, PrizeSetTypeEnum } = require("../../src/common/prisma");
const { getReviewClient } = require("../../src/common/review-prisma");
const prisma = getClient();
const reviewSchema = config.get("REVIEW_DB_SCHEMA");
const reviewTableName = `"${reviewSchema}"."review"`;
const submissionTableName = `"${reviewSchema}"."submission"`;
const aiReviewDecisionTableName = `"${reviewSchema}"."aiReviewDecision"`;
const should = chai.should();
let reviewClient;

describe("challenge service unit tests", () => {
  // created entity id
  let id;
  let id2;
  let attachment;
  const winners = [
    {
      userId: 12345678,
      handle: "thomaskranitsas",
      placement: 1,
    },
    {
      userId: 3456789,
      handle: "tonyj",
      placement: 2,
    },
  ];
  // generated data
  let data;
  let testChallengeData;
  let createdChallengeData;
  let billingLockRequests;
  let originalLockChallengeBillingAccountAmount;
  let originalRerateChallengeSubmitterRatings;
  let originalSearchStandSkills;
  const notFoundId = uuid();
  const authUser = {
    userId: "testuser",
  };

  before(async () => {
    await testHelper.clearData();
    await testHelper.createData();
    data = testHelper.getData();

    reviewClient = getReviewClient();
    await reviewClient.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${reviewSchema}"`);
    await reviewClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${reviewTableName} (
        "id" varchar(36) PRIMARY KEY,
        "phaseId" varchar(255) NOT NULL,
        "scorecardId" varchar(255),
        "status" varchar(32),
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now()
      )
    `);
    await reviewClient.$executeRawUnsafe(`
      ALTER TABLE ${reviewTableName}
      ADD COLUMN IF NOT EXISTS "scorecardId" varchar(255)
    `);
    await reviewClient.$executeRawUnsafe(`DELETE FROM ${reviewTableName}`);
    await reviewClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${submissionTableName} (
        "id" varchar(64) PRIMARY KEY,
        "challengeId" varchar(255),
        "memberId" varchar(255),
        "type" varchar(64),
        "status" varchar(64),
        "submittedDate" timestamp,
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now()
      )
    `);
    await reviewClient.$executeRawUnsafe(`
      ALTER TABLE ${submissionTableName}
      ADD COLUMN IF NOT EXISTS "challengeId" varchar(255)
    `);
    await reviewClient.$executeRawUnsafe(`
      ALTER TABLE ${submissionTableName}
      ADD COLUMN IF NOT EXISTS "memberId" varchar(255)
    `);
    await reviewClient.$executeRawUnsafe(`
      ALTER TABLE ${submissionTableName}
      ADD COLUMN IF NOT EXISTS "type" varchar(64)
    `);
    await reviewClient.$executeRawUnsafe(`
      ALTER TABLE ${submissionTableName}
      ADD COLUMN IF NOT EXISTS "isLatest" boolean
    `);
    await reviewClient.$executeRawUnsafe(`
      ALTER TABLE ${submissionTableName}
      ADD COLUMN IF NOT EXISTS "virusScan" boolean
    `);
    await reviewClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${aiReviewDecisionTableName} (
        "id" varchar(36) PRIMARY KEY,
        "submissionId" varchar(64),
        "configId" varchar(255),
        "isFinal" boolean
      )
    `);
    await reviewClient.$executeRawUnsafe(`DELETE FROM ${submissionTableName}`);
    await reviewClient.$executeRawUnsafe(`DELETE FROM ${aiReviewDecisionTableName}`);
    await reviewClient.$executeRawUnsafe(`DELETE FROM ${aiReviewDecisionTableName}`);

    testChallengeData = {
      typeId: data.challenge.typeId,
      trackId: data.challenge.trackId,
      legacy: {
        reviewType: "COMMUNITY",
        confidentialityType: "public",
        useSchedulingAPI: true,
        pureV5Task: false,
        selfService: false,
        selfServiceCopilot: "aaa",
      },
      billing: {
        billingAccountId: "billing-account",
        markup: 100,
      },
      task: {
        isTask: false,
        isAssigned: false,
        memberId: null,
      },
      name: "Prisma Test Challenge",
      description: "Prisma Test Challenge",
      privateDescription: "Prisma Test Challenge",
      descriptionFormat: "html",
      funChallenge: true,
      metadata: [
        {
          name: "meta-name",
          value: "meta-value",
        },
      ],
      timelineTemplateId: data.timelineTemplate.id,
      events: [
        {
          id: 1,
          name: "event-name",
          key: "event-key",
        },
      ],
      phases: [
        {
          phaseId: data.phase.id,
          duration: 120,
        },
        {
          phaseId: data.phase2.id,
          duration: 200,
        },
      ],
      discussions: [
        {
          id: "ad985cff-ad3e-44de-b54e-3992505ba0ae",
          name: "discussion name",
          type: "challenge",
          provider: "vanilla",
          options: [{ "discussion-opt": "discussion-value" }],
        },
      ],
      prizeSets: [
        {
          type: "placement",
          description: "placement prizes",
          prizes: [
            {
              description: "placement 1",
              type: "USD",
              value: 1000,
            },
          ],
        },
      ],
      tags: ["tag-1", "tag-2"],
      legacyId: 1,
      projectId: 123,
      startDate: "2025-03-13T06:56:50.701Z",
      status: "New",
      groups: [],
      terms: [],
      skills: [],
    };
  });

  beforeEach(() => {
    billingLockRequests = [];
    originalLockChallengeBillingAccountAmount = projectHelper.lockChallengeBillingAccountAmount;
    projectHelper.lockChallengeBillingAccountAmount = async (request) => {
      billingLockRequests.push(_.cloneDeep(request));
      return { locked: true };
    };
    originalRerateChallengeSubmitterRatings = helper.rerateChallengeSubmitterRatings;
    helper.rerateChallengeSubmitterRatings = async () => true;
    originalSearchStandSkills = helper.searchStandSkills;
    helper.searchStandSkills = async () => [];
  });

  afterEach(() => {
    projectHelper.lockChallengeBillingAccountAmount = originalLockChallengeBillingAccountAmount;
    helper.rerateChallengeSubmitterRatings = originalRerateChallengeSubmitterRatings;
    helper.searchStandSkills = originalSearchStandSkills;
  });

  after(async () => {
    const idsToDelete = _.compact([id, id2]);
    if (idsToDelete.length > 0) {
      await prisma.challenge.deleteMany({
        where: {
          id: {
            in: idsToDelete,
          },
        },
      });
    }
    await testHelper.clearData();
  });

  describe("create challenge tests", () => {
    it("create challenge successfully", async () => {
      const challengeData = _.cloneDeep(testChallengeData);
      const result = await service.createChallenge(
        { isMachine: true, sub: "sub", userId: "testuser" },
        challengeData,
        config.M2M_FULL_ACCESS_TOKEN,
      );
      createdChallengeData = result;
      should.exist(result.id);
      id = result.id;
      should.equal(result.typeId, data.challenge.typeId);
      should.equal(result.trackId, data.challenge.trackId);
      should.equal(result.name, testChallengeData.name);
      should.equal(result.description, testChallengeData.description);
      should.equal(result.timelineTemplateId, testChallengeData.timelineTemplateId);
      should.equal(result.phases.length, 2);
      should.exist(result.phases[0].id);
      should.equal(result.phases[0].phaseId, data.phase.id);
      should.equal(result.phases[0].duration, challengeData.phases[0].duration);
      should.equal(
        testHelper.getDatesDiff(result.phases[0].scheduledStartDate, challengeData.startDate),
        0,
      );
      should.equal(
        testHelper.getDatesDiff(result.phases[0].scheduledEndDate, challengeData.startDate),
        challengeData.phases[0].duration * 1000,
      );
      should.exist(result.phases[1].id);
      should.equal(result.phases[1].phaseId, data.phase2.id);
      should.equal(result.phases[1].predecessor, result.phases[0].phaseId);
      should.equal(result.phases[1].duration, challengeData.phases[1].duration);
      should.equal(
        testHelper.getDatesDiff(result.phases[1].scheduledStartDate, challengeData.startDate),
        challengeData.phases[0].duration * 1000,
      );
      should.equal(
        testHelper.getDatesDiff(result.phases[1].scheduledEndDate, challengeData.startDate),
        challengeData.phases[0].duration * 1000 + challengeData.phases[1].duration * 1000,
      );
      should.equal(result.prizeSets.length, 1);
      should.equal(result.prizeSets[0].type, testChallengeData.prizeSets[0].type);
      should.equal(result.prizeSets[0].description, testChallengeData.prizeSets[0].description);
      should.equal(result.prizeSets[0].prizes.length, 1);
      should.equal(
        result.prizeSets[0].prizes[0].description,
        testChallengeData.prizeSets[0].prizes[0].description,
      );
      should.equal(
        result.prizeSets[0].prizes[0].type,
        testChallengeData.prizeSets[0].prizes[0].type,
      );
      should.equal(
        result.prizeSets[0].prizes[0].value,
        testChallengeData.prizeSets[0].prizes[0].value,
      );
      should.equal(result.reviewType, testChallengeData.reviewType);
      should.equal(result.tags.length, 2);
      should.equal(result.tags[0], testChallengeData.tags[0]);
      should.equal(_.isNil(result.projectId), _.isNil(testChallengeData.projectId));
      should.equal(result.legacyId, testChallengeData.legacyId);
      should.equal(result.forumId, testChallengeData.forumId);
      should.equal(result.status, testChallengeData.status);
      should.equal(result.approvalStatus, "APPROVED");
      should.equal(result.funChallenge, testChallengeData.funChallenge);
      should.equal(result.createdBy, "testuser");
      should.exist(result.startDate);
      should.exist(result.created);
      should.equal(result.numOfSubmissions, 0);
      should.equal(result.numOfRegistrants, 0);
    });

    it("persists false is_test_challenge metadata when create omits the flag", async () => {
      const challengeData = _.cloneDeep(testChallengeData);
      challengeData.discussions[0].type = "CHALLENGE";
      challengeData.prizeSets[0].type = PrizeSetTypeEnum.PLACEMENT;
      challengeData.status = ChallengeStatusEnum.NEW;
      const originalGetProject = projectHelper.getProject;
      const originalGetProjectBillingInformation = projectHelper.getProjectBillingInformation;
      const originalPostBusEvent = helper.postBusEvent;
      let createdChallengeId;

      projectHelper.getProject = async () => ({ directProjectId: 33541 });
      projectHelper.getProjectBillingInformation = async () => ({
        billingAccountId: null,
        markup: 0,
      });
      helper.postBusEvent = async () => {};

      try {
        const result = await service.createChallenge(
          { isMachine: true, sub: "sub", userId: "testuser" },
          challengeData,
          config.M2M_FULL_ACCESS_TOKEN || "test-token",
        );
        createdChallengeId = result.id;

        _.find(result.metadata, {
          name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
        }).value.should.equal("false");

        const persistedMetadata = await prisma.challengeMetadata.findFirst({
          where: {
            challengeId: result.id,
            name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
          },
        });
        persistedMetadata.value.should.equal("false");
      } finally {
        projectHelper.getProject = originalGetProject;
        projectHelper.getProjectBillingInformation = originalGetProjectBillingInformation;
        helper.postBusEvent = originalPostBusEvent;
        if (createdChallengeId) {
          await prisma.challenge.deleteMany({ where: { id: createdChallengeId } });
        }
      }
    });

    it("locks draft challenge budget when the challenge is saved", async () => {
      const challengeData = _.cloneDeep(testChallengeData);
      challengeData.status = ChallengeStatusEnum.DRAFT;
      challengeData.prizeSets = [
        {
          type: PrizeSetTypeEnum.PLACEMENT,
          description: "placement prizes",
          prizes: [
            {
              description: "placement 1",
              type: constants.prizeTypes.USD,
              value: 35,
            },
            {
              description: "placement 2",
              type: constants.prizeTypes.USD,
              value: 12,
            },
          ],
        },
        {
          type: PrizeSetTypeEnum.COPILOT,
          description: "copilot payment",
          prizes: [
            {
              description: "copilot",
              type: constants.prizeTypes.USD,
              value: 10,
            },
          ],
        },
      ];
      challengeData.reviewers = [
        {
          scorecardId: "scorecard-id",
          isMemberReview: true,
          memberReviewerCount: 1,
          phaseId: data.phase.id,
          fixedAmount: 16.1,
          baseCoefficient: 0,
          incrementalCoefficient: 0,
        },
      ];
      const originalGetProjectBillingInformation = projectHelper.getProjectBillingInformation;

      projectHelper.getProjectBillingInformation = async () => ({
        billingAccountId: "80001012",
        markup: 0.1,
      });

      let result;
      try {
        result = await service.createChallenge(
          { isMachine: true, sub: "sub", userId: "testuser" },
          challengeData,
          config.M2M_FULL_ACCESS_TOKEN,
        );

        should.equal(billingLockRequests.length, 1);
        billingLockRequests[0].should.deep.equal({
          billingAccountId: "80001012",
          challengeId: result.id,
          markup: 0.1,
          memberPaymentAmount: 73.1,
        });
      } finally {
        projectHelper.getProjectBillingInformation = originalGetProjectBillingInformation;
        if (result && result.id) {
          await prisma.challenge.deleteMany({ where: { id: result.id } });
        }
      }
    });

    it("create challenge successfully when project directProjectId is a numeric string", async () => {
      const challengeData = _.cloneDeep(testChallengeData);
      const originalGetProject = projectHelper.getProject;
      projectHelper.getProject = async () => ({ directProjectId: "33541" });
      try {
        const result = await service.createChallenge(
          { isMachine: true, sub: "sub", userId: "testuser" },
          challengeData,
          config.M2M_FULL_ACCESS_TOKEN || "test-token",
        );
        id2 = result.id;
        should.equal(_.get(result, "legacy.directProjectId"), 33541);
      } finally {
        projectHelper.getProject = originalGetProject;
      }
    });

    it("create challenge applies default ai configs when reviewers are not provided", async () => {
      const challengeData = _.cloneDeep(testChallengeData);
      challengeData.discussions[0].type = "CHALLENGE";
      challengeData.prizeSets[0].type = "PLACEMENT";
      challengeData.status = "NEW";
      const originalGetProject = projectHelper.getProject;
      const originalApplyDefaultMemberReviewers =
        challengeHelper.applyDefaultMemberReviewersForChallengeCreation;
      const originalApplyDefaultAIConfig = challengeHelper.applyDefaultAIConfigForChallengeCreation;
      const originalCreateAIReviewConfigs =
        challengeHelper.createAIReviewConfigsForChallengeCreation;
      const aiReviewConfigs = [
        {
          templateId: "template-1",
          minPassingThreshold: 80,
          mode: "aggregated",
          autoFinalize: false,
          formula: {},
          workflows: [{ workflowId: "wf-1", weightPercent: 100, isGating: true }],
        },
      ];

      let applyDefaultAICallCount = 0;
      let createAIConfigCallCount = 0;
      let createdChallengeId;
      let createdConfigs;
      let tempChallengeId;

      projectHelper.getProject = async () => ({ directProjectId: "33541" });
      challengeHelper.applyDefaultMemberReviewersForChallengeCreation = async () => {};
      challengeHelper.applyDefaultAIConfigForChallengeCreation = async () => {
        applyDefaultAICallCount += 1;
        return aiReviewConfigs;
      };
      challengeHelper.createAIReviewConfigsForChallengeCreation = async (
        challengeIdArg,
        aiConfigsArg,
      ) => {
        createAIConfigCallCount += 1;
        createdChallengeId = challengeIdArg;
        createdConfigs = aiConfigsArg;
      };

      try {
        const result = await service.createChallenge(
          { isMachine: true, sub: "sub", userId: "testuser" },
          challengeData,
          config.M2M_FULL_ACCESS_TOKEN || "test-token",
        );
        tempChallengeId = result.id;

        should.equal(applyDefaultAICallCount, 1);
        should.equal(createAIConfigCallCount, 1);
        should.equal(createdChallengeId, result.id);
        createdConfigs.should.deep.equal(aiReviewConfigs);
      } finally {
        projectHelper.getProject = originalGetProject;
        challengeHelper.applyDefaultMemberReviewersForChallengeCreation =
          originalApplyDefaultMemberReviewers;
        challengeHelper.applyDefaultAIConfigForChallengeCreation = originalApplyDefaultAIConfig;
        challengeHelper.createAIReviewConfigsForChallengeCreation = originalCreateAIReviewConfigs;

        if (tempChallengeId) {
          await prisma.challenge.delete({ where: { id: tempChallengeId } });
        }
      }
    }).timeout(10000);

    it("create challenge skips default ai configs when reviewers are provided", async () => {
      const challengeData = _.cloneDeep(testChallengeData);
      challengeData.discussions[0].type = "CHALLENGE";
      challengeData.prizeSets[0].type = "PLACEMENT";
      challengeData.status = "NEW";
      const originalGetProject = projectHelper.getProject;
      challengeData.reviewers = [
        {
          scorecardId: "provided-scorecard",
          isMemberReview: false,
          phaseId: data.phase.id,
          aiWorkflowId: "wf-provided",
        },
      ];

      const originalApplyDefaultAIConfig = challengeHelper.applyDefaultAIConfigForChallengeCreation;
      const originalCreateAIReviewConfigs =
        challengeHelper.createAIReviewConfigsForChallengeCreation;
      let applyDefaultAICalled = false;
      let createAIConfigCalled = false;
      let tempChallengeId;

      projectHelper.getProject = async () => ({ directProjectId: "33541" });
      challengeHelper.applyDefaultAIConfigForChallengeCreation = async () => {
        applyDefaultAICalled = true;
        return [];
      };
      challengeHelper.createAIReviewConfigsForChallengeCreation = async () => {
        createAIConfigCalled = true;
      };

      try {
        const result = await service.createChallenge(
          { isMachine: true, sub: "sub", userId: "testuser" },
          challengeData,
          config.M2M_FULL_ACCESS_TOKEN || "test-token",
        );
        tempChallengeId = result.id;

        should.equal(applyDefaultAICalled, false);
        should.equal(createAIConfigCalled, false);
      } finally {
        projectHelper.getProject = originalGetProject;
        challengeHelper.applyDefaultAIConfigForChallengeCreation = originalApplyDefaultAIConfig;
        challengeHelper.createAIReviewConfigsForChallengeCreation = originalCreateAIReviewConfigs;

        if (tempChallengeId) {
          await prisma.challenge.delete({ where: { id: tempChallengeId } });
        }
      }
    }).timeout(10000);

    it("create challenge - type not found", async () => {
      const challengeData = _.clone(testChallengeData);
      challengeData.typeId = notFoundId;
      try {
        await service.createChallenge(
          { isMachine: true, sub: "sub", userId: "testuser" },
          challengeData,
          config.M2M_FULL_ACCESS_TOKEN,
        );
      } catch (e) {
        should.equal(e.message, `ChallengeType with id: ${notFoundId} doesn't exist`);
        return;
      }
      throw new Error("should not reach here");
    });

    it("create challenge - invalid projectId", async () => {
      const challengeData = _.clone(testChallengeData);
      challengeData.projectId = -1;
      try {
        await service.createChallenge(
          { isMachine: true, sub: "sub", userId: "testuser" },
          challengeData,
          config.M2M_FULL_ACCESS_TOKEN,
        );
      } catch (e) {
        should.equal(e.message.indexOf('"projectId" must be a positive number') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("create challenge - missing name", async () => {
      const challengeData = _.clone(testChallengeData);
      delete challengeData.name;
      try {
        await service.createChallenge(
          { isMachine: true, sub: "sub", userId: "testuser" },
          challengeData,
          config.M2M_FULL_ACCESS_TOKEN,
        );
      } catch (e) {
        should.equal(e.message.indexOf('"name" is required') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("create challenge - invalid date", async () => {
      const challengeData = _.clone(testChallengeData);
      challengeData.startDate = "abc";
      try {
        await service.createChallenge(
          { isMachine: true, sub: "sub", userId: "testuser" },
          challengeData,
          config.M2M_FULL_ACCESS_TOKEN,
        );
      } catch (e) {
        should.equal(e.message.indexOf('"startDate" must be a valid ISO 8601 date') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("create challenge - invalid status", async () => {
      const challengeData = _.clone(testChallengeData);
      challengeData.status = ["ACTIVE"];
      try {
        await service.createChallenge(
          { isMachine: true, sub: "sub", userId: "testuser" },
          challengeData,
          config.M2M_FULL_ACCESS_TOKEN,
        );
      } catch (e) {
        should.equal(e.message.indexOf('"status" must be a string') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("create challenge - unexpected field", async () => {
      const challengeData = _.clone(testChallengeData);
      challengeData.other = 123;
      try {
        await service.createChallenge(
          { isMachine: true, sub: "sub", userId: "testuser" },
          challengeData,
          config.M2M_FULL_ACCESS_TOKEN,
        );
      } catch (e) {
        should.equal(e.message.indexOf('"other" is not allowed') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });
  });

  describe("get challenge tests", () => {
    it("get challenge successfully", async () => {
      const result = await service.getChallenge({ isMachine: true }, createdChallengeData.id);
      should.equal(result.id, createdChallengeData.id);
      should.equal(result.typeId, testChallengeData.typeId);
      should.equal(result.trackId, testChallengeData.trackId);
      should.equal(result.name, testChallengeData.name);
      should.equal(result.description, testChallengeData.description);
      should.equal(result.timelineTemplateId, testChallengeData.timelineTemplateId);
      should.equal(result.phases.length, 2);
      should.equal(result.phases[0].phaseId, data.phase.id);
      should.equal(result.phases[0].name, data.phase.name);
      should.equal(result.phases[0].description, data.phase.description);
      should.equal(result.phases[0].isOpen, false);
      should.equal(result.phases[0].duration, testChallengeData.phases[0].duration);
      should.equal(result.phases[1].phaseId, data.phase2.id);
      should.equal(result.phases[1].name, data.phase2.name);
      should.equal(result.phases[1].predecessor, data.phase.id);
      should.equal(result.phases[1].description, data.phase2.description);
      should.equal(result.phases[1].isOpen, false);
      should.equal(result.phases[1].duration, testChallengeData.phases[1].duration);
      should.equal(result.prizeSets.length, 1);
      should.equal(result.prizeSets[0].type, testChallengeData.prizeSets[0].type);
      should.equal(result.prizeSets[0].description, testChallengeData.prizeSets[0].description);
      should.equal(result.prizeSets[0].prizes.length, 1);
      should.equal(
        result.prizeSets[0].prizes[0].description,
        testChallengeData.prizeSets[0].prizes[0].description,
      );
      should.equal(
        result.prizeSets[0].prizes[0].type,
        testChallengeData.prizeSets[0].prizes[0].type,
      );
      should.equal(
        result.prizeSets[0].prizes[0].value,
        testChallengeData.prizeSets[0].prizes[0].value,
      );
      should.equal(result.reviewType, testChallengeData.reviewType);
      should.equal(result.tags.length, 2);
      should.equal(result.tags[0], testChallengeData.tags[0]);
      should.equal(result.tags[1], testChallengeData.tags[1]);
      should.equal(result.projectId, testChallengeData.projectId);
      should.equal(result.legacyId, testChallengeData.legacyId);
      should.equal(result.forumId, testChallengeData.forumId);
      should.equal(result.status, testChallengeData.status);
      should.equal(result.createdBy, "testuser");
      should.exist(result.startDate);
      should.exist(result.created);
      should.equal(result.numOfSubmissions, 0);
      should.equal(result.numOfRegistrants, 0);
    });

    it("returns checkpoint winners after checkpoint review closes while keeping placement winners hidden", async () => {
      const challengeId = data.challenge.id;
      const checkpointPhase = await prisma.challengePhase.findFirstOrThrow({
        where: { challengeId },
      });
      const originalPhase = _.pick(checkpointPhase, [
        "name",
        "isOpen",
        "actualStartDate",
        "actualEndDate",
      ]);
      const phaseStartDate = new Date(Date.now() - 60_000);
      await prisma.challenge.update({
        where: { id: challengeId },
        data: { status: ChallengeStatusEnum.ACTIVE },
      });
      await prisma.challengePhase.update({
        where: { id: checkpointPhase.id },
        data: {
          name: "Checkpoint Review",
          isOpen: true,
          actualStartDate: phaseStartDate,
          actualEndDate: null,
        },
      });
      await prisma.challengeWinner.createMany({
        data: [
          {
            challengeId,
            userId: 123,
            handle: "checkpoint-winner",
            placement: 1,
            type: PrizeSetTypeEnum.CHECKPOINT,
            createdBy: "test",
            updatedBy: "test",
          },
          {
            challengeId,
            userId: 456,
            handle: "placement-winner",
            placement: 1,
            type: PrizeSetTypeEnum.PLACEMENT,
            createdBy: "test",
            updatedBy: "test",
          },
        ],
      });

      try {
        const openPhaseDetail = await service.getChallenge({ isMachine: true }, challengeId);
        should.equal(_.isUndefined(openPhaseDetail.checkpointWinners), true);
        openPhaseDetail.winners.should.deep.equal([]);

        const openPhaseListing = await service.searchChallenges(
          { isMachine: true },
          {
            id: challengeId,
            page: 1,
            perPage: 10,
          },
        );
        should.equal(openPhaseListing.result.length, 1);
        should.equal(_.isUndefined(openPhaseListing.result[0].checkpointWinners), true);
        should.equal(_.isUndefined(openPhaseListing.result[0].winners), true);

        await prisma.challengePhase.update({
          where: { id: checkpointPhase.id },
          data: {
            isOpen: false,
            actualEndDate: new Date(),
          },
        });

        const closedPhaseDetail = await service.getChallenge({ isMachine: true }, challengeId);
        closedPhaseDetail.checkpointWinners.should.deep.equal([
          {
            userId: 123,
            handle: "checkpoint-winner",
            placement: 1,
          },
        ]);
        closedPhaseDetail.winners.should.deep.equal([]);

        const closedPhaseListing = await service.searchChallenges(
          { isMachine: true },
          {
            id: challengeId,
            page: 1,
            perPage: 10,
          },
        );
        should.equal(closedPhaseListing.result.length, 1);
        closedPhaseListing.result[0].checkpointWinners.should.deep.equal(
          closedPhaseDetail.checkpointWinners,
        );
        should.equal(_.isUndefined(closedPhaseListing.result[0].winners), true);
      } finally {
        await prisma.challengeWinner.deleteMany({ where: { challengeId } });
        await prisma.challengePhase.update({
          where: { id: checkpointPhase.id },
          data: originalPhase,
        });
        await prisma.challenge.update({
          where: { id: challengeId },
          data: { status: ChallengeStatusEnum.COMPLETED },
        });
      }
    });

    it("returns latest-member submission counters for challenge detail and listing", async () => {
      const challengeId = data.challenge.id;
      await prisma.challenge.update({
        where: { id: challengeId },
        data: {
          numOfSubmissions: 5,
          numOfCheckpointSubmissions: 2,
        },
      });

      await reviewClient.$executeRawUnsafe(`
        INSERT INTO ${submissionTableName}
          ("id", "challengeId", "memberId", "type", "status", "submittedDate")
        VALUES
          ('pm4831a1', '${challengeId}', 'member-1', 'CONTEST_SUBMISSION', 'ACTIVE', '2026-01-01T00:00:00Z'),
          ('pm4831a2', '${challengeId}', 'member-1', 'CONTEST_SUBMISSION', 'ACTIVE', '2026-01-02T00:00:00Z'),
          ('pm4831b1', '${challengeId}', 'member-2', 'CONTEST_SUBMISSION', 'ACTIVE', '2026-01-03T00:00:00Z'),
          ('pm4831c1', '${challengeId}', 'member-3', 'CONTEST_SUBMISSION', 'ACTIVE', '2026-01-04T00:00:00Z'),
          ('pm4831d1', '${challengeId}', 'member-4', 'CHECKPOINT_SUBMISSION', 'ACTIVE', '2026-01-05T00:00:00Z'),
          ('pm4831d2', '${challengeId}', 'member-4', 'CHECKPOINT_SUBMISSION', 'ACTIVE', '2026-01-06T00:00:00Z')
      `);

      try {
        const detail = await service.getChallenge({ isMachine: true }, challengeId);
        should.equal(detail.numOfSubmissions, 3);
        should.equal(detail.numOfCheckpointSubmissions, 1);

        const listing = await service.searchChallenges(
          { isMachine: true },
          {
            id: challengeId,
            page: 1,
            perPage: 10,
          },
        );
        should.equal(listing.result.length, 1);
        should.equal(listing.result[0].numOfSubmissions, 3);
        should.equal(listing.result[0].numOfCheckpointSubmissions, 1);
      } finally {
        await reviewClient.$executeRawUnsafe(
          `DELETE FROM ${submissionTableName} WHERE "challengeId" = '${challengeId}'`,
        );
        await prisma.challenge.update({
          where: { id: challengeId },
          data: {
            numOfSubmissions: 0,
            numOfCheckpointSubmissions: 0,
          },
        });
      }
    });

    it("counts every Design submission as a separate concept", async () => {
      const challengeId = data.challenge.id;
      const originalTrack = data.challengeTrack.track;
      await prisma.challengeTrack.update({
        where: { id: data.challenge.trackId },
        data: { track: "DESIGN" },
      });

      try {
        await reviewClient.$executeRawUnsafe(`
          INSERT INTO ${submissionTableName}
            ("id", "challengeId", "memberId", "type", "status", "submittedDate")
          VALUES
            ('pm5761a1', '${challengeId}', 'member-1', 'CONTEST_SUBMISSION', 'ACTIVE', '2026-01-01T00:00:00Z'),
            ('pm5761a2', '${challengeId}', 'member-1', 'CONTEST_SUBMISSION', 'ACTIVE', '2026-01-02T00:00:00Z'),
            ('pm5761a3', '${challengeId}', 'member-1', 'CONTEST_SUBMISSION', 'ACTIVE', '2026-01-03T00:00:00Z'),
            ('pm5761c1', '${challengeId}', 'member-1', 'CHECKPOINT_SUBMISSION', 'ACTIVE', '2026-01-04T00:00:00Z'),
            ('pm5761c2', '${challengeId}', 'member-1', 'CHECKPOINT_SUBMISSION', 'ACTIVE', '2026-01-05T00:00:00Z')
        `);

        const detail = await service.getChallenge({ isMachine: true }, challengeId);
        should.equal(detail.numOfSubmissions, 3);
        should.equal(detail.numOfCheckpointSubmissions, 2);

        const listing = await service.searchChallenges(
          { isMachine: true },
          {
            id: challengeId,
            page: 1,
            perPage: 10,
          },
        );
        should.equal(listing.result.length, 1);
        should.equal(listing.result[0].numOfSubmissions, 3);
        should.equal(listing.result[0].numOfCheckpointSubmissions, 2);
      } finally {
        try {
          await reviewClient.$executeRawUnsafe(
            `DELETE FROM ${submissionTableName} WHERE "challengeId" = '${challengeId}'`,
          );
        } finally {
          await prisma.challengeTrack.update({
            where: { id: data.challenge.trackId },
            data: { track: originalTrack },
          });
        }
      }
    });

    it("get challenge preserves billing for project write users", async () => {
      const originalUserHasProjectWriteAccess = helper.userHasProjectWriteAccess;

      helper.userHasProjectWriteAccess = async () => true;

      try {
        const result = await service.getChallenge(
          { handle: "writer", userId: "testuser" },
          createdChallengeData.id,
        );

        should.deepEqual(result.billing, createdChallengeData.billing);
      } finally {
        helper.userHasProjectWriteAccess = originalUserHasProjectWriteAccess;
      }
    });

    it("get challenge hides billing markup for copilot-only project write users", async () => {
      const originalUserHasProjectWriteAccess = helper.userHasProjectWriteAccess;

      helper.userHasProjectWriteAccess = async () => true;

      try {
        const result = await service.getChallenge(
          { handle: "writer", roles: ["copilot"], userId: "testuser" },
          createdChallengeData.id,
        );

        should.equal(
          result.billing.billingAccountId,
          createdChallengeData.billing.billingAccountId,
        );
        should.equal(_.isUndefined(result.billing.markup), true);
      } finally {
        helper.userHasProjectWriteAccess = originalUserHasProjectWriteAccess;
      }
    });

    it("get challenge hides billing for users without project write access", async () => {
      const originalUserHasProjectWriteAccess = helper.userHasProjectWriteAccess;
      const originalListResourcesByMemberAndChallenge = helper.listResourcesByMemberAndChallenge;

      helper.userHasProjectWriteAccess = async () => false;
      helper.listResourcesByMemberAndChallenge = async () => [];

      try {
        const result = await service.getChallenge(
          { handle: "viewer", userId: "testuser" },
          createdChallengeData.id,
        );

        should.equal(_.isUndefined(result.billing), true);
      } finally {
        helper.userHasProjectWriteAccess = originalUserHasProjectWriteAccess;
        helper.listResourcesByMemberAndChallenge = originalListResourcesByMemberAndChallenge;
      }
    });

    it("get challenge enforces challenge user whitelist for interactive users", async () => {
      await prisma.challengeUserWhitelist.create({
        data: {
          challengeId: createdChallengeData.id,
          userId: "allowed-user",
        },
      });

      try {
        const allowed = await service.getChallenge(
          { handle: "allowed", roles: ["administrator"], userId: "allowed-user" },
          createdChallengeData.id,
        );
        should.equal(allowed.id, createdChallengeData.id);

        const machine = await service.getChallenge(
          { isMachine: true, userId: "machine-user" },
          createdChallengeData.id,
        );
        should.equal(machine.id, createdChallengeData.id);

        const whitelistBypassOnly = await service.getChallenge(
          { bypassChallengeWhitelist: true },
          createdChallengeData.id,
          true,
        );
        should.equal(whitelistBypassOnly.id, createdChallengeData.id);

        try {
          await service.getChallenge(
            { handle: "blocked", roles: ["administrator"], userId: "blocked-user" },
            createdChallengeData.id,
          );
        } catch (e) {
          should.equal(e.name, "ForbiddenError");
          return;
        }
        throw new Error("should not reach here");
      } finally {
        await prisma.challengeUserWhitelist.deleteMany({
          where: { challengeId: createdChallengeData.id },
        });
      }
    });

    it("get challenge statistics enforces challenge user whitelist before loading submissions", async () => {
      const originalGetChallengeSubmissions = helper.getChallengeSubmissions;
      let loadedSubmissions = false;

      helper.getChallengeSubmissions = async () => {
        loadedSubmissions = true;
        return [];
      };

      await prisma.challengeUserWhitelist.create({
        data: {
          challengeId: data.challenge.id,
          userId: "allowed-user",
        },
      });

      try {
        try {
          await service.getChallengeStatistics(
            { handle: "blocked", roles: ["administrator"], userId: "blocked-user" },
            data.challenge.id,
          );
        } catch (e) {
          should.equal(e.name, "ForbiddenError");
          should.equal(loadedSubmissions, false);

          const allowed = await service.getChallengeStatistics(
            { handle: "allowed", roles: ["administrator"], userId: "allowed-user" },
            data.challenge.id,
          );
          should.deepEqual(allowed, []);

          const machine = await service.getChallengeStatistics(
            { isMachine: true, userId: "machine-user" },
            data.challenge.id,
          );
          should.deepEqual(machine, []);
          return;
        }
        throw new Error("should not reach here");
      } finally {
        helper.getChallengeSubmissions = originalGetChallengeSubmissions;
        await prisma.challengeUserWhitelist.deleteMany({
          where: { challengeId: data.challenge.id },
        });
      }
    });

    it("get challenge statistics returns not found before loading submissions", async () => {
      const originalGetChallengeSubmissions = helper.getChallengeSubmissions;
      let loadedSubmissions = false;

      helper.getChallengeSubmissions = async () => {
        loadedSubmissions = true;
        return [];
      };

      try {
        await service.getChallengeStatistics({ isMachine: true }, notFoundId);
      } catch (e) {
        should.equal(e.name, "NotFoundError");
        should.equal(e.message, `Challenge of id ${notFoundId} is not found.`);
        should.equal(loadedSubmissions, false);
        return;
      } finally {
        helper.getChallengeSubmissions = originalGetChallengeSubmissions;
      }
      throw new Error("should not reach here");
    });

    it("get challenge statistics enforces challenge group view rules before loading submissions", async () => {
      const originalGetChallengeSubmissions = helper.getChallengeSubmissions;
      const originalAxiosGet = axios.get;
      const originalGetM2MToken = m2mHelper.getM2MToken;
      let loadedSubmissions = false;

      helper.getChallengeSubmissions = async () => {
        loadedSubmissions = true;
        return [];
      };
      m2mHelper.getM2MToken = async () => "test-token";
      axios.get = async (url, options) => {
        if (_.toString(url).includes("/memberGroups/")) {
          return { data: [], status: 200, headers: {} };
        }
        return originalAxiosGet(url, options);
      };

      await prisma.challenge.update({
        where: { id: data.challenge.id },
        data: { groups: [uuid()] },
      });

      try {
        await service.getChallengeStatistics(
          { handle: "blocked", roles: ["Topcoder User"], userId: "blocked-user" },
          data.challenge.id,
        );
      } catch (e) {
        should.equal(e.name, "ForbiddenError");
        should.equal(loadedSubmissions, false);
        return;
      } finally {
        helper.getChallengeSubmissions = originalGetChallengeSubmissions;
        axios.get = originalAxiosGet;
        m2mHelper.getM2MToken = originalGetM2MToken;
        await prisma.challenge.update({
          where: { id: data.challenge.id },
          data: { groups: [] },
        });
      }
      throw new Error("should not reach here");
    });

    it("get challenge - not found", async () => {
      try {
        await service.getChallenge({ isMachine: true }, notFoundId);
      } catch (e) {
        should.equal(e.message, `Challenge of id ${notFoundId} is not found.`);
        return;
      }
      throw new Error("should not reach here");
    });

    it("get challenge - invalid id", async () => {
      try {
        await service.getChallenge({ isMachine: true }, "invalid");
      } catch (e) {
        should.equal(e.message.indexOf('"id" must be a valid GUID') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });
  });

  describe("search challenges tests", () => {
    it("search challenges successfully by legacyId", async () => {
      const res = await service.searchChallenges(
        { isMachine: true },
        {
          page: 1,
          perPage: 10,
          legacyId: testChallengeData.legacyId,
        },
      );
      should.equal(res.total, 1);
      should.equal(res.page, 1);
      should.equal(res.perPage, 10);
      should.equal(res.result.length, 1);
      const result = res.result[0];
      should.equal(result.id, id);
      should.equal(result.type, data.challengeType.name);
      should.equal(result.track, data.challengeTrack.name);
      should.equal(result.name, testChallengeData.name);
      should.equal(result.description, testChallengeData.description);
      should.equal(result.timelineTemplateId, testChallengeData.timelineTemplateId);
      should.equal(result.phases.length, 2);
      should.equal(result.phases[0].phaseId, data.phase.id);
      should.equal(result.phases[0].name, data.phase.name);
      should.equal(result.phases[0].description, data.phase.description);
      should.equal(result.phases[0].isOpen, false);
      should.equal(result.phases[0].duration, testChallengeData.phases[0].duration);
      should.equal(result.phases[1].phaseId, data.phase2.id);
      should.equal(result.phases[1].name, data.phase2.name);
      should.equal(result.phases[1].predecessor, data.phase.id);
      should.equal(result.phases[1].description, data.phase2.description);
      should.equal(result.phases[1].isOpen, false);
      should.equal(result.phases[1].duration, testChallengeData.phases[1].duration);
      should.equal(result.prizeSets.length, 1);
      should.equal(result.prizeSets[0].type, testChallengeData.prizeSets[0].type);
      should.equal(result.prizeSets[0].description, testChallengeData.prizeSets[0].description);
      should.equal(result.prizeSets[0].prizes.length, 1);
      should.equal(
        result.prizeSets[0].prizes[0].description,
        testChallengeData.prizeSets[0].prizes[0].description,
      );
      should.equal(
        result.prizeSets[0].prizes[0].type,
        testChallengeData.prizeSets[0].prizes[0].type,
      );
      should.equal(
        result.prizeSets[0].prizes[0].value,
        testChallengeData.prizeSets[0].prizes[0].value,
      );
      should.equal(result.reviewType, testChallengeData.reviewType);
      should.equal(result.tags.length, 2);
      should.equal(result.tags[0], testChallengeData.tags[0]);
      should.equal(result.tags[1], testChallengeData.tags[1]);
      should.equal(result.projectId, testChallengeData.projectId);
      should.equal(result.legacyId, testChallengeData.legacyId);
      should.equal(result.forumId, testChallengeData.forumId);
      should.equal(result.status, testChallengeData.status);
      should.equal(result.createdBy, "testuser");
      should.exist(result.startDate);
      should.exist(result.created);
      should.equal(result.numOfSubmissions, 0);
      should.equal(result.numOfRegistrants, 0);
    });

    it("search challenges hides unassigned tasks from anonymous users", async () => {
      await prisma.challenge.update({
        where: { id: data.taskChallenge.id },
        data: {
          taskIsAssigned: false,
          taskMemberId: null,
        },
      });

      try {
        const result = await service.searchChallenges(undefined, {
          id: data.taskChallenge.id,
        });

        should.equal(result.total, 0);
        should.equal(result.result.length, 0);
      } finally {
        await prisma.challenge.update({
          where: { id: data.taskChallenge.id },
          data: { taskIsAssigned: true },
        });
      }
    });

    it("search challenges uses the caller resource association for task visibility", async () => {
      const originalGetCompleteUserGroupTreeIds = helper.getCompleteUserGroupTreeIds;
      const originalMemberChallengeAccessFindMany = prisma.memberChallengeAccess.findMany;
      const originalChallengeFindMany = prisma.challenge.findMany;
      let capturedWhere;
      let capturedMemberAccessQuery;

      helper.getCompleteUserGroupTreeIds = async () => [];
      prisma.memberChallengeAccess.findMany = async (query) => {
        capturedMemberAccessQuery = query;
        return [{ challengeId: data.taskChallenge.id }];
      };
      prisma.challenge.findMany = async (query) => {
        capturedWhere = query.where;
        return [];
      };

      try {
        const result = await service.searchChallenges(
          { roles: ["Topcoder User"], userId: "caller-resource-id" },
          { memberId: "different-member-id" },
        );

        should.equal(result.total, 0);
        capturedMemberAccessQuery.should.deep.equal({
          where: { memberId: "different-member-id" },
          select: { challengeId: true },
          distinct: ["challengeId"],
        });
        const taskVisibilityFilter = capturedWhere.AND.find(
          (filter) => filter.OR && filter.OR.some((condition) => condition.taskIsTask === false),
        );
        taskVisibilityFilter.should.deep.equal({
          OR: [
            { taskIsTask: false },
            {
              taskIsTask: true,
              memberAccesses: {
                some: { memberId: "caller-resource-id" },
              },
            },
          ],
        });
      } finally {
        helper.getCompleteUserGroupTreeIds = originalGetCompleteUserGroupTreeIds;
        prisma.memberChallengeAccess.findMany = originalMemberChallengeAccessFindMany;
        prisma.challenge.findMany = originalChallengeFindMany;
      }
    });

    it("role-specific member search does not grant anonymous task visibility", async () => {
      const originalMemberChallengeAccessFindMany = prisma.memberChallengeAccess.findMany;
      let capturedMemberAccessQuery;

      prisma.memberChallengeAccess.findMany = async (query) => {
        capturedMemberAccessQuery = query;
        return [{ challengeId: data.taskChallenge.id }];
      };

      try {
        const result = await service.searchChallenges(undefined, {
          memberId: "anonymous-filter-member",
          resourceRoleId: config.SUBMITTER_ROLE_ID,
        });

        should.equal(result.total, 0);
        should.equal(result.result.length, 0);
        capturedMemberAccessQuery.should.deep.equal({
          where: {
            memberId: "anonymous-filter-member",
            roleId: config.SUBMITTER_ROLE_ID,
          },
          select: { challengeId: true },
          distinct: ["challengeId"],
        });
      } finally {
        prisma.memberChallengeAccess.findMany = originalMemberChallengeAccessFindMany;
      }
    });

    it("validates the role-specific member search contract", async () => {
      try {
        await service.searchChallenges(
          { isMachine: true },
          { memberId: "role-filter-member", resourceRoleId: "invalid" },
        );
        should.fail("Expected an invalid resource role UUID to be rejected");
      } catch (error) {
        error.message.should.equal('"criteria.resourceRoleId" must be a valid GUID');
      }

      try {
        await service.searchChallenges(
          { isMachine: true },
          { resourceRoleId: config.SUBMITTER_ROLE_ID },
        );
        should.fail("Expected a resource role without memberId to be rejected");
      } catch (error) {
        error.message.should.include("memberId");
      }
    });

    it("combines resource role and legacy challenge filters", async () => {
      const originalMemberChallengeAccessFindMany = prisma.memberChallengeAccess.findMany;
      let capturedMemberAccessQuery;
      prisma.memberChallengeAccess.findMany = async (query) => {
        capturedMemberAccessQuery = query;
        return [{ challengeId: data.challenge.id }];
      };

      try {
        const result = await service.searchChallenges(
          { isMachine: true },
          {
            memberId: "legacy-role-filter-member",
            resourceRoleId: config.SUBMITTER_ROLE_ID,
            legacyId: data.challenge.legacyId,
          },
        );

        should.equal(result.total, 1);
        should.equal(result.result[0].id, data.challenge.id);
        capturedMemberAccessQuery.where.should.deep.equal({
          memberId: "legacy-role-filter-member",
          roleId: config.SUBMITTER_ROLE_ID,
        });
      } finally {
        prisma.memberChallengeAccess.findMany = originalMemberChallengeAccessFindMany;
      }
    });

    it("search challenges sorts status alphabetically for member and non-member searches", async () => {
      const statusChallenges = [
        {
          id: uuid(),
          name: `Status Sort Cancelled ${Date.now()}`,
          status: ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST,
        },
        {
          id: uuid(),
          name: `Status Sort New ${Date.now()}`,
          status: ChallengeStatusEnum.NEW,
        },
        {
          id: uuid(),
          name: `Status Sort Active ${Date.now()}`,
          status: ChallengeStatusEnum.ACTIVE,
        },
        {
          id: uuid(),
          name: `Status Sort Completed ${Date.now()}`,
          status: ChallengeStatusEnum.COMPLETED,
        },
      ];
      const statusChallengeIds = statusChallenges.map((challengeRow) => challengeRow.id);
      const originalMemberChallengeAccessFindMany = prisma.memberChallengeAccess.findMany;
      const memberAccessQueries = [];

      try {
        for (const challengeRow of statusChallenges) {
          await prisma.challenge.create({
            data: {
              id: challengeRow.id,
              name: challengeRow.name,
              description: "status-sort",
              privateDescription: "status-sort",
              challengeSource: "Topcoder",
              descriptionFormat: "html",
              timelineTemplate: { connect: { id: data.timelineTemplate.id } },
              type: { connect: { id: data.challenge.typeId } },
              track: { connect: { id: data.challenge.trackId } },
              tags: [],
              groups: [],
              status: challengeRow.status,
              createdBy: "testuser",
              updatedBy: "testuser",
            },
          });
        }

        prisma.memberChallengeAccess.findMany = async (query) => {
          memberAccessQueries.push(query);
          return statusChallenges.map((challengeRow) => ({ challengeId: challengeRow.id }));
        };

        const ascRes = await service.searchChallenges(
          { isMachine: true },
          {
            memberId: "status-sort-member",
            resourceRoleId: config.SUBMITTER_ROLE_ID,
            sortBy: "status",
            sortOrder: "asc",
            page: 1,
            perPage: 10,
          },
        );
        _.map(ascRes.result, "status").should.deep.equal([
          ChallengeStatusEnum.ACTIVE,
          ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST,
          ChallengeStatusEnum.COMPLETED,
          ChallengeStatusEnum.NEW,
        ]);

        const secondPage = await service.searchChallenges(
          { isMachine: true },
          {
            memberId: "status-sort-member",
            resourceRoleId: config.SUBMITTER_ROLE_ID,
            sortBy: "status",
            sortOrder: "asc",
            page: 2,
            perPage: 2,
          },
        );
        should.equal(secondPage.total, 4);
        should.equal(secondPage.page, 2);
        should.equal(secondPage.perPage, 2);
        _.map(secondPage.result, "status").should.deep.equal([
          ChallengeStatusEnum.COMPLETED,
          ChallengeStatusEnum.NEW,
        ]);

        const ascResNoMember = await service.searchChallenges(
          { isMachine: true },
          {
            ids: statusChallengeIds,
            sortBy: "status",
            sortOrder: "asc",
            page: 1,
            perPage: 10,
          },
        );
        _.map(ascResNoMember.result, "status").should.deep.equal([
          ChallengeStatusEnum.ACTIVE,
          ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST,
          ChallengeStatusEnum.COMPLETED,
          ChallengeStatusEnum.NEW,
        ]);

        const descRes = await service.searchChallenges(
          { isMachine: true },
          {
            memberId: "status-sort-member",
            resourceRoleId: config.SUBMITTER_ROLE_ID,
            sortBy: "status",
            sortOrder: "desc",
            page: 1,
            perPage: 10,
          },
        );
        _.map(descRes.result, "status").should.deep.equal([
          ChallengeStatusEnum.NEW,
          ChallengeStatusEnum.COMPLETED,
          ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST,
          ChallengeStatusEnum.ACTIVE,
        ]);

        const descResNoMember = await service.searchChallenges(
          { isMachine: true },
          {
            ids: statusChallengeIds,
            sortBy: "status",
            sortOrder: "desc",
            page: 1,
            perPage: 10,
          },
        );
        _.map(descResNoMember.result, "status").should.deep.equal([
          ChallengeStatusEnum.NEW,
          ChallengeStatusEnum.COMPLETED,
          ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST,
          ChallengeStatusEnum.ACTIVE,
        ]);
        memberAccessQueries.should.have.length(3);
        memberAccessQueries.forEach((query) => {
          query.should.deep.equal({
            where: {
              memberId: "status-sort-member",
              roleId: config.SUBMITTER_ROLE_ID,
            },
            select: { challengeId: true },
            distinct: ["challengeId"],
          });
        });
      } finally {
        prisma.memberChallengeAccess.findMany = originalMemberChallengeAccessFindMany;
        await prisma.challenge.deleteMany({
          where: {
            id: {
              in: statusChallengeIds,
            },
          },
        });
      }
    });

    it("search challenges successfully 1", async () => {
      const res = await service.searchChallenges(
        { isMachine: true },
        {
          page: 1,
          perPage: 10,
          id: id,

          typeId: testChallengeData.typeId,
          name: testChallengeData.name.substring(2).trim(),
          description: testChallengeData.description,
          timelineTemplateId: testChallengeData.timelineTemplateId,
          tag: testChallengeData.tags[0],
          projectId: testChallengeData.projectId,
          status: testChallengeData.status,
          createdDateStart: "1992-01-02",
          createdDateEnd: "2032-01-02",
          createdBy: testChallengeData.createdBy,
        },
      );
      should.equal(res.total, 1);
      should.equal(res.page, 1);
      should.equal(res.perPage, 10);
      should.equal(res.result.length, 1);
      const result = res.result[0];
      should.equal(result.id, id);
      should.equal(result.type, data.challengeType.name);
      should.equal(result.track, data.challengeTrack.name);
      should.equal(result.name, testChallengeData.name);
      should.equal(result.description, testChallengeData.description);
      should.equal(result.timelineTemplateId, testChallengeData.timelineTemplateId);
      should.equal(result.phases.length, 2);
      should.equal(result.phases[0].phaseId, data.phase.id);
      should.equal(result.phases[0].name, data.phase.name);
      should.equal(result.phases[0].description, data.phase.description);
      should.equal(result.phases[0].isOpen, false);
      should.equal(result.phases[0].duration, testChallengeData.phases[0].duration);
      should.equal(result.phases[1].phaseId, data.phase2.id);
      should.equal(result.phases[1].name, data.phase2.name);
      should.equal(result.phases[1].predecessor, data.phase.id);
      should.equal(result.phases[1].description, data.phase2.description);
      should.equal(result.phases[1].isOpen, false);
      should.equal(result.phases[1].duration, testChallengeData.phases[1].duration);
      should.equal(result.prizeSets.length, 1);
      should.equal(result.prizeSets[0].type, testChallengeData.prizeSets[0].type);
      should.equal(result.prizeSets[0].description, testChallengeData.prizeSets[0].description);
      should.equal(result.prizeSets[0].prizes.length, 1);
      should.equal(
        result.prizeSets[0].prizes[0].description,
        testChallengeData.prizeSets[0].prizes[0].description,
      );
      should.equal(
        result.prizeSets[0].prizes[0].type,
        testChallengeData.prizeSets[0].prizes[0].type,
      );
      should.equal(
        result.prizeSets[0].prizes[0].value,
        testChallengeData.prizeSets[0].prizes[0].value,
      );
      should.equal(result.reviewType, testChallengeData.reviewType);
      should.equal(result.tags.length, 2);
      should.equal(result.tags[0], testChallengeData.tags[0]);
      should.equal(result.tags[1], testChallengeData.tags[1]);
      should.equal(result.projectId, testChallengeData.projectId);
      should.equal(result.legacyId, testChallengeData.legacyId);
      should.equal(result.forumId, testChallengeData.forumId);
      should.equal(result.status, testChallengeData.status);
      should.equal(result.createdBy, "testuser");
      should.exist(result.startDate);
      should.exist(result.created);
      should.equal(result.numOfSubmissions, 0);
      should.equal(result.numOfRegistrants, 0);
    });

    it("search challenges hides whitelisted challenges from blocked interactive users", async () => {
      await prisma.challengeUserWhitelist.create({
        data: {
          challengeId: data.challenge.id,
          userId: "allowed-user",
        },
      });

      try {
        const blocked = await service.searchChallenges(
          { handle: "blocked", roles: ["administrator"], userId: "blocked-user" },
          { id: data.challenge.id },
        );
        should.equal(blocked.total, 0);
        should.equal(blocked.result.length, 0);

        const allowed = await service.searchChallenges(
          { handle: "allowed", roles: ["administrator"], userId: "allowed-user" },
          { id: data.challenge.id },
        );
        should.equal(allowed.total, 1);
        should.equal(allowed.result[0].id, data.challenge.id);

        const machine = await service.searchChallenges(
          { isMachine: true, userId: "machine-user" },
          { id: data.challenge.id },
        );
        should.equal(machine.total, 1);
        should.equal(machine.result[0].id, data.challenge.id);

        const whitelistBypassOnly = await service.searchChallenges(
          { bypassChallengeWhitelist: true },
          { id: data.challenge.id },
        );
        should.equal(whitelistBypassOnly.total, 1);
        should.equal(whitelistBypassOnly.result[0].id, data.challenge.id);
      } finally {
        await prisma.challengeUserWhitelist.deleteMany({
          where: { challengeId: data.challenge.id },
        });
      }
    });

    it("search challenges successfully 2", async () => {
      const result = await service.searchChallenges({ isMachine: true }, { name: "aaa bbb ccc" });
      should.equal(result.total, 0);
      should.equal(result.page, 1);
      should.equal(result.perPage, 20);
      should.equal(result.result.length, 0);
    });

    it("search challenges by name case-insensitively", async () => {
      const result = await service.searchChallenges(
        { isMachine: true },
        { name: data.challenge.name.toLowerCase() },
      );

      should.equal(result.total, 1);
      should.equal(result.result.length, 1);
      should.equal(result.result[0].id, data.challenge.id);
      should.equal(result.result[0].name, data.challenge.name);
    });

    it("search challenges by search term case-insensitively for challenge names", async () => {
      const result = await service.searchChallenges(
        { isMachine: true },
        { search: data.challenge.name.toLowerCase() },
      );

      should.equal(result.total, 1);
      should.equal(result.result.length, 1);
      should.equal(result.result[0].id, data.challenge.id);
      should.equal(result.result[0].name, data.challenge.name);
    });

    it("searches names, descriptions, tags and skills before count and pagination", async () => {
      const searchToken = `UnifiedSearch${Date.now()}`;
      const skillId = uuid();
      const searchChallenges = [
        {
          id: uuid(),
          name: `A Name ${searchToken}`,
          description: "unrelated",
          tags: [],
        },
        {
          id: uuid(),
          name: "B Description Only",
          description: `contains ${searchToken.toUpperCase()} here`,
          tags: [],
        },
        {
          id: uuid(),
          name: "C Tag Only",
          description: "unrelated",
          tags: [`prefix-${searchToken.toUpperCase()}-suffix`],
        },
        {
          id: uuid(),
          name: "D Skill Only",
          description: "unrelated",
          tags: [],
          skillId,
        },
        {
          id: uuid(),
          name: "E No Match",
          description: "unrelated",
          tags: [],
        },
      ];
      const searchChallengeIds = searchChallenges.map((challenge) => challenge.id);
      const originalGetStandSkills = helper.getStandSkills;

      helper.searchStandSkills = async (term) => {
        should.equal(term, searchToken.toLowerCase());
        return [{ id: skillId, name: searchToken }];
      };
      helper.getStandSkills = async (ids) =>
        ids.map((id) => ({ id, name: id === skillId ? searchToken : `Skill ${id}` }));

      try {
        for (const challenge of searchChallenges) {
          await prisma.challenge.create({
            data: {
              id: challenge.id,
              name: challenge.name,
              description: challenge.description,
              privateDescription: "unified-search",
              challengeSource: "Topcoder",
              descriptionFormat: "html",
              timelineTemplate: { connect: { id: data.timelineTemplate.id } },
              type: { connect: { id: data.challenge.typeId } },
              track: { connect: { id: data.challenge.trackId } },
              tags: challenge.tags,
              groups: [],
              status: ChallengeStatusEnum.ACTIVE,
              createdBy: "unified-search",
              updatedBy: "unified-search",
              ...(challenge.skillId
                ? {
                    skills: {
                      create: {
                        skillId: challenge.skillId,
                        createdBy: "unified-search",
                        updatedBy: "unified-search",
                      },
                    },
                  }
                : {}),
            },
          });
        }

        const result = await service.searchChallenges(
          { isMachine: true },
          {
            ids: searchChallengeIds,
            search: searchToken.toLowerCase(),
            sortBy: "name",
            sortOrder: "asc",
            page: 2,
            perPage: 2,
          },
        );

        should.equal(result.total, 4);
        should.equal(result.page, 2);
        should.equal(result.perPage, 2);
        _.map(result.result, "name").should.deep.equal(["C Tag Only", "D Skill Only"]);
        result.result[1].skills.should.deep.equal([{ id: skillId, name: searchToken }]);
      } finally {
        helper.getStandSkills = originalGetStandSkills;
        await prisma.challenge.deleteMany({
          where: { id: { in: searchChallengeIds } },
        });
      }
    }).timeout(10000);

    it("treats AI as an exact tag track facet and ORs it with persisted tracks", async () => {
      const developmentTrackId = uuid();
      const designTrackId = uuid();
      const facetChallengeIds = [uuid(), uuid(), uuid(), uuid()];

      await prisma.challengeTrack.createMany({
        data: [
          {
            id: developmentTrackId,
            name: `Development AI facet ${Date.now()}`,
            description: "Development track for AI facet search",
            isActive: true,
            track: "DEVELOPMENT",
            abbreviation: "Dev",
            createdBy: "ai-track-facet",
            updatedBy: "ai-track-facet",
          },
          {
            id: designTrackId,
            name: `Design AI facet ${Date.now()}`,
            description: "Design track for AI facet search",
            isActive: true,
            track: "DESIGN",
            abbreviation: `Design-${designTrackId}`,
            createdBy: "ai-track-facet",
            updatedBy: "ai-track-facet",
          },
        ],
      });

      const facetChallenges = [
        { id: facetChallengeIds[0], name: "A AI design", trackId: designTrackId, tags: ["AI"] },
        { id: facetChallengeIds[1], name: "B Development", trackId: developmentTrackId, tags: [] },
        { id: facetChallengeIds[2], name: "C AI design", trackId: designTrackId, tags: ["AI"] },
        { id: facetChallengeIds[3], name: "D lowercase ai", trackId: designTrackId, tags: ["ai"] },
      ];

      try {
        for (const challenge of facetChallenges) {
          await prisma.challenge.create({
            data: {
              id: challenge.id,
              name: challenge.name,
              description: "AI synthetic track facet test",
              privateDescription: "AI synthetic track facet test",
              challengeSource: "Topcoder",
              descriptionFormat: "html",
              timelineTemplate: { connect: { id: data.timelineTemplate.id } },
              type: { connect: { id: data.challenge.typeId } },
              track: { connect: { id: challenge.trackId } },
              tags: challenge.tags,
              groups: [],
              status: ChallengeStatusEnum.ACTIVE,
              createdBy: "ai-track-facet",
              updatedBy: "ai-track-facet",
            },
          });
        }

        const aiOnly = await service.searchChallenges(
          { isMachine: true },
          {
            ids: facetChallengeIds,
            tracks: ["AI"],
            sortBy: "name",
            sortOrder: "asc",
            page: 2,
            perPage: 1,
          },
        );
        should.equal(aiOnly.total, 2);
        should.equal(aiOnly.page, 2);
        should.equal(aiOnly.perPage, 1);
        _.map(aiOnly.result, "name").should.deep.equal(["C AI design"]);

        const aiAndDevelopment = await service.searchChallenges(
          { isMachine: true },
          {
            ids: facetChallengeIds,
            tracks: ["AI", "Dev"],
            sortBy: "name",
            sortOrder: "asc",
            page: 2,
            perPage: 2,
          },
        );
        should.equal(aiAndDevelopment.total, 3);
        should.equal(aiAndDevelopment.page, 2);
        should.equal(aiAndDevelopment.perPage, 2);
        _.map(aiAndDevelopment.result, "name").should.deep.equal(["C AI design"]);

        const unknown = await service.searchChallenges(
          { isMachine: true },
          { ids: facetChallengeIds, tracks: ["NotARealTrack"] },
        );
        should.equal(unknown.total, 0);
        should.equal(unknown.result.length, 0);
      } finally {
        await prisma.challenge.deleteMany({
          where: { id: { in: facetChallengeIds } },
        });
        await prisma.challengeTrack.deleteMany({
          where: { id: { in: [developmentTrackId, designTrackId] } },
        });
      }
    }).timeout(10000);

    it("search challenges by approvalStatus case-insensitively", async () => {
      const result = await service.searchChallenges(
        { isMachine: true },
        { approvalStatus: "approved" },
      );

      should.equal(result.total > 0, true);
      should.equal(result.result.every((challenge) => challenge.approvalStatus === "APPROVED"), true);
    });

    it("search challenges successfully 3", async () => {
      const res = await service.searchChallenges(
        { isMachine: true },
        {
          page: 1,
          perPage: 10,
          id: data.challenge.id,
          typeId: data.challenge.typeId,
          track: data.challenge.track,
          name: data.challenge.name.substring(2).trim().toUpperCase(),
          description: data.challenge.description,
          timelineTemplateId: data.challenge.timelineTemplateId,
          reviewType: data.challenge.reviewType,
          tag: data.challenge.tags[0],
          projectId: data.challenge.projectId,
          forumId: data.challenge.forumId,
          status: _.capitalize(data.challenge.status.toLowerCase()),
          createdDateStart: "1992-01-02",
          createdDateEnd: "2022-01-02",
          createdBy: data.challenge.createdBy,
          memberId: "23124329",
        },
      );
      should.equal(res.total, 0);
      should.equal(res.page, 1);
      should.equal(res.perPage, 10);
      should.equal(res.result.length, 0);
    });

    it("search challenges successfully 4 - with terms", async () => {
      const res = await service.searchChallenges(
        { isMachine: true },
        {
          page: 1,
          perPage: 10,
          id,
        },
      );
      const challengeData = _.cloneDeep(testChallengeData);
      should.equal(res.total, 1);
      should.equal(res.page, 1);
      should.equal(res.perPage, 10);
      should.equal(res.result.length, 1);
      const result = res.result[0];

      should.equal(result.type, data.challengeType.name);
      should.equal(result.track, data.challengeTrack.name);
      should.equal(result.name, challengeData.name);
      should.equal(result.description, challengeData.description);
      should.equal(result.timelineTemplateId, challengeData.timelineTemplateId);
      should.equal(result.phases.length, 2);
      should.equal(result.phases[0].phaseId, data.phase.id);
      should.equal(result.phases[0].name, data.phase.name);
      should.equal(result.phases[0].description, data.phase.description);
      should.equal(result.phases[0].isOpen, false);
      should.equal(result.phases[0].duration, challengeData.phases[0].duration);
      should.equal(result.phases[1].phaseId, data.phase2.id);
      should.equal(result.phases[1].name, data.phase2.name);
      should.equal(result.phases[1].predecessor, data.phase.id);
      should.equal(result.phases[1].description, data.phase2.description);
      should.equal(result.phases[1].isOpen, false);
      should.equal(result.phases[1].duration, challengeData.phases[1].duration);
      should.equal(result.prizeSets.length, 1);
      should.equal(result.prizeSets[0].type, challengeData.prizeSets[0].type);
      should.equal(result.prizeSets[0].description, challengeData.prizeSets[0].description);
      should.equal(result.prizeSets[0].prizes.length, 1);
      should.equal(
        result.prizeSets[0].prizes[0].description,
        challengeData.prizeSets[0].prizes[0].description,
      );
      should.equal(result.prizeSets[0].prizes[0].type, challengeData.prizeSets[0].prizes[0].type);
      should.equal(result.prizeSets[0].prizes[0].value, challengeData.prizeSets[0].prizes[0].value);
      should.equal(result.reviewType, challengeData.reviewType);
      should.equal(result.tags.length, 2);
      should.equal(result.tags[0], challengeData.tags[0]);
      should.equal(result.projectId, challengeData.projectId);
      should.equal(result.legacyId, challengeData.legacyId);
      should.equal(result.forumId, challengeData.forumId);
      should.equal(result.status, challengeData.status);
      should.equal(result.createdBy, "testuser");
      should.exist(result.startDate);
      should.exist(result.created);
      should.equal(result.numOfSubmissions, 0);
      should.equal(result.numOfRegistrants, 0);
    });

    it("search challenges successfully 5 - with tco eligible events", async () => {
      const result = await service.searchChallenges({ isMachine: true }, { tco: true });
      should.equal(result.total, 0);
      should.equal(result.page, 1);
      should.equal(result.perPage, 20);
      should.equal(result.result.length, 0);
    });

    it("search challenges - invalid name", async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { name: ["invalid"] });
      } catch (e) {
        should.equal(e.message.indexOf('"name" must be a string') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("search challenges - invalid forumId", async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { forumId: "invalid" });
      } catch (e) {
        should.equal(e.message.indexOf('"forumId" must be a number') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("search challenges - invalid page", async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { page: -1 });
      } catch (e) {
        should.equal(e.message.indexOf('"page" must be larger than or equal to 1') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("search challenges - invalid perPage", async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { perPage: -1 });
      } catch (e) {
        should.equal(e.message.indexOf('"perPage" must be larger than or equal to 1') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("search challenges - invalid name", async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { name: ["abc"] });
      } catch (e) {
        should.equal(e.message.indexOf('"name" must be a string') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("search challenges - invalid track", async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { track: ["abc"] });
      } catch (e) {
        should.equal(e.message.indexOf('"track" must be a string') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("search challenges - invalid description", async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { description: ["abc"] });
      } catch (e) {
        should.equal(e.message.indexOf('"description" must be a string') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("search challenges - invalid reviewType", async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { reviewType: ["abc"] });
      } catch (e) {
        should.equal(e.message.indexOf('"reviewType" must be a string') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("search challenges - invalid tag", async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { tag: ["abc"] });
      } catch (e) {
        should.equal(e.message.indexOf('"tag" must be a string') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("search challenges - invalid group", async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { group: ["abc"] });
      } catch (e) {
        should.equal(e.message.indexOf('"group" must be a string') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("search challenges - invalid createdBy", async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { createdBy: ["abc"] });
      } catch (e) {
        should.equal(e.message.indexOf('"createdBy" must be a string') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("search challenges - invalid updatedBy", async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { updatedBy: ["abc"] });
      } catch (e) {
        should.equal(e.message.indexOf('"updatedBy" must be a string') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("search challenges - invalid approvalStatus", async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { approvalStatus: "INVALID" });
      } catch (e) {
        should.equal(e.message.includes("approvalStatus") && e.message.includes("must be one of"), true);
        return;
      }
      throw new Error("should not reach here");
    });
  });

  describe("update challenge tests", () => {
    const ensureSkipTimelineTemplate = async () => {
      const templateId = config.SKIP_PROJECT_ID_BY_TIMLINE_TEMPLATE_ID;
      let template = await prisma.timelineTemplate.findUnique({ where: { id: templateId } });
      if (!template) {
        template = await prisma.timelineTemplate.create({
          data: {
            id: templateId,
            name: `skip-template-${templateId}`,
            description: "Template used to bypass project requirements in activation tests",
            isActive: true,
            createdBy: "activation-test",
            updatedBy: "activation-test",
          },
        });
      }

      const existingPhases = await prisma.timelineTemplatePhase.findMany({
        where: { timelineTemplateId: templateId },
      });
      const existingPhaseIds = new Set(existingPhases.map((p) => p.phaseId));
      const phaseRows = [];
      if (!existingPhaseIds.has(data.phase.id)) {
        phaseRows.push({
          timelineTemplateId: templateId,
          phaseId: data.phase.id,
          defaultDuration: 1000,
          createdBy: "activation-test",
          updatedBy: "activation-test",
        });
      }
      if (!existingPhaseIds.has(data.phase2.id)) {
        phaseRows.push({
          timelineTemplateId: templateId,
          phaseId: data.phase2.id,
          predecessor: data.phase.id,
          defaultDuration: 1000,
          createdBy: "activation-test",
          updatedBy: "activation-test",
        });
      }
      if (phaseRows.length > 0) {
        await prisma.timelineTemplatePhase.createMany({ data: phaseRows });
      }
      return templateId;
    };

    const createChallengeWithRequiredReviewPhases = async () => {
      await ensureSkipTimelineTemplate();

      const phaseNames = ["Screening", "Review"];
      const createdPhaseIds = [];
      const phaseRecords = [];

      for (const phaseName of phaseNames) {
        let phaseRecord = await prisma.phase.findFirst({ where: { name: phaseName } });
        if (!phaseRecord) {
          phaseRecord = await prisma.phase.create({
            data: {
              id: uuid(),
              name: phaseName,
              description: `${phaseName} phase`,
              isOpen: false,
              duration: 86400,
              createdBy: "activation-test",
              updatedBy: "activation-test",
            },
          });
          createdPhaseIds.push(phaseRecord.id);
        }
        phaseRecords.push(phaseRecord);
      }

      const challenge = await prisma.challenge.create({
        data: {
          id: uuid(),
          name: `Activation coverage ${Date.now()}`,
          description: "Activation coverage test",
          typeId: data.challenge.typeId,
          trackId: data.challenge.trackId,
          timelineTemplateId: config.SKIP_PROJECT_ID_BY_TIMLINE_TEMPLATE_ID,
          startDate: new Date(),
          status: ChallengeStatusEnum.DRAFT,
          tags: [],
          groups: [],
          createdBy: "activation-test",
          updatedBy: "activation-test",
        },
      });

      const challengePhaseIds = [];
      await prisma.challengePhase.createMany({
        data: phaseRecords.map((phase) => {
          const cpId = uuid();
          challengePhaseIds.push(cpId);
          return {
            id: cpId,
            challengeId: challenge.id,
            phaseId: phase.id,
            name: phase.name,
            duration: phase.duration || 86400,
            isOpen: false,
            createdBy: "activation-test",
            updatedBy: "activation-test",
          };
        }),
      });

      return { challenge, phaseRecords, createdPhaseIds, challengePhaseIds };
    };

    const cleanupChallengeWithRequiredReviewPhases = async ({
      challenge,
      createdPhaseIds = [],
      challengePhaseIds = [],
    }) => {
      if (challengePhaseIds.length > 0) {
        await prisma.challengePhase.deleteMany({ where: { id: { in: challengePhaseIds } } });
      }
      if (challenge) {
        await prisma.challenge.delete({ where: { id: challenge.id } });
      }
      if (createdPhaseIds.length > 0) {
        await prisma.phase.deleteMany({ where: { id: { in: createdPhaseIds } } });
      }
    };

    const createActivationChallenge = async (status = ChallengeStatusEnum.NEW) => {
      const timelineTemplateId = await ensureSkipTimelineTemplate();
      return prisma.challenge.create({
        data: {
          id: uuid(),
          name: `Activation reviewer check ${Date.now()}`,
          description: "activation reviewer check",
          typeId: data.challenge.typeId,
          trackId: data.challenge.trackId,
          timelineTemplateId,
          startDate: new Date(),
          status,
          tags: [],
          groups: [],
          createdBy: "activation-test",
          updatedBy: "activation-test",
        },
      });
    };

    const createProjectActivationChallenge = async (status = ChallengeStatusEnum.NEW) => {
      return prisma.challenge.create({
        data: {
          id: uuid(),
          name: `Project activation check ${Date.now()}`,
          description: "project activation check",
          typeId: data.challenge.typeId,
          trackId: data.challenge.trackId,
          timelineTemplateId: data.timelineTemplate.id,
          projectId: 12345,
          startDate: new Date(),
          status,
          tags: [],
          groups: [],
          createdBy: "activation-test",
          updatedBy: "activation-test",
        },
      });
    };

    const buildActivationReviewers = () => [
      {
        phaseId: data.phase.id,
        scorecardId: "activation-scorecard",
        isMemberReview: false,
        aiWorkflowId: "workflow-123",
      },
    ];

    it("update challenge enforces challenge user whitelist before downstream validation", async () => {
      const originalGetChallengeResources = helper.getChallengeResources;
      let loadedResources = false;

      helper.getChallengeResources = async () => {
        loadedResources = true;
        return [];
      };

      await prisma.challengeUserWhitelist.create({
        data: {
          challengeId: data.challenge.id,
          userId: "allowed-user",
        },
      });

      try {
        try {
          await service.updateChallenge(
            { handle: "blocked", roles: ["administrator"], userId: "blocked-user" },
            data.challenge.id,
            { description: "blocked update" },
          );
        } catch (e) {
          should.equal(e.name, "ForbiddenError");
          should.equal(loadedResources, false);
          return;
        }
        throw new Error("should not reach here");
      } finally {
        helper.getChallengeResources = originalGetChallengeResources;
        await prisma.challengeUserWhitelist.deleteMany({
          where: { challengeId: data.challenge.id },
        });
      }
    });

    it("update challenge successfully 1", async () => {
      const challengeData = testChallengeData;
      const result = await service.updateChallenge(
        { isMachine: true, sub: "sub3", userId: 22838965 },
        id,
        {
          privateDescription: "track 333",
          description: "updated desc",
          attachments: [], // this will delete attachments
        },
      );
      should.equal(result.id, id);
      should.equal(result.typeId, data.challenge.typeId);
      should.equal(result.privateDescription, "track 333");
      should.equal(result.name, challengeData.name);
      should.equal(result.description, "updated desc");
      should.equal(result.timelineTemplateId, challengeData.timelineTemplateId);
      should.equal(result.phases.length, 2);
      should.exist(result.phases[0].id);
      should.equal(result.phases[0].phaseId, data.phase.id);
      should.equal(result.phases[0].duration, challengeData.phases[0].duration);
      should.equal(
        testHelper.getDatesDiff(result.phases[0].scheduledStartDate, challengeData.startDate),
        0,
      );
      should.equal(
        testHelper.getDatesDiff(result.phases[0].scheduledEndDate, challengeData.startDate),
        challengeData.phases[0].duration * 1000,
      );
      should.exist(result.phases[1].id);
      should.equal(result.phases[1].phaseId, data.phase2.id);
      should.equal(result.phases[1].predecessor, result.phases[0].phaseId);
      should.equal(result.phases[1].duration, challengeData.phases[1].duration);
      should.equal(
        testHelper.getDatesDiff(result.phases[1].scheduledStartDate, challengeData.startDate),
        challengeData.phases[0].duration * 1000,
      );
      should.equal(
        testHelper.getDatesDiff(result.phases[1].scheduledEndDate, challengeData.startDate),
        challengeData.phases[0].duration * 1000 + challengeData.phases[1].duration * 1000,
      );
      should.equal(result.prizeSets.length, 1);
      should.equal(result.prizeSets[0].type, challengeData.prizeSets[0].type);
      should.equal(result.prizeSets[0].description, challengeData.prizeSets[0].description);
      should.equal(result.prizeSets[0].prizes.length, 1);
      should.equal(
        result.prizeSets[0].prizes[0].description,
        challengeData.prizeSets[0].prizes[0].description,
      );
      should.equal(result.prizeSets[0].prizes[0].type, challengeData.prizeSets[0].prizes[0].type);
      should.equal(result.prizeSets[0].prizes[0].value, challengeData.prizeSets[0].prizes[0].value);
      should.equal(result.reviewType, challengeData.reviewType);
      should.equal(result.tags.length, 2);
      should.equal(result.tags[0], challengeData.tags[0]);
      should.equal(result.tags[1], challengeData.tags[1]);
      should.equal(result.projectId, challengeData.projectId);
      should.equal(result.legacyId, challengeData.legacyId);
      should.equal(result.forumId, challengeData.forumId);
      should.equal(result.status, challengeData.status);
      should.equal(result.funChallenge, challengeData.funChallenge);
      should.equal(!result.attachments || result.attachments.length === 0, true);
      should.equal(result.createdBy, "testuser");
      should.equal(result.updatedBy, "22838965");
      should.exist(result.startDate);
      should.exist(result.created);
      should.exist(result.updated);
    }).timeout(3000);

    it("update challenge with startDate only keeps derived dates stable", async () => {
      const result = await service.updateChallenge(
        { isMachine: true, sub: "sub3", userId: 22838965 },
        id,
        {
          startDate: testChallengeData.startDate,
        },
      );

      should.equal(result.id, id);
      should.exist(result.startDate);
      should.equal(testHelper.getDatesDiff(result.startDate, testChallengeData.startDate), 0);
    });

    it("backfills missing billing and locks draft budget including copilot prizes", async () => {
      const challengeData = _.cloneDeep(testChallengeData);
      challengeData.name = `${challengeData.name} Billing Lock ${Date.now()}`;
      challengeData.legacyId = Math.floor(Math.random() * 1000000);
      challengeData.status = ChallengeStatusEnum.NEW;
      challengeData.funChallenge = false;
      challengeData.prizeSets = [
        {
          type: PrizeSetTypeEnum.PLACEMENT,
          description: "placement prizes",
          prizes: [
            {
              description: "placement 1",
              type: constants.prizeTypes.USD,
              value: 1000,
            },
          ],
        },
        {
          type: PrizeSetTypeEnum.COPILOT,
          description: "copilot payment",
          prizes: [
            {
              description: "copilot",
              type: constants.prizeTypes.USD,
              value: 150,
            },
          ],
        },
      ];

      const originalGetProject = projectHelper.getProject;
      const originalGetProjectBillingInformation = projectHelper.getProjectBillingInformation;
      let billingLookupCount = 0;
      let createdChallengeId;

      projectHelper.getProject = async () => ({ directProjectId: "33541" });
      projectHelper.getProjectBillingInformation = async () => {
        billingLookupCount += 1;

        if (billingLookupCount === 1) {
          return {
            billingAccountId: null,
            markup: null,
          };
        }

        return {
          billingAccountId: "80001012",
          markup: 0.1,
        };
      };

      try {
        const created = await service.createChallenge(
          { isMachine: true, sub: "sub-billing-lock-create", userId: "testuser" },
          challengeData,
          config.M2M_FULL_ACCESS_TOKEN,
        );
        createdChallengeId = created.id;
        should.equal(created.approvalStatus, "PENDING_APPROVAL");
        should.equal(billingLockRequests.length, 0);

        const draftPrizeSets = _.cloneDeep(challengeData.prizeSets);
        draftPrizeSets[0].prizes[0].value = 1005;

        const draft = await service.updateChallenge(
          { isMachine: true, sub: "sub-billing-lock-update", userId: 22838965 },
          created.id,
          {
            prizeSets: draftPrizeSets,
            status: ChallengeStatusEnum.DRAFT,
          },
        );

        should.equal(draft.approvalStatus, "PENDING_APPROVAL");
        should.equal(draft.billing.billingAccountId, "80001012");
        should.equal(billingLockRequests.length, 1);
        billingLockRequests[0].should.deep.equal({
          billingAccountId: "80001012",
          challengeId: created.id,
          markup: 0.1,
          memberPaymentAmount: 1155,
        });

        const updatedPrizeSets = _.cloneDeep(draft.prizeSets);
        const copilotPrizeSet = _.find(
          updatedPrizeSets,
          (prizeSet) => _.toString(prizeSet.type).toUpperCase() === PrizeSetTypeEnum.COPILOT,
        );
        should.exist(copilotPrizeSet);
        copilotPrizeSet.prizes[0].value = 225;
        billingLockRequests = [];

        await service.updateChallenge(
          { isMachine: true, sub: "sub-billing-lock-prize-update", userId: 22838965 },
          created.id,
          {
            prizeSets: updatedPrizeSets,
          },
        );

        should.equal(billingLockRequests.length, 1);
        billingLockRequests[0].should.deep.equal({
          billingAccountId: "80001012",
          challengeId: created.id,
          markup: 0.1,
          memberPaymentAmount: 1230,
        });
      } finally {
        projectHelper.getProject = originalGetProject;
        projectHelper.getProjectBillingInformation = originalGetProjectBillingInformation;

        if (createdChallengeId) {
          await prisma.challenge.deleteMany({ where: { id: createdChallengeId } });
        }
      }
    }).timeout(10000);

    it("preserves existing terms when update payload omits the terms field", async () => {
      const challengeData = _.cloneDeep(testChallengeData);
      challengeData.name = `${challengeData.name} Terms ${Date.now()}`;
      challengeData.legacyId = Math.floor(Math.random() * 1000000);
      const challengeWithTerms = await service.createChallenge(
        { isMachine: true, sub: "sub-terms", userId: 22838965 },
        challengeData,
        config.M2M_FULL_ACCESS_TOKEN,
      );

      const termRecords = [
        {
          challengeId: challengeWithTerms.id,
          termId: uuid(),
          roleId: uuid(),
          createdBy: "unit-test",
          updatedBy: "unit-test",
        },
        {
          challengeId: challengeWithTerms.id,
          termId: uuid(),
          roleId: uuid(),
          createdBy: "unit-test",
          updatedBy: "unit-test",
        },
      ];
      await prisma.challengeTerm.createMany({ data: termRecords });

      try {
        const updated = await service.updateChallenge(
          { isMachine: true, sub: "sub-terms", userId: 22838965 },
          challengeWithTerms.id,
          {
            description: "Updated description to ensure persistence of terms",
          },
        );

        should.exist(updated.terms);
        should.equal(updated.terms.length, termRecords.length);
        const sortedTerms = _.sortBy(updated.terms, ["id", "roleId"]);
        const expectedTerms = _.sortBy(
          termRecords.map((t) => ({ id: t.termId, roleId: t.roleId })),
          ["id", "roleId"],
        );
        sortedTerms.should.deep.equal(expectedTerms);
      } finally {
        await prisma.challenge.delete({ where: { id: challengeWithTerms.id } });
      }
    }).timeout(5000);

    it("preserves existing attachments when update payload omits the attachments field", async () => {
      const challengeData = _.cloneDeep(testChallengeData);
      challengeData.name = `${challengeData.name} Attachments ${Date.now()}`;
      challengeData.legacyId = Math.floor(Math.random() * 1000000);
      const challengeWithAttachment = await service.createChallenge(
        { isMachine: true, sub: "sub-attachments-create", userId: 22838965 },
        challengeData,
        config.M2M_FULL_ACCESS_TOKEN,
      );

      const createdAttachment = await prisma.attachment.create({
        data: {
          challengeId: challengeWithAttachment.id,
          createdBy: "unit-test",
          fileSize: 1234,
          name: "specification.pdf",
          updatedBy: "unit-test",
          url: "https://example.com/specification.pdf",
        },
      });

      try {
        const updated = await service.updateChallenge(
          { isMachine: true, sub: "sub-attachments-update", userId: 22838965 },
          challengeWithAttachment.id,
          {
            description: "Updated description while preserving attachments",
          },
        );

        should.exist(updated.attachments);
        should.equal(updated.attachments.length, 1);
        should.equal(updated.attachments[0].id, createdAttachment.id);
        should.equal(updated.attachments[0].name, createdAttachment.name);
        should.equal(updated.attachments[0].url, createdAttachment.url);
        should.equal(updated.attachments[0].fileSize, createdAttachment.fileSize);

        const persistedAttachments = await prisma.attachment.findMany({
          where: { challengeId: challengeWithAttachment.id },
        });

        should.equal(persistedAttachments.length, 1);
        should.equal(persistedAttachments[0].id, createdAttachment.id);
      } finally {
        await prisma.challenge.delete({ where: { id: challengeWithAttachment.id } });
      }
    }).timeout(5000);

    it("replaces existing skills when update payload includes skills", async () => {
      const challengeData = _.cloneDeep(testChallengeData);
      challengeData.name = `${challengeData.name} Skills ${Date.now()}`;
      challengeData.legacyId = Math.floor(Math.random() * 1000000);
      const originalGetStandSkills = helper.getStandSkills;
      const skillId1 = uuid();
      const skillId2 = uuid();
      let challengeWithSkills;

      helper.getStandSkills = async (ids) =>
        ids.map((skillId) => ({
          id: skillId,
          name: `Skill ${skillId}`,
        }));

      try {
        challengeWithSkills = await service.createChallenge(
          { isMachine: true, sub: "sub-skills-create", userId: 22838965 },
          challengeData,
          config.M2M_FULL_ACCESS_TOKEN,
        );

        await prisma.challengeSkill.createMany({
          data: [
            {
              challengeId: challengeWithSkills.id,
              skillId: skillId1,
              createdBy: "unit-test",
              updatedBy: "unit-test",
            },
            {
              challengeId: challengeWithSkills.id,
              skillId: skillId2,
              createdBy: "unit-test",
              updatedBy: "unit-test",
            },
          ],
        });

        const updated = await service.updateChallenge(
          { isMachine: true, sub: "sub-skills-update", userId: 22838965 },
          challengeWithSkills.id,
          {
            skills: [{ id: skillId2 }],
          },
        );

        should.exist(updated.skills);
        should.equal(updated.skills.length, 1);
        should.equal(updated.skills[0].id, skillId2);
        should.equal(updated.skills[0].name, `Skill ${skillId2}`);

        const persistedSkills = await prisma.challengeSkill.findMany({
          where: { challengeId: challengeWithSkills.id },
        });
        should.equal(persistedSkills.length, 1);
        should.equal(persistedSkills[0].skillId, skillId2);
      } finally {
        helper.getStandSkills = originalGetStandSkills;
        if (challengeWithSkills && challengeWithSkills.id) {
          await prisma.challenge.delete({ where: { id: challengeWithSkills.id } });
        }
      }
    }).timeout(5000);

    it("update challenge successfully with winners", async () => {
      const result = await service.updateChallenge(
        { isMachine: true, sub: "sub3", userId: 22838965 },
        data.challenge.id,
        {
          winners: [
            {
              userId: 12345678,
              handle: "thomaskranitsas",
              placement: 1,
              type: PrizeSetTypeEnum.PLACEMENT,
            },
          ],
        },
      );
      should.equal(result.id, data.challenge.id);
      should.equal(result.typeId, data.challenge.typeId);
      should.equal(result.trackId, data.challenge.trackId);
      should.equal(result.name, data.challenge.name);
      should.equal(result.description, data.challenge.description);
      should.equal(result.timelineTemplateId, data.challenge.timelineTemplateId);
      should.equal(result.phases.length, 0);
      should.equal(result.prizeSets.length, 0);
      should.equal(result.reviewType, data.challenge.reviewType);
      should.equal(result.tags.length, 1);
      should.equal(result.tags[0], data.challenge.tags[0]);
      should.equal(result.projectId, data.challenge.projectId);
      should.equal(result.legacyId, data.challenge.legacyId);
      should.equal(result.forumId, data.challenge.forumId);
      should.equal(result.status.toUpperCase(), data.challenge.status.toUpperCase());
      should.equal(result.winners.length, 1);
      should.equal(result.winners[0].userId, winners[0].userId);
      should.equal(result.winners[0].handle, winners[0].handle);
      should.equal(result.winners[0].placement, winners[0].placement);
      should.equal(result.winners[0].type, PrizeSetTypeEnum.PLACEMENT);
      should.equal(result.createdBy, "admin");
      should.equal(result.updatedBy, "22838965");
      should.exist(result.startDate);
      should.exist(result.created);
      should.exist(result.updated);
    });

    it("update challenge - triggers payments for task challenges stored without legacy.pureV5Task", async () => {
      const originalGetChallengeResources = helper.getChallengeResources;
      const originalGenerateChallengePayments = helper.generateChallengePayments;
      let generatedPaymentsChallengeId;

      helper.getChallengeResources = async (challengeId) => {
        if (challengeId === data.taskChallenge.id) {
          return [
            {
              roleId: config.SUBMITTER_ROLE_ID,
              memberId: 12345678,
              memberHandle: "thomaskranitsas",
            },
          ];
        }

        return originalGetChallengeResources(challengeId);
      };
      helper.generateChallengePayments = async (challengeId) => {
        generatedPaymentsChallengeId = challengeId;
        return true;
      };

      try {
        await prisma.challenge.update({
          where: { id: data.taskChallenge.id },
          data: {
            status: ChallengeStatusEnum.ACTIVE,
            updatedBy: "admin",
          },
        });

        const result = await service.updateChallenge(
          { isMachine: true, sub: "sub-task", userId: 22838965 },
          data.taskChallenge.id,
          {
            status: ChallengeStatusEnum.COMPLETED,
            winners: [
              {
                userId: 12345678,
                handle: "thomaskranitsas",
                placement: 1,
              },
            ],
          },
        );

        should.equal(result.status, ChallengeStatusEnum.COMPLETED);
        should.equal(generatedPaymentsChallengeId, data.taskChallenge.id);
      } finally {
        helper.getChallengeResources = originalGetChallengeResources;
        helper.generateChallengePayments = originalGenerateChallengePayments;
      }
    });

    it("update challenge - triggers payments when a challenge is cancelled", async () => {
      const originalGetChallengeResources = helper.getChallengeResources;
      const originalGenerateChallengePayments = helper.generateChallengePayments;
      let generatedPaymentsChallengeId;
      const cancelledChallenge = await createActivationChallenge(ChallengeStatusEnum.ACTIVE);

      helper.getChallengeResources = async () => [];
      helper.generateChallengePayments = async (challengeId) => {
        generatedPaymentsChallengeId = challengeId;
        return true;
      };

      try {
        const result = await service.updateChallenge(
          { isMachine: true, sub: "sub-cancel", userId: 22838965 },
          cancelledChallenge.id,
          {
            status: ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST,
            cancelReason: "QA cancellation coverage",
          },
        );

        should.equal(result.status, ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST);
        should.equal(generatedPaymentsChallengeId, cancelledChallenge.id);
      } finally {
        helper.getChallengeResources = originalGetChallengeResources;
        helper.generateChallengePayments = originalGenerateChallengePayments;
        await prisma.challenge.deleteMany({ where: { id: cancelledChallenge.id } });
      }
    });

    describe("reviewer scorecard changes", () => {
      const originalScorecardId = "sc-original";
      const newScorecardId = "sc-updated";

      beforeEach(async () => {
        await prisma.challengeReviewer.deleteMany({ where: { challengeId: data.challenge.id } });
        await prisma.challengeReviewer.create({
          data: {
            challengeId: data.challenge.id,
            scorecardId: originalScorecardId,
            isMemberReview: false,
            phaseId: data.phase.id,
            createdBy: "admin",
            updatedBy: "admin",
          },
        });
        if (reviewClient) {
          await reviewClient.$executeRawUnsafe(`DELETE FROM ${reviewTableName}`);
        }
      });

      afterEach(async () => {
        await prisma.challengeReviewer.deleteMany({ where: { challengeId: data.challenge.id } });
        if (reviewClient) {
          await reviewClient.$executeRawUnsafe(`DELETE FROM ${reviewTableName}`);
        }
      });

      it("allows scorecard change when no reviews exist", async () => {
        const payload = {
          reviewers: [
            {
              phaseId: data.phase.id,
              scorecardId: newScorecardId,
              isMemberReview: false,
            },
          ],
        };

        const updated = await service.updateChallenge(
          { isMachine: true, sub: "sub3", userId: 22838965 },
          data.challenge.id,
          payload,
        );

        should.exist(updated.reviewers);
        should.equal(updated.reviewers.length, 1);
        should.equal(updated.reviewers[0].scorecardId, newScorecardId);
      });

      it("blocks scorecard change when reviews already started", async () => {
        if (reviewClient) {
          await reviewClient.$executeRawUnsafe(
            `INSERT INTO ${reviewTableName} ("id", "phaseId", "scorecardId", "status") VALUES ('${uuid()}', '${data.challengePhase1Id}', '${originalScorecardId}', 'IN_PROGRESS')`,
          );
        }

        try {
          await service.updateChallenge(
            { isMachine: true, sub: "sub3", userId: 22838965 },
            data.challenge.id,
            {
              reviewers: [
                {
                  phaseId: data.phase.id,
                  scorecardId: newScorecardId,
                  isMemberReview: false,
                },
              ],
            },
          );
        } catch (e) {
          should.equal(
            e.message,
            "Can't change the scorecard at this time because at least one review has already started with the old scorecard",
          );
          return;
        }

        throw new Error("should not reach here");
      });

      it("allows scorecard change via reviews alias when no reviews exist", async () => {
        const payload = {
          reviews: [
            {
              phaseId: data.phase.id,
              scorecardId: newScorecardId,
              isMemberReview: false,
            },
          ],
        };

        const updated = await service.updateChallenge(
          { isMachine: true, sub: "sub3", userId: 22838965 },
          data.challenge.id,
          payload,
        );

        should.exist(updated.reviewers);
        should.equal(updated.reviewers.length, 1);
        should.equal(updated.reviewers[0].scorecardId, newScorecardId);
      });

      it("blocks scorecard change via reviews alias when reviews already started", async () => {
        if (reviewClient) {
          await reviewClient.$executeRawUnsafe(
            `INSERT INTO ${reviewTableName} ("id", "phaseId", "scorecardId", "status") VALUES ('${uuid()}', '${data.challengePhase1Id}', '${originalScorecardId}', 'IN_PROGRESS')`,
          );
        }

        try {
          await service.updateChallenge(
            { isMachine: true, sub: "sub3", userId: 22838965 },
            data.challenge.id,
            {
              reviews: [
                {
                  phaseId: data.phase.id,
                  scorecardId: newScorecardId,
                  isMemberReview: false,
                },
              ],
            },
          );
        } catch (e) {
          should.equal(
            e.message,
            "Can't change the scorecard at this time because at least one review has already started with the old scorecard",
          );
          return;
        }

        throw new Error("should not reach here");
      });

      it("blocks scorecard change when an active review phase has started reviews", async () => {
        if (!reviewClient) {
          return;
        }

        let reviewPhase;
        let reviewChallengePhaseId;

        const insertedReviewId = uuid();

        try {
          reviewPhase = await prisma.phase.create({
            data: {
              id: uuid(),
              name: "Review",
              description: "desc",
              isOpen: true,
              duration: 86400,
              createdBy: "admin",
              updatedBy: "admin",
            },
          });

          reviewChallengePhaseId = uuid();
          const now = new Date();

          await prisma.challengePhase.create({
            data: {
              id: reviewChallengePhaseId,
              challengeId: data.challenge.id,
              phaseId: reviewPhase.id,
              name: "Review",
              isOpen: true,
              actualStartDate: now,
              createdBy: "admin",
              updatedBy: "admin",
            },
          });

          await prisma.challengeReviewer.updateMany({
            where: { challengeId: data.challenge.id },
            data: { phaseId: reviewPhase.id },
          });

          await reviewClient.$executeRawUnsafe(
            `INSERT INTO ${reviewTableName} ("id", "phaseId", "scorecardId", "status") VALUES ('${insertedReviewId}', '${reviewChallengePhaseId}', '${originalScorecardId}', 'COMPLETED')`,
          );

          await service.updateChallenge(
            { isMachine: true, sub: "sub3", userId: 22838965 },
            data.challenge.id,
            {
              reviewers: [
                {
                  phaseId: reviewPhase.id,
                  scorecardId: newScorecardId,
                  isMemberReview: false,
                },
              ],
            },
          );
        } catch (e) {
          should.equal(
            e.message,
            "Cannot change the scorecard for phase 'Review' because reviews are already in progress or completed",
          );
          return;
        } finally {
          await reviewClient.$executeRawUnsafe(
            `DELETE FROM ${reviewTableName} WHERE "id" = '${insertedReviewId}'`,
          );
          if (reviewChallengePhaseId) {
            await prisma.challengePhase.delete({ where: { id: reviewChallengePhaseId } });
          }
          if (reviewPhase) {
            await prisma.phase.delete({ where: { id: reviewPhase.id } });
          }
        }

        throw new Error("should not reach here");
      });
    });

    it("update challenge - creator memberId can modify without matching handle", async () => {
      const updatePayload = { privateDescription: "Creator update via memberId" };
      const result = await service.updateChallenge(
        { userId: "testuser", handle: "different-handle" },
        id,
        updatePayload,
      );
      should.equal(result.id, id);
      should.equal(result.privateDescription, updatePayload.privateDescription);
    });

    it("update challenge - project not found", async () => {
      try {
        await service.updateChallenge(
          { userId: "16096823", handle: "", roles: [constants.UserRoles.Admin] },
          id,
          { projectId: 100000 },
        );
      } catch (e) {
        should.equal(e.message, "Project with id: 100000 doesn't exist");
        return;
      }
      throw new Error("should not reach here");
    });

    it("update challenge - user doesn't have permission to update challenge under specific project", async () => {
      try {
        await service.updateChallenge({ userId: "16096823", handle: "" }, id, { projectId: 200 });
      } catch (e) {
        should.equal(
          e.message,
          "Only M2M, admin, challenge's copilot, users with full access, or project members with write/full/copilot access can perform modification.",
        );
        return;
      }
      throw new Error("should not reach here");
    });

    it("update challenge - timeline template not found", async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: "sub3" }, id, {
          timelineTemplateId: notFoundId,
        });
      } catch (e) {
        should.equal(e.message, `TimelineTemplate with id: ${notFoundId} doesn't exist`);
        return;
      }
      throw new Error("should not reach here");
    });

    it("update challenge - challenge not found", async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: "sub3" }, notFoundId, {
          privateDescription: "track 333",
        });
      } catch (e) {
        should.equal(e.message, `Challenge with id: ${notFoundId} doesn't exist`);
        return;
      }
      throw new Error("should not reach here");
    });

    it("update challenge - invalid type id", async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: "sub3" }, id, {
          typeId: "invalid",
        });
      } catch (e) {
        should.equal(e.message.indexOf('"typeId" must be a valid GUID') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("update challenge - invalid start date", async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: "sub3" }, id, {
          startDate: "abc",
        });
      } catch (e) {
        should.equal(e.message.indexOf('"startDate" must be a valid ISO 8601 date') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("update challenge - empty name", async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: "sub3" }, id, {
          name: "",
        });
      } catch (e) {
        should.equal(e.message.indexOf('"name" is not allowed to be empty') >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("update challenge - Completed to Active status", async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: "sub3" }, data.challenge.id, {
          status: ChallengeStatusEnum.ACTIVE,
        });
      } catch (e) {
        should.equal(
          e.message.indexOf("Cannot change COMPLETED challenge status to ACTIVE status") >= 0,
          true,
        );
        return;
      }
      throw new Error("should not reach here");
    });

    it("update challenge - prevent activating without reviewers", async () => {
      const activationChallenge = await createActivationChallenge(ChallengeStatusEnum.DRAFT);
      try {
        await service.updateChallenge(
          { isMachine: true, sub: "sub-activate" },
          activationChallenge.id,
          {
            status: ChallengeStatusEnum.ACTIVE,
          },
        );
      } catch (e) {
        should.equal(e.message.indexOf("reviewer configured") >= 0, true);
        return;
      } finally {
        await prisma.challenge.delete({ where: { id: activationChallenge.id } });
      }
      throw new Error("should not reach here");
    });

    it("update challenge - allow activating with reviewers provided", async () => {
      const activationChallenge = await createActivationChallenge();
      try {
        const updated = await service.updateChallenge(
          { isMachine: true, sub: "sub-activate", userId: 22838965 },
          activationChallenge.id,
          {
            status: ChallengeStatusEnum.ACTIVE,
            reviewers: buildActivationReviewers(),
          },
        );
        should.equal(updated.status, ChallengeStatusEnum.ACTIVE);
        should.exist(updated.reviewers);
        should.equal(updated.reviewers.length, 1);
        should.equal(updated.reviewers[0].scorecardId, "activation-scorecard");
      } finally {
        await prisma.challenge.delete({ where: { id: activationChallenge.id } });
      }
    });

    it("update challenge - auto-approves and activates a persisted pending Fun challenge", async () => {
      const activationChallenge = await createActivationChallenge(ChallengeStatusEnum.DRAFT);
      const originalGetChallengeResources = helper.getChallengeResources;
      const originalGetM2MToken = m2mHelper.getM2MToken;
      const originalAxiosGet = axios.get;
      const originalPostBusEvent = helper.postBusEvent;
      await prisma.challenge.update({
        where: { id: activationChallenge.id },
        data: {
          approvalStatus: "PENDING_APPROVAL",
          funChallenge: true,
        },
      });
      helper.getChallengeResources = async () => [];
      helper.postBusEvent = async () => {};
      m2mHelper.getM2MToken = async () => "test-token";
      axios.get = async (url, options) => {
        if (_.toString(url) === config.RESOURCE_ROLES_API_URL) {
          return { data: [], status: 200, headers: {} };
        }
        return originalAxiosGet(url, options);
      };

      try {
        const updated = await service.updateChallenge(
          { isMachine: true, sub: "sub-activate-fun", userId: 22838965 },
          activationChallenge.id,
          {
            status: ChallengeStatusEnum.ACTIVE,
            reviewers: [
              {
                phaseId: data.phase.id,
                scorecardId: "activation-scorecard",
                isMemberReview: true,
                memberReviewerCount: 1,
                shouldOpenOpportunity: false,
              },
            ],
          },
        );

        should.equal(updated.status, ChallengeStatusEnum.ACTIVE);
        should.equal(updated.approvalStatus, "APPROVED");
        should.equal(updated.funChallenge, true);
      } finally {
        helper.getChallengeResources = originalGetChallengeResources;
        helper.postBusEvent = originalPostBusEvent;
        m2mHelper.getM2MToken = originalGetM2MToken;
        axios.get = originalAxiosGet;
        await prisma.challenge.delete({ where: { id: activationChallenge.id } });
      }
    });

    it("update challenge - prevent activating with an inactive project billing account", async () => {
      const activationChallenge = await createProjectActivationChallenge(ChallengeStatusEnum.DRAFT);
      const originalGetProjectBillingInformation = projectHelper.getProjectBillingInformation;

      projectHelper.getProjectBillingInformation = async () => ({
        active: false,
        billingAccountId: "80001061",
        endDate: "2099-01-01T00:00:00.000Z",
        markup: 0.25,
      });

      try {
        await service.updateChallenge(
          { isMachine: true, sub: "sub-activate", userId: 22838965 },
          activationChallenge.id,
          {
            status: ChallengeStatusEnum.ACTIVE,
            reviewers: buildActivationReviewers(),
          },
        );
      } catch (e) {
        should.equal(
          e.message,
          "Cannot activate challenge because the project billing account is inactive.",
        );
        return;
      } finally {
        projectHelper.getProjectBillingInformation = originalGetProjectBillingInformation;
        await prisma.challenge.delete({ where: { id: activationChallenge.id } });
      }

      throw new Error("should not reach here");
    });

    it("update challenge - prevent activating with an expired project billing account", async () => {
      const activationChallenge = await createProjectActivationChallenge(ChallengeStatusEnum.DRAFT);
      const originalGetProjectBillingInformation = projectHelper.getProjectBillingInformation;

      projectHelper.getProjectBillingInformation = async () => ({
        active: true,
        billingAccountId: "80001061",
        endDate: "2000-01-01T00:00:00.000Z",
        markup: 0.25,
      });

      try {
        await service.updateChallenge(
          { isMachine: true, sub: "sub-activate", userId: 22838965 },
          activationChallenge.id,
          {
            status: ChallengeStatusEnum.ACTIVE,
            reviewers: buildActivationReviewers(),
          },
        );
      } catch (e) {
        should.equal(
          e.message,
          "Cannot activate challenge because the project billing account is expired.",
        );
        return;
      } finally {
        projectHelper.getProjectBillingInformation = originalGetProjectBillingInformation;
        await prisma.challenge.delete({ where: { id: activationChallenge.id } });
      }

      throw new Error("should not reach here");
    });

    it("update challenge - prevent activating with insufficient project billing funds", async () => {
      const activationChallenge = await createProjectActivationChallenge(ChallengeStatusEnum.DRAFT);
      const originalGetProjectBillingInformation = projectHelper.getProjectBillingInformation;
      const originalGetBillingAccountDetails = projectHelper.getBillingAccountDetails;

      projectHelper.getProjectBillingInformation = async () => ({
        active: true,
        billingAccountId: "80001061",
        endDate: "2099-01-01T00:00:00.000Z",
        markup: 0.25,
      });
      projectHelper.getBillingAccountDetails = async () => ({
        active: true,
        billingAccountId: "80001061",
        endDate: "2099-01-01T00:00:00.000Z",
        status: "ACTIVE",
        totalBudgetRemaining: 0,
      });

      try {
        await service.updateChallenge(
          { isMachine: true, sub: "sub-activate", userId: 22838965 },
          activationChallenge.id,
          {
            status: ChallengeStatusEnum.ACTIVE,
            reviewers: buildActivationReviewers(),
          },
        );
      } catch (e) {
        should.equal(
          e.message,
          "Cannot activate challenge because the project billing account has insufficient remaining funds.",
        );
        return;
      } finally {
        projectHelper.getProjectBillingInformation = originalGetProjectBillingInformation;
        projectHelper.getBillingAccountDetails = originalGetBillingAccountDetails;
        await prisma.challenge.delete({ where: { id: activationChallenge.id } });
      }

      throw new Error("should not reach here");
    });

    it("update challenge - allow activating with a valid project billing account", async () => {
      const activationChallenge = await createProjectActivationChallenge(ChallengeStatusEnum.DRAFT);
      const originalGetProjectBillingInformation = projectHelper.getProjectBillingInformation;
      const originalGetBillingAccountDetails = projectHelper.getBillingAccountDetails;

      projectHelper.getProjectBillingInformation = async () => ({
        active: true,
        billingAccountId: "80001061",
        endDate: "2099-01-01T00:00:00.000Z",
        markup: 0.25,
      });
      projectHelper.getBillingAccountDetails = async () => ({
        active: true,
        billingAccountId: "80001061",
        endDate: "2099-01-01T00:00:00.000Z",
        status: "ACTIVE",
        totalBudgetRemaining: 150,
      });

      try {
        const updated = await service.updateChallenge(
          { isMachine: true, sub: "sub-activate", userId: 22838965 },
          activationChallenge.id,
          {
            status: ChallengeStatusEnum.ACTIVE,
            reviewers: buildActivationReviewers(),
          },
        );
        should.equal(updated.status, ChallengeStatusEnum.ACTIVE);
      } finally {
        projectHelper.getProjectBillingInformation = originalGetProjectBillingInformation;
        projectHelper.getBillingAccountDetails = originalGetBillingAccountDetails;
        await prisma.challenge.delete({ where: { id: activationChallenge.id } });
      }
    });

    it("update challenge - allow activating with an ignored project billing account that is expired and out of funds", async () => {
      const activationChallenge = await createProjectActivationChallenge(ChallengeStatusEnum.DRAFT);
      const originalGetProjectBillingInformation = projectHelper.getProjectBillingInformation;
      const originalGetBillingAccountDetails = projectHelper.getBillingAccountDetails;

      projectHelper.getProjectBillingInformation = async () => ({
        active: true,
        billingAccountId: "80000062",
        endDate: "2000-01-01T00:00:00.000Z",
        markup: 0.25,
      });
      projectHelper.getBillingAccountDetails = async () => ({
        active: true,
        billingAccountId: "80000062",
        endDate: "2000-01-01T00:00:00.000Z",
        status: "ACTIVE",
        totalBudgetRemaining: 0,
      });

      try {
        const updated = await service.updateChallenge(
          { isMachine: true, sub: "sub-activate", userId: 22838965 },
          activationChallenge.id,
          {
            status: ChallengeStatusEnum.ACTIVE,
            reviewers: buildActivationReviewers(),
          },
        );
        should.equal(updated.status, ChallengeStatusEnum.ACTIVE);
      } finally {
        projectHelper.getProjectBillingInformation = originalGetProjectBillingInformation;
        projectHelper.getBillingAccountDetails = originalGetBillingAccountDetails;
        await prisma.challenge.delete({ where: { id: activationChallenge.id } });
      }
    });

    it("update challenge - prevent activating when reviewer is missing required fields", async () => {
      const activationChallenge = await createActivationChallenge();
      await prisma.challengeReviewer.create({
        data: {
          id: uuid(),
          challengeId: activationChallenge.id,
          scorecardId: "",
          isMemberReview: false,
          phaseId: data.phase.id,
          aiWorkflowId: "wf-missing",
          createdBy: "activation-test",
          updatedBy: "activation-test",
        },
      });

      try {
        await service.updateChallenge(
          { isMachine: true, sub: "sub-activate", userId: 22838965 },
          activationChallenge.id,
          {
            status: ChallengeStatusEnum.ACTIVE,
          },
        );
      } catch (e) {
        should.equal(e.message.indexOf("reviewers are missing required fields") >= 0, true);
        return;
      } finally {
        await prisma.challenge.delete({ where: { id: activationChallenge.id } });
      }
      throw new Error("should not reach here");
    });

    it("update challenge - enforce reviewers for required phases", async () => {
      const setup = await createChallengeWithRequiredReviewPhases();
      try {
        await service.updateChallenge(
          { isMachine: true, sub: "sub-activate", userId: 22838965 },
          setup.challenge.id,
          {
            status: ChallengeStatusEnum.ACTIVE,
            reviewers: [
              {
                phaseId: setup.phaseRecords[0].id,
                scorecardId: "screening-scorecard",
                isMemberReview: false,
                aiWorkflowId: "workflow-screening",
              },
            ],
          },
        );
      } catch (e) {
        should.equal(e.message.indexOf("missing reviewers for phase(s): Review") >= 0, true);
        return;
      } finally {
        await cleanupChallengeWithRequiredReviewPhases(setup);
      }
      throw new Error("should not reach here");
    });

    it("update challenge - allow activation when required phases have reviewers", async () => {
      const setup = await createChallengeWithRequiredReviewPhases();
      try {
        const updated = await service.updateChallenge(
          { isMachine: true, sub: "sub-activate", userId: 22838965 },
          setup.challenge.id,
          {
            status: ChallengeStatusEnum.ACTIVE,
            reviewers: [
              {
                phaseId: setup.phaseRecords[0].id,
                scorecardId: "screening-scorecard",
                isMemberReview: false,
                aiWorkflowId: "workflow-screening",
              },
              {
                phaseId: setup.phaseRecords[1].id,
                scorecardId: "review-scorecard",
                isMemberReview: false,
                aiWorkflowId: "workflow-review",
              },
            ],
          },
        );
        should.equal(updated.status, ChallengeStatusEnum.ACTIVE);
        should.exist(updated.reviewers);
        should.equal(updated.reviewers.length, 2);
      } finally {
        await cleanupChallengeWithRequiredReviewPhases(setup);
      }
    });

    it("update challenge - set winners with non-completed Active status", async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: "sub3" }, id, {
          winners,
        });
      } catch (e) {
        should.equal(
          e.message.indexOf("Cannot set winners for challenge with non-completed") >= 0,
          true,
        );
        return;
      }
      throw new Error("should not reach here");
    });

    it("update challenge - Duplicate member with placement 1", async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: "sub3" }, data.challenge.id, {
          winners: [
            {
              userId: 12345678,
              handle: "thomaskranitsas",
              placement: 1,
              type: PrizeSetTypeEnum.PLACEMENT,
            },
            {
              userId: 12345678,
              handle: "thomaskranitsas",
              placement: 1,
              type: PrizeSetTypeEnum.PLACEMENT,
            },
          ],
        });
      } catch (e) {
        should.equal(e.message.indexOf("Duplicate member with placement") >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("update challenge - Only one member can have placement 1", async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: "sub3" }, data.challenge.id, {
          winners: [
            {
              userId: 12345678,
              handle: "thomaskranitsas",
              placement: 1,
              type: PrizeSetTypeEnum.PLACEMENT,
            },
            {
              userId: 3456789,
              handle: "tonyj",
              placement: 1,
              type: PrizeSetTypeEnum.PLACEMENT,
            },
          ],
        });
      } catch (e) {
        should.equal(e.message.indexOf("Only one member can have a placement") >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("update challenge - The same member 12345678 cannot have multiple placements", async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: "sub3" }, data.challenge.id, {
          winners: [
            {
              userId: 12345678,
              handle: "thomaskranitsas",
              placement: 1,
              type: PrizeSetTypeEnum.PLACEMENT,
            },
            {
              userId: 12345678,
              handle: "thomaskranitsas",
              placement: 2,
              type: PrizeSetTypeEnum.PLACEMENT,
            },
          ],
        });
      } catch (e) {
        should.equal(
          e.message.indexOf("The same member 12345678 cannot have multiple placements") >= 0,
          true,
        );
        return;
      }
      throw new Error("should not reach here");
    });
  });

  describe("AI phase closure tests", () => {
    let originalGetAIReviewConfigByChallengeId;

    beforeEach(() => {
      originalGetAIReviewConfigByChallengeId = helper.getAIReviewConfigByChallengeId;
    });

    afterEach(async () => {
      helper.getAIReviewConfigByChallengeId = originalGetAIReviewConfigByChallengeId;
      await reviewClient.$executeRawUnsafe(
        `DELETE FROM ${submissionTableName} WHERE "challengeId" = '${data.challenge.id}'`,
      );
      await reviewClient.$executeRawUnsafe(
        `DELETE FROM ${aiReviewDecisionTableName} WHERE "configId" = 'ai-config-test'`,
      );
      await prisma.challengeReviewer.deleteMany({ where: { challengeId: data.challenge.id } });
    });

    it("skips latest submissions that failed virus scan when checking AI phase closure readiness", async () => {
      helper.getAIReviewConfigByChallengeId = async () => ({ id: "ai-config-test" });
      await prisma.challengeReviewer.create({
        data: {
          id: uuid(),
          challengeId: data.challenge.id,
          scorecardId: "ai-scorecard-id",
          isMemberReview: false,
          aiWorkflowId: "workflow-1",
          createdBy: "test",
          updatedBy: "test",
        },
      });

      await reviewClient.$executeRawUnsafe(`
        INSERT INTO ${submissionTableName}
          ("id", "challengeId", "memberId", "type", "status", "submittedDate", "virusScan")
        VALUES
          ('sub-1', '${data.challenge.id}', 'member-1', 'CONTEST_SUBMISSION', 'ACTIVE', '2026-01-01T00:00:00Z', TRUE),
          ('sub-2', '${data.challenge.id}', 'member-1', 'CONTEST_SUBMISSION', 'ACTIVE', '2026-01-02T00:00:00Z', FALSE)
      `);

      await reviewClient.$executeRawUnsafe(`
        INSERT INTO ${aiReviewDecisionTableName}
          ("id", "submissionId", "configId", "isFinal")
        VALUES
          ('dec-1', 'sub-1', 'ai-config-test', TRUE)
      `);

      await service.ensureAIPhaseCanBeClosed(data.challenge.id, "AI Screening");
    });

    it("allows AI phase closure when all latest submissions failed virus scan", async () => {
      helper.getAIReviewConfigByChallengeId = async () => ({ id: "ai-config-test" });
      await prisma.challengeReviewer.create({
        data: {
          id: uuid(),
          challengeId: data.challenge.id,
          scorecardId: "ai-scorecard-id",
          isMemberReview: false,
          aiWorkflowId: "workflow-2",
          createdBy: "test",
          updatedBy: "test",
        },
      });

      await reviewClient.$executeRawUnsafe(`
        INSERT INTO ${submissionTableName}
          ("id", "challengeId", "memberId", "type", "status", "submittedDate", "virusScan")
        VALUES
          ('sub-3', '${data.challenge.id}', 'member-2', 'CONTEST_SUBMISSION', 'ACTIVE', '2026-01-03T00:00:00Z', FALSE)
      `);

      await service.ensureAIPhaseCanBeClosed(data.challenge.id, "AI Screening");
    });
  });

  describe("delete challenge tests", () => {
    const challengeIds = [];
    let originalEnsureUserCanModifyChallenge;
    let originalPostBusEvent;

    const createDeletionChallenge = async ({ status, testMetadataValue }) => {
      const challengeId = uuid();
      challengeIds.push(challengeId);
      const metadata = _.isUndefined(testMetadataValue)
        ? undefined
        : {
            create: {
              name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
              value: testMetadataValue,
              createdBy: "delete-test",
              updatedBy: "delete-test",
            },
          };

      return prisma.challenge.create({
        data: {
          id: challengeId,
          name: `Deletion coverage ${challengeId}`,
          typeId: data.challenge.typeId,
          trackId: data.challenge.trackId,
          status,
          tags: [],
          groups: [],
          currentPhaseNames: [],
          createdBy: "delete-test",
          updatedBy: "delete-test",
          ...(_.isUndefined(metadata) ? {} : { metadata }),
        },
      });
    };

    beforeEach(() => {
      originalEnsureUserCanModifyChallenge = helper.ensureUserCanModifyChallenge;
      originalPostBusEvent = helper.postBusEvent;
      helper.ensureUserCanModifyChallenge = async () => {};
      helper.postBusEvent = async () => {};
    });

    afterEach(async () => {
      helper.ensureUserCanModifyChallenge = originalEnsureUserCanModifyChallenge;
      helper.postBusEvent = originalPostBusEvent;
      await prisma.challenge.deleteMany({ where: { id: { in: challengeIds.splice(0) } } });
    });

    it("deletes a completed challenge with exact true test metadata", async () => {
      const challenge = await createDeletionChallenge({
        status: ChallengeStatusEnum.COMPLETED,
        testMetadataValue: "true",
      });

      const result = await service.deleteChallenge(
        { isMachine: true, userId: "delete-test" },
        challenge.id,
      );

      should.equal(result.id, challenge.id);
      _.find(result.metadata, {
        name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
      }).value.should.equal("true");
      should.equal(await prisma.challenge.count({ where: { id: challenge.id } }), 0);
    });

    it("deletes exact-true test challenges in every cancelled terminal status", async () => {
      const cancelledStatuses = Object.values(ChallengeStatusEnum).filter((status) =>
        status.startsWith("CANCELLED"),
      );

      for (const status of cancelledStatuses) {
        const challenge = await createDeletionChallenge({
          status,
          testMetadataValue: "true",
        });

        await service.deleteChallenge(
          { isMachine: true, userId: "delete-test" },
          challenge.id,
        );

        should.equal(await prisma.challenge.count({ where: { id: challenge.id } }), 0);
      }
    });

    it("preserves NEW challenge deletion regardless of test metadata", async () => {
      const challenge = await createDeletionChallenge({
        status: ChallengeStatusEnum.NEW,
        testMetadataValue: "false",
      });

      await service.deleteChallenge({ isMachine: true, userId: "delete-test" }, challenge.id);

      should.equal(await prisma.challenge.count({ where: { id: challenge.id } }), 0);
    });

    for (const testMetadataValue of [undefined, "false", "TRUE"]) {
      it(`rejects non-NEW deletion with ${
        _.isUndefined(testMetadataValue) ? "missing" : testMetadataValue
      } test metadata`, async () => {
        const challenge = await createDeletionChallenge({
          status: ChallengeStatusEnum.COMPLETED,
          testMetadataValue,
        });

        try {
          await service.deleteChallenge(
            { isMachine: true, userId: "delete-test" },
            challenge.id,
          );
        } catch (error) {
          should.equal(error.name, "NotFoundError");
          should.equal(
            error.message,
            `Challenge with id: ${challenge.id} doesn't exist or is not eligible for deletion; deletion requires NEW status or a COMPLETED/CANCELLED status with is_test_challenge set to the exact string true`,
          );
          should.equal(await prisma.challenge.count({ where: { id: challenge.id } }), 1);
          return;
        }

        throw new Error("should not reach here");
      });
    }

    for (const status of [
      ChallengeStatusEnum.DRAFT,
      ChallengeStatusEnum.APPROVED,
      ChallengeStatusEnum.ACTIVE,
    ]) {
      it(`rejects exact-true deletion while the challenge is ${status}`, async () => {
        const challenge = await createDeletionChallenge({
          status,
          testMetadataValue: "true",
        });

        try {
          await service.deleteChallenge(
            { isMachine: true, userId: "delete-test" },
            challenge.id,
          );
        } catch (error) {
          should.equal(error.name, "NotFoundError");
          should.equal(await prisma.challenge.count({ where: { id: challenge.id } }), 1);
          return;
        }

        throw new Error("should not reach here");
      });
    }
  });

  describe("test challenge metadata update tests", () => {
    const challengeIds = [];
    let originalEnsureUserCanModifyChallenge;
    let originalGenerateChallengePayments;
    let originalGetChallengeResources;
    let originalGetProjectBillingInformation;
    let originalPostBusEvent;

    const createMetadataUpdateChallenge = async ({ status, testMetadataValue }) => {
      const challengeId = uuid();
      challengeIds.push(challengeId);
      const metadata = _.isUndefined(testMetadataValue)
        ? undefined
        : {
            create: {
              name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
              value: testMetadataValue,
              createdBy: "metadata-update-test",
              updatedBy: "metadata-update-test",
            },
          };

      return prisma.challenge.create({
        data: {
          id: challengeId,
          name: `Metadata update coverage ${challengeId}`,
          typeId: data.challenge.typeId,
          trackId: data.challenge.trackId,
          status,
          tags: [],
          groups: [],
          currentPhaseNames: [],
          createdBy: "metadata-update-test",
          updatedBy: "metadata-update-test",
          ...(_.isUndefined(metadata) ? {} : { metadata }),
        },
      });
    };

    beforeEach(() => {
      originalEnsureUserCanModifyChallenge = helper.ensureUserCanModifyChallenge;
      originalGenerateChallengePayments = helper.generateChallengePayments;
      originalGetChallengeResources = helper.getChallengeResources;
      originalGetProjectBillingInformation = projectHelper.getProjectBillingInformation;
      originalPostBusEvent = helper.postBusEvent;
      projectHelper.getProjectBillingInformation = async () => ({
        billingAccountId: null,
        markup: 0,
      });
      helper.ensureUserCanModifyChallenge = async () => {};
      helper.generateChallengePayments = async () => true;
      helper.getChallengeResources = async () => [];
      helper.postBusEvent = async () => {};
    });

    afterEach(async () => {
      projectHelper.getProjectBillingInformation = originalGetProjectBillingInformation;
      helper.ensureUserCanModifyChallenge = originalEnsureUserCanModifyChallenge;
      helper.generateChallengePayments = originalGenerateChallengePayments;
      helper.getChallengeResources = originalGetChallengeResources;
      helper.postBusEvent = originalPostBusEvent;
      await prisma.challenge.deleteMany({ where: { id: { in: challengeIds.splice(0) } } });
    });

    it("allows a non-terminal challenge to enable the test flag", async () => {
      const challenge = await createMetadataUpdateChallenge({
        status: ChallengeStatusEnum.DRAFT,
      });

      const result = await service.updateChallenge(
        { isMachine: true, userId: "metadata-update-test" },
        challenge.id,
        {
          metadata: [
            {
              name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
              value: "true",
            },
          ],
        },
      );

      _.find(result.metadata, {
        name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
      }).value.should.equal("true");
    });

    const terminalTransitionMutationCases = [
      {
        name: "rejects missing-to-true while transitioning ACTIVE to COMPLETED",
        initialStatus: ChallengeStatusEnum.ACTIVE,
        initialValue: undefined,
        finalStatus: ChallengeStatusEnum.COMPLETED,
        requestedMetadata: [
          {
            name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
            value: "true",
          },
        ],
      },
      {
        name: "rejects false-to-true while transitioning DRAFT to CANCELLED",
        initialStatus: ChallengeStatusEnum.DRAFT,
        initialValue: "false",
        finalStatus: ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST,
        requestedMetadata: [
          {
            name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
            value: "true",
          },
        ],
      },
      {
        name: "rejects true-to-missing while transitioning ACTIVE to COMPLETED",
        initialStatus: ChallengeStatusEnum.ACTIVE,
        initialValue: "true",
        finalStatus: ChallengeStatusEnum.COMPLETED,
        requestedMetadata: [],
      },
      {
        name: "rejects true-to-false while transitioning DRAFT to CANCELLED",
        initialStatus: ChallengeStatusEnum.DRAFT,
        initialValue: "true",
        finalStatus: ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST,
        requestedMetadata: [
          {
            name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
            value: "false",
          },
        ],
      },
    ];

    for (const testCase of terminalTransitionMutationCases) {
      it(testCase.name, async () => {
        const challenge = await createMetadataUpdateChallenge({
          status: testCase.initialStatus,
          testMetadataValue: testCase.initialValue,
        });

        try {
          await service.updateChallenge(
            { isMachine: true, userId: "metadata-update-test" },
            challenge.id,
            {
              status: testCase.finalStatus,
              metadata: testCase.requestedMetadata,
            },
          );
        } catch (error) {
          should.equal(error.name, "BadRequestError");
          should.equal(
            error.message,
            "is_test_challenge metadata cannot be changed when a challenge is or becomes COMPLETED or CANCELLED",
          );
          const persistedChallenge = await prisma.challenge.findUnique({
            where: { id: challenge.id },
            include: { metadata: true },
          });
          should.equal(persistedChallenge.status, testCase.initialStatus);
          should.equal(
            _.some(persistedChallenge.metadata, {
              name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
              value: "true",
            }),
            testCase.initialValue === "true",
          );
          return;
        }

        throw new Error("should not reach here");
      });
    }

    const terminalTransitionPreservationCases = [
      {
        name: "allows explicit true preservation while transitioning ACTIVE to COMPLETED",
        initialStatus: ChallengeStatusEnum.ACTIVE,
        initialValue: "true",
        finalStatus: ChallengeStatusEnum.COMPLETED,
        requestedMetadata: [
          {
            name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
            value: "true",
          },
        ],
      },
      {
        name: "allows omitted metadata while transitioning DRAFT test data to CANCELLED",
        initialStatus: ChallengeStatusEnum.DRAFT,
        initialValue: "true",
        finalStatus: ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST,
      },
      {
        name: "allows omitted metadata while transitioning ACTIVE ordinary data to COMPLETED",
        initialStatus: ChallengeStatusEnum.ACTIVE,
        initialValue: undefined,
        finalStatus: ChallengeStatusEnum.COMPLETED,
      },
      {
        name: "allows explicit false preservation while transitioning DRAFT to CANCELLED",
        initialStatus: ChallengeStatusEnum.DRAFT,
        initialValue: "false",
        finalStatus: ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST,
        requestedMetadata: [
          {
            name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
            value: "false",
          },
        ],
      },
    ];

    for (const testCase of terminalTransitionPreservationCases) {
      it(testCase.name, async () => {
        const challenge = await createMetadataUpdateChallenge({
          status: testCase.initialStatus,
          testMetadataValue: testCase.initialValue,
        });
        const updateData = { status: testCase.finalStatus };
        if (!_.isUndefined(testCase.requestedMetadata)) {
          updateData.metadata = testCase.requestedMetadata;
        }

        const result = await service.updateChallenge(
          { isMachine: true, userId: "metadata-update-test" },
          challenge.id,
          updateData,
        );

        should.equal(result.status, testCase.finalStatus);
        should.equal(
          _.some(result.metadata, {
            name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
            value: "true",
          }),
          testCase.initialValue === "true",
        );
      });
    }

    it("rejects enabling the test flag on a completed ordinary challenge", async () => {
      const challenge = await createMetadataUpdateChallenge({
        status: ChallengeStatusEnum.COMPLETED,
      });

      try {
        await service.updateChallenge(
          { isMachine: true, userId: "metadata-update-test" },
          challenge.id,
          {
            metadata: [
              {
                name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
                value: "true",
              },
            ],
          },
        );
      } catch (error) {
        should.equal(error.name, "BadRequestError");
        should.equal(
          error.message,
          "is_test_challenge metadata cannot be changed when a challenge is or becomes COMPLETED or CANCELLED",
        );
        should.equal(
          await prisma.challengeMetadata.count({ where: { challengeId: challenge.id } }),
          0,
        );
        return;
      }

      throw new Error("should not reach here");
    });

    it("rejects removing the test flag from a cancelled test challenge", async () => {
      const challenge = await createMetadataUpdateChallenge({
        status: ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST,
        testMetadataValue: "true",
      });

      try {
        await service.updateChallenge(
          { isMachine: true, userId: "metadata-update-test" },
          challenge.id,
          { metadata: [] },
        );
      } catch (error) {
        should.equal(error.name, "BadRequestError");
        should.equal(
          await prisma.challengeMetadata.count({
            where: {
              challengeId: challenge.id,
              name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
              value: "true",
            },
          }),
          1,
        );
        return;
      }

      throw new Error("should not reach here");
    });

    it("allows terminal metadata updates that keep an enabled test flag unchanged", async () => {
      const challenge = await createMetadataUpdateChallenge({
        status: ChallengeStatusEnum.COMPLETED,
        testMetadataValue: "true",
      });

      const result = await service.updateChallenge(
        { isMachine: true, userId: "metadata-update-test" },
        challenge.id,
        {
          metadata: [
            {
              name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
              value: "true",
            },
            { name: "lifecycle-note", value: "updated" },
          ],
        },
      );

      _.find(result.metadata, { name: "lifecycle-note" }).value.should.equal("updated");
    });

    it("allows terminal metadata updates that keep a disabled test flag unchanged", async () => {
      const challenge = await createMetadataUpdateChallenge({
        status: ChallengeStatusEnum.CANCELLED_ZERO_SUBMISSIONS,
      });

      const result = await service.updateChallenge(
        { isMachine: true, userId: "metadata-update-test" },
        challenge.id,
        { metadata: [{ name: "lifecycle-note", value: "updated" }] },
      );

      should.equal(
        _.some(result.metadata, {
          name: constants.ChallengeMetadataNames.IS_TEST_CHALLENGE,
          value: "true",
        }),
        false,
      );
      _.find(result.metadata, { name: "lifecycle-note" }).value.should.equal("updated");
    });
  });

  describe("close marathon match tests", () => {
    const adminUser = { isMachine: false, roles: [constants.UserRoles.Admin], userId: "admin" };
    const m2mUser = { isMachine: true };
    const nonAdminUser = { isMachine: false, userId: "user123", roles: [constants.UserRoles.User] };

    let originalReviewSummations;
    let originalChallengeResources;

    beforeEach(async () => {
      originalReviewSummations = helper.getReviewSummations;
      originalChallengeResources = helper.getChallengeResources;

      if (data && data.marathonMatchChallenge) {
        await prisma.challengeWinner.deleteMany({
          where: { challengeId: data.marathonMatchChallenge.id },
        });
        await prisma.challenge.update({
          where: { id: data.marathonMatchChallenge.id },
          data: {
            status: ChallengeStatusEnum.ACTIVE,
            updatedBy: "admin",
          },
        });
        await prisma.challengePhase.updateMany({
          where: { challengeId: data.marathonMatchChallenge.id },
          data: {
            isOpen: true,
            actualEndDate: null,
            updatedBy: "admin",
          },
        });
        await reviewClient.$executeRawUnsafe(
          `DELETE FROM ${submissionTableName} WHERE "challengeId" = '${data.marathonMatchChallenge.id}'`,
        );
      }
    });

    afterEach(() => {
      helper.getReviewSummations = originalReviewSummations;
      helper.getChallengeResources = originalChallengeResources;
    });

    it("close marathon match successfully with multiple final review summations", async () => {
      const originalGetReviewSummations = helper.getReviewSummations;
      helper.getReviewSummations = async () => [
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 95.5,
          submitterId: "12345678",
          submitterHandle: "thomaskranitsas",
          createdAt: "2024-02-01T10:00:00.000Z",
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 92.1,
          submitterId: "9876543",
          submitterHandle: "tonyj",
          createdAt: "2024-02-01T11:00:00.000Z",
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 87.3,
          submitterId: "3456789",
          submitterHandle: "nathanael",
          createdAt: "2024-02-01T12:00:00.000Z",
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: false,
          aggregateScore: 99.9,
          submitterId: "5555555",
          submitterHandle: "ignored",
          createdAt: "2024-02-01T13:00:00.000Z",
        },
      ];
      originalReviewSummations = originalGetReviewSummations;

      const originalGetChallengeResources = helper.getChallengeResources;
      helper.getChallengeResources = async () => [
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 12345678, memberHandle: "thomaskranitsas" },
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 9876543, memberHandle: "tonyj" },
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 3456789, memberHandle: "nathanael" },
        { roleId: "some-other-role", memberId: 11111111 },
      ];
      originalChallengeResources = originalGetChallengeResources;

      const result = await service.closeMarathonMatch(adminUser, data.marathonMatchChallenge.id);

      should.exist(result);
      should.equal(result.status, ChallengeStatusEnum.COMPLETED);
      should.equal(result.winners.length, 3);
      should.equal(result.winners[0].placement, 1);
      should.equal(result.winners[0].userId, 12345678);
      should.equal(result.winners[0].type, PrizeSetTypeEnum.PLACEMENT);
      should.equal(result.winners[1].placement, 2);
      should.equal(result.winners[1].userId, 9876543);
      should.equal(result.winners[2].placement, 3);
      should.equal(result.winners[2].userId, 3456789);
      result.phases.forEach((phase) => {
        should.equal(phase.isOpen, false);
        should.exist(phase.actualEndDate);
      });
    });

    it("close marathon match selects winners from latest member final summations", async () => {
      await reviewClient.$executeRawUnsafe(`
        INSERT INTO ${submissionTableName}
          ("id", "challengeId", "memberId", "type", "status", "submittedDate", "createdAt", "updatedAt", "isLatest")
        VALUES
          ('old-topacc-submission', '${data.marathonMatchChallenge.id}', '12345678', 'Contest Submission', 'ACTIVE', '2024-05-01T09:00:00.000Z', '2024-05-01T09:00:00.000Z', '2024-05-01T09:00:00.000Z', false),
          ('latest-topacc-submission', '${data.marathonMatchChallenge.id}', '12345678', 'Contest Submission', 'ACTIVE', '2024-05-01T10:00:00.000Z', '2024-05-01T10:00:00.000Z', '2024-05-01T10:00:00.000Z', true),
          ('old-liuliquan-submission', '${data.marathonMatchChallenge.id}', '9876543', 'Contest Submission', 'ACTIVE', '2024-05-01T09:05:00.000Z', '2024-05-01T09:05:00.000Z', '2024-05-01T09:05:00.000Z', false),
          ('latest-liuliquan-submission', '${data.marathonMatchChallenge.id}', '9876543', 'Contest Submission', 'ACTIVE', '2024-05-01T10:05:00.000Z', '2024-05-01T10:05:00.000Z', '2024-05-01T10:05:00.000Z', true)
      `);

      const originalGetReviewSummations = helper.getReviewSummations;
      helper.getReviewSummations = async () => [
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 75.8,
          submissionId: "old-topacc-submission",
          submitterId: "12345678",
          submitterHandle: "thomaskranitsas",
          createdAt: "2024-05-01T09:15:00.000Z",
          reviewedDate: "2024-05-01T09:15:00.000Z",
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 95.7,
          submissionId: "latest-topacc-submission",
          submitterId: "12345678",
          submitterHandle: "thomaskranitsas",
          createdAt: "2024-05-01T10:15:00.000Z",
          reviewedDate: "2024-05-01T10:15:00.000Z",
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 99.9,
          submissionId: "old-liuliquan-submission",
          submitterId: "9876543",
          submitterHandle: "tonyj",
          createdAt: "2024-05-01T09:20:00.000Z",
          reviewedDate: "2024-05-01T09:20:00.000Z",
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 83.6,
          submissionId: "latest-liuliquan-submission",
          submitterId: "9876543",
          submitterHandle: "tonyj",
          createdAt: "2024-05-01T10:20:00.000Z",
          reviewedDate: "2024-05-01T10:20:00.000Z",
        },
      ];
      originalReviewSummations = originalGetReviewSummations;

      const originalGetChallengeResources = helper.getChallengeResources;
      helper.getChallengeResources = async () => [
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 12345678, memberHandle: "thomaskranitsas" },
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 9876543, memberHandle: "tonyj" },
      ];
      originalChallengeResources = originalGetChallengeResources;

      const result = await service.closeMarathonMatch(adminUser, data.marathonMatchChallenge.id);

      should.exist(result);
      should.equal(result.status, ChallengeStatusEnum.COMPLETED);
      should.equal(result.winners.length, 2);
      should.equal(result.winners[0].placement, 1);
      should.equal(result.winners[0].userId, 12345678);
      should.equal(result.winners[1].placement, 2);
      should.equal(result.winners[1].userId, 9876543);
    });

    it("close marathon match blocks until all latest submissions have final summations", async () => {
      await reviewClient.$executeRawUnsafe(`
        INSERT INTO ${submissionTableName}
          ("id", "challengeId", "memberId", "type", "status", "submittedDate", "createdAt", "updatedAt", "isLatest")
        VALUES
          ('latest-topacc-submission', '${data.marathonMatchChallenge.id}', '12345678', 'Contest Submission', 'ACTIVE', '2024-05-02T10:00:00.000Z', '2024-05-02T10:00:00.000Z', '2024-05-02T10:00:00.000Z', true),
          ('latest-liuliquan-submission', '${data.marathonMatchChallenge.id}', '9876543', 'Contest Submission', 'ACTIVE', '2024-05-02T10:05:00.000Z', '2024-05-02T10:05:00.000Z', '2024-05-02T10:05:00.000Z', true)
      `);

      const originalGetReviewSummations = helper.getReviewSummations;
      helper.getReviewSummations = async () => [
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 83.6,
          submissionId: "latest-liuliquan-submission",
          submitterId: "9876543",
          submitterHandle: "tonyj",
          createdAt: "2024-05-02T10:20:00.000Z",
          reviewedDate: "2024-05-02T10:20:00.000Z",
        },
      ];
      originalReviewSummations = originalGetReviewSummations;

      try {
        await service.closeMarathonMatch(adminUser, data.marathonMatchChallenge.id);
      } catch (e) {
        should.equal(e.name, "BadRequestError");
        should.equal(
          e.message.indexOf("final system scoring is not complete for latest submissions") >= 0,
          true,
        );
        should.equal(e.message.indexOf("latest-topacc-submission") >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("close marathon match blocks fallback selection when a newer submitter summation is not final", async () => {
      const originalGetReviewSummations = helper.getReviewSummations;
      helper.getReviewSummations = async () => [
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 75.8,
          submissionId: "old-topacc-submission",
          submitterId: "12345678",
          submitterHandle: "thomaskranitsas",
          createdAt: "2024-05-03T09:15:00.000Z",
          reviewedDate: "2024-05-03T09:15:00.000Z",
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: false,
          aggregateScore: 95.7,
          submissionId: "latest-topacc-submission",
          submitterId: "12345678",
          submitterHandle: "thomaskranitsas",
          createdAt: "2024-05-03T10:15:00.000Z",
          reviewedDate: "2024-05-03T10:15:00.000Z",
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 83.6,
          submissionId: "latest-liuliquan-submission",
          submitterId: "9876543",
          submitterHandle: "tonyj",
          createdAt: "2024-05-03T10:20:00.000Z",
          reviewedDate: "2024-05-03T10:20:00.000Z",
        },
      ];
      originalReviewSummations = originalGetReviewSummations;

      try {
        await service.closeMarathonMatch(adminUser, data.marathonMatchChallenge.id);
      } catch (e) {
        should.equal(e.name, "BadRequestError");
        should.equal(
          e.message.indexOf(
            "final system scoring is not complete for latest submitter summations",
          ) >= 0,
          true,
        );
        should.equal(e.message.indexOf("12345678") >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("close marathon match successfully with M2M token", async () => {
      const originalGetReviewSummations = helper.getReviewSummations;
      helper.getReviewSummations = async () => [
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 88.4,
          submitterId: "12345678",
          submitterHandle: "thomaskranitsas",
          createdAt: "2024-03-01T10:00:00.000Z",
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 84.1,
          submitterId: "9876543",
          submitterHandle: "tonyj",
          createdAt: "2024-03-01T11:00:00.000Z",
        },
      ];
      originalReviewSummations = originalGetReviewSummations;

      const originalGetChallengeResources = helper.getChallengeResources;
      helper.getChallengeResources = async () => [
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 12345678, memberHandle: "thomaskranitsas" },
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 9876543, memberHandle: "tonyj" },
      ];
      originalChallengeResources = originalGetChallengeResources;

      const result = await service.closeMarathonMatch(m2mUser, data.marathonMatchChallenge.id);

      should.exist(result);
      should.equal(result.status, ChallengeStatusEnum.COMPLETED);
      should.equal(result.winners.length, 2);
      should.equal(result.winners[0].userId, 12345678);
      should.equal(result.winners[0].placement, 1);
      should.equal(result.winners[1].userId, 9876543);
      should.equal(result.winners[1].placement, 2);
      result.phases.forEach((phase) => {
        should.equal(phase.isOpen, false);
        should.exist(phase.actualEndDate);
      });
    });

    it("close marathon match with tie-breaking logic (same aggregateScore, different createdAt)", async () => {
      const originalGetReviewSummations = helper.getReviewSummations;
      helper.getReviewSummations = async () => [
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 90.0,
          submitterId: "12345678",
          submitterHandle: "thomaskranitsas",
          createdAt: "2024-04-01T09:00:00.000Z",
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 90.0,
          submitterId: "9876543",
          submitterHandle: "tonyj",
          createdAt: "2024-04-01T12:00:00.000Z",
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 80.5,
          submitterId: "3456789",
          submitterHandle: "nathanael",
          createdAt: "2024-04-01T13:00:00.000Z",
        },
      ];
      originalReviewSummations = originalGetReviewSummations;

      const originalGetChallengeResources = helper.getChallengeResources;
      helper.getChallengeResources = async () => [
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 12345678, memberHandle: "thomaskranitsas" },
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 9876543, memberHandle: "tonyj" },
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 3456789, memberHandle: "nathanael" },
      ];
      originalChallengeResources = originalGetChallengeResources;

      const result = await service.closeMarathonMatch(adminUser, data.marathonMatchChallenge.id);

      should.exist(result);
      should.equal(result.winners.length, 3);
      should.equal(result.winners[0].userId, 12345678);
      should.equal(result.winners[0].placement, 1);
      should.equal(result.winners[1].userId, 9876543);
      should.equal(result.winners[1].placement, 2);
      should.equal(result.winners[2].userId, 3456789);
      should.equal(result.winners[2].placement, 3);
    });

    it("close marathon match - non-Marathon Match challenge type", async () => {
      try {
        await service.closeMarathonMatch(adminUser, data.challenge.id);
      } catch (e) {
        should.equal(e.name, "BadRequestError");
        should.equal(e.message.indexOf("is not a Marathon Match challenge") >= 0, true);
        return;
      }
      throw new Error("should not reach here");
    });

    it("close marathon match - forbidden for non-admin user", async () => {
      try {
        await service.closeMarathonMatch(nonAdminUser, data.marathonMatchChallenge.id);
      } catch (e) {
        should.equal(e.name, "ForbiddenError");
        should.equal(
          e.message.indexOf(
            "Admin role or an M2M token is required to close the marathon match.",
          ) >= 0,
          true,
        );
        return;
      }
      throw new Error("should not reach here");
    });

    it("close marathon match - challenge not found", async () => {
      try {
        await service.closeMarathonMatch(adminUser, notFoundId);
      } catch (e) {
        should.equal(e.name, "NotFoundError");
        should.equal(
          e.message.indexOf(`Challenge with id: ${notFoundId} doesn't exist`) >= 0,
          true,
        );
        return;
      }
      throw new Error("should not reach here");
    });

    it("close marathon match - missing submitter resources", async () => {
      const originalGetReviewSummations = helper.getReviewSummations;
      helper.getReviewSummations = async () => [
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 70.0,
          submitterId: "12345678",
          submitterHandle: "thomaskranitsas",
          createdAt: "2024-05-01T09:00:00.000Z",
        },
      ];
      originalReviewSummations = originalGetReviewSummations;

      const originalGetChallengeResources = helper.getChallengeResources;
      helper.getChallengeResources = async () => [];
      originalChallengeResources = originalGetChallengeResources;

      try {
        await service.closeMarathonMatch(adminUser, data.marathonMatchChallenge.id);
      } catch (e) {
        should.equal(e.name, "BadRequestError");
        should.equal(
          e.message.indexOf("Submitter resources are required to close Marathon Match challenge") >=
            0,
          true,
        );
        return;
      }
      throw new Error("should not reach here");
    });
  });
});
