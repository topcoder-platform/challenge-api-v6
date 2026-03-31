#!/usr/bin/env node
"use strict";

const path = require("path");
const { createRequire } = require("module");
const dotenv = require("dotenv");
const { parseArgs, usage } = require("./importHistoricalMarathonMatches/argParser");
const { buildDryRunPlan } = require("./importHistoricalMarathonMatches/planning");
const { runApplyMode } = require("./importHistoricalMarathonMatches/apply");
const { emitPlanReport, emitApplyReport } = require("./importHistoricalMarathonMatches/reporting");
const { loadExistingState } = require("./importHistoricalMarathonMatches/existingState");

const appRoot = path.resolve(__dirname, "..", "..", "..");
const requireFromRoot = createRequire(path.join(appRoot, "package.json"));

dotenv.config({
  path: path.resolve(__dirname, "..", "..", "..", ".env.importer.local"),
  override: false,
  quiet: true,
});
dotenv.config({ quiet: true });

const DEFAULT_ACTOR =
  process.env.UPDATED_BY || process.env.CREATED_BY || "historical-mm-importer";

const run = async () => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(usage);
    return;
  }

  const existingStateByRoundId = loadExistingState(options.dataDir, options.existingStateFile);
  const plan = await buildDryRunPlan(options, existingStateByRoundId);
  if (!options.apply) {
    emitPlanReport(plan);
    return;
  }

  // Lazy load Prisma only when apply mode is requested so --help / dry-run
  // keep working in environments without generated client artifacts.
  const { PrismaClient } = requireFromRoot("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const applyResult = await runApplyMode({
      prisma,
      options,
      plan,
      actor: DEFAULT_ACTOR,
    });
    emitApplyReport(applyResult);
  } finally {
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
