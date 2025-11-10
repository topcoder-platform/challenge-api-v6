#!/usr/bin/env node
/**
 * Backfill script for ChallengeBilling records.
 *
 * This script scans every challenge that does not yet have an associated
 * ChallengeBilling row and attempts to create one using data sourced from:
 *   1. tc-project-service database (for project -> billingAccountId linkage)
 *   2. billing-accounts-api-v6 database (for billing account markup + client)
 *
 * Environment variables:
 *   - PROJECTS_DATABASE_URL (or PROJECTS_DB_URL / PROJECTS_MASTER_URL):
 *       Connection string for the tc-project-service Postgres database.
 *   - BILLING_DATABASE_URL (or BILLING_ACCOUNTS_DATABASE_URL):
 *       Connection string for the billing-accounts-api-v6 Postgres database.
 *   - DATABASE_URL:
 *       Already used by challenge-api-v6 Prisma client (challenge DB).
 *   - CHALLENGE_BILLING_BACKFILL_BATCH_SIZE (optional, default 100)
 *   - CHALLENGE_BILLING_BACKFILL_AUDIT_USER_ID (optional, overrides audit user)
 *   - CHALLENGE_BILLING_BACKFILL_DRY_RUN=true (optional, skip writes)
 *
 * Usage:
 *   node src/scripts/backfill-challenge-billing.js
 */

require("dotenv").config();

const config = require("config");
const { PrismaClient, Prisma } = require("@prisma/client");

const PROJECTS_DATABASE_URL =
  process.env.PROJECTS_DATABASE_URL ||
  process.env.PROJECTS_DB_URL ||
  process.env.PROJECTS_MASTER_URL ||
  process.env.TC_PROJECTS_DATABASE_URL;

const BILLING_DATABASE_URL =
  process.env.BILLING_DATABASE_URL || process.env.BILLING_ACCOUNTS_DATABASE_URL;

if (!PROJECTS_DATABASE_URL) {
  throw new Error(
    "Missing project DB connection string. Set PROJECTS_DATABASE_URL (or PROJECTS_DB_URL/PROJECTS_MASTER_URL)."
  );
}

if (!BILLING_DATABASE_URL) {
  throw new Error(
    "Missing billing DB connection string. Set BILLING_DATABASE_URL (or BILLING_ACCOUNTS_DATABASE_URL)."
  );
}

const BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.CHALLENGE_BILLING_BACKFILL_BATCH_SIZE || "100", 10)
);
const DRY_RUN = process.env.CHALLENGE_BILLING_BACKFILL_DRY_RUN === "true";
const auditUserId =
  process.env.CHALLENGE_BILLING_BACKFILL_AUDIT_USER_ID ||
  config.M2M_AUDIT_USERID ||
  "system";
const auditUser = String(auditUserId);

// Main challenge database client (already configured via DATABASE_URL)
const challengePrisma = new PrismaClient();
// Secondary clients for the other two databases; only $queryRaw is used.
const projectPrisma = new PrismaClient({
  datasources: { db: { url: PROJECTS_DATABASE_URL } },
});
const billingPrisma = new PrismaClient({
  datasources: { db: { url: BILLING_DATABASE_URL } },
});

const stats = {
  processed: 0,
  created: 0,
  skippedNoProjectId: 0,
  skippedMissingProject: 0,
  skippedMissingBillingAccountId: 0,
  skippedMissingBillingAccount: 0,
  skippedMissingMarkup: 0,
  errors: 0,
};

function asNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function asFloat(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

async function fetchProjects(projectIds) {
  if (!projectIds.length) {
    return new Map();
  }
  const rows = await projectPrisma.$queryRaw(
    Prisma.sql`
      SELECT id, "billingAccountId"
      FROM projects
      WHERE id IN (${Prisma.join(projectIds)})
    `
  );
  const map = new Map();
  for (const row of rows) {
    const id = asNumber(row.id);
    if (id === null) {
      continue;
    }
    map.set(id, {
      billingAccountId: asNumber(row.billingAccountId),
    });
  }
  return map;
}

async function fetchBillingAccounts(billingAccountIds) {
  if (!billingAccountIds.length) {
    return new Map();
  }
  const rows = await billingPrisma.$queryRaw(
    Prisma.sql`
      SELECT id, "clientId", "markup"
      FROM "BillingAccount"
      WHERE id IN (${Prisma.join(billingAccountIds)})
    `
  );
  const map = new Map();
  for (const row of rows) {
    const id = asNumber(row.id);
    if (id === null) {
      continue;
    }
    map.set(id, {
      clientId: row.clientId || "unknown",
      markup: asFloat(row.markup),
    });
  }
  return map;
}

async function processBatch(challenges) {
  const projectIds = [
    ...new Set(
      challenges
        .map((c) => asNumber(c.projectId))
        .filter((id) => id !== null && !Number.isNaN(id))
    ),
  ];
  const projectMap = await fetchProjects(projectIds);
  const billingAccountIds = [
    ...new Set(
      projectIds
        .map((id) => projectMap.get(id)?.billingAccountId)
        .filter((id) => id !== null && id !== undefined)
    ),
  ];
  const billingMap = await fetchBillingAccounts(billingAccountIds);

  for (const challenge of challenges) {
    stats.processed += 1;
    const challengeId = challenge.id;
    const projectId = asNumber(challenge.projectId);
    if (projectId === null) {
      stats.skippedNoProjectId += 1;
      console.warn(
        `[SKIP:no-project-id] Challenge ${challengeId} has no projectId; clientId=unknown`
      );
      continue;
    }
    const project = projectMap.get(projectId);
    if (!project) {
      stats.skippedMissingProject += 1;
      console.warn(
        `[SKIP:missing-project] Challenge ${challengeId} -> project ${projectId} not found`
      );
      continue;
    }
    const billingAccountId = project.billingAccountId;
    if (billingAccountId === null) {
      stats.skippedMissingBillingAccountId += 1;
      console.warn(
        `[SKIP:no-billing-account-id] Challenge ${challengeId} -> project ${projectId} has no billingAccountId`
      );
      continue;
    }
    const billing = billingMap.get(billingAccountId);
    if (!billing) {
      stats.skippedMissingBillingAccount += 1;
      console.warn(
        `[SKIP:missing-billing-account] Challenge ${challengeId} -> billingAccount ${billingAccountId} not found`
      );
      continue;
    }
    if (billing.markup === null) {
      stats.skippedMissingMarkup += 1;
      console.warn(
        `[SKIP:no-markup] Challenge ${challengeId} -> billingAccount ${billingAccountId} (client ${billing.clientId}) missing markup`
      );
      continue;
    }

    try {
      if (DRY_RUN) {
        console.log(
          `[DRY-RUN] Would create ChallengeBilling for challenge ${challengeId} -> billingAccount ${billingAccountId} (client ${billing.clientId}) markup=${billing.markup}`
        );
      } else {
        await challengePrisma.challengeBilling.create({
          data: {
            challengeId,
            billingAccountId: String(billingAccountId),
            markup: billing.markup,
            clientBillingRate: null,
            createdBy: auditUser,
            updatedBy: auditUser,
          },
        });
        console.log(
          `[OK] Challenge ${challengeId} linked to billingAccount ${billingAccountId} (client ${billing.clientId}) markup=${billing.markup}`
        );
      }
      stats.created += 1;
    } catch (error) {
      stats.errors += 1;
      console.error(
        `[ERROR] Failed to create ChallengeBilling for challenge ${challengeId}: ${error.message}`
      );
    }
  }
}

async function main() {
  console.log("Starting ChallengeBilling backfill...");
  if (DRY_RUN) {
    console.log("Running in DRY RUN mode; no data will be written.");
  }
  console.log(`Batch size: ${BATCH_SIZE}`);

  let cursor = null;

  while (true) {
    const query = {
      where: { billingRecord: { is: null } },
      select: { id: true, projectId: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    };
    if (cursor) {
      query.cursor = { id: cursor };
      query.skip = 1;
    }
    const challenges = await challengePrisma.challenge.findMany(query);
    if (!challenges.length) {
      break;
    }
    await processBatch(challenges);
    cursor = challenges[challenges.length - 1].id;
  }

  console.log("Backfill completed.");
  console.table(stats);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([
      challengePrisma.$disconnect(),
      projectPrisma.$disconnect(),
      billingPrisma.$disconnect(),
    ]);
  });
