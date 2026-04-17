const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  derivePhaseWindows,
  buildChallengePhaseRows,
  applyCreateRound,
  reconcileSubmitterResourcesForRound,
  runApplyMode,
  runTargetedRerunMode,
} = require("../src/scripts/importHistoricalMarathonMatches/apply");

const buildSkippedFilePath = (suffix) =>
  path.join(
    os.tmpdir(),
    `mm-apply-skipped-${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );

const buildArchiveDirPath = (suffix) =>
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      `mm-targeted-archive-${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}-`
    )
  );

const writeJson = (baseDir, fileName, rootKey, rows) => {
  fs.writeFileSync(
    path.join(baseDir, fileName),
    `${JSON.stringify({ [rootKey]: rows }, null, 2)}\n`,
    "utf8"
  );
};

const createTargetedScoreFixtureDataDirectory = () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-targeted-score-fixture-"));

  writeJson(baseDir, "long_component_state_1.json", "long_component_state", [
    { long_component_state_id: "1001", round_id: "9892", coder_id: "1", points: "100.0" },
  ]);
  writeJson(baseDir, "long_comp_result_1.json", "long_comp_result", [
    { round_id: "9892", coder_id: "1", system_point_total: "100.0", point_total: "95.0", placed: "1" },
  ]);
  writeJson(baseDir, "long_submission_1.json", "long_submission", [
    {
      long_component_state_id: "1001",
      submission_number: "1",
      example: "0",
      submit_time: "1000",
      submission_points: "9.5",
    },
  ]);

  return baseDir;
};

const readSingleEntryStoredZip = (zipPath) => {
  const zipBuffer = fs.readFileSync(zipPath);
  expect(zipBuffer.readUInt32LE(0)).toBe(0x04034b50);
  const fileNameLength = zipBuffer.readUInt16LE(26);
  const extraFieldLength = zipBuffer.readUInt16LE(28);
  const compressedSize = zipBuffer.readUInt32LE(18);
  const localFileDataOffset = 30 + fileNameLength + extraFieldLength;
  const fileName = zipBuffer
    .slice(30, 30 + fileNameLength)
    .toString("utf8");
  const contents = zipBuffer
    .slice(localFileDataOffset, localFileDataOffset + compressedSize)
    .toString("utf8");

  const centralDirectoryOffset = localFileDataOffset + compressedSize;
  expect(zipBuffer.readUInt32LE(centralDirectoryOffset)).toBe(0x02014b50);
  const endRecordOffset = zipBuffer.length - 22;
  expect(zipBuffer.readUInt32LE(endRecordOffset)).toBe(0x06054b50);
  expect(zipBuffer.readUInt16LE(endRecordOffset + 8)).toBe(1);

  return { fileName, contents };
};

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
    const calls = {
      createdChallenge: null,
      createdPhases: null,
      createdMetadata: null,
    };
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
      challengeMetadata: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }) => {
          calls.createdMetadata = data;
          return { id: "metadata-1" };
        }),
      },
    };

    const prisma = {
      $transaction: async (callback) => callback(tx),
    };

    const result = await applyCreateRound({
      prisma,
      roundId: "9892",
      round: {
        round_id: "9892",
        name: "Intel Multi-Threading Competition 2",
        short_name: "Intel 2",
        rated_ind: "0",
      },
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
      description: "Imported historical Marathon Match from legacy round 9892",
      descriptionFormat: "markdown",
      status: "COMPLETED",
      currentPhaseNames: [],
      numOfRegistrants: 2,
      numOfSubmissions: 3,
    });
    expect(calls.createdMetadata).toEqual({
      challengeId: "challenge-1",
      name: "isRated",
      value: "false",
      createdBy: "importer",
      updatedBy: "importer",
    });
    expect(calls.createdPhases).toHaveLength(3);
    expect(calls.createdPhases.map((row) => row.name)).toEqual([
      "Registration",
      "Submission",
      "Review",
    ]);
  });

  test("apply create-path uses mapped raw legacy problem HTML when available", async () => {
    const calls = { createdChallenge: null };
    const tx = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }) => {
          calls.createdChallenge = data;
          return { id: "challenge-1" };
        }),
      },
      challengePhase: {
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };

    const prisma = {
      $transaction: async (callback) => callback(tx),
    };

    const rawProblemHtml = "<p><strong>Legacy</strong> description</p>";
    await applyCreateRound({
      prisma,
      roundId: "9892",
      round: { round_id: "9892", name: "MM 9892" },
      counters: {
        registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
        registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
        earliestSubmissionOpenMs: Date.parse("2020-01-01T01:00:00.000Z"),
        earliestNonExampleSubmitMs: Date.parse("2020-01-01T02:00:00.000Z"),
        latestNonExampleSubmitMs: Date.parse("2020-01-02T00:00:00.000Z"),
        eligibleRegistrants: new Set(["1", "2"]),
        nonExampleSubmissions: 3,
        descriptionProblemText: rawProblemHtml,
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

    expect(calls.createdChallenge.description).toBe(rawProblemHtml);
    expect(calls.createdChallenge.descriptionFormat).toBe("html");
  });

  test("apply create-path falls back to mapped component_text markdown when problem text is unusable", async () => {
    const calls = { createdChallenge: null };
    const tx = {
      challenge: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }) => {
          calls.createdChallenge = data;
          return { id: "challenge-1" };
        }),
      },
      challengePhase: {
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };

    const prisma = {
      $transaction: async (callback) => callback(tx),
    };

    const markdownFallback = "## Robot Routing\n\nPublic example only.";
    await applyCreateRound({
      prisma,
      roundId: "9892",
      round: { round_id: "9892", name: "MM 9892" },
      counters: {
        registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
        registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
        earliestSubmissionOpenMs: Date.parse("2020-01-01T01:00:00.000Z"),
        earliestNonExampleSubmitMs: Date.parse("2020-01-01T02:00:00.000Z"),
        latestNonExampleSubmitMs: Date.parse("2020-01-02T00:00:00.000Z"),
        eligibleRegistrants: new Set(["1", "2"]),
        nonExampleSubmissions: 3,
        descriptionProblemText: "   ",
        descriptionComponentTextMarkdown: markdownFallback,
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

    expect(calls.createdChallenge.description).toBe(markdownFallback);
    expect(calls.createdChallenge.descriptionFormat).toBe("markdown");
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

  test("reuse path canonicalizes legacy rating metadata into one isRated flag", async () => {
    const calls = {
      updatedMetadata: null,
      deletedMetadata: null,
    };
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
      challengeMetadata: {
        findMany: jest.fn().mockResolvedValue([
          { id: "metadata-rated", name: "rated", value: "true" },
          { id: "metadata-unrated", name: "unrated", value: "false" },
        ]),
        create: jest.fn(),
        update: jest.fn().mockImplementation(async ({ data }) => {
          calls.updatedMetadata = data;
          return { id: "metadata-rated" };
        }),
        deleteMany: jest.fn().mockImplementation(async ({ where }) => {
          calls.deletedMetadata = where;
          return { count: 1 };
        }),
      },
    };
    const prisma = {
      $transaction: async (callback) => callback(tx),
    };

    const result = await applyCreateRound({
      prisma,
      roundId: "9892",
      round: { round_id: "9892", rated_ind: "0" },
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
    expect(tx.challengeMetadata.create).not.toHaveBeenCalled();
    expect(calls.updatedMetadata).toEqual({
      name: "isRated",
      value: "false",
      updatedBy: "importer",
    });
    expect(calls.deletedMetadata).toEqual({
      id: {
        in: ["metadata-unrated"],
      },
    });
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
        skippedFilePath: buildSkippedFilePath("rerun-convergence"),
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
      options: {
        roundIds: ["7000"],
        skippedFilePath: buildSkippedFilePath("unresolved-round"),
      },
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
    expect(result.summary).toEqual(
      expect.objectContaining({
        recordType: "apply-summary",
        created: 0,
        existing: 0,
        unmatched: 0,
        unresolved: 1,
        errors: 0,
        skippedFileArtifact: {
          path: expect.stringContaining("mm-apply-skipped-unresolved-round-"),
          reasonCodes: [],
          recordCount: 0,
        },
      })
    );
    expect(tx.challenge.create).not.toHaveBeenCalled();
    expect(tx.challengePhase.createMany).not.toHaveBeenCalled();
  });

  test("targeted rerun mode fails closed when challenge-id override is missing", async () => {
    await expect(
      runTargetedRerunMode({
        options: {
          roundIds: ["9892"],
        },
        plan: {
          records: [
            {
              legacyRoundId: "9892",
              decision: "reuse/backfill-only",
              matchedChallengeId: "challenge-1",
            },
          ],
        },
      })
    ).rejects.toThrow("--targeted-rerun requires --challenge-id");
  });

  test("targeted rerun mode fails closed when challenge-id override mismatches selected round", async () => {
    await expect(
      runTargetedRerunMode({
        options: {
          roundIds: ["9892"],
          challengeId: "challenge-2",
        },
        plan: {
          records: [
            {
              legacyRoundId: "9892",
              decision: "reuse/backfill-only",
              matchedChallengeId: "challenge-1",
            },
          ],
        },
      })
    ).rejects.toThrow(
      'Targeted rerun challenge-id override "challenge-2" does not match selected round 9892 target challenge "challenge-1".'
    );
  });

  test("targeted rerun mode accepts matched rounds that are unresolved only because member resolution is unavailable", async () => {
    const archiveDir = buildArchiveDirPath("member-resolution-unavailable");
    try {
      const submissionArchiveStore = {
        listSubmissionsByLegacyId: jest.fn().mockResolvedValue(new Map()),
        updateSubmissionUrl: jest.fn().mockResolvedValue(undefined),
      };

      const result = await runTargetedRerunMode({
        options: {
          roundIds: ["9892"],
          challengeId: "challenge-1",
        },
        plan: {
          records: [
            {
              legacyRoundId: "9892",
              decision: "unresolved",
              reason: "target-member-resolution-unavailable",
              matchedChallengeId: "challenge-1",
            },
          ],
          roundDataById: new Map([["9892", {}]]),
        },
        submissionArchiveStore,
        submissionArchiveDir: archiveDir,
        legacySubmissionRowsByRoundId: new Map(),
      });

      expect(submissionArchiveStore.listSubmissionsByLegacyId).toHaveBeenCalledWith({
        challengeId: "challenge-1",
      });
      expect(result).toEqual({
        records: [
          {
            recordType: "apply-record",
            legacyRoundId: "9892",
            status: "targeted-rerun-preserved",
            challengeId: "challenge-1",
            mode: "targeted-rerun",
            writesAttempted: false,
            descriptionUpdated: false,
            descriptionSource: "existing-description-preserved-no-usable-legacy-problem-text",
            legacyProblemId: null,
            reason: "targeted-rerun-description-preserved-no-usable-legacy-problem-text",
            submissionArchiveReconciliation: {
              targetedSubmissions: 0,
              archivesWritten: 0,
              urlsUpdated: 0,
              urlsAlreadyMatched: 0,
              archiveDirectory: archiveDir,
            },
          },
        ],
        summary: {
          recordType: "apply-summary",
          created: 0,
          existing: 0,
          unmatched: 0,
          unresolved: 0,
          errors: 0,
          targetedRerunValidated: 1,
          targetedRerunDescriptionUpdated: 0,
          targetedRerunDescriptionPreserved: 1,
          targetedRerunSubmissionArchivesWritten: 0,
          targetedRerunSubmissionUrlsUpdated: 0,
          targetedRerunWritesAttempted: 0,
          skippedFileArtifact: null,
        },
      });
    } finally {
      fs.rmSync(archiveDir, { recursive: true, force: true });
    }
  });

  test("targeted rerun mode backfills deterministic submission archives and URLs while applying mapped raw problem HTML", async () => {
    const archiveDir = buildArchiveDirPath("description-and-archives");
    try {
      const rawProblemHtml = "<div><em>Legacy</em> HTML</div>";
      const prisma = {
        challenge: {
          findUnique: jest.fn().mockResolvedValue({
            description: "Old description",
            descriptionFormat: "markdown",
          }),
          update: jest.fn().mockResolvedValue({ id: "challenge-1" }),
        },
      };
      const submissionArchiveStore = {
        listSubmissionsByLegacyId: jest.fn().mockResolvedValue(
          new Map([
            ["50010001", { legacySubmissionId: "50010001", url: null }],
            ["50010002", { legacySubmissionId: "50010002", url: "https://example.com/old.zip" }],
          ])
        ),
        updateSubmissionUrl: jest.fn().mockResolvedValue(undefined),
      };

      const result = await runTargetedRerunMode({
        options: {
          roundIds: ["9892"],
          challengeId: "challenge-1",
        },
        plan: {
          records: [
            {
              legacyRoundId: "9892",
              decision: "reuse/backfill-only",
              matchedChallengeId: "challenge-1",
            },
          ],
          roundDataById: new Map([
            [
              "9892",
              {
                descriptionProblemText: rawProblemHtml,
                descriptionProblemId: "9001",
              },
            ],
          ]),
        },
        prisma,
        submissionArchiveStore,
        submissionArchiveDir: archiveDir,
        legacySubmissionRowsByRoundId: new Map([
          [
            "9892",
            [
              { legacySubmissionId: "50010001", submissionText: "first legacy submission text" },
              { legacySubmissionId: "50010002", submissionText: "second legacy submission text" },
            ],
          ],
        ]),
        actor: "importer",
      });

      expect(prisma.challenge.update).toHaveBeenCalledWith({
        where: { id: "challenge-1" },
        data: {
          description: rawProblemHtml,
          descriptionFormat: "html",
          updatedBy: "importer",
        },
        select: { id: true },
      });
      expect(submissionArchiveStore.listSubmissionsByLegacyId).toHaveBeenCalledWith({
        challengeId: "challenge-1",
      });
      expect(submissionArchiveStore.updateSubmissionUrl).toHaveBeenCalledTimes(2);
      const updatedUrlsByLegacyId = Object.fromEntries(
        submissionArchiveStore.updateSubmissionUrl.mock.calls.map(([call]) => [
          call.legacySubmissionId,
          call.url,
        ])
      );
      expect(Object.keys(updatedUrlsByLegacyId).sort()).toEqual(["50010001", "50010002"]);
      Object.values(updatedUrlsByLegacyId).forEach((url) => {
        expect(url.startsWith("https://s3.amazonaws.com/topcoder-submissions/")).toBe(true);
        expect(url.endsWith(".zip")).toBe(true);
      });
      expect(updatedUrlsByLegacyId["50010001"]).not.toBe(updatedUrlsByLegacyId["50010002"]);

      const archiveFiles = fs.readdirSync(archiveDir).filter((entry) => entry.endsWith(".zip")).sort();
      expect(archiveFiles).toHaveLength(2);
      const entryInfo = readSingleEntryStoredZip(path.join(archiveDir, archiveFiles[0]));
      expect(entryInfo.fileName.endsWith(".txt")).toBe(true);
      expect(entryInfo.contents.length).toBeGreaterThan(0);

      expect(result).toEqual({
        records: [
          {
            recordType: "apply-record",
            legacyRoundId: "9892",
            status: "targeted-rerun-applied",
            challengeId: "challenge-1",
            mode: "targeted-rerun",
            writesAttempted: true,
            descriptionUpdated: true,
            descriptionSource: "legacy-problem-text",
            legacyProblemId: "9001",
            reason: "targeted-rerun-description-updated-from-legacy-problem-text",
            submissionArchiveReconciliation: {
              targetedSubmissions: 2,
              archivesWritten: 2,
              urlsUpdated: 2,
              urlsAlreadyMatched: 0,
              archiveDirectory: archiveDir,
            },
          },
        ],
        summary: {
          recordType: "apply-summary",
          created: 0,
          existing: 0,
          unmatched: 0,
          unresolved: 0,
          errors: 0,
          targetedRerunValidated: 1,
          targetedRerunDescriptionUpdated: 1,
          targetedRerunDescriptionPreserved: 0,
          targetedRerunSubmissionArchivesWritten: 2,
          targetedRerunSubmissionUrlsUpdated: 2,
          targetedRerunWritesAttempted: 1,
          skippedFileArtifact: null,
        },
      });
    } finally {
      fs.rmSync(archiveDir, { recursive: true, force: true });
    }
  });

  test("targeted rerun mode backfills component_text markdown when problem text is unusable", async () => {
    const archiveDir = buildArchiveDirPath("component-markdown-fallback");
    try {
      const componentMarkdown = "## Robot Routing\n\nPublic example only.";
      const prisma = {
        challenge: {
          findUnique: jest.fn().mockResolvedValue({
            description: "Old description",
            descriptionFormat: "html",
          }),
          update: jest.fn().mockResolvedValue({ id: "challenge-1" }),
        },
      };
      const submissionArchiveStore = {
        listSubmissionsByLegacyId: jest.fn().mockResolvedValue(
          new Map([["50010001", { legacySubmissionId: "50010001", url: null }]])
        ),
        updateSubmissionUrl: jest.fn().mockResolvedValue(undefined),
      };

      const result = await runTargetedRerunMode({
        options: {
          roundIds: ["9892"],
          challengeId: "challenge-1",
        },
        plan: {
          records: [
            {
              legacyRoundId: "9892",
              decision: "reuse/backfill-only",
              matchedChallengeId: "challenge-1",
            },
          ],
          roundDataById: new Map([
            [
              "9892",
              {
                descriptionProblemText: "   ",
                descriptionProblemId: "9001",
                descriptionComponentId: "5503",
                descriptionComponentTextMarkdown: componentMarkdown,
              },
            ],
          ]),
        },
        prisma,
        submissionArchiveStore,
        submissionArchiveDir: archiveDir,
        legacySubmissionRowsByRoundId: new Map([
          [
            "9892",
            [{ legacySubmissionId: "50010001", submissionText: "single legacy submission text" }],
          ],
        ]),
        actor: "importer",
      });

      expect(prisma.challenge.update).toHaveBeenCalledWith({
        where: { id: "challenge-1" },
        data: {
          description: componentMarkdown,
          descriptionFormat: "markdown",
          updatedBy: "importer",
        },
        select: { id: true },
      });
      expect(result.records).toEqual([
        {
          recordType: "apply-record",
          legacyRoundId: "9892",
          status: "targeted-rerun-applied",
          challengeId: "challenge-1",
          mode: "targeted-rerun",
          writesAttempted: true,
          descriptionUpdated: true,
          descriptionSource: "legacy-component-text-markdown",
          legacyProblemId: null,
          legacyComponentId: "5503",
          reason: "targeted-rerun-description-updated-from-legacy-component-text-markdown",
          submissionArchiveReconciliation: {
            targetedSubmissions: 1,
            archivesWritten: 1,
            urlsUpdated: 1,
            urlsAlreadyMatched: 0,
            archiveDirectory: archiveDir,
          },
        },
      ]);
    } finally {
      fs.rmSync(archiveDir, { recursive: true, force: true });
    }
  });

  test("targeted rerun mode updates description format even when the description text already matches", async () => {
    const archiveDir = buildArchiveDirPath("description-format-only");
    try {
      const componentMarkdown = "## Robot Routing\n\nPublic example only.";
      const prisma = {
        challenge: {
          findUnique: jest.fn().mockResolvedValue({
            description: componentMarkdown,
            descriptionFormat: null,
          }),
          update: jest.fn().mockResolvedValue({ id: "challenge-1" }),
        },
      };
      const submissionArchiveStore = {
        listSubmissionsByLegacyId: jest.fn().mockResolvedValue(new Map()),
        updateSubmissionUrl: jest.fn().mockResolvedValue(undefined),
      };

      const result = await runTargetedRerunMode({
        options: {
          roundIds: ["9892"],
          challengeId: "challenge-1",
        },
        plan: {
          records: [
            {
              legacyRoundId: "9892",
              decision: "reuse/backfill-only",
              matchedChallengeId: "challenge-1",
            },
          ],
          roundDataById: new Map([
            [
              "9892",
              {
                descriptionComponentId: "5503",
                descriptionComponentTextMarkdown: componentMarkdown,
              },
            ],
          ]),
        },
        prisma,
        submissionArchiveStore,
        submissionArchiveDir: archiveDir,
        legacySubmissionRowsByRoundId: new Map([["9892", []]]),
        actor: "importer",
      });

      expect(prisma.challenge.update).toHaveBeenCalledWith({
        where: { id: "challenge-1" },
        data: {
          description: componentMarkdown,
          descriptionFormat: "markdown",
          updatedBy: "importer",
        },
        select: { id: true },
      });
      expect(result.records).toEqual([
        {
          recordType: "apply-record",
          legacyRoundId: "9892",
          status: "targeted-rerun-applied",
          challengeId: "challenge-1",
          mode: "targeted-rerun",
          writesAttempted: true,
          descriptionUpdated: true,
          descriptionSource: "legacy-component-text-markdown",
          legacyProblemId: null,
          legacyComponentId: "5503",
          reason: "targeted-rerun-description-updated-from-legacy-component-text-markdown",
          submissionArchiveReconciliation: {
            targetedSubmissions: 0,
            archivesWritten: 0,
            urlsUpdated: 0,
            urlsAlreadyMatched: 0,
            archiveDirectory: archiveDir,
          },
        },
      ]);
    } finally {
      fs.rmSync(archiveDir, { recursive: true, force: true });
    }
  });

  test("targeted rerun mode preserves existing description but still backfills submission archive URLs", async () => {
    const archiveDir = buildArchiveDirPath("preserve-description");
    try {
      const prisma = {
        challenge: {
          update: jest.fn(),
        },
      };
      const submissionArchiveStore = {
        listSubmissionsByLegacyId: jest.fn().mockResolvedValue(
          new Map([["50010001", { legacySubmissionId: "50010001", url: null }]])
        ),
        updateSubmissionUrl: jest.fn().mockResolvedValue(undefined),
      };

      const result = await runTargetedRerunMode({
        options: {
          roundIds: ["9892"],
          challengeId: "challenge-1",
        },
        plan: {
          records: [
            {
              legacyRoundId: "9892",
              decision: "reuse/backfill-only",
              matchedChallengeId: "challenge-1",
            },
          ],
          roundDataById: new Map([
            [
              "9892",
              {
                descriptionProblemText: "   ",
                descriptionProblemId: "9001",
              },
            ],
          ]),
        },
        prisma,
        submissionArchiveStore,
        submissionArchiveDir: archiveDir,
        legacySubmissionRowsByRoundId: new Map([
          [
            "9892",
            [{ legacySubmissionId: "50010001", submissionText: "single legacy submission text" }],
          ],
        ]),
        actor: "importer",
      });

      expect(prisma.challenge.update).not.toHaveBeenCalled();
      expect(submissionArchiveStore.updateSubmissionUrl).toHaveBeenCalledTimes(1);
      expect(result.records).toEqual([
        {
          recordType: "apply-record",
          legacyRoundId: "9892",
          status: "targeted-rerun-preserved",
          challengeId: "challenge-1",
          mode: "targeted-rerun",
          writesAttempted: true,
          descriptionUpdated: false,
          descriptionSource: "existing-description-preserved-no-usable-legacy-problem-text",
          legacyProblemId: null,
          reason: "targeted-rerun-description-preserved-no-usable-legacy-problem-text",
          submissionArchiveReconciliation: {
            targetedSubmissions: 1,
            archivesWritten: 1,
            urlsUpdated: 1,
            urlsAlreadyMatched: 0,
            archiveDirectory: archiveDir,
          },
        },
      ]);
      expect(result.summary).toEqual({
        recordType: "apply-summary",
        created: 0,
        existing: 0,
        unmatched: 0,
        unresolved: 0,
        errors: 0,
        targetedRerunValidated: 1,
        targetedRerunDescriptionUpdated: 0,
        targetedRerunDescriptionPreserved: 1,
        targetedRerunSubmissionArchivesWritten: 1,
        targetedRerunSubmissionUrlsUpdated: 1,
        targetedRerunWritesAttempted: 1,
        skippedFileArtifact: null,
      });
    } finally {
      fs.rmSync(archiveDir, { recursive: true, force: true });
    }
  });

  test("targeted rerun mode updates existing final and provisional scores", async () => {
    const archiveDir = buildArchiveDirPath("score-reconciliation");
    const fixtureDir = createTargetedScoreFixtureDataDirectory();
    try {
      const submissionArchiveStore = {
        listSubmissionsByLegacyId: jest.fn().mockResolvedValue(new Map()),
        updateSubmissionUrl: jest.fn().mockResolvedValue(undefined),
      };
      const finalScoreStore = {
        listImportedNonExampleSubmissionsByChallenge: jest.fn().mockResolvedValue([
          {
            id: "sub-1",
            memberId: "1",
            legacySubmissionId: "10010001",
            submittedDate: new Date("2020-01-01T01:00:00.000Z"),
            createdAt: new Date("2020-01-01T01:00:00.000Z"),
          },
        ]),
        listExistingFinalSummationsBySubmissionId: jest.fn().mockResolvedValue(
          new Map([
            [
              "sub-1",
              [{ id: "final-1", submissionId: "sub-1", aggregateScore: 1 }],
            ],
          ])
        ),
        createFinalSummation: jest.fn().mockResolvedValue(undefined),
        updateFinalSummation: jest.fn().mockResolvedValue(undefined),
      };
      const provisionalScoreStore = {
        listImportedNonExampleSubmissionsByLegacySubmissionId: jest.fn().mockResolvedValue(
          new Map([
            [
              "10010001",
              {
                id: "sub-1",
                memberId: "1",
                legacySubmissionId: "10010001",
                submittedDate: new Date("2020-01-01T01:00:00.000Z"),
                createdAt: new Date("2020-01-01T01:00:00.000Z"),
              },
            ],
          ])
        ),
        listExistingProvisionalSummationsBySubmissionId: jest.fn().mockResolvedValue(
          new Map([
            [
              "sub-1",
              [{ id: "prov-1", submissionId: "sub-1", aggregateScore: 2 }],
            ],
          ])
        ),
        createProvisionalSummation: jest.fn().mockResolvedValue(undefined),
        updateProvisionalSummation: jest.fn().mockResolvedValue(undefined),
      };

      const result = await runTargetedRerunMode({
        options: {
          roundIds: ["9892"],
          challengeId: "challenge-1",
          dataDir: fixtureDir,
          longComponentStateFile: "long_component_state_1.json",
          longSubmissionPattern: "^long_submission_\\d+\\.json$",
          longCompResultPattern: "^long_comp_result_\\d+\\.json$",
        },
        plan: {
          records: [
            {
              legacyRoundId: "9892",
              decision: "reuse/backfill-only",
              matchedChallengeId: "challenge-1",
            },
          ],
          roundDataById: new Map([
            [
              "9892",
              {
                finalCandidateCoderIds: new Set(["1"]),
              },
            ],
          ]),
        },
        submissionArchiveStore,
        finalScoreStore,
        provisionalScoreStore,
        submissionArchiveDir: archiveDir,
        legacySubmissionRowsByRoundId: new Map([["9892", []]]),
        normalizedIdentityByCoderId: new Map([
          ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
        ]),
      });

      expect(finalScoreStore.updateFinalSummation).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewSummationId: "final-1",
          submissionId: "sub-1",
          aggregateScore: 100,
          legacySubmissionId: "10010001",
          isFinal: true,
        })
      );
      expect(provisionalScoreStore.updateProvisionalSummation).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewSummationId: "prov-1",
          submissionId: "sub-1",
          aggregateScore: 9.5,
          legacySubmissionId: "10010001",
          isFinal: false,
        })
      );
      expect(result).toEqual({
        records: [
          {
            recordType: "apply-record",
            legacyRoundId: "9892",
            status: "targeted-rerun-applied",
            challengeId: "challenge-1",
            mode: "targeted-rerun",
            writesAttempted: true,
            descriptionUpdated: false,
            descriptionSource: "existing-description-preserved-no-usable-legacy-problem-text",
            legacyProblemId: null,
            reason: "targeted-rerun-description-preserved-no-usable-legacy-problem-text",
            submissionArchiveReconciliation: {
              targetedSubmissions: 0,
              archivesWritten: 0,
              urlsUpdated: 0,
              urlsAlreadyMatched: 0,
              archiveDirectory: archiveDir,
            },
            finalScoreReconciliation: {
              legacyFinalCandidates: 1,
              importedFinalScores: 1,
              alreadyPresentFinalScores: 0,
              createdFinalScores: 0,
              updatedFinalScores: 1,
              missingMemberSkippedFinalScores: 0,
              explicitSkippedFinalScores: 0,
              runtimeSkipRecords: [],
            },
            provisionalScoreReconciliation: {
              legacyNonExampleProvisionalScores: 1,
              legacyExampleOnlyFinalistProvisionalScores: 0,
              importedProvisionalScores: 1,
              alreadyPresentProvisionalScores: 0,
              createdProvisionalScores: 0,
              updatedProvisionalScores: 1,
              malformedSkippedProvisionalScores: 0,
              missingMemberSkippedProvisionalScores: 0,
              importedDistinctSubmitters: 1,
              missingMemberDistinctSubmitters: 0,
              importedProvisionalCountsByMemberId: {
                1: 1,
              },
              skippedProvisionalRecords: [],
            },
          },
        ],
        summary: {
          recordType: "apply-summary",
          created: 0,
          existing: 0,
          unmatched: 0,
          unresolved: 0,
          errors: 0,
          targetedRerunValidated: 1,
          targetedRerunDescriptionUpdated: 0,
          targetedRerunDescriptionPreserved: 1,
          targetedRerunSubmissionArchivesWritten: 0,
          targetedRerunSubmissionUrlsUpdated: 0,
          targetedRerunFinalScoresCreated: 0,
          targetedRerunFinalScoresUpdated: 1,
          targetedRerunProvisionalScoresCreated: 0,
          targetedRerunProvisionalScoresUpdated: 1,
          targetedRerunWritesAttempted: 1,
          skippedFileArtifact: null,
        },
      });
    } finally {
      fs.rmSync(archiveDir, { recursive: true, force: true });
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test("targeted rerun mode skips challenge description write when legacy problem HTML already matches", async () => {
    const archiveDir = buildArchiveDirPath("problem-text-already-matched");
    try {
      const rawProblemHtml = "<div><em>Legacy</em> HTML</div>";
      const prisma = {
        challenge: {
          findUnique: jest.fn().mockResolvedValue({
            description: rawProblemHtml,
            descriptionFormat: "html",
          }),
          update: jest.fn(),
        },
      };
      const submissionArchiveStore = {
        listSubmissionsByLegacyId: jest.fn().mockResolvedValue(new Map()),
        updateSubmissionUrl: jest.fn().mockResolvedValue(undefined),
      };

      const result = await runTargetedRerunMode({
        options: {
          roundIds: ["9892"],
          challengeId: "challenge-1",
        },
        plan: {
          records: [
            {
              legacyRoundId: "9892",
              decision: "reuse/backfill-only",
              matchedChallengeId: "challenge-1",
            },
          ],
          roundDataById: new Map([
            [
              "9892",
              {
                descriptionProblemText: rawProblemHtml,
                descriptionProblemId: "9001",
              },
            ],
          ]),
        },
        prisma,
        submissionArchiveStore,
        submissionArchiveDir: archiveDir,
        legacySubmissionRowsByRoundId: new Map([["9892", []]]),
        actor: "importer",
      });

      expect(prisma.challenge.findUnique).toHaveBeenCalledWith({
        where: { id: "challenge-1" },
        select: { description: true, descriptionFormat: true },
      });
      expect(prisma.challenge.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        records: [
          {
            recordType: "apply-record",
            legacyRoundId: "9892",
            status: "targeted-rerun-preserved",
            challengeId: "challenge-1",
            mode: "targeted-rerun",
            writesAttempted: false,
            descriptionUpdated: false,
            descriptionSource: "legacy-problem-text",
            legacyProblemId: "9001",
            reason: "targeted-rerun-description-already-matched-legacy-problem-text",
            submissionArchiveReconciliation: {
              targetedSubmissions: 0,
              archivesWritten: 0,
              urlsUpdated: 0,
              urlsAlreadyMatched: 0,
              archiveDirectory: archiveDir,
            },
          },
        ],
        summary: {
          recordType: "apply-summary",
          created: 0,
          existing: 0,
          unmatched: 0,
          unresolved: 0,
          errors: 0,
          targetedRerunValidated: 1,
          targetedRerunDescriptionUpdated: 0,
          targetedRerunDescriptionPreserved: 1,
          targetedRerunSubmissionArchivesWritten: 0,
          targetedRerunSubmissionUrlsUpdated: 0,
          targetedRerunWritesAttempted: 0,
          skippedFileArtifact: null,
        },
      });
    } finally {
      fs.rmSync(archiveDir, { recursive: true, force: true });
    }
  });

  test("targeted rerun mode skips challenge description write when component markdown already matches", async () => {
    const archiveDir = buildArchiveDirPath("component-markdown-already-matched");
    try {
      const componentMarkdown = "## Robot Routing\n\nPublic example only.";
      const prisma = {
        challenge: {
          findUnique: jest.fn().mockResolvedValue({
            description: componentMarkdown,
            descriptionFormat: "markdown",
          }),
          update: jest.fn(),
        },
      };
      const submissionArchiveStore = {
        listSubmissionsByLegacyId: jest.fn().mockResolvedValue(new Map()),
        updateSubmissionUrl: jest.fn().mockResolvedValue(undefined),
      };

      const result = await runTargetedRerunMode({
        options: {
          roundIds: ["9892"],
          challengeId: "challenge-1",
        },
        plan: {
          records: [
            {
              legacyRoundId: "9892",
              decision: "reuse/backfill-only",
              matchedChallengeId: "challenge-1",
            },
          ],
          roundDataById: new Map([
            [
              "9892",
              {
                descriptionProblemText: "   ",
                descriptionProblemId: "9001",
                descriptionComponentId: "5503",
                descriptionComponentTextMarkdown: componentMarkdown,
              },
            ],
          ]),
        },
        prisma,
        submissionArchiveStore,
        submissionArchiveDir: archiveDir,
        legacySubmissionRowsByRoundId: new Map([["9892", []]]),
        actor: "importer",
      });

      expect(prisma.challenge.findUnique).toHaveBeenCalledWith({
        where: { id: "challenge-1" },
        select: { description: true, descriptionFormat: true },
      });
      expect(prisma.challenge.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        records: [
          {
            recordType: "apply-record",
            legacyRoundId: "9892",
            status: "targeted-rerun-preserved",
            challengeId: "challenge-1",
            mode: "targeted-rerun",
            writesAttempted: false,
            descriptionUpdated: false,
            descriptionSource: "legacy-component-text-markdown",
            legacyProblemId: null,
            legacyComponentId: "5503",
            reason: "targeted-rerun-description-already-matched-legacy-component-text-markdown",
            submissionArchiveReconciliation: {
              targetedSubmissions: 0,
              archivesWritten: 0,
              urlsUpdated: 0,
              urlsAlreadyMatched: 0,
              archiveDirectory: archiveDir,
            },
          },
        ],
        summary: {
          recordType: "apply-summary",
          created: 0,
          existing: 0,
          unmatched: 0,
          unresolved: 0,
          errors: 0,
          targetedRerunValidated: 1,
          targetedRerunDescriptionUpdated: 0,
          targetedRerunDescriptionPreserved: 1,
          targetedRerunSubmissionArchivesWritten: 0,
          targetedRerunSubmissionUrlsUpdated: 0,
          targetedRerunWritesAttempted: 0,
          skippedFileArtifact: null,
        },
      });
    } finally {
      fs.rmSync(archiveDir, { recursive: true, force: true });
    }
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
        skippedFilePath: buildSkippedFilePath("resource-reconciliation"),
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

  test("apply mode filters planned missing-member resource skips before Resource API creates", async () => {
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
      listSubmitterResources: jest.fn().mockResolvedValue([]),
      createSubmitterResource: jest.fn().mockImplementation(async ({ memberId }) => {
        if (memberId === "2") {
          throw new Error("missing-member should have been filtered before Resource API create");
        }
        return {};
      }),
    };

    const result = await runApplyMode({
      prisma,
      options: {
        roundIds: ["9892"],
        skippedFilePath: buildSkippedFilePath("resource-missing-member-filter"),
        resourceClient,
        submitterRoleId: "submitter-role",
      },
      plan: {
        records: [
          {
            legacyRoundId: "9892",
            decision: "create",
            reason: "no-matching-v6-challenge-found",
            plannedSkipRecords: [
              {
                legacyRoundId: "9892",
                memberId: "2",
                reasonCode: "missing-member",
                affectedSurfaces: ["resource", "submission", "final-score", "provisional-score"],
              },
            ],
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

    expect(resourceClient.createSubmitterResource).toHaveBeenCalledTimes(1);
    expect(resourceClient.createSubmitterResource).toHaveBeenCalledWith({
      challengeId: "challenge-1",
      memberId: "1",
      roleId: "submitter-role",
    });
    expect(result.records).toEqual([
      {
        recordType: "apply-record",
        legacyRoundId: "9892",
        status: "created",
        challengeId: "challenge-1",
        resourceReconciliation: {
          targetEligibleRegistrants: 1,
          existingSubmitterResources: 0,
          createdSubmitterResources: 1,
          unchangedSubmitterResources: 0,
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
