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

  test("keeps non-example provisional rows when example and contest submissions reuse submission numbers", async () => {
    const duplicateNumberFixtureDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mm-provisional-duplicate-number-fixture-")
    );
    try {
      writeJson(
        duplicateNumberFixtureDir,
        "long_component_state_1.json",
        "long_component_state",
        [
          {
            long_component_state_id: "2720455",
            round_id: "10082",
            coder_id: "10597114",
            component_id: "5910",
          },
        ]
      );
      writeJson(
        duplicateNumberFixtureDir,
        "long_submission_1.json",
        "long_submission",
        [
          {
            long_component_state_id: "2720455",
            submission_number: "1",
            example: "1",
            submit_time: "1149722902515",
            submission_points: "0.00",
          },
          {
            long_component_state_id: "2720455",
            submission_number: "1",
            example: "0",
            submit_time: "1149724742959",
            submission_points: "78.05",
          },
          {
            long_component_state_id: "2720455",
            submission_number: "2",
            example: "0",
            submit_time: "1149854727339",
            submission_points: "78.53",
          },
          {
            long_component_state_id: "2720455",
            submission_number: "3",
            example: "0",
            submit_time: "1150020945504",
            submission_points: "83.86",
          },
          {
            long_component_state_id: "2720455",
            submission_number: "2",
            example: "1",
            submit_time: "1150021804459",
            submission_points: "0.00",
          },
          {
            long_component_state_id: "2720455",
            submission_number: "3",
            example: "1",
            submit_time: "1150032979378",
            submission_points: "0.00",
          },
          {
            long_component_state_id: "2720455",
            submission_number: "4",
            example: "0",
            submit_time: "1150037434143",
            submission_points: "91.07",
          },
          {
            long_component_state_id: "2720455",
            submission_number: "4",
            example: "1",
            submit_time: "1150293594688",
            submission_points: "0.00",
          },
          {
            long_component_state_id: "2720455",
            submission_number: "5",
            example: "0",
            submit_time: "1150294561706",
            submission_points: "103.30",
          },
        ]
      );

      const rowsByRoundId = await loadLegacyProvisionalRowsByRoundId({
        dataDir: duplicateNumberFixtureDir,
        longComponentStateFile: "long_component_state_1.json",
        longSubmissionPattern: "^long_submission_\\d+\\.json$",
        roundIds: ["10082"],
      });

      expect(rowsByRoundId.get("10082")).toEqual([
        expect.objectContaining({
          coderId: "10597114",
          legacySubmissionId: "27204550001",
          aggregateScore: 78.05,
        }),
        expect.objectContaining({
          coderId: "10597114",
          legacySubmissionId: "27204550002",
          aggregateScore: 78.53,
        }),
        expect.objectContaining({
          coderId: "10597114",
          legacySubmissionId: "27204550003",
          aggregateScore: 83.86,
        }),
        expect.objectContaining({
          coderId: "10597114",
          legacySubmissionId: "27204550004",
          aggregateScore: 91.07,
        }),
        expect.objectContaining({
          coderId: "10597114",
          legacySubmissionId: "27204550005",
          aggregateScore: 103.3,
        }),
      ]);
    } finally {
      fs.rmSync(duplicateNumberFixtureDir, { recursive: true, force: true });
    }
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

  test("updates mismatched existing provisional scores when targeted rerun update mode is enabled", async () => {
    const rowsByRoundId = await loadLegacyProvisionalRowsByRoundId({
      dataDir: fixtureDir,
      longComponentStateFile: "long_component_state_1.json",
      longSubmissionPattern: "^long_submission_\\d+\\.json$",
      roundIds: ["9892"],
    });

    const updated = [];
    const provisionalScoreStore = {
      listImportedNonExampleSubmissionsByLegacySubmissionId: async () =>
        new Map([
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
        ]),
      listExistingProvisionalSummationsBySubmissionId: async () =>
        new Map([
          [
            "sub-10010001",
            [{ id: "prov-1", submissionId: "sub-10010001", aggregateScore: 1 }],
          ],
        ]),
      createProvisionalSummation: async () => {
        throw new Error("createProvisionalSummation should not be called");
      },
      updateProvisionalSummation: async (payload) => {
        updated.push(payload);
      },
    };

    const result = await reconcileRoundProvisionalScores({
      roundId: "9892",
      challengeId: "challenge-1",
      provisionalRowsByRoundId: new Map([
        [
          "9892",
          [(rowsByRoundId.get("9892") || []).find((row) => row.legacySubmissionId === "10010001")],
        ],
      ]),
      normalizedIdentityByCoderId: new Map([
        ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
      ]),
      provisionalScoreStore,
      updateExistingScores: true,
    });

    expect(result).toEqual({
      legacyNonExampleProvisionalScores: 1,
      legacyExampleOnlyFinalistProvisionalScores: 0,
      importedProvisionalScores: 1,
      alreadyPresentProvisionalScores: 0,
      createdProvisionalScores: 0,
      updatedProvisionalScores: 1,
      demotedFinalScores: 0,
      clearedSubmissionFinalScoreSummaries: 0,
      malformedSkippedProvisionalScores: 0,
      missingMemberSkippedProvisionalScores: 0,
      importedDistinctSubmitters: 1,
      missingMemberDistinctSubmitters: 0,
      importedProvisionalCountsByMemberId: {
        1: 1,
      },
      skippedProvisionalRecords: [],
    });
    expect(updated).toEqual([
      expect.objectContaining({
        reviewSummationId: "prov-1",
        submissionId: "sub-10010001",
        aggregateScore: 9.5,
        legacySubmissionId: "10010001",
        isFinal: false,
        isExample: false,
      }),
    ]);
  });

  test("clears stale submission final score summaries for non-final submissions during targeted rerun", async () => {
    const rowsByRoundId = await loadLegacyProvisionalRowsByRoundId({
      dataDir: fixtureDir,
      longComponentStateFile: "long_component_state_1.json",
      longSubmissionPattern: "^long_submission_\\d+\\.json$",
      roundIds: ["9892"],
    });

    const cleared = [];
    const provisionalScoreStore = {
      listImportedNonExampleSubmissionsByLegacySubmissionId: async () =>
        new Map([
          [
            "10010001",
            {
              id: "sub-10010001",
              memberId: "1",
              legacySubmissionId: "10010001",
              submittedDate: new Date("2020-01-01T01:00:00.000Z"),
              createdAt: new Date("2020-01-01T01:00:00.000Z"),
              finalScore: 9.5,
              placement: 1,
              userRank: 1,
            },
          ],
        ]),
      listExistingProvisionalSummationsBySubmissionId: async () =>
        new Map([
          [
            "sub-10010001",
            [{ id: "prov-1", submissionId: "sub-10010001", aggregateScore: 9.5 }],
          ],
        ]),
      listExistingFinalSummationsBySubmissionId: async () => new Map(),
      createProvisionalSummation: async () => {
        throw new Error("createProvisionalSummation should not be called");
      },
      updateProvisionalSummation: async () => {
        throw new Error("updateProvisionalSummation should not be called");
      },
      clearSubmissionFinalScoreSummary: async (payload) => {
        cleared.push(payload);
        return true;
      },
    };

    const result = await reconcileRoundProvisionalScores({
      roundId: "9892",
      challengeId: "challenge-1",
      provisionalRowsByRoundId: new Map([
        [
          "9892",
          [(rowsByRoundId.get("9892") || []).find((row) => row.legacySubmissionId === "10010001")],
        ],
      ]),
      normalizedIdentityByCoderId: new Map([
        ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
      ]),
      provisionalScoreStore,
      updateExistingScores: true,
      finalLegacySubmissionIdsByRoundId: new Map([["9892", ["10010003"]]]),
    });

    expect(result).toEqual({
      legacyNonExampleProvisionalScores: 1,
      legacyExampleOnlyFinalistProvisionalScores: 0,
      importedProvisionalScores: 1,
      alreadyPresentProvisionalScores: 0,
      createdProvisionalScores: 0,
      updatedProvisionalScores: 1,
      demotedFinalScores: 0,
      clearedSubmissionFinalScoreSummaries: 1,
      malformedSkippedProvisionalScores: 0,
      missingMemberSkippedProvisionalScores: 0,
      importedDistinctSubmitters: 1,
      missingMemberDistinctSubmitters: 0,
      importedProvisionalCountsByMemberId: {
        1: 1,
      },
      skippedProvisionalRecords: [],
    });
    expect(cleared).toEqual([{ submissionId: "sub-10010001" }]);
  });

  test("demotes misclassified final summations on non-final submissions during targeted rerun", async () => {
    const rowsByRoundId = await loadLegacyProvisionalRowsByRoundId({
      dataDir: fixtureDir,
      longComponentStateFile: "long_component_state_1.json",
      longSubmissionPattern: "^long_submission_\\d+\\.json$",
      roundIds: ["9892"],
    });
    rowsByRoundId.set(
      "9892",
      (rowsByRoundId.get("9892") || []).filter((row) => row.coderId === "1")
    );

    const created = [];
    const updated = [];
    const cleared = [];
    const provisionalScoreStore = {
      listImportedNonExampleSubmissionsByLegacySubmissionId: async () =>
        new Map([
          [
            "10010001",
            {
              id: "sub-10010001",
              memberId: "1",
              legacySubmissionId: "10010001",
              submittedDate: new Date("2020-01-01T01:00:00.000Z"),
              createdAt: new Date("2020-01-01T01:00:00.000Z"),
              finalScore: 999,
              placement: 1,
              userRank: 1,
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
        ]),
      listExistingProvisionalSummationsBySubmissionId: async () =>
        new Map([
          [
            "sub-10010001",
            [{ id: "prov-10010001", submissionId: "sub-10010001", aggregateScore: 9.5 }],
          ],
          [
            "sub-10010003",
            [{ id: "prov-10010003", submissionId: "sub-10010003", aggregateScore: 8.25 }],
          ],
        ]),
      listExistingFinalSummationsBySubmissionId: async () =>
        new Map([
          [
            "sub-10010001",
            [{ id: "final-misclassified", submissionId: "sub-10010001", aggregateScore: 999 }],
          ],
          [
            "sub-10010003",
            [{ id: "final-correct", submissionId: "sub-10010003", aggregateScore: 8.25 }],
          ],
        ]),
      createProvisionalSummation: async (payload) => {
        created.push(payload);
      },
      updateProvisionalSummation: async (payload) => {
        updated.push(payload);
      },
      clearSubmissionFinalScoreSummary: async (payload) => {
        cleared.push(payload);
        return true;
      },
    };

    const result = await reconcileRoundProvisionalScores({
      roundId: "9892",
      challengeId: "challenge-1",
      provisionalRowsByRoundId: rowsByRoundId,
      normalizedIdentityByCoderId: new Map([
        ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
      ]),
      provisionalScoreStore,
      updateExistingScores: true,
      finalLegacySubmissionIdsByRoundId: new Map([
        ["9892", [{ legacySubmissionId: "10010003" }]],
      ]),
    });

    expect(result).toEqual({
      legacyNonExampleProvisionalScores: 2,
      legacyExampleOnlyFinalistProvisionalScores: 0,
      importedProvisionalScores: 2,
      alreadyPresentProvisionalScores: 1,
      createdProvisionalScores: 0,
      updatedProvisionalScores: 1,
      demotedFinalScores: 1,
      clearedSubmissionFinalScoreSummaries: 1,
      malformedSkippedProvisionalScores: 0,
      missingMemberSkippedProvisionalScores: 0,
      importedDistinctSubmitters: 1,
      missingMemberDistinctSubmitters: 0,
      importedProvisionalCountsByMemberId: {
        1: 2,
      },
      skippedProvisionalRecords: [],
    });
    expect(updated).toEqual([
      expect.objectContaining({
        reviewSummationId: "final-misclassified",
        submissionId: "sub-10010001",
        aggregateScore: 9.5,
        legacySubmissionId: "10010001",
        isFinal: false,
        isExample: false,
      }),
    ]);
    expect(cleared).toEqual([{ submissionId: "sub-10010001" }]);
    expect(created).toEqual([]);
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
