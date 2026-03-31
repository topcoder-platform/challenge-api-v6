"use strict";

const DEFAULT_OPTIONS = {
  dataDir: process.env.DATA_DIRECTORY || "/mnt/Informix",
  roundFile: "round_1.json",
  roundComponentFile: "round_component_1.json",
  componentFile: "component_1.json",
  problemFile: "problem_1.json",
  longComponentStateFile: "long_component_state_1.json",
  roundRegistrationPattern: "^round_registration_\\d+\\.json$",
  longSubmissionPattern: "^long_submission_\\d+\\.json$",
  longCompResultPattern: "^long_comp_result_\\d+\\.json$",
  existingStateFile: null,
  dryRun: true,
  apply: false,
  roundIds: [],
  help: false,
};

const isPositiveIntegerString = (value) => /^[1-9]\d*$/.test(String(value || "").trim());

const parseRoundIdValue = (value, optionName) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`${optionName} requires a value`);
  }
  if (!isPositiveIntegerString(normalized)) {
    throw new Error(`Invalid round id value "${normalized}" for ${optionName}. Expected a positive integer.`);
  }
  return normalized;
};

const requireNextValue = (argv, index, optionName) => {
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }
  return next;
};

const parseRoundIdsList = (value, optionName) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`${optionName} requires a comma-separated list`);
  }

  const parsed = [];
  normalized.split(",").forEach((entry) => {
    const candidate = String(entry || "").trim();
    if (!candidate) {
      throw new Error(`Invalid round id value "${entry}" for ${optionName}.`);
    }
    parsed.push(parseRoundIdValue(candidate, optionName));
  });

  return parsed;
};

const sortRoundIds = (roundIds) =>
  roundIds.sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));

const parseArgs = (argv) => {
  const options = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--data-dir") {
      options.dataDir = requireNextValue(argv, index, "--data-dir");
      index += 1;
      continue;
    }
    if (arg === "--round-file") {
      options.roundFile = requireNextValue(argv, index, "--round-file");
      index += 1;
      continue;
    }
    if (arg === "--round-component-file") {
      options.roundComponentFile = requireNextValue(argv, index, "--round-component-file");
      index += 1;
      continue;
    }
    if (arg === "--component-file") {
      options.componentFile = requireNextValue(argv, index, "--component-file");
      index += 1;
      continue;
    }
    if (arg === "--problem-file") {
      options.problemFile = requireNextValue(argv, index, "--problem-file");
      index += 1;
      continue;
    }
    if (arg === "--long-component-state-file") {
      options.longComponentStateFile = requireNextValue(argv, index, "--long-component-state-file");
      index += 1;
      continue;
    }
    if (arg === "--round-registration-pattern") {
      options.roundRegistrationPattern = requireNextValue(argv, index, "--round-registration-pattern");
      index += 1;
      continue;
    }
    if (arg === "--long-submission-pattern") {
      options.longSubmissionPattern = requireNextValue(argv, index, "--long-submission-pattern");
      index += 1;
      continue;
    }
    if (arg === "--long-comp-result-pattern") {
      options.longCompResultPattern = requireNextValue(argv, index, "--long-comp-result-pattern");
      index += 1;
      continue;
    }
    if (arg === "--existing-state-file") {
      options.existingStateFile = requireNextValue(argv, index, "--existing-state-file");
      index += 1;
      continue;
    }
    if (arg === "--round-id") {
      const value = requireNextValue(argv, index, "--round-id");
      options.roundIds.push(parseRoundIdValue(value, "--round-id"));
      index += 1;
      continue;
    }
    if (arg === "--round-ids") {
      const value = requireNextValue(argv, index, "--round-ids");
      options.roundIds.push(...parseRoundIdsList(value, "--round-ids"));
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      options.apply = false;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      options.dryRun = false;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  options.roundIds = sortRoundIds(Array.from(new Set(options.roundIds)));

  if (!options.help && options.roundIds.length === 0) {
    throw new Error("At least one round filter is required. Use --round-id or --round-ids.");
  }

  return options;
};

const usage = `Usage:
  node data-migration/src/scripts/importHistoricalMarathonMatches.js --dry-run --round-id <id> [options]

Planning options:
  --round-id <id>                    Select one round id (repeatable)
  --round-ids <id1,id2,...>          Select comma-separated round ids
  --dry-run                          Build a non-mutating deterministic reconciliation plan (default)
  --existing-state-file <path>       Optional JSON snapshot for matched challenge ids + existing entity counts

Input options:
  --data-dir <path>                  Legacy data directory (default: DATA_DIRECTORY or /mnt/Informix)
  --round-file <file>                Legacy round file (default: round_1.json)
  --round-component-file <file>      Legacy round_component file (default: round_component_1.json)
  --component-file <file>            Legacy component file (default: component_1.json)
  --problem-file <file>              Legacy problem file (default: problem_1.json)
  --long-component-state-file <file> Legacy long_component_state file (default: long_component_state_1.json)
  --round-registration-pattern <re>  Regex for round_registration files (default: ^round_registration_\\d+\\.json$)
  --long-submission-pattern <re>     Regex for long_submission files (default: ^long_submission_\\d+\\.json$)
  --long-comp-result-pattern <re>    Regex for long_comp_result files (default: ^long_comp_result_\\d+\\.json$)

Apply mode:
  --apply                            Reserved for later milestones (not available yet)

Other:
  --help, -h                         Show this help
`;

module.exports = {
  parseArgs,
  usage,
};
