#!/usr/bin/env node
"use strict";

const path = require("path");
const { createRequire } = require("module");
const dotenv = require("dotenv");
const { parseArgs, usage } = require("./importHistoricalMarathonMatches/argParser");
const { buildDryRunPlan } = require("./importHistoricalMarathonMatches/planning");
const {
  runApplyMode,
  DEFAULT_SUBMITTER_ROLE_ID,
  resolveMarathonTypeId,
  resolveDataScienceTrackId,
  resolveCanonicalTimelineTemplateId,
} = require("./importHistoricalMarathonMatches/apply");
const { emitPlanReport, emitApplyReport } = require("./importHistoricalMarathonMatches/reporting");
const {
  loadExistingState,
  buildExistingStateByRoundId,
} = require("./importHistoricalMarathonMatches/existingState");
const {
  createAuth0TokenProvider,
  createResourceApiClient,
} = require("./importHistoricalMarathonMatches/resourceApi");
const {
  TARGET_MEMBER_RESOLUTION_UNAVAILABLE_REASON,
  DEFAULT_MEMBER_SCHEMA,
  createMemberPresenceResolver,
} = require("./importHistoricalMarathonMatches/targetMemberResolution");

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

const createDefaultResourceClient = () => {
  const getAccessToken = createAuth0TokenProvider({
    auth0Url: process.env.AUTH0_URL,
    auth0Audience: process.env.AUTH0_AUDIENCE,
    auth0ClientId: process.env.AUTH0_CLIENT_ID,
    auth0ClientSecret: process.env.AUTH0_CLIENT_SECRET,
  });
  return createResourceApiClient({
    baseUrl: process.env.RESOURCES_API_URL,
    getAccessToken,
  });
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
  const reviewDbUrl = String(process.env.REVIEW_DB_URL || "").trim();
  const reviewDbSchema = String(process.env.REVIEW_DB_SCHEMA || "reviews").trim();
  const memberDbUrl = String(process.env.MEMBER_DB_URL || process.env.DATABASE_URL || "").trim();
  const memberDbSchema = String(process.env.MEMBER_DB_SCHEMA || DEFAULT_MEMBER_SCHEMA).trim();
  let prisma = null;
  let memberLookupPrisma = null;
  let reviewPrisma = null;
  let resolveMemberPresence = null;

  if (shouldAttemptDatabaseDiscovery) {
    const { PrismaClient } = requireFromRoot("@prisma/client");
    prisma = new PrismaClient();
  }
  if (memberDbUrl) {
    const { PrismaClient } = requireFromRoot("@prisma/client");
    const databaseUrl = String(process.env.DATABASE_URL || "").trim();
    memberLookupPrisma =
      prisma && databaseUrl && memberDbUrl === databaseUrl
        ? prisma
        : new PrismaClient({
          datasources: {
            db: {
              url: memberDbUrl,
            },
          },
        });
  }
  if (options.apply) {
    if (!reviewDbUrl) {
      throw new Error("REVIEW_DB_URL must be set for apply mode submission import.");
    }
    const { PrismaClient } = requireFromRoot("@prisma/client");
    const databaseUrl = String(process.env.DATABASE_URL || "").trim();
    reviewPrisma =
      prisma && databaseUrl && reviewDbUrl === databaseUrl
        ? prisma
        : new PrismaClient({
          datasources: {
            db: {
              url: reviewDbUrl,
            },
          },
        });
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
      memberResolution: {
        available: false,
        reason: TARGET_MEMBER_RESOLUTION_UNAVAILABLE_REASON,
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

    if (memberLookupPrisma) {
      try {
        if (memberLookupPrisma !== prisma) {
          await memberLookupPrisma.$connect();
        }
        resolveMemberPresence = createMemberPresenceResolver({
          prisma: memberLookupPrisma,
          memberSchema: memberDbSchema,
        });
        planningPrerequisites.memberResolution = {
          available: true,
        };
      } catch (error) {
        planningPrerequisites.memberResolution = {
          available: false,
          reason: TARGET_MEMBER_RESOLUTION_UNAVAILABLE_REASON,
        };
        process.stderr.write(
          `Warning: unable to resolve target-environment members (${error.message}); planning will be unresolved for missing-member classification.\n`
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

    const plan = await buildDryRunPlan(
      {
        ...options,
        cwd: process.cwd(),
        resolveMemberPresence,
      },
      existingStateByRoundId,
      planningPrerequisites
    );
    if (!options.apply) {
      emitPlanReport(plan);
      return;
    }

    if (!String(process.env.RESOURCES_API_URL || "").trim()) {
      throw new Error("RESOURCES_API_URL must be set for apply mode participant reconciliation.");
    }

    const submitterRoleId = String(
      process.env.SUBMITTER_ROLE_ID || DEFAULT_SUBMITTER_ROLE_ID
    ).trim();
    if (!submitterRoleId) {
      throw new Error("SUBMITTER_ROLE_ID must be set for apply mode participant reconciliation.");
    }

    const applyResult = await runApplyMode({
      prisma,
      options: {
        ...options,
        cwd: process.cwd(),
        submitterRoleId,
        resourceClient: createDefaultResourceClient(),
        reviewClient: reviewPrisma,
        reviewSchema: reviewDbSchema,
        importSubmissions: true,
        importFinalScores: true,
      },
      plan,
      actor: DEFAULT_ACTOR,
    });
    emitApplyReport(applyResult);
  } finally {
    if (memberLookupPrisma && memberLookupPrisma !== prisma) {
      await memberLookupPrisma.$disconnect();
    }
    if (reviewPrisma && reviewPrisma !== prisma && reviewPrisma !== memberLookupPrisma) {
      await reviewPrisma.$disconnect();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  }
};

run().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
