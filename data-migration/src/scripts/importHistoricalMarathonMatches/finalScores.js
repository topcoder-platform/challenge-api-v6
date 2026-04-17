"use strict";

const {
  ensureFileExists,
  listFilesByPattern,
  resolveFilePath,
  streamJsonArray,
} = require("./legacyDataReader");
const {
  MISSING_MEMBER_REASON_CODE,
  FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE,
} = require("./skippedArtifact");

const DEFAULT_REVIEW_SCHEMA = "reviews";

const normalizeReviewSchema = (value) => {
  const normalized = String(value || DEFAULT_REVIEW_SCHEMA).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid REVIEW_DB_SCHEMA "${normalized}"`);
  }
  return normalized;
};

const buildQualifiedTableName = (schemaName, tableName) =>
  `"${String(schemaName).replace(/"/g, "\"\"")}"."${String(tableName).replace(/"/g, "\"\"")}"`;

const parsePositiveInteger = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const normalizeMemberId = (value) => {
  const parsed = parsePositiveInteger(value);
  if (!parsed) {
    return null;
  }
  return String(parsed);
};

const parseNumericScore = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === "null") {
    return null;
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};

const parsePlacement = (value) => {
  const parsed = parsePositiveInteger(value);
  return parsed || null;
};

const hasAnyFinalSignal = (finalResultRow) => {
  const candidates = [
    finalResultRow && finalResultRow.system_point_total,
    finalResultRow && finalResultRow.point_total,
    finalResultRow && finalResultRow.placed,
  ];
  return candidates.some((value) => {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized && normalized !== "null";
  });
};

const resolveIdentityForCoderId = (coderId, normalizedIdentityByCoderId = new Map()) => {
  const normalizedCoderId = String(coderId || "").trim();
  if (!normalizedCoderId) {
    return null;
  }
  const knownIdentity = normalizedIdentityByCoderId.get(normalizedCoderId);
  const knownMemberId = normalizeMemberId(knownIdentity && knownIdentity.memberId);
  if (knownMemberId) {
    return {
      coderId: normalizedCoderId,
      memberId: knownMemberId,
      memberHandle: knownIdentity.memberHandle || null,
    };
  }

  const fallbackMemberId = normalizeMemberId(normalizedCoderId);
  if (!fallbackMemberId) {
    return null;
  }
  return {
    coderId: normalizedCoderId,
    memberId: fallbackMemberId,
    memberHandle: null,
  };
};

const deriveFinalScore = ({ systemPointTotal, pointTotal, rankingScore }) => {
  const preferredLegacyScore = Number.isFinite(systemPointTotal)
    ? { aggregateScore: systemPointTotal, scoreSource: "system_point_total" }
    : Number.isFinite(pointTotal)
    ? { aggregateScore: pointTotal, scoreSource: "point_total" }
    : { aggregateScore: null, scoreSource: null };

  if (Number.isFinite(rankingScore)) {
    if (
      !Number.isFinite(preferredLegacyScore.aggregateScore) ||
      preferredLegacyScore.aggregateScore !== rankingScore
    ) {
      return { aggregateScore: rankingScore, scoreSource: "ranking_score" };
    }
  }
  if (Number.isFinite(preferredLegacyScore.aggregateScore)) {
    return preferredLegacyScore;
  }
  if (Number.isFinite(rankingScore)) {
    return { aggregateScore: rankingScore, scoreSource: "ranking_score" };
  }
  return { aggregateScore: null, scoreSource: null };
};

const compareFinalRows = (left, right) => {
  const leftPlacement = Number.isFinite(left.legacyPlacement) ? left.legacyPlacement : Number.MAX_SAFE_INTEGER;
  const rightPlacement = Number.isFinite(right.legacyPlacement) ? right.legacyPlacement : Number.MAX_SAFE_INTEGER;
  if (leftPlacement !== rightPlacement) {
    return leftPlacement - rightPlacement;
  }
  return String(left.coderId || "").localeCompare(String(right.coderId || ""), undefined, {
    numeric: true,
  });
};

