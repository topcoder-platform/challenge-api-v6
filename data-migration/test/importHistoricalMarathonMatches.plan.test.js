const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const scriptPath = path.resolve(
  __dirname,
  "../src/scripts/importHistoricalMarathonMatches.js"
);

const writeJson = (baseDir, fileName, rootKey, rows) => {
  fs.writeFileSync(
    path.join(baseDir, fileName),
    `${JSON.stringify({ [rootKey]: rows }, null, 2)}\n`,
    "utf8"
  );
};

const buildFixtureDataDirectory = () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-plan-fixture-"));

  writeJson(baseDir, "round_1.json", "round", [
    { round_id: "9892", round_type_id: "13", name: "MM 9892", short_name: "MM 9892" },
    { round_id: "7000", round_type_id: "13", name: "MM 7000", short_name: "MM 7000" },
  ]);

  writeJson(baseDir, "round_component_1.json", "round_component", [
    { round_id: "9892", component_id: "5503" },
    { round_id: "9892", component_id: "5504" },
    { round_id: "7000", component_id: "7777" },
  ]);

  writeJson(baseDir, "component_1.json", "component", [
    { component_id: "5503", problem_id: "9001" },
    { component_id: "5504", problem_id: "9002" },
    { component_id: "7777", problem_id: "9999" },
  ]);

  writeJson(baseDir, "problem_1.json", "problem", [
    { problem_id: "9001" },
    { problem_id: "9002" },
    { problem_id: "9999" },
  ]);

  writeJson(baseDir, "long_component_state_1.json", "long_component_state", [
    { long_component_state_id: "lcs-1", round_id: "9892", coder_id: "1", component_id: "5503" },
    { long_component_state_id: "lcs-2", round_id: "9892", coder_id: "2", component_id: "5504" },
    { long_component_state_id: "lcs-3", round_id: "7000", coder_id: "8", component_id: "7777" },
  ]);

  writeJson(baseDir, "long_submission_1.json", "long_submission", [
    { long_component_state_id: "lcs-1", submission_number: "1", example: "0", submit_time: "100", submission_points: "10.0" },
    { long_component_state_id: "lcs-1", submission_number: "2", example: "1", submit_time: "101", submission_points: "11.0" },
    { long_component_state_id: "lcs-1", submission_number: "3", example: "0", submit_time: "102", submission_points: "12.0" },
    { long_component_state_id: "lcs-2", submission_number: "1", example: "0", submit_time: "103", submission_points: "13.0" },
    { long_component_state_id: "lcs-3", submission_number: "1", example: "0", submit_time: "104", submission_points: "14.0" },
  ]);

  writeJson(baseDir, "long_comp_result_1.json", "long_comp_result", [
    { round_id: "9892", coder_id: "1", system_point_total: "98.1", point_total: null, placed: "1" },
    { round_id: "9892", coder_id: "2", system_point_total: null, point_total: "91.5", placed: "2" },
    { round_id: "9892", coder_id: "3", system_point_total: null, point_total: null, placed: "3" },
    { round_id: "7000", coder_id: "8", system_point_total: "77.0", point_total: null, placed: "1" },
  ]);

  writeJson(baseDir, "round_registration_1.json", "round_registration", [
    { round_id: "9892", coder_id: "1", eligible: "1", timestamp: "2020-01-01 00:00:00.0" },
    { round_id: "9892", coder_id: "2", eligible: "1", timestamp: "2020-01-01 00:01:00.0" },
    { round_id: "9892", coder_id: "2", eligible: "1", timestamp: "2020-01-01 00:02:00.0" },
    { round_id: "9892", coder_id: "3", eligible: "0", timestamp: "2020-01-01 00:03:00.0" },
    { round_id: "7000", coder_id: "8", eligible: "1", timestamp: "2020-01-01 00:04:00.0" },
  ]);

  fs.writeFileSync(
    path.join(baseDir, "existing-state.json"),
    `${JSON.stringify(
      {
        rounds: [
          {
            legacyRoundId: "9892",
            challengeId: "e3f97773-2f76-4657-b22d-9cb5a95d310a",
            existing: {
              phases: 3,
              resources: 2,
              submissions: 3,
              finalScores: 2,
              provisionalScores: 3,
            },
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return baseDir;
};

const runImporter = (args, fixtureDir, extraEnv = {}) =>
  spawnSync(process.execPath, [scriptPath, ...args], {
    env: { ...process.env, ...extraEnv },
    cwd: fixtureDir,
    encoding: "utf8",
  });

const parseRecords = (stdout) =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith("PLAN_RECORD "))
    .map((line) => JSON.parse(line.replace("PLAN_RECORD ", "")));

describe("importHistoricalMarathonMatches CLI planning behavior", () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = buildFixtureDataDirectory();
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("help is safe and exits successfully without write-side env", () => {
    const result = runImporter(["--help"], fixtureDir, {
      DATABASE_URL: "",
      REVIEW_DB_URL: "",
      RESOURCES_API_URL: "",
      AUTH0_CLIENT_ID: "",
      AUTH0_CLIENT_SECRET: "",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("--round-id");
    expect(result.stdout).toContain("--round-ids");
    expect(result.stdout).toContain("--dry-run");
  });

  test("unknown options fail fast with actionable error", () => {
    const result = runImporter(["--wat"], fixtureDir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unknown option: --wat");
  });

  test("malformed round filters fail fast with actionable error", () => {
    const result = runImporter(["--data-dir", fixtureDir, "--round-ids", "9892,abc"], fixtureDir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid round id value \"abc\"");
  });

  test("dry-run emits one deterministic parseable record per selected round including unmatched", () => {
    const args = [
      "--data-dir",
      fixtureDir,
      "--dry-run",
      "--round-id",
      "9892",
      "--round-ids",
      " 9892,9999 ",
    ];
    const firstRun = runImporter(args, fixtureDir);
    const secondRun = runImporter(args, fixtureDir);

    expect(firstRun.status).toBe(0);
    expect(secondRun.status).toBe(0);
    expect(firstRun.stdout).toBe(secondRun.stdout);

    const records = parseRecords(firstRun.stdout);
    expect(records).toHaveLength(2);
    expect(records.map((entry) => entry.legacyRoundId)).toEqual(["9892", "9999"]);

    const matched = records.find((entry) => entry.legacyRoundId === "9892");
    expect(matched.decision).toBe("create");
    expect(matched.summaryCounts).toEqual({
      eligibleRegistrants: 2,
      nonExampleSubmissions: 3,
      exampleSubmissionsFiltered: 1,
      plannedFinalScores: 2,
      plannedProvisionalScores: 3,
      finalistsWithoutAttachableSubmission: 1,
    });
    expect(matched.traceability).toEqual({
      legacyRoundId: "9892",
      legacyComponentIds: ["5503", "5504"],
      legacyProblemIds: ["9001", "9002"],
    });

    const unmatched = records.find((entry) => entry.legacyRoundId === "9999");
    expect(unmatched.decision).toBe("unmatched");
    expect(unmatched.reason).toBe("selected-round-not-found-in-legacy-source");
  });

  test("existing challenge snapshots produce reuse/backfill-only deltas and rerun no-op classification", () => {
    const result = runImporter(
      [
        "--data-dir",
        fixtureDir,
        "--dry-run",
        "--round-id",
        "9892",
        "--existing-state-file",
        path.join(fixtureDir, "existing-state.json"),
      ],
      fixtureDir
    );

    expect(result.status).toBe(0);

    const [record] = parseRecords(result.stdout);
    expect(record.decision).toBe("reuse/backfill-only");
    expect(record.reason).toBe("existing-v6-challenge-found");
    expect(record.matchedChallengeId).toBe("e3f97773-2f76-4657-b22d-9cb5a95d310a");
    expect(record.rerunClassification).toBe("no-op");
    expect(record.entityDeltas.phases).toEqual({
      target: 3,
      existing: 3,
      toCreate: 0,
      unchanged: 3,
    });
    expect(record.entityDeltas.resources).toEqual({
      target: 2,
      existing: 2,
      toCreate: 0,
      unchanged: 2,
    });
    expect(record.entityDeltas.submissions).toEqual({
      target: 3,
      existing: 3,
      toCreate: 0,
      unchanged: 3,
    });
    expect(record.entityDeltas.finalScores).toEqual({
      target: 2,
      existing: 2,
      toCreate: 0,
      unchanged: 2,
      skippedUnattachableFinalists: 1,
    });
    expect(record.entityDeltas.provisionalScores).toEqual({
      target: 3,
      existing: 3,
      toCreate: 0,
      unchanged: 3,
    });
  });
});
