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

describe("importHistoricalMarathonMatches apply mode submission-history wiring", () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-apply-submissions-fixture-"));
    writeJson(fixtureDir, "long_component_state_1.json", "long_component_state", [
      { long_component_state_id: "1001", round_id: "9892", coder_id: "1", component_id: "5503" },
      { long_component_state_id: "1002", round_id: "9892", coder_id: "2", component_id: "5503" },
    ]);
    writeJson(fixtureDir, "long_submission_1.json", "long_submission", [
      { long_component_state_id: "1001", submission_number: "1", example: "0", submit_time: "1000" },
      { long_component_state_id: "1002", submission_number: "1", example: "0", submit_time: "1001" },
    ]);
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("apply-mode creates resolvable submissions and appends per-submission missing-member skips", async () => {
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

    const submissionStoreRecords = new Map();
    const submissionStore = {
      listExistingSubmissionsByLegacyId: async () => new Map(submissionStoreRecords),
      createSubmission: async ({ legacySubmissionId, memberId, submitter }) => {
        submissionStoreRecords.set(legacySubmissionId, {
          legacySubmissionId,
          memberId: String(memberId),
          submitter: submitter || null,
        });
      },
    };

    const skippedFilePath = path.join(fixtureDir, "apply-skipped.json");
    const result = await runApplyMode({
      prisma,
      options: {
        roundIds: ["9892"],
        skippedFilePath,
        importSubmissions: true,
        submissionStore,
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
                affectedSurfaces: ["resource", "submission"],
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
              earliestNonExampleSubmitMs: Date.parse("2020-01-01T02:00:00.000Z"),
              latestNonExampleSubmitMs: Date.parse("2020-01-02T00:00:00.000Z"),
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

    expect(result.records).toEqual([
      expect.objectContaining({
        recordType: "apply-record",
        legacyRoundId: "9892",
        status: "created",
        challengeId: "challenge-1",
        submissionReconciliation: {
          legacyNonExampleSubmissions: 2,
          importedSubmissions: 1,
          alreadyPresentSubmissions: 0,
          createdSubmissions: 1,
          missingMemberSkippedSubmissions: 1,
          importedDistinctSubmitters: 1,
          missingMemberDistinctSubmitters: 1,
          importedSubmissionCountsByMemberId: {
            1: 1,
          },
          skippedSubmissionRecords: [
            expect.objectContaining({
              legacyRoundId: "9892",
              memberId: "2",
              reasonCode: "missing-member",
              legacySubmissionId: "10020001",
              affectedSurfaces: ["submission"],
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
          recordCount: 2,
        },
      })
    );

    const artifact = JSON.parse(fs.readFileSync(skippedFilePath, "utf8"));
    expect(artifact.reasonCodes).toEqual(["missing-member"]);
    expect(artifact.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          legacyRoundId: "9892",
          memberId: "2",
          reasonCode: "missing-member",
          affectedSurfaces: ["resource", "submission"],
        }),
        expect.objectContaining({
          legacyRoundId: "9892",
          memberId: "2",
          reasonCode: "missing-member",
          affectedSurfaces: ["submission"],
          legacySubmissionId: "10020001",
        }),
      ])
    );
  });
});
