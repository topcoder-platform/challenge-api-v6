"use strict";

const {
  ensureFileExists,
  listFilesByPattern,
  resolveFilePath,
  streamJsonArray,
} = require("./legacyDataReader");
const { deriveLegacySubmissionId } = require("./submissionHistory");
const {
  MISSING_MEMBER_REASON_CODE,
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

const parseEpochMs = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
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

const normalizeMemberId = (value) => {
  const parsed = parsePositiveInteger(value);
  if (!parsed) {
    return null;
  }
  return String(parsed);
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

const compareProvisionalRows = (left, right) => {
  const legacySubmissionDelta = String(left.legacySubmissionId || "").localeCompare(
    String(right.legacySubmissionId || ""),
    undefined,
    { numeric: true }
  );
  if (legacySubmissionDelta !== 0) {
    return legacySubmissionDelta;
  }
  const leftSubmitTime = Number.isFinite(left.submitTimeMs) ? left.submitTimeMs : Number.MAX_SAFE_INTEGER;
  const rightSubmitTime = Number.isFinite(right.submitTimeMs) ? right.submitTimeMs : Number.MAX_SAFE_INTEGER;
  if (leftSubmitTime !== rightSubmitTime) {
    return leftSubmitTime - rightSubmitTime;
  }
  return String(left.coderId || "").localeCompare(String(right.coderId || ""), undefined, {
    numeric: true,
  });
};

const formatImportedCountsByMemberId = (countsByMemberId) =>
  Object.fromEntries(
    Array.from(countsByMemberId.entries()).sort(([left], [right]) =>
      String(left).localeCompare(String(right), undefined, { numeric: true })
    )
  );

const loadLegacyProvisionalRowsByRoundId = async ({
  dataDir,
  longComponentStateFile,
  longSubmissionPattern,
  roundIds,
}) => {
  const selectedRoundIds = Array.from(
    new Set((roundIds || []).map((roundId) => String(roundId || "").trim()).filter(Boolean))
  );
  const rowsByRoundId = new Map(selectedRoundIds.map((roundId) => [roundId, []]));
  if (selectedRoundIds.length === 0) {
    return rowsByRoundId;
  }

  const longComponentStatePath = resolveFilePath(dataDir, longComponentStateFile);
  ensureFileExists(longComponentStatePath, "long component state");
  const longSubmissionFiles = listFilesByPattern(
    dataDir,
    longSubmissionPattern,
    "long submission"
  );

  const selectedRoundIdSet = new Set(selectedRoundIds);
  const stateInfoById = new Map();
  await streamJsonArray(longComponentStatePath, "long_component_state", (row) => {
    const roundId = String(row && row.round_id ? row.round_id : "").trim();
    if (!selectedRoundIdSet.has(roundId)) {
      return;
    }
    const longComponentStateId = String(
      row && row.long_component_state_id ? row.long_component_state_id : ""
    ).trim();
    const coderId = String(row && row.coder_id ? row.coder_id : "").trim();
    if (!longComponentStateId || !coderId) {
      return;
    }
    stateInfoById.set(longComponentStateId, {
      legacyRoundId: roundId,
      coderId,
    });
  });

  const generatedSubmissionOrdinalByStateId = new Map();
  await Promise.all(
    longSubmissionFiles.map((filePath) =>
      streamJsonArray(filePath, "long_submission", (row) => {
        const longComponentStateId = String(
          row && row.long_component_state_id ? row.long_component_state_id : ""
        ).trim();
        const stateInfo = stateInfoById.get(longComponentStateId);
        if (!stateInfo) {
          return;
        }

        const isExample = String(row && row.example ? row.example : "").trim() === "1";
        if (isExample) {
          return;
        }

        const currentOrdinal = generatedSubmissionOrdinalByStateId.get(longComponentStateId) || 0;
        const fallbackOrdinal = currentOrdinal + 1;
        generatedSubmissionOrdinalByStateId.set(longComponentStateId, fallbackOrdinal);
        const submissionNumber =
          parsePositiveInteger(row && row.submission_number) || fallbackOrdinal;
        const legacySubmissionId = deriveLegacySubmissionId({
          longComponentStateId,
          submissionNumber,
        });

        rowsByRoundId.get(stateInfo.legacyRoundId).push({
          legacyRoundId: stateInfo.legacyRoundId,
          coderId: stateInfo.coderId,
          longComponentStateId,
          submissionNumber,
          legacySubmissionId,
          submitTimeMs: parseEpochMs(row && row.submit_time),
          aggregateScore: parseNumericScore(row && row.submission_points),
        });
      })
    )
  );

  rowsByRoundId.forEach((rows, roundId) => {
    rowsByRoundId.set(roundId, [...rows].sort(compareProvisionalRows));
  });

  return rowsByRoundId;
};

const reconcileRoundProvisionalScores = async ({
  roundId,
  challengeId,
  provisionalRowsByRoundId,
  normalizedIdentityByCoderId,
  missingMemberProvisionalSkipMemberIds = new Set(),
  provisionalScoreStore,
}) => {
  if (
    !provisionalScoreStore ||
    typeof provisionalScoreStore.listImportedNonExampleSubmissionsByLegacySubmissionId !== "function" ||
    typeof provisionalScoreStore.listExistingProvisionalSummationsBySubmissionId !== "function" ||
    typeof provisionalScoreStore.createProvisionalSummation !== "function"
  ) {
    throw new Error(
      "provisionalScoreStore must provide listImportedNonExampleSubmissionsByLegacySubmissionId, listExistingProvisionalSummationsBySubmissionId, and createProvisionalSummation."
    );
  }

  const legacyProvisionalRows = provisionalRowsByRoundId.get(roundId) || [];
  const importedSubmissionByLegacySubmissionId =
    await provisionalScoreStore.listImportedNonExampleSubmissionsByLegacySubmissionId({
      challengeId,
    });
  const existingProvisionalSummationsBySubmissionId =
    await provisionalScoreStore.listExistingProvisionalSummationsBySubmissionId({
      challengeId,
    });
  const missingMemberIds = new Set(
    Array.from(missingMemberProvisionalSkipMemberIds || [])
      .map((memberId) => normalizeMemberId(memberId))
      .filter(Boolean)
  );

  let createdProvisionalScores = 0;
  let alreadyPresentProvisionalScores = 0;
  let missingMemberSkippedProvisionalScores = 0;
  const importedCountsByMemberId = new Map();
  const importedMemberIds = new Set();
  const missingMemberIdsObserved = new Set();
  const skippedProvisionalRecords = [];

  const incrementImportedCount = (memberId) => {
    importedMemberIds.add(memberId);
    importedCountsByMemberId.set(memberId, (importedCountsByMemberId.get(memberId) || 0) + 1);
  };

  for (const provisionalRow of legacyProvisionalRows) {
    const identity = resolveIdentityForCoderId(
      provisionalRow.coderId,
      normalizedIdentityByCoderId
    );
    const memberId = normalizeMemberId(identity && identity.memberId);
    const memberHandle = identity && identity.memberHandle ? identity.memberHandle : null;

    if (!memberId || missingMemberIds.has(memberId)) {
      missingMemberSkippedProvisionalScores += 1;
      if (memberId) {
        missingMemberIdsObserved.add(memberId);
      }
      skippedProvisionalRecords.push({
        legacyRoundId: roundId,
        memberId: memberId || String(provisionalRow.coderId || "").trim(),
        memberHandle: memberHandle || undefined,
        coderIds: [String(provisionalRow.coderId || "").trim()].filter(Boolean),
        reasonCode: MISSING_MEMBER_REASON_CODE,
        affectedSurfaces: ["provisional-score"],
        legacySubmissionId: provisionalRow.legacySubmissionId,
        counts: {
          provisionalScore: 1,
        },
      });
      continue;
    }

    if (!Number.isFinite(provisionalRow.aggregateScore)) {
      throw new Error(
        `Legacy provisional score for round ${roundId} submission ${provisionalRow.legacySubmissionId} (coder ${provisionalRow.coderId}) is missing numeric submission_points.`
      );
    }

    const importedSubmission = importedSubmissionByLegacySubmissionId.get(
      provisionalRow.legacySubmissionId
    );
    if (!importedSubmission) {
      throw new Error(
        `Unable to attach provisional score for round ${roundId} submission ${provisionalRow.legacySubmissionId}: imported non-example submission is missing.`
      );
    }
    const submissionId = String(importedSubmission.id || "").trim();
    if (!submissionId) {
      throw new Error(
        `Imported non-example submission for legacySubmissionId ${provisionalRow.legacySubmissionId} is missing id.`
      );
    }
    const submissionMemberId = normalizeMemberId(importedSubmission.memberId);
    if (submissionMemberId && submissionMemberId !== memberId) {
      throw new Error(
        `Imported submission legacySubmissionId "${provisionalRow.legacySubmissionId}" is linked to memberId ${submissionMemberId} but legacy coder ${provisionalRow.coderId} resolves to memberId ${memberId}.`
      );
    }

    const existingProvisionalSummations =
      existingProvisionalSummationsBySubmissionId.get(submissionId) || [];
    if (existingProvisionalSummations.length > 0) {
      alreadyPresentProvisionalScores += 1;
      incrementImportedCount(memberId);
      continue;
    }

    await provisionalScoreStore.createProvisionalSummation({
      submissionId,
      aggregateScore: provisionalRow.aggregateScore,
      isPassing: provisionalRow.aggregateScore > 0,
      reviewedDate:
        importedSubmission.submittedDate || importedSubmission.createdAt || null,
      legacySubmissionId: provisionalRow.legacySubmissionId || null,
      isFinal: false,
      isExample: false,
      metadata: {
        legacyRoundId: roundId,
        legacyCoderId: provisionalRow.coderId,
      },
    });
    existingProvisionalSummationsBySubmissionId.set(submissionId, [
      {
        submissionId,
        aggregateScore: provisionalRow.aggregateScore,
      },
    ]);
    createdProvisionalScores += 1;
    incrementImportedCount(memberId);
  }

  return {
    legacyNonExampleProvisionalScores: legacyProvisionalRows.length,
    importedProvisionalScores:
      createdProvisionalScores + alreadyPresentProvisionalScores,
    alreadyPresentProvisionalScores,
    createdProvisionalScores,
    missingMemberSkippedProvisionalScores,
    importedDistinctSubmitters: importedMemberIds.size,
    missingMemberDistinctSubmitters: missingMemberIdsObserved.size,
    importedProvisionalCountsByMemberId: formatImportedCountsByMemberId(
      importedCountsByMemberId
    ),
    skippedProvisionalRecords,
  };
};

const createReviewProvisionalScoreStore = async ({
  reviewClient,
  reviewSchema = DEFAULT_REVIEW_SCHEMA,
  actor = "historical-mm-importer",
}) => {
  if (!reviewClient || typeof reviewClient.$queryRawUnsafe !== "function") {
    throw new Error(
      "Review DB client with $queryRawUnsafe is required for provisional-score import."
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

  if (
    !submissionColumnsByName.has("id") ||
    !submissionColumnsByName.has("challengeId") ||
    !submissionColumnsByName.has("legacySubmissionId")
  ) {
    throw new Error(
      `Review submission table ${schema}.submission must expose id, challengeId, and legacySubmissionId columns.`
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

  const listImportedNonExampleSubmissionsByLegacySubmissionId = async ({
    challengeId,
  }) => {
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

    const byLegacySubmissionId = new Map();
    (rows || []).forEach((row) => {
      const legacySubmissionId = String(
        row && row.legacySubmissionId ? row.legacySubmissionId : ""
      ).trim();
      if (!legacySubmissionId) {
        return;
      }
      const submissionId = String(row && row.id ? row.id : "").trim();
      if (!submissionId) {
        return;
      }
      byLegacySubmissionId.set(legacySubmissionId, {
        id: submissionId,
        memberId: normalizeMemberId(row && row.memberId),
        legacySubmissionId,
        submittedDate: row && row.submittedDate ? row.submittedDate : null,
        createdAt: row && row.createdAt ? row.createdAt : null,
        isExample: Boolean(row && row.isExample),
      });
    });
    return byLegacySubmissionId;
  };

  const listExistingProvisionalSummationsBySubmissionId = async ({
    challengeId,
  }) => {
    const whereClauses = [
      `s."challengeId" = $1`,
      `COALESCE(rs."isFinal", false) = false`,
    ];
    if (reviewSummationColumnsByName.has("isExample")) {
      whereClauses.push(`COALESCE(rs."isExample", false) = false`);
    }
    const rows = await reviewClient.$queryRawUnsafe(
      `SELECT rs."submissionId" AS "submissionId",
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
        submissionId,
        aggregateScore: parseNumericScore(row && row.aggregateScore),
      });
    });
    return bySubmissionId;
  };

  const createProvisionalSummation = async ({
    submissionId,
    aggregateScore,
    isPassing,
    reviewedDate,
    legacySubmissionId,
    isFinal = false,
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

  return {
    listImportedNonExampleSubmissionsByLegacySubmissionId,
    listExistingProvisionalSummationsBySubmissionId,
    createProvisionalSummation,
  };
};

module.exports = {
  DEFAULT_REVIEW_SCHEMA,
  loadLegacyProvisionalRowsByRoundId,
  reconcileRoundProvisionalScores,
  createReviewProvisionalScoreStore,
};