/**
 * Clears legacy placements when Informix reused the same raw `placed` value for multiple rows
 * that do not share the same score. The original placement is preserved in
 * `rawLegacyPlacement` for diagnostics, while lower-scoring or unscored rows lose their
 * normalized `legacyPlacement` so downstream imports do not treat the duplicate placement as
 * authoritative.
 *
 * @param {Array<object>} rows legacy final rows for a single round
 * @returns {Array<object>} rows cloned with normalized placement fields
 */
const normalizeConflictingDuplicatePlacements = (rows = []) => {
  const normalizedRows = rows.map((row) => ({
    ...row,
    rawLegacyPlacement: Number.isFinite(row && row.legacyPlacement) ? row.legacyPlacement : null,
  }));

  const rowsByPlacement = new Map();
  normalizedRows.forEach((row) => {
    if (!Number.isFinite(row.rawLegacyPlacement)) {
      return;
    }
    if (!rowsByPlacement.has(row.rawLegacyPlacement)) {
      rowsByPlacement.set(row.rawLegacyPlacement, []);
    }
    rowsByPlacement.get(row.rawLegacyPlacement).push(row);
  });

  rowsByPlacement.forEach((placementRows) => {
    const scoredRows = placementRows.filter((row) => Number.isFinite(row.aggregateScore));
    if (scoredRows.length === 0) {
      return;
    }

    const distinctScores = Array.from(new Set(scoredRows.map((row) => row.aggregateScore)));
    const hasUnscoredRows = scoredRows.length !== placementRows.length;
    if (distinctScores.length <= 1 && !hasUnscoredRows) {
      return;
    }

    const topScore = distinctScores.reduce((highest, score) => Math.max(highest, score), Number.NEGATIVE_INFINITY);
    placementRows.forEach((row) => {
      if (!Number.isFinite(row.aggregateScore) || row.aggregateScore !== topScore) {
        row.legacyPlacement = null;
      }
    });
  });

  return normalizedRows;
};

