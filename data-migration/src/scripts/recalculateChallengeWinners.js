#!/usr/bin/env node
"use strict";

/**
 * Challenge winner recalculation script.
 *
 * Steps:
 * 1) Set environment variables:
 *    - DATABASE_URL (challenge DB)
 *    - REVIEW_DB_URL (review DB)
 *    - REVIEW_DB_SCHEMA (optional; default "reviews")
 *    - AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET / AUTH0_URL / AUTH0_AUDIENCE (for submitter handles)
 *    - RESOURCES_API_URL (optional; defaults to http://localhost:4000/v5/resources)
 * 2) Run CSV-only mode to review results:
 *    - node data-migration/src/scripts/recalculateChallengeWinners.js --csv-only --csv-path /tmp/winners.csv
 * 3) Validate CSV output (challenge ordering is DESC by ID):
 *    - Submission ID, Challenge ID, Submitter handle, Submission date, Review score (avg),
 *      Scorecard min passing score, Placement
 * 4) Run write mode to apply winners:
 *    - node data-migration/src/scripts/recalculateChallengeWinners.js
 * 5) Optional filters:
 *    - --challenge-id <uuid> (repeatable)
 *    - --challenge-ids <uuid,uuid>
 *    - --statuses COMPLETED,CANCELLED or --statuses ALL
 *    - --limit <n>
 *
 * Notes:
 * - Review score is the average of committed final scores (falls back to initial score).
 * - Passing requires review score >= scorecard minimumPassingScore (falls back to minScore).
 * - Review scores only consider committed reviews from the Review phase.
 * - Winners are capped by placement prize count when placement prizes exist.
 * - Tie breaker for equal scores: earlier submission date wins the higher placement.
 */

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

require("dotenv").config();

const config = require("config");
const appRoot = path.resolve(__dirname, "..", "..", "..");
const requireFromRoot = createRequire(path.join(appRoot, "package.json"));
const { PrismaClient, Prisma, PrizeSetTypeEnum } = requireFromRoot("@prisma/client");
const { getReviewClient } = require("../../../src/common/review-prisma");
const helper = require("../../../src/common/helper");

const DEFAULT_ACTOR = process.env.UPDATED_BY || process.env.CREATED_BY || "winner-recalc";
const CREATED_BY = process.env.CREATED_BY || DEFAULT_ACTOR;
const UPDATED_BY = process.env.UPDATED_BY || DEFAULT_ACTOR;
const CONTEST_SUBMISSION_TYPE = "CONTEST_SUBMISSION";
const CHALLENGE_TYPE_BY_ID = new Map([
  ["ecd58c69-238f-43a4-a4bb-d172719b9f31", "Task"],
  ["929bc408-9cf2-4b3e-ba71-adfbf693046c", "Marathon Match"],
  ["927abff4-7af9-4145-8ba1-577c16e64e2e", "Challenge"],
  ["dc876fa4-ef2d-4eee-b701-b555fcc6544c", "First2Finish"],
  ["e76afccb-b6c6-488d-950e-76bddfea5df9", "Topgear Task"],
]);

const roundScore = (value) => Math.round(value * 100) / 100;

const toNumber = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
};

