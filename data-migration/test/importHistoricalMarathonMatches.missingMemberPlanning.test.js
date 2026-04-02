const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildDryRunPlan,
} = require("../src/scripts/importHistoricalMarathonMatches/planning");
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

const buildFixtureDataDirectory = () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-missing-member-plan-fixture-"));

  writeJson(baseDir, "round_1.json", "round", [
    { round_id: "9892", round_type_id: "13", name: "MM 9892", short_name: "MM 9892" },
  ]);
  writeJson(baseDir, "round_component_1.json", "round_component", [
    { round_id: "9892", component_id: "5503" },
  ]);
  writeJson(baseDir, "component_1.json", "component", [
    { component_id: "5503", problem_id: "9001" },
  ]);
  writeJson(baseDir, "problem_1.json", "problem", [{ problem_id: "9001" }]);
  writeJson(baseDir, "long_component_state_1.json", "long_component_state", [
    { long_component_state_id: "lcs-1", round_id: "9892", coder_id: "1", component_id: "5503" },
    { long_component_state_id: "lcs-2", round_id: "9892", coder_id: "2", component_id: "5503" },
    { long_component_state_id: "lcs-3", round_id: "9892", coder_id: "3", component_id: "5503" },
    { long_component_state_id: "lcs-4", round_id: "9892", coder_id: "4", component_id: "5503" },
  ]);
  writeJson(baseDir, "long_submission_1.json", "long_submission", [
    { long_component_state_id: "lcs-1", submission_number: "1", example: "0", submit_time: "100", open_time: "90", submission_points: "10.0" },
    { long_component_state_id: "lcs-1", submission_number: "2", example: "1", submit_time: "101", open_time: "90", submission_points: "11.0" },
    { long_component_state_id: "lcs-2", submission_number: "1", example: "0", submit_time: "102", open_time: "90", submission_points: "12.0" },
    { long_component_state_id: "lcs-3", submission_number: "1", example: "0", submit_time: "103", open_time: "90", submission_points: "13.0" },
    { long_component_state_id: "lcs-3", submission_number: "2", example: "0", submit_time: "104", open_time: "90", submission_points: "14.0" },
  ]);
  writeJson(baseDir, "long_comp_result_1.json", "long_comp_result", [
    { round_id: "9892", coder_id: "1", system_point_total: "98.1", point_total: null, placed: "1" },
    { round_id: "9892", coder_id: "3", system_point_total: "91.5", point_total: null, placed: "2" },
    { round_id: "9892", coder_id: "4", system_point_total: "77.7", point_total: null, placed: "3" },
  ]);
  writeJson(baseDir, "round_registration_1.json", "round_registration", [
    { round_id: "9892", coder_id: "1", eligible: "1", timestamp: "2020-01-01 00:00:00.0" },
    { round_id: "9892", coder_id: "2", eligible: "1", timestamp: "2020-01-01 00:01:00.0" },
    { round_id: "9892", coder_id: "3", eligible: "1", timestamp: "2020-01-01 00:02:00.0" },
  ]);
  writeJson(baseDir, "user_1.json", "user", [
    { user_id: "1", handle: "alpha" },
    { user_id: "2", handle: "bravo" },
    { user_id: "3", handle: "charlie" },
    { user_id: "4", handle: "delta" },
  ]);

  return baseDir;
};

const buildOptions = (fixtureDir) => ({
  dataDir: fixtureDir,
  roundFile: "round_1.json",
  roundComponentFile: "round_component_1.json",
  componentFile: "component_1.json",
  problemFile: "problem_1.json",
  longComponentStateFile: "long_component_state_1.json",
  roundRegistrationPattern: "^round_registration_\\d+\\.json$",
  userPattern: "^user_\\d+\\.json$",
  longSubmissionPattern: "^long_submission_\\d+\\.json$",
  longCompResultPattern: "^long_comp_result_\\d+\\.json$",
  roundIds: ["9892"],
  skippedFilePath: path.join(fixtureDir, "skipped-members.json"),
});

