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

describe("importHistoricalMarathonMatches apply mode final-score wiring", () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-apply-final-scores-fixture-"));
    writeJson(fixtureDir, "long_component_state_1.json", "long_component_state", [
      { long_component_state_id: "1001", round_id: "9892", coder_id: "1", component_id: "5503", points: "10.0" },
      { long_component_state_id: "1002", round_id: "9892", coder_id: "3", component_id: "5503", points: "5.0" },
    ]);
    writeJson(fixtureDir, "long_submission_1.json", "long_submission", [
      { long_component_state_id: "1001", submission_number: "1", example: "0", submit_time: "1000" },
    ]);
    writeJson(fixtureDir, "long_comp_result_1.json", "long_comp_result", [
      { round_id: "9892", coder_id: "1", system_point_total: "10.0", point_total: null, placed: "1" },
      { round_id: "9892", coder_id: "3", system_point_total: "5.0", point_total: null, placed: "2" },
    ]);
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("apply-mode imports final scores and appends runtime unattachable-finalist skips", async () => {
    const calls = {
      createdChallenge: null,
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

    const createdFinalSummations = [];
    const finalScoreStore = {
      listImportedNonExampleSubmissionsByChallenge: async ({ challengeId }) =>
        Array.from(
          (submissionStoreRecordsByChallengeId.get(challengeId) || new Map()).values()
        ),
      listExistingFinalSummationsBySubmissionId: async () => new Map(),
      createFinalSummation: async (payload) => {
        createdFinalSummations.push(payload);
      },
    };

    const skippedFilePath = path.join(fixtureDir, "apply-skipped.json");
    const result = await runApplyMode({
      prisma,
      options: {
        roundIds: ["9892"],
        skippedFilePath,
        importSubmissions: true,
        importFinalScores: true,
        submissionStore,
        finalScoreStore,
        dataDir: fixtureDir,
        longComponentStateFile: "long_component_state_1.json",
        longSubmissionPattern: "^long_submission_\\d+\\.json$",
        longCompResultPattern: "^long_comp_result_\\d+\\.json$",
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
              round: { round_id: "9892", round_type_id: "13", name: "MM 9892" },
              registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
              registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
              earliestSubmissionOpenMs: Date.parse("2020-01-01T01:00:00.000Z"),
              earliestNonExampleSubmitMs: Date.parse("2020-01-01T01:00:00.000Z"),
              latestNonExampleSubmitMs: Date.parse("2020-01-01T01:00:00.000Z"),
              eligibleRegistrants: new Set(["1", "3"]),
              nonExampleSubmissions: 1,
              nonExampleSubmitterCoderIds: new Set(["1"]),
              finalCandidateCoderIds: new Set(["1", "3"]),
            },
          ],
        ]),
      },
      actor: "importer",
      normalizedIdentityByCoderId: new Map([
        ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
        ["3", { coderId: "3", memberId: 3, memberHandle: "charlie" }],
      ]),
    });

    expect(createdFinalSummations).toHaveLength(1);
    expect(createdFinalSummations[0]).toEqual(
      expect.objectContaining({
        submissionId: "sub-10010001",
        aggregateScore: 10,
        legacySubmissionId: "10010001",
      })
    );
    expect(calls.createdChallenge).toEqual(
      expect.objectContaining({
        winners: {
          create: [
            expect.objectContaining({
              userId: 1,
              handle: "alpha",
              placement: 1,
              type: "PLACEMENT",
              createdBy: "importer",
              updatedBy: "importer",
            }),
            expect.objectContaining({
              userId: 3,
              handle: "charlie",
              placement: 2,
              type: "PLACEMENT",
              createdBy: "importer",
              updatedBy: "importer",
            }),
          ],
        },
      })
    );
    expect(result.records).toEqual([
      expect.objectContaining({
        recordType: "apply-record",
        legacyRoundId: "9892",
        status: "created",
        challengeId: "challenge-1",
        finalScoreReconciliation: {
          legacyFinalCandidates: 2,
          importedFinalScores: 1,
          alreadyPresentFinalScores: 0,
          createdFinalScores: 1,
          missingMemberSkippedFinalScores: 0,
          explicitSkippedFinalScores: 1,
          runtimeSkipRecords: [
            expect.objectContaining({
              reasonCode: "finalist-without-attachable-submission",
              memberId: "3",
            }),
          ],
        },
      }),
    ]);
    expect(result.summary).toEqual(
      expect.objectContaining({
        skippedFileArtifact: {
          path: skippedFilePath,
          reasonCodes: ["finalist-without-attachable-submission"],
          recordCount: 1,
        },
      })
    );
  });

  test("apply-mode attaches final scores to latest example-only finalist submissions", async () => {
    writeJson(fixtureDir, "long_submission_1.json", "long_submission", [
      { long_component_state_id: "1001", submission_number: "1", example: "0", submit_time: "1000" },
      { long_component_state_id: "1002", submission_number: "1", example: "1", submit_time: "1001" },
      { long_component_state_id: "1002", submission_number: "2", example: "1", submit_time: "1002" },
    ]);

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

    const createdFinalSummations = [];
    const finalScoreStore = {
      listImportedNonExampleSubmissionsByChallenge: async ({ challengeId }) =>
        Array.from(
          (submissionStoreRecordsByChallengeId.get(challengeId) || new Map()).values()
        ),
      listExistingFinalSummationsBySubmissionId: async () => new Map(),
      createFinalSummation: async (payload) => {
        createdFinalSummations.push(payload);
      },
    };

    const result = await runApplyMode({
      prisma,
      options: {
        roundIds: ["9892"],
        skippedFilePath: path.join(fixtureDir, "apply-example-only-final-skipped.json"),
        importSubmissions: true,
        importFinalScores: true,
        submissionStore,
        finalScoreStore,
        dataDir: fixtureDir,
        longComponentStateFile: "long_component_state_1.json",
        longSubmissionPattern: "^long_submission_\\d+\\.json$",
        longCompResultPattern: "^long_comp_result_\\d+\\.json$",
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
              round: { round_id: "9892", round_type_id: "13", name: "MM 9892" },
              registrationStartMs: Date.parse("2020-01-01T00:00:00.000Z"),
              registrationEndMs: Date.parse("2020-01-01T12:00:00.000Z"),
              earliestSubmissionOpenMs: Date.parse("2020-01-01T01:00:00.000Z"),
              earliestNonExampleSubmitMs: Date.parse("2020-01-01T01:00:00.000Z"),
              latestNonExampleSubmitMs: Date.parse("2020-01-01T01:00:00.000Z"),
              earliestExampleOnlyFinalistSubmitMs: Date.parse("2020-01-01T02:00:00.000Z"),
              latestExampleOnlyFinalistSubmitMs: Date.parse("2020-01-01T02:00:00.000Z"),
              eligibleRegistrants: new Set(["1", "3"]),
              nonExampleSubmissions: 1,
              exampleOnlyFinalistSubmissions: 1,
              nonExampleSubmitterCoderIds: new Set(["1"]),
              exampleOnlyFinalistSubmissionCountsByCoderId: new Map([["3", 1]]),
              finalCandidateCoderIds: new Set(["1", "3"]),
            },
          ],
        ]),
      },
      actor: "importer",
      normalizedIdentityByCoderId: new Map([
        ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
        ["3", { coderId: "3", memberId: 3, memberHandle: "charlie" }],
      ]),
    });

    expect(createdFinalSummations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          submissionId: "sub-10010001",
          aggregateScore: 10,
          legacySubmissionId: "10010001",
        }),
        expect.objectContaining({
          submissionId: "sub-10020002",
          aggregateScore: 5,
          legacySubmissionId: "10020002",
        }),
      ])
    );

    expect(result.records).toEqual([
      expect.objectContaining({
        recordType: "apply-record",
        legacyRoundId: "9892",
        status: "created",
        challengeId: "challenge-1",
        finalScoreReconciliation: {
          legacyFinalCandidates: 2,
          importedFinalScores: 2,
          alreadyPresentFinalScores: 0,
          createdFinalScores: 2,
          missingMemberSkippedFinalScores: 0,
          explicitSkippedFinalScores: 0,
          runtimeSkipRecords: [],
        },
      }),
    ]);
  });
});
