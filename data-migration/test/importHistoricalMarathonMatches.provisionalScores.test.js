const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  loadLegacyProvisionalRowsByRoundId,
  reconcileRoundProvisionalScores,
} = require("../src/scripts/importHistoricalMarathonMatches/provisionalScores");

const writeJson = (baseDir, fileName, rootKey, rows) => {
  fs.writeFileSync(
    path.join(baseDir, fileName),
    `${JSON.stringify({ [rootKey]: rows }, null, 2)}\n`,
    "utf8"
  );
};

const createFixtureDataDirectory = () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-provisional-scores-fixture-"));

  writeJson(baseDir, "long_component_state_1.json", "long_component_state", [
    { long_component_state_id: "1001", round_id: "9892", coder_id: "1", component_id: "5503" },
    { long_component_state_id: "1002", round_id: "9892", coder_id: "2", component_id: "5503" },
    { long_component_state_id: "1003", round_id: "9892", coder_id: "3", component_id: "5503" },
  ]);
  writeJson(baseDir, "long_submission_1.json", "long_submission", [
    {
      long_component_state_id: "1001",
      submission_number: "1",
      example: "0",
      submit_time: "1000",
      submission_points: "9.5",
    },
    {
      long_component_state_id: "1001",
      submission_number: "2",
      example: "1",
      submit_time: "1001",
      submission_points: "200.0",
    },
    {
      long_component_state_id: "1001",
      submission_number: "3",
      example: "0",
      submit_time: "1002",
      submission_points: "8.25",
    },
    {
      long_component_state_id: "1002",
      submission_number: "1",
      example: "0",
      submit_time: "1003",
      submission_points: "7.0",
    },
    {
      long_component_state_id: "1003",
      submission_number: "1",
      example: "1",
      submit_time: "1004",
      submission_points: "6.0",
    },
    {
      long_component_state_id: "1003",
      submission_number: "2",
      example: "1",
      submit_time: "1005",
      submission_points: "5.5",
    },
  ]);

  return baseDir;
};

