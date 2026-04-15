"use strict";

const fs = require("fs");
const path = require("path");
const {
  listFilesByPattern,
  streamJsonArray,
} = require("./importHistoricalMarathonMatches/legacyDataReader");

const DEFAULT_DATA_DIR = process.env.DATA_DIRECTORY || "/mnt/Informix";
const DEFAULT_INPUT_FILE = "/home/jmgasper/Downloads/section_3.json";
const DEFAULT_OUTPUT_FILE = "/home/jmgasper/Downloads/section_3.corrected_raw_scores.json";
const DEFAULT_MISSING_FILE = "/home/jmgasper/Downloads/section_3.missing_raw_matches.json";
const DEFAULT_SUMMARY_FILE = "/home/jmgasper/Downloads/section_3.corrected_summary.json";

const printUsage = () => {
  console.log(`Usage:
  node data-migration/src/scripts/regenerateMarathonSystemTestResultsSection3.js \\
    [--data-dir <path>] \\
    [--input-file <path>] \\
    [--output-file <path>] \\
    [--missing-file <path>] \\
    [--summary-file <path>]

Defaults:
  --data-dir ${DEFAULT_DATA_DIR}
  --input-file ${DEFAULT_INPUT_FILE}
  --output-file ${DEFAULT_OUTPUT_FILE}
  --missing-file ${DEFAULT_MISSING_FILE}
  --summary-file ${DEFAULT_SUMMARY_FILE}`);
};

const parseArgs = (argv) => {
  const options = {
    dataDir: DEFAULT_DATA_DIR,
    inputFile: DEFAULT_INPUT_FILE,
    outputFile: DEFAULT_OUTPUT_FILE,
    missingFile: DEFAULT_MISSING_FILE,
    summaryFile: DEFAULT_SUMMARY_FILE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      printUsage();
      process.exit(0);
    }

    if (argument === "--data-dir") {
      options.dataDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--input-file") {
      options.inputFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--output-file") {
      options.outputFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--missing-file") {
      options.missingFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--summary-file") {
      options.summaryFile = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
};

const ensureParentDirectory = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const readInputRows = (filePath) => {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Input file must contain a JSON array: ${filePath}`);
  }
  return parsed;
};

const buildKey = (roundId, coderId, testCaseId) =>
  `${Number(roundId)}:${Number(coderId)}:${Number(testCaseId)}`;

const toNumeric = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildTargetIndex = (rows) => {
  const targetByKey = new Map();
  const duplicateInputKeys = [];

  rows.forEach((row, index) => {
    const key = buildKey(row.round_id, row.coder_id, row.test_case_id);
    if (targetByKey.has(key)) {
      duplicateInputKeys.push({
        key,
        firstIndex: targetByKey.get(key).index,
        duplicateIndex: index,
      });
      return;
    }

    targetByKey.set(key, {
      index,
      row,
      matched: false,
      rawScore: null,
      source: null,
    });
  });

  if (duplicateInputKeys.length > 0) {
    throw new Error(
      `Input file contains duplicate (round_id, coder_id, test_case_id) keys. Sample: ${JSON.stringify(
        duplicateInputKeys.slice(0, 5)
      )}`
    );
  }

  return targetByKey;
};

const createRoundStats = (rows) => {
  const roundStats = new Map();
  rows.forEach((row) => {
    const roundId = Number(row.round_id);
    const existing = roundStats.get(roundId) || { total: 0, matched: 0 };
    existing.total += 1;
    roundStats.set(roundId, existing);
  });
  return roundStats;
};

const sortNumericAscending = (left, right) => left - right;

const writeJsonFile = (filePath, payload) => {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const inputRows = readInputRows(options.inputFile);
  const targetByKey = buildTargetIndex(inputRows);
  const roundStats = createRoundStats(inputRows);

  const resultFiles = listFilesByPattern(
    options.dataDir,
    "^long_system_test_result_\\d+\\.json$",
    "long system test result"
  );

  for (const filePath of resultFiles) {
    await streamJsonArray(filePath, "long_system_test_result", (row) => {
      const key = buildKey(row.round_id, row.coder_id, row.test_case_id);
      const target = targetByKey.get(key);

      if (!target || target.matched) {
        return;
      }

      target.matched = true;
      target.rawScore = toNumeric(row.score);
      target.source = {
        component_id: toNumeric(row.component_id),
        submission_number: toNumeric(row.submission_number),
        timestamp: row.timestamp || null,
      };

      const stats = roundStats.get(Number(row.round_id));
      stats.matched += 1;
    });
  }

  const correctedRows = [];
  const missingRows = [];

  inputRows.forEach((row) => {
    const key = buildKey(row.round_id, row.coder_id, row.test_case_id);
    const target = targetByKey.get(key);

    if (target && target.matched) {
      correctedRows.push({
        coder_id: Number(row.coder_id),
        test_case_id: Number(row.test_case_id),
        round_id: Number(row.round_id),
        problem_id: Number(row.problem_id),
        score: target.rawScore,
      });
      return;
    }

    missingRows.push({
      coder_id: Number(row.coder_id),
      test_case_id: Number(row.test_case_id),
      round_id: Number(row.round_id),
      problem_id: Number(row.problem_id),
      original_score: toNumeric(row.score),
      missing_reason: "no matching long_system_test_result row",
    });
  });

  const matchedRounds = [...roundStats.entries()]
    .filter(([, stats]) => stats.matched > 0)
    .map(([roundId]) => roundId)
    .sort(sortNumericAscending);

  const missingRoundBreakdown = [...roundStats.entries()]
    .map(([roundId, stats]) => ({
      round_id: roundId,
      total_rows: stats.total,
      matched_rows: stats.matched,
      missing_rows: stats.total - stats.matched,
    }))
    .filter((row) => row.missing_rows > 0)
    .sort((left, right) => left.round_id - right.round_id);

  const summary = {
    input_file: options.inputFile,
    data_dir: options.dataDir,
    scanned_long_system_test_result_files: resultFiles.length,
    total_input_rows: inputRows.length,
    corrected_rows: correctedRows.length,
    missing_rows: missingRows.length,
    total_input_rounds: roundStats.size,
    matched_rounds: matchedRounds.length,
    first_matched_round: matchedRounds.length > 0 ? matchedRounds[0] : null,
    last_matched_round:
      matchedRounds.length > 0 ? matchedRounds[matchedRounds.length - 1] : null,
    missing_round_breakdown: missingRoundBreakdown,
  };

  writeJsonFile(options.outputFile, correctedRows);
  writeJsonFile(options.missingFile, missingRows);
  writeJsonFile(options.summaryFile, summary);

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
