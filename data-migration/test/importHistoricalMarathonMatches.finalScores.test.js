const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  loadLegacyFinalRowsByRoundId,
  reconcileRoundFinalScores,
} = require("../src/scripts/importHistoricalMarathonMatches/finalScores");
const {
  FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE,
} = require("../src/scripts/importHistoricalMarathonMatches/skippedArtifact");

const writeJson = (baseDir, fileName, rootKey, rows) => {
  fs.writeFileSync(
    path.join(baseDir, fileName),
    `${JSON.stringify({ [rootKey]: rows }, null, 2)}\n`,
    "utf8"
  );
};

const createFixtureDataDirectory = () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-final-scores-fixture-"));

  writeJson(baseDir, "long_component_state_1.json", "long_component_state", [
    { long_component_state_id: "1001", round_id: "9892", coder_id: "1", points: "100.0" },
    { long_component_state_id: "1002", round_id: "9892", coder_id: "2", points: "70.0" },
    { long_component_state_id: "1003", round_id: "9892", coder_id: "3", points: "60.0" },
    { long_component_state_id: "1004", round_id: "9892", coder_id: "4", points: "40.0" },
    { long_component_state_id: "2001", round_id: "10000", coder_id: "77", points: "777.0" },
  ]);
  writeJson(baseDir, "long_comp_result_1.json", "long_comp_result", [
    { round_id: "9892", coder_id: "1", system_point_total: "100.0", point_total: "90.0", placed: "1" },
    { round_id: "9892", coder_id: "2", system_point_total: null, point_total: "70.0", placed: "2" },
    { round_id: "9892", coder_id: "3", system_point_total: null, point_total: null, placed: "3" },
    { round_id: "9892", coder_id: "4", system_point_total: "40.0", point_total: null, placed: "4" },
    { round_id: "9892", coder_id: "5", system_point_total: "30.0", point_total: null, placed: "5" },
    { round_id: "10000", coder_id: "77", system_point_total: "777.0", point_total: null, placed: "1" },
  ]);

  return baseDir;
};