const toIsoString = (value) => {
  if (!value) {
    return "";
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return String(value);
};

const toCsvValue = (value) => {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildSchemaTable = (schemaName, tableName) => {
  const trimmed = String(schemaName || "").trim();
  if (!trimmed) {
    return Prisma.raw(`"${tableName}"`);
  }
  const safeSchema = trimmed.replace(/"/g, '""');
  return Prisma.raw(`"${safeSchema}"."${tableName}"`);
};

const parseArgs = (argv) => {
  const options = {
    csvOnly: false,
    csvPath: null,
    challengeIds: [],
    statuses: ["COMPLETED"],
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--csv-only" || arg === "--csv") {
      options.csvOnly = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        options.csvPath = next;
        i += 1;
      }
      continue;
    }
    if (arg === "--csv-path") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--csv-path requires a value");
      }
      options.csvOnly = true;
      options.csvPath = next;
      i += 1;
      continue;
    }
    if (arg === "--challenge-id") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--challenge-id requires a value");
      }
      options.challengeIds.push(next);
      i += 1;
      continue;
    }
    if (arg === "--challenge-ids") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--challenge-ids requires a comma-separated list");
      }
      const ids = next.split(",").map((id) => id.trim()).filter(Boolean);
      options.challengeIds.push(...ids);
      i += 1;
      continue;
    }
    if (arg === "--statuses") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--statuses requires a comma-separated list or ALL");
      }
      const normalized = next.trim();
      if (normalized.toUpperCase() === "ALL") {
        options.statuses = null;
      } else {
        options.statuses = normalized
          .split(",")
          .map((entry) => entry.trim().toUpperCase())
          .filter(Boolean);
      }
      i += 1;
      continue;
    }
    if (arg === "--limit") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--limit requires a number");
      }
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      options.limit = parsed;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
};

const printUsage = () => {
  console.log(`
Usage:
  node data-migration/src/scripts/recalculateChallengeWinners.js [options]

Options:
  --csv-only, --csv         Output CSV report and skip DB writes.
  --csv-path <path>         Write CSV to file (defaults to stdout).
  --challenge-id <id>       Process a single challenge (repeatable).
  --challenge-ids <ids>     Comma-separated challenge IDs.
  --statuses <list|ALL>     Comma-separated challenge statuses (default: COMPLETED).
  --limit <n>               Limit number of challenges processed after filtering.
  --help                    Show this help.
`);
};

const getChallengeIds = async (prisma, reviewClient, submissionTable, options) => {
  let challengeIds = [];

  if (options.challengeIds.length > 0) {
    challengeIds = options.challengeIds.slice();
  } else {
    const rows = await reviewClient.$queryRaw`
      SELECT DISTINCT "challengeId" AS id
      FROM ${submissionTable}
      WHERE "challengeId" IS NOT NULL
        AND "type" = ${CONTEST_SUBMISSION_TYPE}::reviews."SubmissionType"
      ORDER BY "challengeId" DESC
    `;
    challengeIds = rows.map((row) => row.id).filter(Boolean);
  }

  const uniqueIds = Array.from(new Set(challengeIds));
  uniqueIds.sort((a, b) => (a < b ? 1 : -1));

  let allowedSet = null;
  if (options.statuses && options.statuses.length > 0) {
    const statusRows = await prisma.challenge.findMany({
      where: { status: { in: options.statuses } },
      select: { id: true },
    });
    allowedSet = new Set(statusRows.map((row) => row.id));
  } else {
    const allRows = await prisma.challenge.findMany({ select: { id: true } });
    allowedSet = new Set(allRows.map((row) => row.id));
  }

  const filtered = uniqueIds.filter((id) => allowedSet.has(id));
  if (options.limit && filtered.length > options.limit) {
    return filtered.slice(0, options.limit);
  }
  return filtered;
};