const loadLegacyFinalRowsByRoundId = async ({
  dataDir,
  longComponentStateFile,
  longCompResultPattern,
  roundIds,
}) => {
  const selectedRoundIds = Array.from(
    new Set((roundIds || []).map((roundId) => String(roundId || "").trim()).filter(Boolean))
  );
  const rowsByRoundId = new Map(selectedRoundIds.map((roundId) => [roundId, []]));
  if (selectedRoundIds.length === 0) {
    return rowsByRoundId;
  }

  const selectedRoundIdSet = new Set(selectedRoundIds);
  const longComponentStatePath = resolveFilePath(dataDir, longComponentStateFile);
  ensureFileExists(longComponentStatePath, "long component state");
  const longCompResultFiles = listFilesByPattern(
    dataDir,
    longCompResultPattern,
    "long comp result"
  );

  const rankingScoreByRoundCoder = new Map();
  const resultRowByRoundCoder = new Map();
  const roundCoderKeys = new Set();
  await streamJsonArray(longComponentStatePath, "long_component_state", (row) => {
    const roundId = String(row && row.round_id ? row.round_id : "").trim();
    if (!selectedRoundIdSet.has(roundId)) {
      return;
    }
    const coderId = String(row && row.coder_id ? row.coder_id : "").trim();
    if (!coderId) {
      return;
    }
    const points = parseNumericScore(row && row.points);
    if (!Number.isFinite(points)) {
      return;
    }
    const roundCoderKey = `${roundId}:${coderId}`;
    rankingScoreByRoundCoder.set(roundCoderKey, points);
    roundCoderKeys.add(roundCoderKey);
  });

  await Promise.all(
    longCompResultFiles.map((filePath) =>
      streamJsonArray(filePath, "long_comp_result", (row) => {
        const roundId = String(row && row.round_id ? row.round_id : "").trim();
        if (!selectedRoundIdSet.has(roundId)) {
          return;
        }
        if (!hasAnyFinalSignal(row)) {
          return;
        }
        const coderId = String(row && row.coder_id ? row.coder_id : "").trim();
        if (!coderId) {
          return;
        }

        const systemPointTotal = parseNumericScore(row && row.system_point_total);
        const pointTotal = parseNumericScore(row && row.point_total);
        const roundCoderKey = `${roundId}:${coderId}`;
        roundCoderKeys.add(roundCoderKey);
        resultRowByRoundCoder.set(roundCoderKey, {
          legacyPlacement: parsePlacement(row && row.placed),
          systemPointTotal,
          pointTotal,
        });
      })
    )
  );

  roundCoderKeys.forEach((roundCoderKey) => {
    const separatorIndex = roundCoderKey.indexOf(":");
    const roundId = separatorIndex >= 0 ? roundCoderKey.slice(0, separatorIndex) : "";
    const coderId = separatorIndex >= 0 ? roundCoderKey.slice(separatorIndex + 1) : "";
    if (!roundId || !coderId || !rowsByRoundId.has(roundId)) {
      return;
    }

    const resultRow = resultRowByRoundCoder.get(roundCoderKey) || {};
    const rankingScore = rankingScoreByRoundCoder.get(roundCoderKey) ?? null;
    const { aggregateScore, scoreSource } = deriveFinalScore({
      systemPointTotal: resultRow.systemPointTotal ?? null,
      pointTotal: resultRow.pointTotal ?? null,
      rankingScore,
    });

    rowsByRoundId.get(roundId).push({
      legacyRoundId: roundId,
      coderId,
      legacyPlacement: resultRow.legacyPlacement ?? null,
      aggregateScore,
      scoreSource,
      systemPointTotal: resultRow.systemPointTotal ?? null,
      pointTotal: resultRow.pointTotal ?? null,
      rankingScore,
    });
  });

  rowsByRoundId.forEach((rows, roundId) => {
    rowsByRoundId.set(
      roundId,
      normalizeConflictingDuplicatePlacements(rows)
        .sort(compareFinalRows)
    );
  });

  return rowsByRoundId;
};

