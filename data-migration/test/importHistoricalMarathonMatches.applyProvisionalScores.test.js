const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  runApplyMode,
} = require("../src/scripts/importHistoricalMarathonMatches/apply");

const writeJson = (baseDir, fileName, rootKey, rows) => {
  fs.writeFileSync(
    path.join(baseDir, fileName),
    `${JSON.stringify({ [rootKey]: rows }, null, 2)}\n`,
    "utf8"
  );
};

describe("importHistoricalMarathonMatches apply mode provisional-score wiring", () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-apply-provisional-scores-fixture-"));
    writeJson(fixtureDir, "long_component_state_1.json", "long_component_state", [
      { long_component_state_id: "1001", round_id: "9892", coder_id: "1", component_id: "5503", points: "9.5" },
      { long_component_state_id: "1002", round_id: "9892", coder_id: "2", component_id: "5503", points: "7.0" },
      { long_component_state_id: "1003", round_id: "9892", coder_id: "3", component_id: "5503", points: "5.5" },
    ]);
    writeJson(fixtureDir, "long_submission_1.json", "long_submission", [
      {
        long_component_state_id: "1001",
        submission_number: "1",
        example: "0",
        submit_time: "1000",
        submission_points: "9.5",
      },
      {
        long_component_state_id: "1002",
        submission_number: "1",
        example: "0",
        submit_time: "1001",
        submission_points: "7.0",
      },
      {
        long_component_state_id: "1003",
        submission_number: "1",
        example: "1",
        submit_time: "1002",
        submission_points: "6.0",
      },
      {
        long_component_state_id: "1003",
        submission_number: "2",
        example: "1",
        submit_time: "1003",
        submission_points: "5.5",
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("apply-mode imports provisional scores and appends per-submission missing-member provisional skips", async () => {
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

    const submissionStoreRecordsByChallengeId = new Map();
    const submissionStore = {
      listExistingSubmissionsByLegacyId: async ({ challengeId }) =>
        new Map(submissionStoreRecordsByChallengeId.get(challengeId) || []),
      createSubmission: async ({ challengeId, legacySubmissionId, memberId, submittedDate }) => {
        if (!submissionStoreRecordsByChallengeId.has(challengeId)) {
          submissionStoreRecordsByChallengeId.set(challengeId, new Map());
        }
        submissionStoreRecordsByChallengeId.get(challengeId).set(legacySubmissionId, {
          id: `sub-${legacySubmissionId}`,
          legacySubmissionId,
          memberId: String(memberId),
          submittedDate,
          createdAt: submittedDate,
        });
      },
    };

    const existingProvisionalBySubmissionId = new Map();
    const createdProvisionalSummations = [];
    const provisionalScoreStore = {
      listImportedNonExampleSubmissionsByLegacySubmissionId: async ({ challengeId }) =>
        new Map(
          Array.from(
            (submissionStoreRecordsByChallengeId.get(challengeId) || new Map()).values()
          ).map((submission) => [submission.legacySubmissionId, submission])
        ),
      listExistingProvisionalSummationsBySubmissionId: async () =>
        new Map(existingProvisionalBySubmissionId),
      createProvisionalSummation: async (payload) => {
        createdProvisionalSummations.push(payload);
        existingProvisionalBySubmissionId.set(payload.submissionId, [
          {
            submissionId: payload.submissionId,
            aggregateScore: payload.aggregateScore,
          },
        ]);
      },
    };

    const skippedFilePath = path.join(fixtureDir, "apply-skipped.json");
    const result = await runApplyMode({
      prisma,
      options: {
        roundIds: ["9892"],
        skippedFilePath,
        importSubmissions: true,
        importProvisionalScores: true,
        submissionStore,
        provisionalScoreStore,
        dataDir: fixtureDir,
        longComponentStateFile: "long_component_state_1.json",
        longSubmissionPattern: "^long_submission_\\d+\\.json$",
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
            plannedSkipRecords: [
              {
                legacyRoundId: "9892",
                memberId: "2",
                reasonCode: "missing-member",
                affectedSurfaces: ["resource", "submission", "provisional-score"],
              },
            ],
          },
        ],
        roundDataById: new Map([
          [
            "9892",
            {
              round: { round_id: "9892", round_type_id: "13", name: "MM 9892" },
              registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
              registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
              earliestSubmissionOpenMs: Date.parse("2020-01-01T01:00:00.000Z"),
              earliestNonExampleSubmitMs: Date.parse("2020-01-01T01:00:00.000Z"),
              latestNonExampleSubmitMs: Date.parse("2020-01-01T01:00:00.000Z"),
              eligibleRegistrants: new Set(["1", "2"]),
              nonExampleSubmissions: 2,
              nonExampleSubmitterCoderIds: new Set(["1", "2"]),
              finalCandidateCoderIds: new Set(),
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

    expect(createdProvisionalSummations).toHaveLength(1);
    expect(createdProvisionalSummations[0]).toEqual(
      expect.objectContaining({
        submissionId: "sub-10010001",
        aggregateScore: 9.5,
        legacySubmissionId: "10010001",
        isFinal: false,
      })
    );

    expect(result.records).toEqual([
      expect.objectContaining({
        recordType: "apply-record",
        legacyRoundId: "9892",
        status: "created",
        challengeId: "challenge-1",
        provisionalScoreReconciliation: {
          legacyNonExampleProvisionalScores: 2,
          legacyExampleOnlyFinalistProvisionalScores: 0,
          importedProvisionalScores: 1,
          alreadyPresentProvisionalScores: 0,
          createdProvisionalScores: 1,
          malformedSkippedProvisionalScores: 0,
          missingMemberSkippedProvisionalScores: 1,
          importedDistinctSubmitters: 1,
          missingMemberDistinctSubmitters: 1,
          importedProvisionalCountsByMemberId: {
            1: 1,
          },
          skippedProvisionalRecords: [
            expect.objectContaining({
              reasonCode: "missing-member",
              memberId: "2",
              legacySubmissionId: "10020001",
              affectedSurfaces: ["provisional-score"],
            }),
          ],
        },
      }),
    ]);
    expect(result.summary).toEqual(
      expect.objectContaining({
        skippedFileArtifact: {
          path: skippedFilePath,
          reasonCodes: ["missing-member"],
          recordCount: 3,
        },
      })
    );
  });

  test("apply-mode imports a provisional score for the latest example-only finalist submission", async () => {
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

    const submissionStoreRecordsByChallengeId = new Map();
    const submissionStore = {
      listExistingSubmissionsByLegacyId: async ({ challengeId }) =>
        new Map(submissionStoreRecordsByChallengeId.get(challengeId) || []),
      createSubmission: async ({ challengeId, legacySubmissionId, memberId, submittedDate }) => {
        if (!submissionStoreRecordsByChallengeId.has(challengeId)) {
          submissionStoreRecordsByChallengeId.set(challengeId, new Map());
        }
        submissionStoreRecordsByChallengeId.get(challengeId).set(legacySubmissionId, {
          id: `sub-${legacySubmissionId}`,
          legacySubmissionId,
          memberId: String(memberId),
          submittedDate,
          createdAt: submittedDate,
        });
      },
    };

    const createdProvisionalSummations = [];
    const provisionalScoreStore = {
      listImportedNonExampleSubmissionsByLegacySubmissionId: async ({ challengeId }) =>
        new Map(
          Array.from(
            (submissionStoreRecordsByChallengeId.get(challengeId) || new Map()).values()
          ).map((submission) => [submission.legacySubmissionId, submission])
        ),
      listExistingProvisionalSummationsBySubmissionId: async () => new Map(),
      createProvisionalSummation: async (payload) => {
        createdProvisionalSummations.push(payload);
      },
    };

    const result = await runApplyMode({
      prisma,
      options: {
        roundIds: ["9892"],
        skippedFilePath: path.join(fixtureDir, "apply-example-only-provisional-skipped.json"),
        importSubmissions: true,
        importProvisionalScores: true,
        submissionStore,
        provisionalScoreStore,
        dataDir: fixtureDir,
        longComponentStateFile: "long_component_state_1.json",
        longSubmissionPattern: "^long_submission_\\d+\\.json$",
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
            plannedSkipRecords: [],
          },
        ],
        roundDataById: new Map([
          [
            "9892",
            {
              round: { round_id: "9892", round_type_id: "13", name: "MM 9892" },
              registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
              registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
              earliestSubmissionOpenMs: Date.parse("2020-01-01T01:00:00.000Z"),
              earliestNonExampleSubmitMs: Date.parse("2020-01-01T01:00:00.000Z"),
              latestNonExampleSubmitMs: Date.parse("2020-01-01T01:00:00.000Z"),
              earliestExampleOnlyFinalistSubmitMs: Date.parse("2020-01-01T03:00:00.000Z"),
              latestExampleOnlyFinalistSubmitMs: Date.parse("2020-01-01T03:00:00.000Z"),
              eligibleRegistrants: new Set(["1", "2", "3"]),
              nonExampleSubmissions: 2,
              exampleOnlyFinalistSubmissions: 1,
              nonExampleSubmitterCoderIds: new Set(["1", "2"]),
              exampleOnlyFinalistSubmissionCountsByCoderId: new Map([["3", 1]]),
              finalCandidateCoderIds: new Set(["3"]),
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

    expect(createdProvisionalSummations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          submissionId: "sub-10030002",
          aggregateScore: 5.5,
          legacySubmissionId: "10030002",
          isFinal: false,
        }),
      ])
    );

    expect(result.records).toEqual([
      expect.objectContaining({
        recordType: "apply-record",
        legacyRoundId: "9892",
        status: "created",
        challengeId: "challenge-1",
        provisionalScoreReconciliation: {
          legacyNonExampleProvisionalScores: 2,
          legacyExampleOnlyFinalistProvisionalScores: 1,
          importedProvisionalScores: 3,
          alreadyPresentProvisionalScores: 0,
          createdProvisionalScores: 3,
          malformedSkippedProvisionalScores: 0,
          missingMemberSkippedProvisionalScores: 0,
          importedDistinctSubmitters: 3,
          missingMemberDistinctSubmitters: 0,
          importedProvisionalCountsByMemberId: {
            1: 1,
            2: 1,
            3: 1,
          },
          skippedProvisionalRecords: [],
        },
      }),
    ]);
  });
});