const loadSubmissionScores = async (reviewClient, tables, challenge, reviewPhaseIds) => {
  const challengeType = CHALLENGE_TYPE_BY_ID.get(challenge.typeId);
  const isMarathonMatch = challengeType === "Marathon Match";
  const phaseFilterClause =
    reviewPhaseIds && reviewPhaseIds.length > 0
      ? Prisma.sql`r."phaseId" IN (${Prisma.join(reviewPhaseIds)})`
      : Prisma.sql`FALSE`;

  const rows = isMarathonMatch
    ? await reviewClient.$queryRaw`
        SELECT
          s.id AS "submissionId",
          s."challengeId" AS "challengeId",
          s."memberId" AS "memberId",
          s."submittedDate" AS "submittedDate",
          s."createdAt" AS "createdAt",
          MIN(rs."scorecardId") AS "scorecardId",
          AVG(rs."aggregateScore") AS "reviewScore"
        FROM ${tables.submission} s
        INNER JOIN ${tables.reviewSummation} rs ON rs."submissionId" = s.id
        WHERE s."challengeId" = ${challenge.id}
          AND s."type" = ${CONTEST_SUBMISSION_TYPE}::reviews."SubmissionType"
        GROUP BY s.id, s."challengeId", s."memberId", s."submittedDate", s."createdAt"
      `
    : await reviewClient.$queryRaw`
        SELECT
          s.id AS "submissionId",
          s."challengeId" AS "challengeId",
          s."memberId" AS "memberId",
          s."submittedDate" AS "submittedDate",
          s."createdAt" AS "createdAt",
          MIN(r."scorecardId") AS "scorecardId",
          AVG(
            CASE
              WHEN r."finalScore" IS NOT NULL THEN r."finalScore"
              WHEN r."initialScore" IS NOT NULL THEN r."initialScore"
              ELSE NULL
            END
          ) AS "reviewScore"
        FROM ${tables.submission} s
        INNER JOIN ${tables.review} r ON r."submissionId" = s.id
        WHERE s."challengeId" = ${challenge.id}
          AND s."type" = ${CONTEST_SUBMISSION_TYPE}::reviews."SubmissionType"
          AND r."committed" = true
          AND ${phaseFilterClause}
        GROUP BY s.id, s."challengeId", s."memberId", s."submittedDate", s."createdAt"
      `;

  return rows || [];
};

const loadScorecardPassingScores = async (reviewClient, scorecardTable, scorecardIds) => {
  if (!scorecardIds.length) {
    return new Map();
  }

  const rows = await reviewClient.$queryRaw`
    SELECT id, "minScore", "minimumPassingScore"
    FROM ${scorecardTable}
    WHERE id IN (${Prisma.join(scorecardIds)})
  `;

  return new Map(
    (rows || []).map((row) => {
      const minimumPassingScore = toNumber(row.minimumPassingScore);
      const minScore = toNumber(row.minScore);
      const passingScore = minimumPassingScore !== null ? minimumPassingScore : (minScore ?? 0);
      return [row.id, passingScore];
    })
  );
};

const getReviewPhaseIds = (challenge) => {
  if (!challenge || !Array.isArray(challenge.phases)) {
    return [];
  }
  const phaseIds = new Set();
  challenge.phases.forEach((phase) => {
    const name = String(phase.name || "").trim().toLowerCase();
    if (name !== "review") {
      return;
    }
    [phase.id, phase.phaseId]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .forEach((value) => phaseIds.add(value));
  });
  return Array.from(phaseIds);
};

const loadSubmitterHandles = async (challengeId) => {
  try {
    const resources = await helper.getChallengeResources(
      challengeId,
      config.SUBMITTER_ROLE_ID
    );
    const handleMap = new Map();
    resources.forEach((resource) => {
      if (resource && resource.memberId) {
        handleMap.set(String(resource.memberId), resource.memberHandle || null);
      }
    });
    return handleMap;
  } catch (error) {
    console.warn(
      `Failed to load submitter handles for challenge ${challengeId}: ${error.message}`
    );
    return null;
  }
};

const getPlacementPrizeCount = async (prisma, challengeId) => {
  return prisma.prize.count({
    where: {
      prizeSet: {
        challengeId,
        type: PrizeSetTypeEnum.PLACEMENT,
      },
    },
  });
};