describe("importHistoricalMarathonMatches final score import", () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = createFixtureDataDirectory();
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("loads final candidates and applies score fallback precedence", async () => {
    const rowsByRoundId = await loadLegacyFinalRowsByRoundId({
      dataDir: fixtureDir,
      longComponentStateFile: "long_component_state_1.json",
      longCompResultPattern: "^long_comp_result_\\d+\\.json$",
      roundIds: ["9892"],
    });

    expect(rowsByRoundId.get("9892")).toEqual([
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "1",
        legacyPlacement: 1,
        scoreSource: "system_point_total",
        aggregateScore: 100,
      }),
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "2",
        legacyPlacement: 2,
        scoreSource: "point_total",
        aggregateScore: 70,
      }),
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "3",
        legacyPlacement: 3,
        scoreSource: "ranking_score",
        aggregateScore: 60,
      }),
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "4",
        legacyPlacement: 4,
        scoreSource: "system_point_total",
        aggregateScore: 40,
      }),
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "5",
        legacyPlacement: 5,
        scoreSource: "system_point_total",
        aggregateScore: 30,
      }),
    ]);
  });

  test("attaches one final per member to latest imported non-example submission and tracks skips", async () => {
    const rowsByRoundId = await loadLegacyFinalRowsByRoundId({
      dataDir: fixtureDir,
      longComponentStateFile: "long_component_state_1.json",
      longCompResultPattern: "^long_comp_result_\\d+\\.json$",
      roundIds: ["9892"],
    });

    const created = [];
    const finalScoreStore = {
      listImportedNonExampleSubmissionsByChallenge: async () => [
        {
          id: "sub-1-old",
          memberId: "1",
          legacySubmissionId: "10010001",
          submittedDate: new Date("2020-01-01T01:00:00.000Z"),
          createdAt: new Date("2020-01-01T01:00:00.000Z"),
        },
        {
          id: "sub-1-new",
          memberId: "1",
          legacySubmissionId: "10010002",
          submittedDate: new Date("2020-01-01T02:00:00.000Z"),
          createdAt: new Date("2020-01-01T02:00:00.000Z"),
        },
        {
          id: "sub-2",
          memberId: "2",
          legacySubmissionId: "10020001",
          submittedDate: new Date("2020-01-01T01:30:00.000Z"),
          createdAt: new Date("2020-01-01T01:30:00.000Z"),
        },
        {
          id: "sub-3",
          memberId: "3",
          legacySubmissionId: "10030001",
          submittedDate: new Date("2020-01-01T01:45:00.000Z"),
          createdAt: new Date("2020-01-01T01:45:00.000Z"),
        },
      ],
      listExistingFinalSummationsBySubmissionId: async () =>
        new Map([
          [
            "sub-3",
            [{ submissionId: "sub-3", aggregateScore: 60 }],
          ],
        ]),
      createFinalSummation: async (payload) => {
        created.push(payload);
      },
    };

    const result = await reconcileRoundFinalScores({
      roundId: "9892",
      challengeId: "challenge-1",
      finalRowsByRoundId: rowsByRoundId,
      normalizedIdentityByCoderId: new Map([
        ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
        ["2", { coderId: "2", memberId: 2, memberHandle: "bravo" }],
        ["3", { coderId: "3", memberId: 3, memberHandle: "charlie" }],
        ["4", { coderId: "4", memberId: 4, memberHandle: "delta" }],
        ["5", { coderId: "5", memberId: 5, memberHandle: "echo" }],
      ]),
      missingMemberFinalSkipMemberIds: new Set(["4"]),
      plannedUnattachableFinalSkipMemberIds: new Set(["5"]),
      finalScoreStore,
    });

    expect(result).toEqual({
      legacyFinalCandidates: 5,
      importedFinalScores: 3,
      alreadyPresentFinalScores: 1,
      createdFinalScores: 2,
      missingMemberSkippedFinalScores: 1,
      explicitSkippedFinalScores: 1,
      runtimeSkipRecords: [],
    });

    expect(created).toEqual([
      expect.objectContaining({
        submissionId: "sub-1-new",
        aggregateScore: 100,
        legacySubmissionId: "10010002",
      }),
      expect.objectContaining({
        submissionId: "sub-2",
        aggregateScore: 70,
        legacySubmissionId: "10020001",
      }),
    ]);
  });

  test("records runtime unattachable-finalist skip when no attachable submission exists unexpectedly", async () => {
    const rowsByRoundId = await loadLegacyFinalRowsByRoundId({
      dataDir: fixtureDir,
      longComponentStateFile: "long_component_state_1.json",
      longCompResultPattern: "^long_comp_result_\\d+\\.json$",
      roundIds: ["9892"],
    });

    const result = await reconcileRoundFinalScores({
      roundId: "9892",
      challengeId: "challenge-1",
      finalRowsByRoundId: rowsByRoundId,
      normalizedIdentityByCoderId: new Map([
        ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
        ["2", { coderId: "2", memberId: 2, memberHandle: "bravo" }],
        ["3", { coderId: "3", memberId: 3, memberHandle: "charlie" }],
        ["4", { coderId: "4", memberId: 4, memberHandle: "delta" }],
        ["5", { coderId: "5", memberId: 5, memberHandle: "echo" }],
      ]),
      missingMemberFinalSkipMemberIds: new Set(["4"]),
      plannedUnattachableFinalSkipMemberIds: new Set(),
      finalScoreStore: {
        listImportedNonExampleSubmissionsByChallenge: async () => [
          {
            id: "sub-1",
            memberId: "1",
            legacySubmissionId: "10010001",
            submittedDate: new Date("2020-01-01T01:00:00.000Z"),
            createdAt: new Date("2020-01-01T01:00:00.000Z"),
          },
          {
            id: "sub-2",
            memberId: "2",
            legacySubmissionId: "10020001",
            submittedDate: new Date("2020-01-01T01:00:00.000Z"),
            createdAt: new Date("2020-01-01T01:00:00.000Z"),
          },
          {
            id: "sub-3",
            memberId: "3",
            legacySubmissionId: "10030001",
            submittedDate: new Date("2020-01-01T01:00:00.000Z"),
            createdAt: new Date("2020-01-01T01:00:00.000Z"),
          },
        ],
        listExistingFinalSummationsBySubmissionId: async () => new Map(),
        createFinalSummation: jest.fn(),
      },
    });

    expect(result.explicitSkippedFinalScores).toBe(1);
    expect(result.runtimeSkipRecords).toEqual([
      expect.objectContaining({
        legacyRoundId: "9892",
        memberId: "5",
        reasonCode: FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE,
        affectedSurfaces: ["final-score"],
      }),
    ]);
  });
});
