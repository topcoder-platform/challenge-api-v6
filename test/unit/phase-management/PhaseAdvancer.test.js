const { expect } = require("chai");

const PhaseAdvancer = require("../../../src/phase-management/PhaseAdvancer");
const { getClient } = require("../../../src/common/prisma");
const reviewPrisma = require("../../../src/common/review-prisma");

const buildIterativeReviewPhase = () => ({
  id: "phase-iterative-review",
  phaseId: "003a4b14-de5d-43fc-9e35-835dbeb6af1f",
  name: "Iterative Review",
  description: "Iterative review phase",
  duration: 86400,
  isOpen: false,
  predecessor: "submission-phase-id",
  scheduledStartDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  scheduledEndDate: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
  actualStartDate: null,
  actualEndDate: null,
  constraints: [],
});

describe("PhaseAdvancer Iterative Review gating", () => {
  const prisma = getClient();
  const originalFindUnique = prisma.challenge.findUnique;

  afterEach(() => {
    prisma.challenge.findUnique = originalFindUnique;
  });

  it("fails to open iterative review when no submissions exist", async () => {
    const challengeDomain = {
      async getPhaseFacts() {
        return {
          factResponses: [
            {
              response: {
                submissionCount: 0,
                reviewCount: 0,
              },
            },
          ],
        };
      },
    };
    const phaseAdvancer = new PhaseAdvancer(challengeDomain);
    const phases = [buildIterativeReviewPhase()];

    prisma.challenge.findUnique = async () => ({ numOfSubmissions: 0 });

    const result = await phaseAdvancer.advancePhase(
      "challenge-123",
      null,
      phases,
      "open",
      "Iterative Review"
    );

    expect(result.success).to.be.false;
    expect(result.failureReasons).to.be.an("array").that.is.not.empty;
    expect(phases[0].isOpen).to.be.false;
  });

  it("opens iterative review once submissions are present", async () => {
    const challengeDomain = {
      async getPhaseFacts() {
        return {
          factResponses: [
            {
              response: {
                submissionCount: 1,
                reviewCount: 0,
              },
            },
          ],
        };
      },
    };
    const phaseAdvancer = new PhaseAdvancer(challengeDomain);
    const phases = [buildIterativeReviewPhase()];

    prisma.challenge.findUnique = async () => ({ numOfSubmissions: 1 });

    const result = await phaseAdvancer.advancePhase(
      "challenge-123",
      null,
      phases,
      "open",
      "Iterative Review"
    );

    expect(result.success).to.be.true;
    expect(phases[0].isOpen).to.be.true;
  });
});

describe("PhaseAdvancer review completion queries", () => {
  const prisma = getClient();
  const originalFindUnique = prisma.challenge.findUnique;
  const originalGetReviewClient = reviewPrisma.getReviewClient;
  const phaseAdvancerPath = require.resolve("../../../src/phase-management/PhaseAdvancer");

  afterEach(() => {
    prisma.challenge.findUnique = originalFindUnique;
    reviewPrisma.getReviewClient = originalGetReviewClient;
    delete require.cache[phaseAdvancerPath];
  });

  it("casts review status to text before comparing completed reviews", async () => {
    const capturedQueries = [];

    reviewPrisma.getReviewClient = () => ({
      $queryRaw: async (query) => {
        capturedQueries.push(query);
        return [{ count: 2 }];
      },
    });

    delete require.cache[phaseAdvancerPath];
    const PhaseAdvancerWithMockedReviewClient = require("../../../src/phase-management/PhaseAdvancer");
    const phaseAdvancer = new PhaseAdvancerWithMockedReviewClient({
      async getPhaseFacts() {
        return {};
      },
    });

    prisma.challenge.findUnique = async () => ({
      numOfSubmissions: 1,
      reviewers: [{ isMemberReview: true, memberReviewerCount: 2 }],
    });

    const phases = [
      {
        id: "phase-review",
        phaseId: "phase-review",
        name: "Review",
        description: "Review phase",
        duration: 86400,
        isOpen: true,
        predecessor: null,
        scheduledStartDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        scheduledEndDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        actualStartDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        actualEndDate: null,
        constraints: [],
      },
    ];

    const result = await phaseAdvancer.advancePhase(
      "challenge-123",
      null,
      phases,
      "close",
      "Review"
    );
    const [reviewCompletionQuery] = capturedQueries;
    const queryText = [
      reviewCompletionQuery.sql,
      reviewCompletionQuery.text,
      reviewCompletionQuery.statement,
      Array.isArray(reviewCompletionQuery.strings)
        ? reviewCompletionQuery.strings.join("?")
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    expect(result.success).to.be.true;
    expect(queryText).to.contain('r."status"::text =');
    expect(reviewCompletionQuery.values).to.include("COMPLETED");
  });
});
