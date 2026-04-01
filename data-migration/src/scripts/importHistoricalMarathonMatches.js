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
  resolveCanonicalTimelineTemplateId,
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
const AUTHORITATIVE_DISCOVERY_UNAVAILABLE_REASON =
  "authoritative-existing-v6-discovery-unavailable";
const CANONICAL_TIMELINE_UNRESOLVED_REASON = "canonical-mm-ds-timeline-template-unresolved";
const CANONICAL_TIMELINE_AMBIGUOUS_REASON = "canonical-mm-ds-timeline-template-ambiguous";

const deriveCanonicalTimelineReason = (error) => {
  const message = String((error && error.message) || "");
  if (message.includes("valid candidates")) {
    return CANONICAL_TIMELINE_AMBIGUOUS_REASON;
  }
  return CANONICAL_TIMELINE_UNRESOLVED_REASON;
};

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
    const planningPrerequisites = {
      authoritativeDiscovery: {
        available: false,
        reason: AUTHORITATIVE_DISCOVERY_UNAVAILABLE_REASON,
      },
      canonicalTimelineTemplate: {
        resolved: false,
        reason: CANONICAL_TIMELINE_UNRESOLVED_REASON,
        timelineTemplateId: null,
      },
    };

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
        planningPrerequisites.authoritativeDiscovery = { available: true };
        try {
          const timelineTemplateId = await resolveCanonicalTimelineTemplateId(
            prisma,
            marathonTypeId,
            dataScienceTrackId
          );
          planningPrerequisites.canonicalTimelineTemplate = {
            resolved: true,
            timelineTemplateId,
          };
        } catch (error) {
          planningPrerequisites.canonicalTimelineTemplate = {
            resolved: false,
            reason: deriveCanonicalTimelineReason(error),
          };
          process.stderr.write(
            `Warning: unable to resolve canonical Marathon Match/Data Science timeline template (${error.message}); create-path planning will be unresolved.\n`
          );
        }
      } catch (error) {
        if (options.apply) {
          throw error;
        }
        process.stderr.write(
          `Warning: unable to discover existing v6 state directly (${error.message}); create-path planning will be unresolved.\n`
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

    const plan = await buildDryRunPlan(options, existingStateByRoundId, planningPrerequisites);
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
