const {
  createLinkedRecordCountResolver,
} = require("../src/scripts/importHistoricalMarathonMatches/linkedCounts");

describe("importHistoricalMarathonMatches linked-record count discovery", () => {
  test("resolves resource/submission/final/provisional counts per challenge", async () => {
    const resourceClient = {
      listSubmitterResources: jest.fn().mockResolvedValue([
        { memberId: "1", roleId: "submitter-role" },
        { memberId: "2", roleId: "submitter-role" },
        { memberId: "2", roleId: "submitter-role" },
      ]),
    };
    const reviewClient = {
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValueOnce([
          { tableName: "submission", columnName: "challengeId" },
          { tableName: "submission", columnName: "id" },
          { tableName: "submission", columnName: "legacySubmissionId" },
          { tableName: "submission", columnName: "isExample" },
          { tableName: "reviewSummation", columnName: "submissionId" },
          { tableName: "reviewSummation", columnName: "isFinal" },
          { tableName: "reviewSummation", columnName: "isExample" },
        ])
        .mockResolvedValueOnce([{ count: "7" }])
        .mockResolvedValueOnce([{ count: "3" }])
        .mockResolvedValueOnce([{ count: "4" }]),
    };

    const resolveLinkedCountsByChallengeId = await createLinkedRecordCountResolver({
      resourceClient,
      reviewClient,
      reviewSchema: "reviews",
      submitterRoleId: "submitter-role",
    });

    const countsByChallengeId = await resolveLinkedCountsByChallengeId({
      challengeIds: ["challenge-1"],
    });

    expect(resourceClient.listSubmitterResources).toHaveBeenCalledWith(
      "challenge-1",
      "submitter-role"
    );
    expect(countsByChallengeId.get("challenge-1")).toEqual({
      resources: 2,
      submissions: 7,
      finalScores: 3,
      provisionalScores: 4,
    });
  });

  test("returns empty counts when no discovery clients are provided", async () => {
    const resolveLinkedCountsByChallengeId = await createLinkedRecordCountResolver({});
    const countsByChallengeId = await resolveLinkedCountsByChallengeId({
      challengeIds: ["challenge-1"],
    });

    expect(countsByChallengeId.get("challenge-1")).toEqual({});
  });
});