const buildCsvWriter = (csvPath) => {
  if (!csvPath) {
    return {
      writeLine: (line) => process.stdout.write(`${line}\n`),
      end: () => { },
    };
  }

  const resolved = path.resolve(csvPath);
  const stream = fs.createWriteStream(resolved, { encoding: "utf8" });
  return {
    writeLine: (line) => stream.write(`${line}\n`),
    end: () => stream.end(),
  };
};

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set for the challenge database.");
  }
  if (!config.REVIEW_DB_URL) {
    throw new Error("REVIEW_DB_URL must be set for the review database.");
  }

  const reviewSchema = config.REVIEW_DB_SCHEMA || "reviews";
  const tables = {
    submission: buildSchemaTable(reviewSchema, "submission"),
    review: buildSchemaTable(reviewSchema, "review"),
    scorecard: buildSchemaTable(reviewSchema, "scorecard"),
    reviewSummation: buildSchemaTable(reviewSchema, "reviewSummation"),
  };

  const prisma = new PrismaClient();
  const reviewClient = getReviewClient();

  await prisma.$connect();
  await reviewClient.$connect();

  const challengeIds = await getChallengeIds(prisma, reviewClient, tables.submission, options);

  if (challengeIds.length === 0) {
    console.log("No challenges matched the filter criteria.");
    await reviewClient.$disconnect();
    await prisma.$disconnect();
    return;
  }

  const csvWriter = options.csvOnly ? buildCsvWriter(options.csvPath) : null;
  if (csvWriter) {
    csvWriter.writeLine(
      [
        "Submission ID",
        "Challenge ID",
        "Submitter handle",
        "Submission date",
        "Review score",
        "Scorecard min passing score",
        "Placement",
        "Prize type",
      ]
        .map(toCsvValue)
        .join(",")
    );
  }

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  for (const challengeId of challengeIds) {
    processed += 1;

    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        phases: {
          select: {
            id: true,
            name: true,
            phaseId: true,
          },
        },
      },
    });
    if (!challenge) {
      console.warn(`Challenge ${challengeId} not found, skipping.`);
      skipped += 1;
      continue;
    }

    const challengeType = CHALLENGE_TYPE_BY_ID.get(challenge.typeId);
    const isMarathonMatch = challengeType === "Marathon Match";
    const reviewPhaseIds = getReviewPhaseIds(challenge);
    if (!isMarathonMatch && reviewPhaseIds.length === 0) {
      console.warn(
        `Challenge ${challengeId} has no Review phase; skipping review-score processing.`
      );
    }

    const submissions = await loadSubmissionScores(
      reviewClient,
      tables,
      challenge,
      reviewPhaseIds
    );

    if (!submissions.length) {
      skipped += 1;
      continue;
    }

    const scorecardIds = Array.from(
      new Set(
        submissions
          .map((row) => row.scorecardId)
          .filter((id) => typeof id === "string" && id.length > 0)
      )
    );
    const passingScoreByScorecard = await loadScorecardPassingScores(
      reviewClient,
      tables.scorecard,
      scorecardIds
    );

    const normalized = submissions.map((row) => {
      const reviewScoreValue = toNumber(row.reviewScore);
      const reviewScore = reviewScoreValue === null ? null : roundScore(reviewScoreValue);
      const scorecardScore = isMarathonMatch
        ? 0
        : toNumber(passingScoreByScorecard.get(row.scorecardId)) ?? 0;
      const isPassing =
        reviewScore !== null &&
        (isMarathonMatch ? reviewScore > 0 : reviewScore >= scorecardScore);
      return {
        submissionId: row.submissionId,
        challengeId: row.challengeId,
        memberId: row.memberId,
        scorecardId: row.scorecardId,
        reviewScore,
        scorecardScore,
        isPassing,
        submittedAt: row.submittedDate || row.createdAt || null,
      };
    });

    const passing = normalized.filter((row) => row.isPassing);
    const getTimestamp = (value) => {
      if (!value) {
        return 0;
      }
      const time = new Date(value).getTime();
      return Number.isFinite(time) ? time : 0;
    };

    const passingSorted = passing.slice().sort((a, b) => {
      const scoreDiff = (b.reviewScore ?? 0) - (a.reviewScore ?? 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      const timeDiff = getTimestamp(a.submittedAt) - getTimestamp(b.submittedAt);
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return String(a.submissionId).localeCompare(String(b.submissionId));
    });

    const placementBySubmission = new Map();

    const placementPrizeCount = await getPlacementPrizeCount(prisma, challengeId);
    const winnerLimit = placementPrizeCount > 0 ? placementPrizeCount : passingSorted.length;
    const winners = passingSorted.slice(0, winnerLimit);
    const passedReview = passingSorted.slice(winnerLimit);

    winners.forEach((row, index) => {
      placementBySubmission.set(row.submissionId, {
        placement: index + 1,
        type: PrizeSetTypeEnum.PLACEMENT,
      });
    });
    passedReview.forEach((row, index) => {
      placementBySubmission.set(row.submissionId, {
        placement: index + 1,
        type: PrizeSetTypeEnum.PASSED_REVIEW,
      });
    });

    console.info(
      `Challenge ${challengeId}: ${winners.length} winner(s), ${passedReview.length} passed review`
    );

    let handleMap = null;
    if (csvWriter || (!options.csvOnly && (winners.length > 0 || passedReview.length > 0))) {
      handleMap = await loadSubmitterHandles(challengeId);
    }

    if (csvWriter) {
      const rowsForCsv = normalized.slice().sort((a, b) => {
        const scoreDiff = (b.reviewScore ?? -Infinity) - (a.reviewScore ?? -Infinity);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        return String(a.submissionId).localeCompare(String(b.submissionId));
      });
      rowsForCsv.forEach((row) => {
        const placementInfo = placementBySubmission.get(row.submissionId);
        const placement = placementInfo ? placementInfo.placement : "";
        const prizeType = placementInfo ? placementInfo.type : "";
        const submitterHandle =
          handleMap && row.memberId ? handleMap.get(String(row.memberId)) || "" : "";
        csvWriter.writeLine(
          [
            row.submissionId,
            row.challengeId,
            submitterHandle,
            toIsoString(row.submittedAt || row.createdAt),
            row.reviewScore === null ? "" : row.reviewScore,
            row.scorecardScore,
            placement,
            prizeType,
          ]
            .map(toCsvValue)
            .join(",")
        );
      });
    }

    if (!options.csvOnly) {
      const buildRecord = (row) => {
        const placementInfo = placementBySubmission.get(row.submissionId);
        if (!placementInfo) {
          console.warn(
            `Skipping entry for submission ${row.submissionId} (challenge ${challengeId}) due to missing placement info`
          );
          return null;
        }
        const { placement, type } = placementInfo;
        const parsedUserId = Number.parseInt(row.memberId, 10);
        if (!Number.isFinite(parsedUserId)) {
          console.warn(
            `Skipping ${type} entry for submission ${row.submissionId} (challenge ${challengeId}) due to invalid memberId ${row.memberId}`
          );
          return null;
        }
        const handle =
          (handleMap && handleMap.get(String(parsedUserId))) ||
          (handleMap && handleMap.get(String(row.memberId))) ||
          String(parsedUserId);
        return {
          challengeId,
          userId: parsedUserId,
          handle,
          placement,
          type,
          createdBy: CREATED_BY,
          updatedBy: UPDATED_BY,
        };
      };

      const winnerRecords = winners.map(buildRecord).filter(Boolean);

      const passedReviewRecords = passedReview.map(buildRecord).filter(Boolean);

      await prisma.$transaction(async (tx) => {
        await tx.challengeWinner.deleteMany({
          where: {
            challengeId,
            type: { in: [PrizeSetTypeEnum.PLACEMENT, PrizeSetTypeEnum.PASSED_REVIEW] },
          },
        });
        const toCreate = [...winnerRecords, ...passedReviewRecords];
        if (toCreate.length > 0) {
          await tx.challengeWinner.createMany({ data: toCreate });
        }
      });

      updated += 1;
    }
  }

  if (csvWriter) {
    csvWriter.end();
  }

  await reviewClient.$disconnect();
  await prisma.$disconnect();

  console.log(
    `Processed ${processed} challenge(s). Updated ${updated} challenge(s). Skipped ${skipped} with no reviews.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
