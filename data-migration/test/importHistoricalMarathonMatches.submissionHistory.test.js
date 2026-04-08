const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  loadNonExampleLegacySubmissionRowsByRoundId,
  reconcileRoundSubmissionHistory,
} = require("../src/scripts/importHistoricalMarathonMatches/submissionHistory");

const writeJson = (baseDir, fileName, rootKey, rows) => {
  fs.writeFileSync(
    path.join(baseDir, fileName),
    `${JSON.stringify({ [rootKey]: rows }, null, 2)}\n`,
    "utf8"
  );
};

const createFixtureDataDirectory = () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-submission-history-fixture-"));

  writeJson(baseDir, "long_component_state_1.json", "long_component_state", [
    { long_component_state_id: "1001", round_id: "9892", coder_id: "1", component_id: "5503" },
    { long_component_state_id: "1002", round_id: "9892", coder_id: "2", component_id: "5503" },
    { long_component_state_id: "1003", round_id: "9892", coder_id: "3", component_id: "5503" },
  ]);
  writeJson(baseDir, "long_submission_1.json", "long_submission", [
    { long_component_state_id: "1001", submission_number: "1", example: "0", submit_time: "1000" },
    { long_component_state_id: "1001", submission_number: "2", example: "1", submit_time: "1001" },
    { long_component_state_id: "1001", submission_number: "3", example: "0", submit_time: "1002" },
    { long_component_state_id: "1002", submission_number: "1", example: "0", submit_time: "1003" },
    { long_component_state_id: "1003", submission_number: "1", example: "1", submit_time: "1004" },
    { long_component_state_id: "1003", submission_number: "2", example: "1", submit_time: "1005" },
  ]);

  return baseDir;
};

const createInMemorySubmissionStore = () => {
  const byChallengeId = new Map();
  return {
    listExistingSubmissionsByLegacyId: async ({ challengeId }) =>
      new Map(byChallengeId.get(challengeId) || []),
    createSubmission: async ({ challengeId, legacySubmissionId, memberId, memberHandle, submittedDate }) => {
      if (!byChallengeId.has(challengeId)) {
        byChallengeId.set(challengeId, new Map());
      }
      byChallengeId.get(challengeId).set(legacySubmissionId, {
        legacySubmissionId,
        memberId: String(memberId),
        submitter: memberHandle || null,
        submittedDate: submittedDate ? submittedDate.toISOString() : null,
      });
    },
  };
};