const parseTimestamp = (value) => {
  if (!value) {
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getTime();
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};

const compareImportedSubmissions = (left, right) => {
  const leftSubmitted = parseTimestamp(left.submittedDate);
  const rightSubmitted = parseTimestamp(right.submittedDate);
  if (leftSubmitted !== rightSubmitted) {
    return (leftSubmitted || 0) - (rightSubmitted || 0);
  }

  const leftCreated = parseTimestamp(left.createdAt);
  const rightCreated = parseTimestamp(right.createdAt);
  if (leftCreated !== rightCreated) {
    return (leftCreated || 0) - (rightCreated || 0);
  }

  return String(left.legacySubmissionId || "").localeCompare(
    String(right.legacySubmissionId || ""),
    undefined,
    { numeric: true }
  );
};

const buildLatestImportedSubmissionByMemberId = (submissions = []) => {
  const latestByMemberId = new Map();

  submissions.forEach((submission) => {
    const memberId = normalizeMemberId(submission && submission.memberId);
    if (!memberId) {
      return;
    }
    const submissionId = String(submission && submission.id ? submission.id : "").trim();
    if (!submissionId) {
      return;
    }
    const legacySubmissionId = String(
      submission && submission.legacySubmissionId ? submission.legacySubmissionId : ""
    ).trim();
    if (!legacySubmissionId) {
      return;
    }

    const existing = latestByMemberId.get(memberId);
    if (!existing || compareImportedSubmissions(existing, submission) < 0) {
      latestByMemberId.set(memberId, submission);
    }
  });

  return latestByMemberId;
};

const hasMatchingAggregateScore = (existingSummations = [], aggregateScore) =>
  existingSummations.every((summation) => summation.aggregateScore === aggregateScore);

const reconcileRoundFinalScores = async ({
  roundId,
  challengeId,
  finalRowsByRoundId,
  normalizedIdentityByCoderId,
  missingMemberFinalSkipMemberIds = new Set(),
  plannedUnattachableFinalSkipMemberIds = new Set(),
  finalScoreStore,
  updateExistingScores = false,
}) => {
  if (
    !finalScoreStore ||
    typeof finalScoreStore.listImportedNonExampleSubmissionsByChallenge !== "function" ||
    typeof finalScoreStore.listExistingFinalSummationsBySubmissionId !== "function" ||
    typeof finalScoreStore.createFinalSummation !== "function"
  ) {
    throw new Error(
      "finalScoreStore must provide listImportedNonExampleSubmissionsByChallenge, listExistingFinalSummationsBySubmissionId, and createFinalSummation."
    );
  }

  const legacyFinalRows = finalRowsByRoundId.get(roundId) || [];
  const importedSubmissions = await finalScoreStore.listImportedNonExampleSubmissionsByChallenge({
    challengeId,
  });
  const latestImportedSubmissionByMemberId = buildLatestImportedSubmissionByMemberId(
    importedSubmissions
  );
  const existingFinalSummationsBySubmissionId =
    await finalScoreStore.listExistingFinalSummationsBySubmissionId({
      challengeId,
    });
  const missingMemberIds = new Set(
    Array.from(missingMemberFinalSkipMemberIds || [])
      .map((memberId) => normalizeMemberId(memberId))
      .filter(Boolean)
  );
  const plannedUnattachableMemberIds = new Set(
    Array.from(plannedUnattachableFinalSkipMemberIds || [])
      .map((memberId) => normalizeMemberId(memberId))
      .filter(Boolean)
  );

  let createdFinalScores = 0;
  let alreadyPresentFinalScores = 0;
  let updatedFinalScores = 0;
  let missingMemberSkippedFinalScores = 0;
  let explicitSkippedFinalScores = 0;
  const runtimeSkipRecords = [];

  for (const finalRow of legacyFinalRows) {
    const identity = resolveIdentityForCoderId(
      finalRow.coderId,
      normalizedIdentityByCoderId
    );
    const memberId = normalizeMemberId(identity && identity.memberId);

    if (!memberId || missingMemberIds.has(memberId)) {
      missingMemberSkippedFinalScores += 1;
      continue;
    }

    const attachableSubmission = latestImportedSubmissionByMemberId.get(memberId);
    if (!attachableSubmission) {
      explicitSkippedFinalScores += 1;
      if (!plannedUnattachableMemberIds.has(memberId)) {
        runtimeSkipRecords.push({
          legacyRoundId: roundId,
          memberId,
          memberHandle: identity && identity.memberHandle ? identity.memberHandle : undefined,
          coderIds: [String(finalRow.coderId || "").trim()].filter(Boolean),
          reasonCode: FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE,
          affectedSurfaces: ["final-score"],
          counts: {
            finalScore: 1,
          },
        });
      }
      continue;
    }

    if (!Number.isFinite(finalRow.aggregateScore)) {
      throw new Error(
        `Legacy final result for round ${roundId} coder ${finalRow.coderId} is missing a numeric score across system_point_total, point_total, and ranking score fallback.`
      );
    }

    const submissionId = String(attachableSubmission.id || "").trim();
    const existingFinalSummations =
      existingFinalSummationsBySubmissionId.get(submissionId) || [];
    if (existingFinalSummations.length > 0) {
      if (
        updateExistingScores &&
        !hasMatchingAggregateScore(existingFinalSummations, finalRow.aggregateScore)
      ) {
        if (typeof finalScoreStore.updateFinalSummation !== "function") {
          throw new Error(
            "finalScoreStore must provide updateFinalSummation when updateExistingScores is enabled."
          );
        }
        await Promise.all(
          existingFinalSummations.map((existingFinalSummation) =>
            finalScoreStore.updateFinalSummation({
              reviewSummationId: existingFinalSummation.id,
              submissionId,
              aggregateScore: finalRow.aggregateScore,
              isPassing: finalRow.aggregateScore > 0,
              reviewedDate:
                attachableSubmission.submittedDate ||
                attachableSubmission.createdAt ||
                null,
              legacySubmissionId:
                attachableSubmission.legacySubmissionId || null,
              isFinal: true,
              isExample: false,
              metadata: {
                legacyRoundId: roundId,
                legacyCoderId: finalRow.coderId,
                scoreSource: finalRow.scoreSource,
                legacyPlacement: finalRow.legacyPlacement,
                rawLegacyPlacement: finalRow.rawLegacyPlacement,
              },
            })
          )
        );
        existingFinalSummationsBySubmissionId.set(
          submissionId,
          existingFinalSummations.map((existingFinalSummation) => ({
            ...existingFinalSummation,
            aggregateScore: finalRow.aggregateScore,
          }))
        );
        updatedFinalScores += 1;
        continue;
      }
      alreadyPresentFinalScores += 1;
      continue;
    }

    await finalScoreStore.createFinalSummation({
      submissionId,
      aggregateScore: finalRow.aggregateScore,
      isPassing: finalRow.aggregateScore > 0,
      reviewedDate:
        attachableSubmission.submittedDate ||
        attachableSubmission.createdAt ||
        null,
      legacySubmissionId:
        attachableSubmission.legacySubmissionId || null,
      isFinal: true,
      isExample: false,
      metadata: {
        legacyRoundId: roundId,
        legacyCoderId: finalRow.coderId,
        scoreSource: finalRow.scoreSource,
        legacyPlacement: finalRow.legacyPlacement,
        rawLegacyPlacement: finalRow.rawLegacyPlacement,
      },
    });
    existingFinalSummationsBySubmissionId.set(submissionId, [
      {
        submissionId,
        aggregateScore: finalRow.aggregateScore,
      },
    ]);
    createdFinalScores += 1;
  }

  const result = {
    legacyFinalCandidates: legacyFinalRows.length,
    importedFinalScores: createdFinalScores + updatedFinalScores + alreadyPresentFinalScores,
    alreadyPresentFinalScores,
    createdFinalScores,
    missingMemberSkippedFinalScores,
    explicitSkippedFinalScores,
    runtimeSkipRecords,
  };
  if (updateExistingScores) {
    result.updatedFinalScores = updatedFinalScores;
  }
  return result;
};

const createReviewFinalScoreStore = async ({
  reviewClient,
  reviewSchema = DEFAULT_REVIEW_SCHEMA,
  actor = "historical-mm-importer",
}) => {
  if (!reviewClient || typeof reviewClient.$queryRawUnsafe !== "function") {
    throw new Error(
      "Review DB client with $queryRawUnsafe is required for final-score import."
    );
  }

  const schema = normalizeReviewSchema(reviewSchema);
  const submissionTable = buildQualifiedTableName(schema, "submission");
  const reviewSummationTable = buildQualifiedTableName(schema, "reviewSummation");

  const columnRows = await reviewClient.$queryRawUnsafe(
    `SELECT table_name AS "tableName",
            column_name AS "columnName",
            data_type AS "dataType",
            is_nullable AS "isNullable"
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name IN ('submission', 'reviewSummation')`,
    schema
  );

  const submissionColumnsByName = new Map();
  const reviewSummationColumnsByName = new Map();
  (columnRows || []).forEach((columnRow) => {
    if (columnRow.tableName === "submission") {
      submissionColumnsByName.set(String(columnRow.columnName), columnRow);
    } else if (columnRow.tableName === "reviewSummation") {
      reviewSummationColumnsByName.set(String(columnRow.columnName), columnRow);
    }
  });

  if (!submissionColumnsByName.has("id") || !submissionColumnsByName.has("challengeId")) {
    throw new Error(
      `Review submission table ${schema}.submission must expose id and challengeId columns.`
    );
  }
  if (
    !reviewSummationColumnsByName.has("submissionId") ||
    !reviewSummationColumnsByName.has("aggregateScore") ||
    !reviewSummationColumnsByName.has("isPassing")
  ) {
    throw new Error(
      `Review reviewSummation table ${schema}.reviewSummation must expose submissionId, aggregateScore, and isPassing columns.`
    );
  }

  const listImportedNonExampleSubmissionsByChallenge = async ({ challengeId }) => {
    const selectedColumns = [`"id"`, `"memberId"`, `"legacySubmissionId"`];
    if (submissionColumnsByName.has("submittedDate")) {
      selectedColumns.push(`"submittedDate"`);
    }
    if (submissionColumnsByName.has("createdAt")) {
      selectedColumns.push(`"createdAt"`);
    }
    if (submissionColumnsByName.has("isExample")) {
      selectedColumns.push(`"isExample"`);
    }

    const whereClauses = [`"challengeId" = $1`, `"legacySubmissionId" IS NOT NULL`];
    if (submissionColumnsByName.has("isExample")) {
      whereClauses.push(`COALESCE("isExample", false) = false`);
    }

    const rows = await reviewClient.$queryRawUnsafe(
      `SELECT ${selectedColumns.join(", ")}
         FROM ${submissionTable}
        WHERE ${whereClauses.join(" AND ")}`,
      challengeId
    );

    return (rows || [])
      .map((row) => ({
        id: String(row && row.id ? row.id : "").trim(),
        memberId: normalizeMemberId(row && row.memberId),
        legacySubmissionId: String(
          row && row.legacySubmissionId ? row.legacySubmissionId : ""
        ).trim(),
        submittedDate: row && row.submittedDate ? row.submittedDate : null,
        createdAt: row && row.createdAt ? row.createdAt : null,
        isExample: Boolean(row && row.isExample),
      }))
      .filter(
        (row) => row.id && row.memberId && row.legacySubmissionId && row.isExample !== true
      );
  };

  const listExistingFinalSummationsBySubmissionId = async ({ challengeId }) => {
    const whereClauses = [
      `s."challengeId" = $1`,
      `rs."isFinal" = true`,
    ];
    if (reviewSummationColumnsByName.has("isExample")) {
      whereClauses.push(`COALESCE(rs."isExample", false) = false`);
    }
    const rows = await reviewClient.$queryRawUnsafe(
      `SELECT ${reviewSummationColumnsByName.has("id") ? 'rs."id" AS "id",' : ""}
              rs."submissionId" AS "submissionId",
              rs."aggregateScore" AS "aggregateScore"
         FROM ${reviewSummationTable} rs
         INNER JOIN ${submissionTable} s ON s."id" = rs."submissionId"
        WHERE ${whereClauses.join(" AND ")}`,
      challengeId
    );

    const bySubmissionId = new Map();
    (rows || []).forEach((row) => {
      const submissionId = String(row && row.submissionId ? row.submissionId : "").trim();
      if (!submissionId) {
        return;
      }
      if (!bySubmissionId.has(submissionId)) {
        bySubmissionId.set(submissionId, []);
      }
      bySubmissionId.get(submissionId).push({
        id: String(row && row.id ? row.id : "").trim() || null,
        submissionId,
        aggregateScore: parseNumericScore(row && row.aggregateScore),
      });
    });
    return bySubmissionId;
  };

  const createFinalSummation = async ({
    submissionId,
    aggregateScore,
    isPassing,
    reviewedDate,
    legacySubmissionId,
    isFinal = true,
    isExample = false,
    metadata = null,
  }) => {
    const columns = [];
    const placeholders = [];
    const values = [];
    const pushColumn = (columnName, value) => {
      columns.push(`"${columnName}"`);
      values.push(value);
      placeholders.push(`$${values.length}`);
    };

    pushColumn("submissionId", submissionId);
    pushColumn("aggregateScore", aggregateScore);
    pushColumn("isPassing", Boolean(isPassing));
    if (reviewSummationColumnsByName.has("isFinal")) {
      pushColumn("isFinal", Boolean(isFinal));
    }
    if (reviewSummationColumnsByName.has("reviewedDate") && reviewedDate) {
      pushColumn("reviewedDate", reviewedDate);
    }
    if (reviewSummationColumnsByName.has("legacySubmissionId") && legacySubmissionId) {
      pushColumn("legacySubmissionId", String(legacySubmissionId));
    }
    if (reviewSummationColumnsByName.has("isExample")) {
      pushColumn("isExample", Boolean(isExample));
    }
    if (reviewSummationColumnsByName.has("metadata") && metadata) {
      pushColumn("metadata", metadata);
    }
    if (reviewSummationColumnsByName.has("createdBy")) {
      pushColumn("createdBy", actor);
    }
    if (reviewSummationColumnsByName.has("updatedBy")) {
      pushColumn("updatedBy", actor);
    }
    const updatedAtColumn = reviewSummationColumnsByName.get("updatedAt");
    if (
      updatedAtColumn &&
      String(updatedAtColumn.isNullable || "").toUpperCase() === "NO"
    ) {
      pushColumn("updatedAt", reviewedDate || new Date());
    }

    await reviewClient.$queryRawUnsafe(
      `INSERT INTO ${reviewSummationTable} (${columns.join(", ")})
            VALUES (${placeholders.join(", ")})`,
      ...values
    );
  };

  const updateFinalSummation = async ({
    reviewSummationId,
    aggregateScore,
    isPassing,
    reviewedDate,
    legacySubmissionId,
    isFinal = true,
    isExample = false,
    metadata = null,
  }) => {
    const normalizedReviewSummationId = String(reviewSummationId || "").trim();
    if (!normalizedReviewSummationId) {
      throw new Error("updateFinalSummation requires reviewSummationId.");
    }
    if (!reviewSummationColumnsByName.has("id")) {
      throw new Error(
        `Review reviewSummation table ${schema}.reviewSummation must expose id for targeted score reruns.`
      );
    }

    const assignments = [];
    const values = [];
    const pushAssignment = (columnName, value) => {
      values.push(value);
      assignments.push(`"${columnName}" = $${values.length}`);
    };

    pushAssignment("aggregateScore", aggregateScore);
    pushAssignment("isPassing", Boolean(isPassing));
    if (reviewSummationColumnsByName.has("isFinal")) {
      pushAssignment("isFinal", Boolean(isFinal));
    }
    if (reviewSummationColumnsByName.has("reviewedDate")) {
      pushAssignment("reviewedDate", reviewedDate || null);
    }
    if (reviewSummationColumnsByName.has("legacySubmissionId")) {
      pushAssignment("legacySubmissionId", legacySubmissionId ? String(legacySubmissionId) : null);
    }
    if (reviewSummationColumnsByName.has("isExample")) {
      pushAssignment("isExample", Boolean(isExample));
    }
    if (reviewSummationColumnsByName.has("metadata")) {
      pushAssignment("metadata", metadata);
    }
    if (reviewSummationColumnsByName.has("updatedBy")) {
      pushAssignment("updatedBy", actor);
    }
    if (reviewSummationColumnsByName.has("updatedAt")) {
      pushAssignment("updatedAt", reviewedDate || new Date());
    }
    values.push(normalizedReviewSummationId);

    await reviewClient.$queryRawUnsafe(
      `UPDATE ${reviewSummationTable}
          SET ${assignments.join(", ")}
        WHERE "id" = $${values.length}`,
      ...values
    );
  };

  return {
    listImportedNonExampleSubmissionsByChallenge,
    listExistingFinalSummationsBySubmissionId,
    createFinalSummation,
    updateFinalSummation,
  };
};

module.exports = {
  DEFAULT_REVIEW_SCHEMA,
  loadLegacyFinalRowsByRoundId,
  reconcileRoundFinalScores,
  createReviewFinalScoreStore,
  MISSING_MEMBER_REASON_CODE,
  FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE,
};
