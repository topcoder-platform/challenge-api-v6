const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildDryRunPlan,
} = require("../src/scripts/importHistoricalMarathonMatches/planning");

const writeJson = (baseDir, fileName, rootKey, rows) => {
  fs.writeFileSync(
    path.join(baseDir, fileName),
    `${JSON.stringify({ [rootKey]: rows }, null, 2)}\n`,
    "utf8"
  );
};

const buildFixtureDataDirectory = () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-prereq-plan-fixture-"));

  writeJson(baseDir, "round_1.json", "round", [
    { round_id: "9892", round_type_id: "13", name: "MM 9892", short_name: "MM 9892" },
  ]);
  writeJson(baseDir, "round_component_1.json", "round_component", [
    { round_id: "9892", component_id: "5503" },
  ]);
  writeJson(baseDir, "component_1.json", "component", [
    {
      component_id: "5503",
      problem_id: "9001",
      component_text:
        "<problem_statement><h2>Robot Routing</h2><p>Public summary.</p></problem_statement>",
    },
  ]);
  writeJson(baseDir, "problem_1.json", "problem", [
    { problem_id: "9001", problem_text: "<p>Legacy <strong>problem</strong> text</p>" },
  ]);
  writeJson(baseDir, "long_component_state_1.json", "long_component_state", [
    { long_component_state_id: "lcs-1", round_id: "9892", coder_id: "1", component_id: "5503" },
  ]);
  writeJson(baseDir, "long_submission_1.json", "long_submission", [
    {
      long_component_state_id: "lcs-1",
      submission_number: "1",
      example: "0",
      submit_time: "100",
      submission_points: "10.0",
      open_time: "90",
    },
  ]);
  writeJson(baseDir, "long_comp_result_1.json", "long_comp_result", [
    { round_id: "9892", coder_id: "1", system_point_total: "98.1", point_total: null, placed: "1" },
  ]);
  writeJson(baseDir, "round_registration_1.json", "round_registration", [
    { round_id: "9892", coder_id: "1", eligible: "1", timestamp: "2020-01-01 00:00:00.0" },
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
  longSubmissionPattern: "^long_submission_\\d+\\.json$",
  longCompResultPattern: "^long_comp_result_\\d+\\.json$",
  roundIds: ["9892"],
});

describe("importHistoricalMarathonMatches planning prerequisites", () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = buildFixtureDataDirectory();
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("returns unresolved when canonical MM/DS timeline template is unavailable", async () => {
    const plan = await buildDryRunPlan(
      buildOptions(fixtureDir),
      new Map(),
      {
        authoritativeDiscovery: { available: true },
        canonicalTimelineTemplate: {
          resolved: false,
          reason: "canonical-mm-ds-timeline-template-unresolved",
        },
      }
    );

    expect(plan.records).toHaveLength(1);
    expect(plan.records[0].decision).toBe("unresolved");
    expect(plan.records[0].reason).toBe("canonical-mm-ds-timeline-template-unresolved");
    expect(plan.records[0].createPathChallengeShape).toBe(null);
    expect(plan.records[0].createPathPhasePlan).toBe(null);
  });

  test("returns create only after canonical MM/DS timeline template is resolved", async () => {
    const plan = await buildDryRunPlan(
      buildOptions(fixtureDir),
      new Map(),
      {
        authoritativeDiscovery: { available: true },
        canonicalTimelineTemplate: {
          resolved: true,
          timelineTemplateId: "timeline-mm",
        },
        memberResolution: {
          available: true,
          resolvedMemberIds: new Set(["1"]),
        },
      }
    );

    expect(plan.records).toHaveLength(1);
    expect(plan.records[0].decision).toBe("create");
    expect(plan.records[0].reason).toBe("no-matching-v6-challenge-found");
    expect(plan.records[0].createPathChallengeShape).toEqual({
      type: "Marathon Match",
      track: "Data Science",
      status: "COMPLETED",
      phaseNames: ["Registration", "Submission", "Review"],
      timelineTemplateId: "timeline-mm",
    });
  });

  test("captures mapped raw legacy problem HTML for apply-mode description sourcing", async () => {
    const plan = await buildDryRunPlan(
      buildOptions(fixtureDir),
      new Map(),
      {
        authoritativeDiscovery: { available: true },
        canonicalTimelineTemplate: {
          resolved: true,
          timelineTemplateId: "timeline-mm",
        },
        memberResolution: {
          available: true,
          resolvedMemberIds: new Set(["1"]),
        },
      }
    );

    const counters = plan.roundDataById.get("9892");
    expect(counters.descriptionProblemId).toBe("9001");
    expect(counters.descriptionProblemText).toBe(
      "<p>Legacy <strong>problem</strong> text</p>"
    );
  });

  test("captures component_text markdown fallback when problem text is unusable", async () => {
    writeJson(fixtureDir, "problem_1.json", "problem", [
      { problem_id: "9001", problem_text: "   " },
    ]);
    writeJson(fixtureDir, "component_1.json", "component", [
      {
        component_id: "5503",
        problem_id: "9001",
        component_text:
          "<problem_statement><h2>Robot Routing</h2><p>Public summary.</p><hidden_test_cases><case>secret</case></hidden_test_cases></problem_statement>",
      },
    ]);

    const plan = await buildDryRunPlan(
      buildOptions(fixtureDir),
      new Map(),
      {
        authoritativeDiscovery: { available: true },
        canonicalTimelineTemplate: {
          resolved: true,
          timelineTemplateId: "timeline-mm",
        },
        memberResolution: {
          available: true,
          resolvedMemberIds: new Set(["1"]),
        },
      }
    );

    const counters = plan.roundDataById.get("9892");
    expect(counters.descriptionProblemId).toBe(null);
    expect(counters.descriptionProblemText).toBe(null);
    expect(counters.descriptionComponentId).toBe("5503");
    expect(counters.descriptionComponentTextMarkdown).toContain("Robot Routing");
    expect(counters.descriptionComponentTextMarkdown).toContain("Public summary.");
    expect(counters.descriptionComponentTextMarkdown).not.toContain("<problem_statement>");
    expect(counters.descriptionComponentTextMarkdown).not.toContain("secret");
  });
});
