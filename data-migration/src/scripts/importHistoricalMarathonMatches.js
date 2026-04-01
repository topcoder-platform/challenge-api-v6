#!/usr/bin/env node
"use strict";

const path = require("path");
const { createRequire } = require("module");
const dotenv = require("dotenv");
const { parseArgs, usage } = require("./importHistoricalMarathonMatches/argParser");
const { buildDryRunPlan } = require("./importHistoricalMarathonMatches/planning");
const {
  runApplyMode,
  resolveMarathonTypeId,
  resolveDataScienceTrackId,
} = require("./importHistoricalMarathonMatches/apply");
const { emitPlanReport, emitApplyReport } = require("./importHistoricalMarathonMatches/reporting");
const {
  loadExistingState,
  buildExistingStateByRoundId,
} = require("./importHistoricalMarathonMatches/existingState");

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

  const snapshotByRoundId = loadExistingState(options.dataDir, options.existingStateFile);
  const shouldAttemptDatabaseDiscovery =
    options.apply || Boolean(String(process.env.DATABASE_URL || "").trim());
  let prisma = null;

  if (shouldAttemptDatabaseDiscovery) {
    const { PrismaClient } = requireFromRoot("@prisma/client");
    prisma = new PrismaClient();
  }

  try {
    let existingStateByRoundId = null;
    if (prisma) {
      try {
        const marathonTypeId = await resolveMarathonTypeId(prisma);
        const dataScienceTrackId = await resolveDataScienceTrackId(prisma);
        existingStateByRoundId = await buildExistingStateByRoundId({
          prisma,
          roundIds: options.roundIds,
          marathonTypeId,
          dataScienceTrackId,
          snapshotByRoundId,
        });
      } catch (error) {
        if (options.apply) {
          throw error;
        }
        process.stderr.write(
          `Warning: unable to discover existing v6 state directly (${error.message}); continuing dry-run without reuse matching.\n`
        );
      }
    }

    if (!existingStateByRoundId) {
      existingStateByRoundId = await buildExistingStateByRoundId({
        prisma: null,
        roundIds: options.roundIds,
        snapshotByRoundId,
      });
    }

    const plan = await buildDryRunPlan(options, existingStateByRoundId);
    if (!options.apply) {
      emitPlanReport(plan);
      return;
    }

    const applyResult = await runApplyMode({
      prisma,
      options,
      plan,
      actor: DEFAULT_ACTOR,
    });
    emitApplyReport(applyResult);
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
  }
};

run().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
