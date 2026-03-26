/*
 * Unit tests for legacy-specific challenge type behavior.
 */

require("../../app-bootstrap");
const { v4: uuid } = require("uuid");
const chai = require("chai");

const service = require("../../src/services/ChallengeTypeService");
const prisma = require("../../src/common/prisma").getClient();

const should = chai.should();

describe("challenge type service legacy unit tests", () => {
  let originalFindMany;
  let originalCreate;

  beforeEach(() => {
    originalFindMany = prisma.challengeType.findMany;
    originalCreate = prisma.challengeType.create;
  });

  afterEach(() => {
    prisma.challengeType.findMany = originalFindMany;
    prisma.challengeType.create = originalCreate;
  });

  it("search challenge types hides legacy records by default", async () => {
    let receivedFilter;
    prisma.challengeType.findMany = async ({ where }) => {
      receivedFilter = where;
      return [];
    };

    const result = await service.searchChallengeTypes({
      page: 1,
      perPage: 10,
      name: "ARCHITECTURE",
    });

    should.equal(result.total, 0);
    should.equal(receivedFilter.isLegacy.equals, false);
  });

  it("search challenge types supports explicit legacy filter", async () => {
    let receivedFilter;
    prisma.challengeType.findMany = async ({ where }) => {
      receivedFilter = where;
      return [];
    };

    const result = await service.searchChallengeTypes({
      page: 1,
      perPage: 10,
      isLegacy: true,
    });

    should.equal(result.total, 0);
    should.equal(receivedFilter.isLegacy.equals, true);
  });

  it("create challenge type accepts legacy metadata", async () => {
    let createdPayload;
    prisma.challengeType.findMany = async () => [];
    prisma.challengeType.create = async ({ data }) => {
      createdPayload = data;
      return {
        id: uuid(),
        name: data.name,
        description: data.description || null,
        isActive: data.isActive,
        isTask: data.isTask || false,
        abbreviation: data.abbreviation,
        legacyId: data.legacyId || null,
        isLegacy: data.isLegacy || false,
        createdAt: new Date(),
        createdBy: data.createdBy,
        updatedAt: new Date(),
        updatedBy: data.updatedBy,
      };
    };

    const result = await service.createChallengeType(
      { userId: "test-user" },
      {
        name: `legacy-type-${Date.now()}`,
        description: "Legacy historical subtype",
        isActive: true,
        abbreviation: `lg-${Date.now()}`,
        legacyId: 150,
        isLegacy: true,
      },
    );

    should.equal(createdPayload.legacyId, 150);
    should.equal(createdPayload.isLegacy, true);
    should.equal(result.legacyId, 150);
    should.equal(result.isLegacy, true);
  });
});