describe("importHistoricalMarathonMatches missing-member planning/reporting", () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = buildFixtureDataDirectory();
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("marks round unresolved when member-resolution prerequisite is unavailable", async () => {
    const existingStateByRoundId = new Map([
      [
        "9892",
        {
          legacyRoundId: "9892",
          matchStatus: "safe",
          reason: "existing-v6-challenge-found",
          challengeId: "challenge-1",
          existing: {
            phases: 3,
            resources: 1,
            submissions: 1,
            finalScores: 0,
            provisionalScores: 1,
          },
        },
      ],
    ]);

    const plan = await buildDryRunPlan(
      buildOptions(fixtureDir),
      existingStateByRoundId,
      {
        authoritativeDiscovery: { available: true },
        canonicalTimelineTemplate: { resolved: true, timelineTemplateId: "timeline-mm" },
        memberResolution: {
          available: false,
          reason: "target-member-resolution-unavailable",
        },
      }
    );

    expect(plan.records).toHaveLength(1);
    expect(plan.records[0].decision).toBe("unresolved");
    expect(plan.records[0].reason).toBe("target-member-resolution-unavailable");
  });

  test("partitions member-owned surfaces into materialized, missing-member, and explicit skip reasons", async () => {
    const existingStateByRoundId = new Map([
      [
        "9892",
        {
          legacyRoundId: "9892",
          matchStatus: "safe",
          reason: "existing-v6-challenge-found",
          challengeId: "challenge-1",
          existing: {
            phases: 3,
            resources: 1,
            submissions: 1,
            finalScores: 0,
            provisionalScores: 1,
          },
        },
      ],
    ]);

    const plan = await buildDryRunPlan(
      buildOptions(fixtureDir),
      existingStateByRoundId,
      {
        authoritativeDiscovery: { available: true },
        canonicalTimelineTemplate: { resolved: true, timelineTemplateId: "timeline-mm" },
        memberResolution: {
          available: true,
          resolvedMemberIds: new Set(["1", "2", "4"]),
        },
      }
    );

    const [record] = plan.records;
    expect(record.decision).toBe("reuse/backfill-only");
    expect(record.partitions.resources).toEqual({
      toCreate: 1,
      alreadyPresent: 1,
      missingMember: 1,
      explicitSkips: {
        total: 0,
        byReason: {},
      },
    });
    expect(record.partitions.submissions).toEqual({
      legacyNonExample: 4,
      legacyExampleFiltered: 1,
      toImport: 1,
      alreadyPresent: 1,
      missingMember: 2,
      explicitSkips: {
        total: 0,
        byReason: {},
      },
    });
    expect(record.partitions.finalScores).toEqual({
      legacyFinalCandidates: 3,
      toImport: 1,
      alreadyPresent: 0,
      missingMember: 1,
      explicitSkips: {
        total: 1,
        byReason: {
          "finalist-without-attachable-submission": 1,
        },
      },
    });
    expect(record.partitions.provisionalScores).toEqual({
      legacyNonExample: 4,
      toImport: 1,
      alreadyPresent: 1,
      missingMember: 2,
      explicitSkips: {
        total: 0,
        byReason: {},
      },
    });

    expect(record.plannedSkipRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          legacyRoundId: "9892",
          memberId: "3",
          reasonCode: "missing-member",
          affectedSurfaces: ["resource", "submission", "final-score", "provisional-score"],
        }),
        expect.objectContaining({
          legacyRoundId: "9892",
          memberId: "4",
          reasonCode: "finalist-without-attachable-submission",
          affectedSurfaces: ["final-score"],
        }),
      ])
    );
    expect(record.skippedFileArtifact).toEqual(
      expect.objectContaining({
        path: path.join(fixtureDir, "skipped-members.json"),
      })
    );
  });

  test("apply writes deterministic skipped-member artifact with stable reason codes", async () => {
    const skippedFilePath = path.join(fixtureDir, "apply-skipped.json");
    const result = await runApplyMode({
      prisma: null,
      options: {
        roundIds: ["9892"],
        skippedFilePath,
      },
      plan: {
        records: [
          {
            legacyRoundId: "9892",
            decision: "unresolved",
            reason: "target-member-resolution-unavailable",
            plannedSkipRecords: [
              {
                legacyRoundId: "9892",
                memberId: "4",
                reasonCode: "finalist-without-attachable-submission",
                affectedSurfaces: ["final-score"],
              },
              {
                legacyRoundId: "9892",
                memberId: "3",
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
            },
          ],
        ]),
      },
      actor: "importer",
    });

    expect(result.summary).toEqual(
      expect.objectContaining({
        unresolved: 1,
        skippedFileArtifact: {
          path: skippedFilePath,
          reasonCodes: ["finalist-without-attachable-submission", "missing-member"],
          recordCount: 2,
        },
      })
    );

    const artifact = JSON.parse(fs.readFileSync(skippedFilePath, "utf8"));
    expect(artifact).toEqual({
      schemaVersion: 1,
      selectedRoundIds: ["9892"],
      reasonCodes: ["finalist-without-attachable-submission", "missing-member"],
      records: [
        {
          legacyRoundId: "9892",
          memberId: "3",
          reasonCode: "missing-member",
          affectedSurfaces: ["resource", "submission", "final-score", "provisional-score"],
        },
        {
          legacyRoundId: "9892",
          memberId: "4",
          reasonCode: "finalist-without-attachable-submission",
          affectedSurfaces: ["final-score"],
        },
      ],
    });
  });
});
