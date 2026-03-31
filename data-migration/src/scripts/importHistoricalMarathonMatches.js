#!/usr/bin/env node
"use strict";

const path = require("path");
const dotenv = require("dotenv");
const { parseArgs, usage } = require("./importHistoricalMarathonMatches/argParser");
const { buildDryRunPlan } = require("./importHistoricalMarathonMatches/planning");
const { emitPlanReport } = require("./importHistoricalMarathonMatches/reporting");
const { loadExistingState } = require("./importHistoricalMarathonMatches/existingState");

dotenv.config({
  path: path.resolve(__dirname, "..", "..", "..", ".env.importer.local"),
  override: false,
  quiet: true,
});
dotenv.config({ quiet: true });

const run = async () => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(usage);
    return;
  }

  if (options.apply) {
    throw new Error(
      "Apply mode is not available in this planning milestone. Use --dry-run to generate reconciliation output."
    );
  }

  const existingStateByRoundId = loadExistingState(options.dataDir, options.existingStateFile);
  const plan = await buildDryRunPlan(options, existingStateByRoundId);
  emitPlanReport(plan);
};

run().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