describe("importHistoricalMarathonMatches submission history", () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = createFixtureDataDirectory();
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("loads non-example rows only and derives deterministic legacySubmissionId values", async () => {
    const rowsByRoundId = await loadNonExampleLegacySubmissionRowsByRoundId({
      dataDir: fixtureDir,
      longComponentStateFile: "long_component_state_1.json",
      longSubmissionPattern: "^long_submission_\\d+\\.json$",
      roundIds: ["9892"],
    });

    expect(rowsByRoundId.get("9892")).toEqual([
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "1",
        longComponentStateId: "1001",
        submissionNumber: 1,
        legacySubmissionId: "10010001",
      }),
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "1",
        longComponentStateId: "1001",
        submissionNumber: 3,
        legacySubmissionId: "10010003",
      }),
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "2",
        longComponentStateId: "1002",
        submissionNumber: 1,
        legacySubmissionId: "10020001",
      }),
    ]);
  });

  test("imports resolvable rows, skips missing-member rows with submission identities, and is rerun-idempotent", async () => {
    const rowsByRoundId = await loadNonExampleLegacySubmissionRowsByRoundId({
      dataDir: fixtureDir,
      longComponentStateFile: "long_component_state_1.json",
      longSubmissionPattern: "^long_submission_\\d+\\.json$",
      roundIds: ["9892"],
    });
    const submissionStore = createInMemorySubmissionStore();
    const normalizedIdentityByCoderId = new Map([
      ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
      ["2", { coderId: "2", memberId: 2, memberHandle: "bravo" }],
    ]);

    const firstRun = await reconcileRoundSubmissionHistory({
      roundId: "9892",
      challengeId: "challenge-1",
      rowsByRoundId,
      normalizedIdentityByCoderId,
      missingMemberSubmissionSkipMemberIds: new Set(["2"]),
      submissionStore,
    });

    expect(firstRun).toEqual({
      legacyNonExampleSubmissions: 3,
      legacyExampleOnlyFinalistSubmissions: 0,
      importedSubmissions: 2,
      alreadyPresentSubmissions: 0,
      createdSubmissions: 2,
      missingMemberSkippedSubmissions: 1,
      importedDistinctSubmitters: 1,
      missingMemberDistinctSubmitters: 1,
      importedSubmissionCountsByMemberId: {
        1: 2,
      },
      skippedSubmissionRecords: [
        expect.objectContaining({
          legacyRoundId: "9892",
          memberId: "2",
          reasonCode: "missing-member",
          affectedSurfaces: ["submission"],
          legacySubmissionId: "10020001",
          counts: {
            submission: 1,
          },
        }),
      ],
    });

    const secondRun = await reconcileRoundSubmissionHistory({
      roundId: "9892",
      challengeId: "challenge-1",
      rowsByRoundId,
      normalizedIdentityByCoderId,
      missingMemberSubmissionSkipMemberIds: new Set(["2"]),
      submissionStore,
    });

    expect(secondRun).toEqual({
      legacyNonExampleSubmissions: 3,
      legacyExampleOnlyFinalistSubmissions: 0,
      importedSubmissions: 2,
      alreadyPresentSubmissions: 2,
      createdSubmissions: 0,
      missingMemberSkippedSubmissions: 1,
      importedDistinctSubmitters: 1,
      missingMemberDistinctSubmitters: 1,
      importedSubmissionCountsByMemberId: {
        1: 2,
      },
      skippedSubmissionRecords: [
        expect.objectContaining({
          legacyRoundId: "9892",
          memberId: "2",
          reasonCode: "missing-member",
          affectedSurfaces: ["submission"],
          legacySubmissionId: "10020001",
          counts: {
            submission: 1,
          },
        }),
      ],
    });
  });

  test("fails when an existing legacySubmissionId is already attached to a different memberId", async () => {
    const rowsByRoundId = await loadNonExampleLegacySubmissionRowsByRoundId({
      dataDir: fixtureDir,
      longComponentStateFile: "long_component_state_1.json",
      longSubmissionPattern: "^long_submission_\\d+\\.json$",
      roundIds: ["9892"],
    });
    const submissionStore = {
      listExistingSubmissionsByLegacyId: async () =>
        new Map([
          [
            "10010001",
            { legacySubmissionId: "10010001", memberId: "999", submitter: "wrong-member" },
          ],
        ]),
      createSubmission: jest.fn(),
    };

    await expect(
      reconcileRoundSubmissionHistory({
        roundId: "9892",
        challengeId: "challenge-1",
        rowsByRoundId,
        normalizedIdentityByCoderId: new Map([
          ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
          ["2", { coderId: "2", memberId: 2, memberHandle: "bravo" }],
        ]),
        missingMemberSubmissionSkipMemberIds: new Set(),
        submissionStore,
      })
    ).rejects.toThrow(
      'Existing submission legacySubmissionId "10010001" is linked to memberId 999 but legacy coder 1 resolves to memberId 1.'
    );
  });

  test("materializes the latest example-only finalist submission when requested", async () => {
    const rowsByRoundId = await loadNonExampleLegacySubmissionRowsByRoundId({
      dataDir: fixtureDir,
      longComponentStateFile: "long_component_state_1.json",
      longSubmissionPattern: "^long_submission_\\d+\\.json$",
      roundIds: ["9892"],
      attachableExampleOnlyFinalistCoderIdsByRoundId: new Map([
        ["9892", new Set(["3"])],
      ]),
    });

    expect(rowsByRoundId.get("9892")).toEqual([
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "1",
        legacySubmissionId: "10010001",
        isSyntheticExampleOnlyFinalist: false,
      }),
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "1",
        legacySubmissionId: "10010003",
        isSyntheticExampleOnlyFinalist: false,
      }),
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "2",
        legacySubmissionId: "10020001",
        isSyntheticExampleOnlyFinalist: false,
      }),
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "3",
        legacySubmissionId: "10030002",
        isSyntheticExampleOnlyFinalist: true,
      }),
    ]);
  });
});
