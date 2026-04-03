"use strict";

const normalizeReviewSchema = (value) => {
  const normalized = String(value || "reviews").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid REVIEW_DB_SCHEMA "${normalized}"`);
  }
  return normalized;
};

const buildQualifiedTableName = (schemaName, tableName) =>
  `"${String(schemaName).replace(/"/g, "\"\"")}"."${String(tableName).replace(/"/g, "\"\"")}"`;

const parseNonNegativeInteger = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
};

const parsePositiveInteger = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const readCountRow = (rows = []) => parseNonNegativeInteger(rows[0] && rows[0].count);

const introspectReviewColumns = async ({ reviewClient, reviewSchema }) => {
  if (!reviewClient || typeof reviewClient.$queryRawUnsafe !== "function") {
    return null;
  }

  const schema = normalizeReviewSchema(reviewSchema);
  const columnRows = await reviewClient.$queryRawUnsafe(
    `SELECT table_name AS "tableName",
            column_name AS "columnName"
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name IN ('submission', 'reviewSummation')`,
    schema
  );

  const submissionColumns = new Set();
  const reviewSummationColumns = new Set();
  (columnRows || []).forEach((columnRow) => {
    const tableName = String(columnRow && columnRow.tableName ? columnRow.tableName : "").trim();
    const columnName = String(columnRow && columnRow.columnName ? columnRow.columnName : "").trim();
    if (!columnName) {
      return;
    }
    if (tableName === "submission") {
      submissionColumns.add(columnName);
    } else if (tableName === "reviewSummation") {
      reviewSummationColumns.add(columnName);
    }
  });

  if (!submissionColumns.has("challengeId") || !submissionColumns.has("id")) {
    return null;
  }
  if (!reviewSummationColumns.has("submissionId")) {
    return null;
  }

  return {
    schema,
    submissionTable: buildQualifiedTableName(schema, "submission"),
    reviewSummationTable: buildQualifiedTableName(schema, "reviewSummation"),
    submissionColumns,
    reviewSummationColumns,
  };
};

const countImportedSubmissions = async ({
  reviewClient,
  metadata,
  challengeId,
}) => {
  const whereClauses = [`"challengeId" = $1`];
  if (metadata.submissionColumns.has("legacySubmissionId")) {
    whereClauses.push(`"legacySubmissionId" IS NOT NULL`);
  }
  if (metadata.submissionColumns.has("isExample")) {
    whereClauses.push(`COALESCE("isExample", false) = false`);
  }
  const rows = await reviewClient.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS "count"
       FROM ${metadata.submissionTable}
      WHERE ${whereClauses.join(" AND ")}`,
    challengeId
  );
  return readCountRow(rows);
};

const countReviewSummations = async ({
  reviewClient,
  metadata,
  challengeId,
  isFinal,
}) => {
  if (!metadata.reviewSummationColumns.has("isFinal")) {
    return 0;
  }

  const whereClauses = [`s."challengeId" = $1`];
  if (metadata.submissionColumns.has("legacySubmissionId")) {
    whereClauses.push(`s."legacySubmissionId" IS NOT NULL`);
  }
  if (metadata.submissionColumns.has("isExample")) {
    whereClauses.push(`COALESCE(s."isExample", false) = false`);
  }
  if (metadata.reviewSummationColumns.has("isExample")) {
    whereClauses.push(`COALESCE(rs."isExample", false) = false`);
  }
  whereClauses.push(`COALESCE(rs."isFinal", false) = ${isFinal ? "true" : "false"}`);

  const rows = await reviewClient.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS "count"
       FROM ${metadata.reviewSummationTable} rs
       INNER JOIN ${metadata.submissionTable} s ON s."id" = rs."submissionId"
      WHERE ${whereClauses.join(" AND ")}`,
    challengeId
  );
  return readCountRow(rows);
};

const countSubmitterResources = async ({
  resourceClient,
  challengeId,
  submitterRoleId,
}) => {
  if (!resourceClient || typeof resourceClient.listSubmitterResources !== "function") {
    return null;
  }

  const rows = await resourceClient.listSubmitterResources(challengeId, submitterRoleId);
  const uniqueSubmitterTuples = new Set();

  (rows || []).forEach((row) => {
    const memberId = parsePositiveInteger(row && row.memberId);
    if (!memberId) {
      return;
    }
    const roleId = String(
      row && row.roleId ? row.roleId : submitterRoleId || ""
    ).trim();
    uniqueSubmitterTuples.add(`${memberId}:${roleId}`);
  });

  return uniqueSubmitterTuples.size;
};

const createLinkedRecordCountResolver = async ({
  resourceClient = null,
  reviewClient = null,
  reviewSchema = "reviews",
  submitterRoleId = "",
} = {}) => {
  const reviewMetadata = await introspectReviewColumns({
    reviewClient,
    reviewSchema,
  });

  return async ({ challengeIds = [] } = {}) => {
    const uniqueChallengeIds = Array.from(
      new Set(
        (challengeIds || [])
          .map((challengeId) => String(challengeId || "").trim())
          .filter(Boolean)
      )
    );

    const byChallengeId = new Map();
    for (const challengeId of uniqueChallengeIds) {
      const counts = {};

      try {
        const resourceCount = await countSubmitterResources({
          resourceClient,
          challengeId,
          submitterRoleId,
        });
        if (Number.isFinite(resourceCount)) {
          counts.resources = resourceCount;
        }
      } catch {
        // Best-effort enrichment only.
      }

      if (reviewMetadata) {
        try {
          counts.submissions = await countImportedSubmissions({
            reviewClient,
            metadata: reviewMetadata,
            challengeId,
          });
          counts.finalScores = await countReviewSummations({
            reviewClient,
            metadata: reviewMetadata,
            challengeId,
            isFinal: true,
          });
          counts.provisionalScores = await countReviewSummations({
            reviewClient,
            metadata: reviewMetadata,
            challengeId,
            isFinal: false,
          });
        } catch {
          // Best-effort enrichment only.
        }
      }

      byChallengeId.set(challengeId, counts);
    }

    return byChallengeId;
  };
};

module.exports = {
  createLinkedRecordCountResolver,
};
