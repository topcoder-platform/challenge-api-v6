const {
  derivePhaseWindows,
  buildChallengePhaseRows,
  applyCreateRound,
  reconcileSubmitterResourcesForRound,
  runApplyMode,
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
    const calls = { createdPhases: null };
    const tx = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([
          { id: "existing-challenge-1", typeId: "type-mm", trackId: "track-ds" },
        ]),
        create: jest.fn(),
      },
      challengePhase: {
        findMany: jest.fn().mockResolvedValue([
          { id: "cp-1", name: "Registration", isOpen: false },
          { id: "cp-2", name: "Submission", isOpen: false },
        ]),
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
    expect(calls.createdPhases).toHaveLength(1);
    expect(calls.createdPhases[0].name).toBe("Review");
  });

  test("reuse path is idempotent when all standard phases already exist", async () => {
    const tx = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([
          { id: "existing-challenge-1", typeId: "type-mm", trackId: "track-ds" },
        ]),
        create: jest.fn(),
      },
      challengePhase: {
        findMany: jest.fn().mockResolvedValue([
          { id: "cp-1", name: "Registration", isOpen: false },
          { id: "cp-2", name: "Submission", isOpen: false },
          { id: "cp-3", name: "Review", isOpen: false },
        ]),
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

  test("apply-mode reruns converge create decisions by backfilling missing standard phases", async () => {
    const tx = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([
          { id: "existing-challenge-1", typeId: "type-mm", trackId: "track-ds" },
        ]),
        create: jest.fn(),
      },
      challengePhase: {
        findMany: jest.fn().mockResolvedValue([
          { id: "cp-1", name: "Registration", isOpen: false },
          { id: "cp-2", name: "Submission", isOpen: false },
        ]),
        createMany: jest.fn(),
      },
    };

    const phaseRows = [
      { id: "phase-registration", name: "Registration" },
      { id: "phase-submission", name: "Submission" },
      { id: "phase-review", name: "Review" },
    ];

    const prisma = {
      challengeType: {
        findMany: jest.fn().mockResolvedValue([{ id: "type-mm" }]),
      },
      challengeTrack: {
        findMany: jest.fn().mockResolvedValue([{ id: "track-ds" }]),
      },
      phase: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(phaseRows)
          .mockResolvedValueOnce(phaseRows),
      },
      challengeTimelineTemplate: {
        findMany: jest.fn().mockResolvedValue([
          {
            timelineTemplateId: "timeline-mm",
            isDefault: true,
            timelineTemplate: {
              phases: [
                { phaseId: "phase-registration" },
                { phaseId: "phase-submission" },
                { phaseId: "phase-review" },
              ],
            },
          },
        ]),
      },
      $transaction: async (callback) => callback(tx),
    };

    const result = await runApplyMode({
      prisma,
      options: {
        roundIds: ["9892"],
        resourceClient: {
          listSubmitterResources: jest.fn().mockResolvedValue([]),
          createSubmitterResource: jest.fn().mockResolvedValue({}),
        },
      },
      plan: {
        records: [
          {
            legacyRoundId: "9892",
            decision: "create",
            reason: "no-matching-v6-challenge-found",
          },
        ],
        roundDataById: new Map([
          [
            "9892",
            {
              round: { round_id: "9892", round_type_id: "13" },
              registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
              registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
              earliestSubmissionOpenMs: Date.parse("2020-01-01T01:00:00.000Z"),
              earliestNonExampleSubmitMs: Date.parse("2020-01-01T02:00:00.000Z"),
              latestNonExampleSubmitMs: Date.parse("2020-01-02T00:00:00.000Z"),
              eligibleRegistrants: new Set(["1", "2"]),
              nonExampleSubmissions: 3,
            },
          ],
        ]),
      },
      actor: "importer",
      normalizedIdentityByCoderId: new Map([
        ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
        ["2", { coderId: "2", memberId: 2, memberHandle: "bravo" }],
      ]),
    });

    expect(result.records).toEqual([
      {
        recordType: "apply-record",
        legacyRoundId: "9892",
        status: "existing",
        challengeId: "existing-challenge-1",
        resourceReconciliation: {
          targetEligibleRegistrants: 2,
          existingSubmitterResources: 0,
          createdSubmitterResources: 2,
          unchangedSubmitterResources: 0,
        },
      },
    ]);
    expect(tx.challenge.create).not.toHaveBeenCalled();
    expect(tx.challengePhase.createMany).toHaveBeenCalledTimes(1);
    expect(tx.challengePhase.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ name: "Review", challengeId: "existing-challenge-1" })],
    });
  });

  test("reuse path rejects non-MM/DS challenge shape", async () => {
    const tx = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([
          { id: "existing-challenge-1", typeId: "type-dev", trackId: "track-dev" },
        ]),
        create: jest.fn(),
      },
      challengePhase: {
        findMany: jest.fn(),
        createMany: jest.fn(),
      },
    };
    const prisma = {
      $transaction: async (callback) => callback(tx),
    };

    await expect(
      applyCreateRound({
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
      })
    ).rejects.toThrow("cannot be reused because it is not Marathon Match / Data Science");
    expect(tx.challenge.create).not.toHaveBeenCalled();
    expect(tx.challengePhase.createMany).not.toHaveBeenCalled();
  });

  test("reuse path rejects ambiguous duplicate legacy challenge matches", async () => {
    const tx = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([
          { id: "existing-challenge-1", typeId: "type-mm", trackId: "track-ds" },
          { id: "existing-challenge-2", typeId: "type-mm", trackId: "track-ds" },
        ]),
        create: jest.fn(),
      },
      challengePhase: {
        findMany: jest.fn(),
        createMany: jest.fn(),
      },
    };
    const prisma = {
      $transaction: async (callback) => callback(tx),
    };

    await expect(
      applyCreateRound({
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
      })
    ).rejects.toThrow("multiple existing v6 challenges");
    expect(tx.challenge.create).not.toHaveBeenCalled();
    expect(tx.challengePhase.createMany).not.toHaveBeenCalled();
  });

  test("reuse path rejects duplicate standard phase rows", async () => {
    const tx = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([
          { id: "existing-challenge-1", typeId: "type-mm", trackId: "track-ds" },
        ]),
        create: jest.fn(),
      },
      challengePhase: {
        findMany: jest.fn().mockResolvedValue([
          { id: "cp-1", name: "Registration", isOpen: false },
          { id: "cp-2", name: "Submission", isOpen: false },
          { id: "cp-3", name: "Submission", isOpen: false },
        ]),
        createMany: jest.fn(),
      },
    };
    const prisma = {
      $transaction: async (callback) => callback(tx),
    };

    await expect(
      applyCreateRound({
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
      })
    ).rejects.toThrow('duplicate "Submission" phase rows');
    expect(tx.challenge.create).not.toHaveBeenCalled();
    expect(tx.challengePhase.createMany).not.toHaveBeenCalled();
  });

  test("apply mode skips unresolved planned rounds instead of creating challenges", async () => {
    const tx = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      challengePhase: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
      },
    };

    const phaseRows = [
      { id: "phase-registration", name: "Registration" },
      { id: "phase-submission", name: "Submission" },
      { id: "phase-review", name: "Review" },
    ];

    const prisma = {
      challengeType: {
        findMany: jest.fn().mockResolvedValue([{ id: "type-mm" }]),
      },
      challengeTrack: {
        findMany: jest.fn().mockResolvedValue([{ id: "track-ds" }]),
      },
      phase: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(phaseRows)
          .mockResolvedValueOnce(phaseRows),
      },
      challengeTimelineTemplate: {
        findMany: jest.fn().mockResolvedValue([
          {
            timelineTemplateId: "timeline-mm",
            isDefault: true,
            timelineTemplate: {
              phases: [
                { phaseId: "phase-registration" },
                { phaseId: "phase-submission" },
                { phaseId: "phase-review" },
              ],
            },
          },
        ]),
      },
      $transaction: async (callback) => callback(tx),
    };

    const result = await runApplyMode({
      prisma,
      options: { roundIds: ["7000"] },
      plan: {
        records: [
          {
            legacyRoundId: "7000",
            decision: "unresolved",
            reason: "selected-round-round-type-is-not-marathon-match",
          },
        ],
        roundDataById: new Map([
          [
            "7000",
            {
              round: { round_id: "7000", round_type_id: "1" },
              registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
              registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
              earliestSubmissionOpenMs: Date.parse("2020-01-01T01:00:00.000Z"),
              earliestNonExampleSubmitMs: Date.parse("2020-01-01T02:00:00.000Z"),
              latestNonExampleSubmitMs: Date.parse("2020-01-02T00:00:00.000Z"),
              eligibleRegistrants: new Set(["1", "2"]),
              nonExampleSubmissions: 3,
            },
          ],
        ]),
      },
      actor: "importer",
    });

    expect(result.records).toEqual([
      {
        recordType: "apply-record",
        legacyRoundId: "7000",
        status: "unresolved",
        reason: "selected-round-round-type-is-not-marathon-match",
      },
    ]);
    expect(result.summary).toEqual({
      recordType: "apply-summary",
      created: 0,
      existing: 0,
      unmatched: 0,
      unresolved: 1,
      errors: 0,
    });
    expect(tx.challenge.create).not.toHaveBeenCalled();
    expect(tx.challengePhase.createMany).not.toHaveBeenCalled();
  });

  test("apply mode reconciles submitter resources from eligible registrations", async () => {
    const tx = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "challenge-1" }),
      },
      challengePhase: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
      },
    };

    const phaseRows = [
      { id: "phase-registration", name: "Registration" },
      { id: "phase-submission", name: "Submission" },
      { id: "phase-review", name: "Review" },
    ];

    const prisma = {
      challengeType: {
        findMany: jest.fn().mockResolvedValue([{ id: "type-mm" }]),
      },
      challengeTrack: {
        findMany: jest.fn().mockResolvedValue([{ id: "track-ds" }]),
      },
      phase: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(phaseRows)
          .mockResolvedValueOnce(phaseRows),
      },
      challengeTimelineTemplate: {
        findMany: jest.fn().mockResolvedValue([
          {
            timelineTemplateId: "timeline-mm",
            isDefault: true,
            timelineTemplate: {
              phases: [
                { phaseId: "phase-registration" },
                { phaseId: "phase-submission" },
                { phaseId: "phase-review" },
              ],
            },
          },
        ]),
      },
      $transaction: async (callback) => callback(tx),
    };

    const resourceClient = {
      listSubmitterResources: jest.fn().mockResolvedValue([
        { id: "resource-existing", challengeId: "challenge-1", roleId: "submitter-role", memberId: 1 },
      ]),
      createSubmitterResource: jest.fn().mockResolvedValue({}),
    };

    const result = await runApplyMode({
      prisma,
      options: {
        roundIds: ["9892"],
        resourceClient,
        submitterRoleId: "submitter-role",
      },
      plan: {
        records: [
          {
            legacyRoundId: "9892",
            decision: "create",
            reason: "no-matching-v6-challenge-found",
          },
        ],
        roundDataById: new Map([
          [
            "9892",
            {
              round: { round_id: "9892", round_type_id: "13" },
              registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
              registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
              earliestSubmissionOpenMs: Date.parse("2020-01-01T01:00:00.000Z"),
              earliestNonExampleSubmitMs: Date.parse("2020-01-01T02:00:00.000Z"),
              latestNonExampleSubmitMs: Date.parse("2020-01-02T00:00:00.000Z"),
              eligibleRegistrants: new Set(["1", "2", "2", "3"]),
              nonExampleSubmissions: 3,
            },
          ],
        ]),
      },
      actor: "importer",
      normalizedIdentityByCoderId: new Map([
        ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
        ["2", { coderId: "2", memberId: 2, memberHandle: "bravo" }],
        ["3", { coderId: "3", memberId: 3, memberHandle: "charlie" }],
      ]),
    });

    expect(resourceClient.listSubmitterResources).toHaveBeenCalledWith(
      "challenge-1",
      "submitter-role"
    );
    expect(resourceClient.createSubmitterResource).toHaveBeenCalledTimes(2);
    expect(resourceClient.createSubmitterResource).toHaveBeenCalledWith({
      challengeId: "challenge-1",
      memberId: "2",
      roleId: "submitter-role",
    });
    expect(resourceClient.createSubmitterResource).toHaveBeenCalledWith({
      challengeId: "challenge-1",
      memberId: "3",
      roleId: "submitter-role",
    });
    expect(result.records).toEqual([
      {
        recordType: "apply-record",
        legacyRoundId: "9892",
        status: "created",
        challengeId: "challenge-1",
        resourceReconciliation: {
          targetEligibleRegistrants: 3,
          existingSubmitterResources: 1,
          createdSubmitterResources: 2,
          unchangedSubmitterResources: 1,
        },
      },
    ]);
  });

  test("resource reconciliation temporarily transitions COMPLETED challenges and restores status on retry success", async () => {
    const completedRestrictionError = new Error(
      "Failed to create submitter resource for challenge challenge-1 member 2 (400 Bad Request): challenge is completed."
    );
    completedRestrictionError.httpStatus = 400;

    const resourceClient = {
      listSubmitterResources: jest.fn().mockResolvedValue([]),
      createSubmitterResource: jest
        .fn()
        .mockRejectedValueOnce(completedRestrictionError)
        .mockResolvedValueOnce({}),
    };

    const challengeStatusController = {
      getChallengeStatus: jest.fn().mockResolvedValue("COMPLETED"),
      updateChallengeStatus: jest.fn().mockResolvedValue({}),
    };

    const result = await reconcileSubmitterResourcesForRound({
      challengeId: "challenge-1",
      counters: {
        eligibleRegistrants: new Set(["2"]),
      },
      normalizedIdentityByCoderId: new Map([
        ["2", { coderId: "2", memberId: 2, memberHandle: "bravo" }],
      ]),
      resourceClient,
      submitterRoleId: "submitter-role",
      challengeStatusController,
    });

    expect(challengeStatusController.getChallengeStatus).toHaveBeenCalledWith("challenge-1");
    expect(challengeStatusController.updateChallengeStatus).toHaveBeenNthCalledWith(
      1,
      "challenge-1",
      "ACTIVE"
    );
    expect(challengeStatusController.updateChallengeStatus).toHaveBeenNthCalledWith(
      2,
      "challenge-1",
      "COMPLETED"
    );
    expect(resourceClient.createSubmitterResource).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      targetEligibleRegistrants: 1,
      existingSubmitterResources: 0,
      createdSubmitterResources: 1,
      unchangedSubmitterResources: 0,
      usedTemporaryStatusTransition: true,
      originalChallengeStatus: "COMPLETED",
      temporaryChallengeStatus: "ACTIVE",
    });
  });

  test("resource reconciliation restores original COMPLETED status when retry still fails", async () => {
    const completedRestrictionError = new Error(
      "Failed to create submitter resource for challenge challenge-1 member 2 (400 Bad Request): challenge is completed."
    );
    completedRestrictionError.httpStatus = 400;
    const secondFailure = new Error("Still rejected after temporary transition.");

    const resourceClient = {
      listSubmitterResources: jest.fn().mockResolvedValue([]),
      createSubmitterResource: jest
        .fn()
        .mockRejectedValueOnce(completedRestrictionError)
        .mockRejectedValueOnce(secondFailure),
    };

    const challengeStatusController = {
      getChallengeStatus: jest.fn().mockResolvedValue("COMPLETED"),
      updateChallengeStatus: jest.fn().mockResolvedValue({}),
    };

    await expect(
      reconcileSubmitterResourcesForRound({
        challengeId: "challenge-1",
        counters: {
          eligibleRegistrants: new Set(["2"]),
        },
        normalizedIdentityByCoderId: new Map([
          ["2", { coderId: "2", memberId: 2, memberHandle: "bravo" }],
        ]),
        resourceClient,
        submitterRoleId: "submitter-role",
        challengeStatusController,
      })
    ).rejects.toThrow("Still rejected after temporary transition.");

    expect(challengeStatusController.updateChallengeStatus).toHaveBeenNthCalledWith(
      1,
      "challenge-1",
      "ACTIVE"
    );
    expect(challengeStatusController.updateChallengeStatus).toHaveBeenNthCalledWith(
      2,
      "challenge-1",
      "COMPLETED"
    );
  });
});
