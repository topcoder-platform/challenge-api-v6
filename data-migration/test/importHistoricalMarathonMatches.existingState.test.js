const {
  buildExistingStateByRoundId,
} = require("../src/scripts/importHistoricalMarathonMatches/existingState");

describe("importHistoricalMarathonMatches existing v6 state discovery", () => {
  test("does not use snapshot-only challenge ids as authoritative reuse matches", async () => {
    const snapshotByRoundId = new Map([
      [
        "9892",
        {
          legacyRoundId: "9892",
          challengeId: "snapshot-challenge",
          existing: {
            phases: 3,
            resources: 2,
            submissions: 3,
            finalScores: 2,
            provisionalScores: 3,
          },
        },
      ],
    ]);

    const existingStateByRoundId = await buildExistingStateByRoundId({
      prisma: null,
      roundIds: ["9892"],
      marathonTypeId: "type-mm",
      dataScienceTrackId: "track-ds",
      snapshotByRoundId,
    });

    expect(existingStateByRoundId.get("9892")).toEqual({
      legacyRoundId: "9892",
      matchStatus: "none",
      reason: "no-matching-v6-challenge-found",
      challengeId: null,
      existing: {
        phases: 0,
        resources: 0,
        submissions: 0,
        finalScores: 0,
        provisionalScores: 0,
      },
    });
  });

  test("returns safe match for a unique MM/DS challenge and merges phase + snapshot counts", async () => {
    const prisma = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "challenge-1",
            legacyId: 9892,
            typeId: "type-mm",
            trackId: "track-ds",
          },
        ]),
      },
      challengePhase: {
        findMany: jest.fn().mockResolvedValue([
          { challengeId: "challenge-1", name: "Registration" },
          { challengeId: "challenge-1", name: "Submission" },
        ]),
      },
    };

    const existingStateByRoundId = await buildExistingStateByRoundId({
      prisma,
      roundIds: ["9892"],
      marathonTypeId: "type-mm",
      dataScienceTrackId: "track-ds",
      snapshotByRoundId: new Map([
        [
          "9892",
          {
            challengeId: "challenge-1",
            existing: {
              resources: 2,
              submissions: 3,
              finalScores: 2,
              provisionalScores: 3,
            },
          },
        ],
      ]),
    });

    expect(existingStateByRoundId.get("9892")).toEqual({
      legacyRoundId: "9892",
      matchStatus: "safe",
      reason: "existing-v6-challenge-found",
      challengeId: "challenge-1",
      existing: {
        phases: 2,
        resources: 2,
        submissions: 3,
        finalScores: 2,
        provisionalScores: 3,
      },
    });
  });

  test("prefers authoritative linked-record discovery counts over snapshot hints", async () => {
    const prisma = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "challenge-1",
            legacyId: 9892,
            typeId: "type-mm",
            trackId: "track-ds",
          },
        ]),
      },
      challengePhase: {
        findMany: jest.fn().mockResolvedValue([
          { challengeId: "challenge-1", name: "Registration" },
          { challengeId: "challenge-1", name: "Submission" },
          { challengeId: "challenge-1", name: "Review" },
        ]),
      },
    };

    const existingStateByRoundId = await buildExistingStateByRoundId({
      prisma,
      roundIds: ["9892"],
      marathonTypeId: "type-mm",
      dataScienceTrackId: "track-ds",
      snapshotByRoundId: new Map([
        [
          "9892",
          {
            challengeId: "challenge-1",
            existing: {
              resources: 1,
              submissions: 2,
              finalScores: 3,
              provisionalScores: 4,
            },
          },
        ],
      ]),
      resolveLinkedCountsByChallengeId: async () =>
        new Map([
          [
            "challenge-1",
            {
              resources: 8,
              submissions: 9,
              finalScores: 5,
              provisionalScores: 11,
            },
          ],
        ]),
    });

    expect(existingStateByRoundId.get("9892")).toEqual({
      legacyRoundId: "9892",
      matchStatus: "safe",
      reason: "existing-v6-challenge-found",
      challengeId: "challenge-1",
      existing: {
        phases: 3,
        resources: 8,
        submissions: 9,
        finalScores: 5,
        provisionalScores: 11,
      },
    });
  });

  test("marks duplicate legacy matches as ambiguous", async () => {
    const prisma = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([
          { id: "challenge-1", legacyId: 9892, typeId: "type-mm", trackId: "track-ds" },
          { id: "challenge-2", legacyId: 9892, typeId: "type-mm", trackId: "track-ds" },
        ]),
      },
      challengePhase: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const existingStateByRoundId = await buildExistingStateByRoundId({
      prisma,
      roundIds: ["9892"],
      marathonTypeId: "type-mm",
      dataScienceTrackId: "track-ds",
      snapshotByRoundId: new Map(),
    });

    expect(existingStateByRoundId.get("9892").matchStatus).toBe("ambiguous");
    expect(existingStateByRoundId.get("9892").reason).toBe("existing-v6-challenge-match-ambiguous");
  });

  test("marks non-MM/DS challenge matches as unsafe", async () => {
    const prisma = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([
          { id: "challenge-1", legacyId: 9892, typeId: "type-dev", trackId: "track-dev" },
        ]),
      },
      challengePhase: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const existingStateByRoundId = await buildExistingStateByRoundId({
      prisma,
      roundIds: ["9892"],
      marathonTypeId: "type-mm",
      dataScienceTrackId: "track-ds",
      snapshotByRoundId: new Map(),
    });

    expect(existingStateByRoundId.get("9892").matchStatus).toBe("unsafe");
    expect(existingStateByRoundId.get("9892").reason).toBe(
      "matched-v6-challenge-not-marathon-match-data-science"
    );
  });

  test("marks duplicate standard phase rows as unsafe", async () => {
    const prisma = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([
          { id: "challenge-1", legacyId: 9892, typeId: "type-mm", trackId: "track-ds" },
        ]),
      },
      challengePhase: {
        findMany: jest.fn().mockResolvedValue([
          { challengeId: "challenge-1", name: "Registration" },
          { challengeId: "challenge-1", name: "Submission" },
          { challengeId: "challenge-1", name: "Submission" },
        ]),
      },
    };

    const existingStateByRoundId = await buildExistingStateByRoundId({
      prisma,
      roundIds: ["9892"],
      marathonTypeId: "type-mm",
      dataScienceTrackId: "track-ds",
      snapshotByRoundId: new Map(),
    });

    expect(existingStateByRoundId.get("9892").matchStatus).toBe("unsafe");
    expect(existingStateByRoundId.get("9892").reason).toBe(
      "matched-v6-challenge-has-duplicate-standard-phases"
    );
  });
});