describe("importHistoricalMarathonMatches provisional score import", () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = createFixtureDataDirectory();
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("loads non-example provisional rows keyed by legacySubmissionId and score", async () => {
    const rowsByRoundId = await loadLegacyProvisionalRowsByRoundId({
      dataDir: fixtureDir,
      longComponentStateFile: "long_component_state_1.json",
      longSubmissionPattern: "^long_submission_\\d+\\.json$",
      roundIds: ["9892"],
    });

    expect(rowsByRoundId.get("9892")).toEqual([
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "1",
        legacySubmissionId: "10010001",
        aggregateScore: 9.5,
      }),
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "1",
        legacySubmissionId: "10010003",
        aggregateScore: 8.25,
      }),
      expect.objectContaining({
        legacyRoundId: "9892",
        coderId: "2",
        legacySubmissionId: "10020001",
        aggregateScore: 7,
      }),
    ]);
  });

  test("imports one provisional per imported submission, skips missing members, and is rerun-idempotent", async () => {
    const rowsByRoundId = await loadLegacyProvisionalRowsByRoundId({
      dataDir: fixtureDir,
      longComponentStateFile: "long_component_state_1.json",
      longSubmissionPattern: "^long_submission_\\d+\\.json$",
      roundIds: ["9892"],
    });

    const importedSubmissionByLegacySubmissionId = new Map([
      [
        "10010001",
        {
          id: "sub-10010001",
          memberId: "1",
          legacySubmissionId: "10010001",
          submittedDate: new Date("2020-01-01T01:00:00.000Z"),
          createdAt: new Date("2020-01-01T01:00:00.000Z"),
        },
      ],
      [
        "10010003",
        {
          id: "sub-10010003",
          memberId: "1",
          legacySubmissionId: "10010003",
          submittedDate: new Date("2020-01-01T02:00:00.000Z"),
          createdAt: new Date("2020-01-01T02:00:00.000Z"),
        },
      ],
      [
        "10020001",
        {
          id: "sub-10020001",
          memberId: "2",
          legacySubmissionId: "10020001",
          submittedDate: new Date("2020-01-01T03:00:00.000Z"),
          createdAt: new Date("2020-01-01T03:00:00.000Z"),
        },
      ],
    ]);
    const existingProvisionalBySubmissionId = new Map([
      [
        "sub-10010003",
        [{ submissionId: "sub-10010003", aggregateScore: 8.25 }],
      ],
    ]);
    const created = [];

    const provisionalScoreStore = {
      listImportedNonExampleSubmissionsByLegacySubmissionId: async () =>
        new Map(importedSubmissionByLegacySubmissionId),
      listExistingProvisionalSummationsBySubmissionId: async () =>
        new Map(existingProvisionalBySubmissionId),
      createProvisionalSummation: async (payload) => {
        created.push(payload);
        existingProvisionalBySubmissionId.set(payload.submissionId, [
          {
            submissionId: payload.submissionId,
            aggregateScore: payload.aggregateScore,
          },
        ]);
      },
    };

    const firstRun = await reconcileRoundProvisionalScores({
      roundId: "9892",
      challengeId: "challenge-1",
      provisionalRowsByRoundId: rowsByRoundId,
      normalizedIdentityByCoderId: new Map([
        ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
        ["2", { coderId: "2", memberId: 2, memberHandle: "bravo" }],
      ]),
      missingMemberProvisionalSkipMemberIds: new Set(["2"]),
      provisionalScoreStore,
    });

    expect(firstRun).toEqual({
      legacyNonExampleProvisionalScores: 3,
      legacyExampleOnlyFinalistProvisionalScores: 0,
      importedProvisionalScores: 2,
      alreadyPresentProvisionalScores: 1,
      createdProvisionalScores: 1,
      malformedSkippedProvisionalScores: 0,
      missingMemberSkippedProvisionalScores: 1,
      importedDistinctSubmitters: 1,
      missingMemberDistinctSubmitters: 1,
      importedProvisionalCountsByMemberId: {
        1: 2,
      },
      skippedProvisionalRecords: [
        expect.objectContaining({
          legacyRoundId: "9892",
          memberId: "2",
          reasonCode: "missing-member",
          affectedSurfaces: ["provisional-score"],
          legacySubmissionId: "10020001",
          counts: {
            provisionalScore: 1,
          },
        }),
      ],
    });
    expect(created).toEqual([
      expect.objectContaining({
        submissionId: "sub-10010001",
        aggregateScore: 9.5,
        legacySubmissionId: "10010001",
        isFinal: false,
      }),
    ]);

    const secondRun = await reconcileRoundProvisionalScores({
      roundId: "9892",
      challengeId: "challenge-1",
      provisionalRowsByRoundId: rowsByRoundId,
      normalizedIdentityByCoderId: new Map([
        ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
        ["2", { coderId: "2", memberId: 2, memberHandle: "bravo" }],
      ]),
      missingMemberProvisionalSkipMemberIds: new Set(["2"]),
      provisionalScoreStore,
    });

    expect(secondRun).toEqual({
      legacyNonExampleProvisionalScores: 3,
      legacyExampleOnlyFinalistProvisionalScores: 0,
      importedProvisionalScores: 2,
      alreadyPresentProvisionalScores: 2,
      createdProvisionalScores: 0,
      malformedSkippedProvisionalScores: 0,
      missingMemberSkippedProvisionalScores: 1,
      importedDistinctSubmitters: 1,
      missingMemberDistinctSubmitters: 1,
      importedProvisionalCountsByMemberId: {
        1: 2,
      },
      skippedProvisionalRecords: [
        expect.objectContaining({
          legacyRoundId: "9892",
          memberId: "2",
          reasonCode: "missing-member",
          affectedSurfaces: ["provisional-score"],
          legacySubmissionId: "10020001",
          counts: {
            provisionalScore: 1,
          },
        }),
      ],
    });
  });

  test("skips malformed provisional rows with missing numeric submission_points and continues importing valid rows", async () => {
    const rowsByRoundId = await loadLegacyProvisionalRowsByRoundId({
      dataDir: fixtureDir,
      longComponentStateFile: "long_component_state_1.json",
      longSubmissionPattern: "^long_submission_\\d+\\.json$",
      roundIds: ["9892"],
    });

    const malformedRows = rowsByRoundId.get("9892").map((row) =>
      row.legacySubmissionId === "10010001"
        ? { ...row, aggregateScore: null }
        : row
    );
    rowsByRoundId.set("9892", malformedRows);

    const created = [];
    const provisionalScoreStore = {
      listImportedNonExampleSubmissionsByLegacySubmissionId: async () =>
        new Map([
          ["10010001", { id: "sub-10010001", memberId: "1", legacySubmissionId: "10010001" }],
          ["10010003", { id: "sub-10010003", memberId: "1", legacySubmissionId: "10010003" }],
          ["10020001", { id: "sub-10020001", memberId: "2", legacySubmissionId: "10020001" }],
        ]),
      listExistingProvisionalSummationsBySubmissionId: async () => new Map(),
      createProvisionalSummation: async (payload) => {
        created.push(payload);
      },
    };

    const result = await reconcileRoundProvisionalScores({
      roundId: "9892",
      challengeId: "challenge-1",
      provisionalRowsByRoundId: rowsByRoundId,
      normalizedIdentityByCoderId: new Map([
        ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
        ["2", { coderId: "2", memberId: 2, memberHandle: "bravo" }],
      ]),
      provisionalScoreStore,
    });

    expect(result).toEqual({
      legacyNonExampleProvisionalScores: 3,
      legacyExampleOnlyFinalistProvisionalScores: 0,
      importedProvisionalScores: 2,
      alreadyPresentProvisionalScores: 0,
      createdProvisionalScores: 2,
      malformedSkippedProvisionalScores: 1,
      missingMemberSkippedProvisionalScores: 0,
      importedDistinctSubmitters: 2,
      missingMemberDistinctSubmitters: 0,
      importedProvisionalCountsByMemberId: {
        1: 1,
        2: 1,
      },
      skippedProvisionalRecords: [
        expect.objectContaining({
          legacyRoundId: "9892",
          memberId: "1",
          reasonCode: "malformed-provisional-score",
          affectedSurfaces: ["provisional-score"],
          legacySubmissionId: "10010001",
          counts: {
            provisionalScore: 1,
          },
        }),
      ],
    });
    expect(created).toEqual([
      expect.objectContaining({
        submissionId: "sub-10010003",
        aggregateScore: 8.25,
      }),
      expect.objectContaining({
        submissionId: "sub-10020001",
        aggregateScore: 7,
      }),
    ]);
  });

  test("loads the latest example-only finalist provisional row when requested", async () => {
    const rowsByRoundId = await loadLegacyProvisionalRowsByRoundId({
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
        aggregateScore: 5.5,
        isSyntheticExampleOnlyFinalist: true,
      }),
    ]);
  });
});
