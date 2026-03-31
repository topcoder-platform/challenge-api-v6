const {
  derivePhaseWindows,
  buildChallengePhaseRows,
  applyCreateRound,
} = require("../src/scripts/importHistoricalMarathonMatches/apply");

describe("importHistoricalMarathonMatches apply create-path behavior", () => {
  test("derives coherent closed MM phase windows from legacy activity", () => {
    const windows = derivePhaseWindows("9892", {
      registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
      registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
      earliestSubmissionOpenMs: Date.parse("2020-01-01T01:00:00.000Z"),
      earliestNonExampleSubmitMs: Date.parse("2020-01-01T02:00:00.000Z"),
      latestNonExampleSubmitMs: Date.parse("2020-01-02T00:00:00.000Z"),
    });

    expect(windows.registration.startDate.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(windows.registration.endDate.toISOString()).toBe("2020-01-01T12:00:00.000Z");
    expect(windows.submission.startDate.toISOString()).toBe("2020-01-01T01:00:00.000Z");
    expect(windows.submission.endDate.toISOString()).toBe("2020-01-02T00:00:00.000Z");
    expect(windows.review.startDate.toISOString()).toBe("2020-01-02T00:00:00.000Z");
    expect(windows.review.endDate.toISOString()).toBe("2020-01-02T00:00:00.000Z");
  });

  test("falls back to earliest non-example submit when open_time is missing", () => {
    const windows = derivePhaseWindows("9892", {
      registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
      registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
      earliestSubmissionOpenMs: null,
      earliestNonExampleSubmitMs: Date.parse("2020-01-01T02:00:00.000Z"),
      latestNonExampleSubmitMs: Date.parse("2020-01-02T00:00:00.000Z"),
    });

    expect(windows.submission.startDate.toISOString()).toBe("2020-01-01T02:00:00.000Z");
  });

  test("phase row builder materializes exactly one closed Registration/Submission/Review trio", () => {
    const windows = derivePhaseWindows("9892", {
      registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
      registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
      earliestSubmissionOpenMs: Date.parse("2020-01-01T01:00:00.000Z"),
      earliestNonExampleSubmitMs: Date.parse("2020-01-01T02:00:00.000Z"),
      latestNonExampleSubmitMs: Date.parse("2020-01-02T00:00:00.000Z"),
    });

    const rows = buildChallengePhaseRows({
      challengeId: "challenge-1",
      actor: "importer",
      phaseIdsByName: {
        Registration: "phase-registration",
        Submission: "phase-submission",
        Review: "phase-review",
      },
      windows,
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.name)).toEqual(["Registration", "Submission", "Review"]);
    rows.forEach((row) => {
      expect(row.isOpen).toBe(false);
      expect(row.actualStartDate).toBeInstanceOf(Date);
      expect(row.actualEndDate).toBeInstanceOf(Date);
      expect(row.actualEndDate.getTime()).toBeGreaterThanOrEqual(row.actualStartDate.getTime());
    });
  });

  test("apply create-path inserts one completed challenge and phase trio for missing rounds", async () => {
    const calls = { createdChallenge: null, createdPhases: null };
    const tx = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }) => {
          calls.createdChallenge = data;
          return { id: "challenge-1" };
        }),
      },
      challengePhase: {
        createMany: jest.fn().mockImplementation(async ({ data }) => {
          calls.createdPhases = data;
          return { count: data.length };
        }),
      },
    };

    const prisma = {
      $transaction: async (callback) => callback(tx),
    };

    const result = await applyCreateRound({
      prisma,
      roundId: "9892",
      round: { round_id: "9892", name: "Intel Multi-Threading Competition 2", short_name: "Intel 2" },
      counters: {
        registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
        registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
        earliestSubmissionOpenMs: Date.parse("2020-01-01T01:00:00.000Z"),
        earliestNonExampleSubmitMs: Date.parse("2020-01-01T02:00:00.000Z"),
        latestNonExampleSubmitMs: Date.parse("2020-01-02T00:00:00.000Z"),
        eligibleRegistrants: new Set(["1", "2"]),
        nonExampleSubmissions: 3,
      },
      actor: "importer",
      marathonTypeId: "type-mm",
      dataScienceTrackId: "track-ds",
      timelineTemplateId: "timeline-mm",
      phaseIdsByName: {
        Registration: "phase-registration",
        Submission: "phase-submission",
        Review: "phase-review",
      },
    });

    expect(result).toEqual({
      status: "created",
      challengeId: "challenge-1",
      legacyRoundId: "9892",
    });
    expect(calls.createdChallenge).toMatchObject({
      legacyId: 9892,
      typeId: "type-mm",
      trackId: "track-ds",
      timelineTemplateId: "timeline-mm",
      status: "COMPLETED",
      currentPhaseNames: [],
      numOfRegistrants: 2,
      numOfSubmissions: 3,
    });
    expect(calls.createdPhases).toHaveLength(3);
    expect(calls.createdPhases.map((row) => row.name)).toEqual([
      "Registration",
      "Submission",
      "Review",
    ]);
  });

  test("apply create-path is idempotent when challenge already exists", async () => {
    const tx = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([{ id: "existing-challenge-1" }]),
        create: jest.fn(),
      },
      challengePhase: {
        createMany: jest.fn(),
      },
    };
    const prisma = {
      $transaction: async (callback) => callback(tx),
    };

    const result = await applyCreateRound({
      prisma,
      roundId: "9892",
      round: { round_id: "9892" },
      counters: {
        registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
        registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
        earliestSubmissionOpenMs: Date.parse("2020-01-01T01:00:00.000Z"),
        earliestNonExampleSubmitMs: Date.parse("2020-01-01T02:00:00.000Z"),
        latestNonExampleSubmitMs: Date.parse("2020-01-02T00:00:00.000Z"),
        eligibleRegistrants: new Set(["1", "2"]),
        nonExampleSubmissions: 3,
      },
      actor: "importer",
      marathonTypeId: "type-mm",
      dataScienceTrackId: "track-ds",
      timelineTemplateId: "timeline-mm",
      phaseIdsByName: {
        Registration: "phase-registration",
        Submission: "phase-submission",
        Review: "phase-review",
      },
    });

    expect(result).toEqual({
      status: "existing",
      challengeId: "existing-challenge-1",
      legacyRoundId: "9892",
    });
    expect(tx.challenge.create).not.toHaveBeenCalled();
    expect(tx.challengePhase.createMany).not.toHaveBeenCalled();
  });
});
