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
  MALFORMED_PROVISIONAL_SCORE_REASON_CODE,
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

const normalizeCoderIdSetByRoundId = (value) => {
  const byRoundId = new Map();
  if (!(value instanceof Map)) {
    return byRoundId;
  }

  value.forEach((coderIds, roundId) => {
    const normalizedRoundId = String(roundId || "").trim();
    if (!normalizedRoundId) {
      return;
    }

    const normalizedCoderIds = new Set(
      Array.from(coderIds || [])
        .map((coderId) => String(coderId || "").trim())
        .filter(Boolean)
    );
    if (normalizedCoderIds.size > 0) {
      byRoundId.set(normalizedRoundId, normalizedCoderIds);
    }
  });

  return byRoundId;
};

/**
 * Normalizes the explicit final legacy submission ids by legacy round. Targeted
 * score reruns use this marker to repair old provisional rows that were
 * mistakenly imported as final review summations.
 *
 * @param {Map<string, Iterable<string|object>>} value map keyed by round id; each
 *   entry may contain legacy submission ids or final-row objects with a
 *   `legacySubmissionId` field
 * @returns {Map<string, Set<string>>} normalized legacy submission ids by round
 * @throws Does not throw.
 */
const normalizeLegacySubmissionIdSetByRoundId = (value) => {
  const byRoundId = new Map();
  if (!(value instanceof Map)) {
    return byRoundId;
  }

  value.forEach((submissionIdsOrRows, roundId) => {
    const normalizedRoundId = String(roundId || "").trim();
    if (!normalizedRoundId) {
      return;
    }

    const normalizedSubmissionIds = new Set(
      Array.from(submissionIdsOrRows || [])
        .map((submissionIdOrRow) => {
          if (
            submissionIdOrRow &&
            typeof submissionIdOrRow === "object" &&
            !Array.isArray(submissionIdOrRow)
          ) {
            return String(submissionIdOrRow.legacySubmissionId || "").trim();
          }
          return String(submissionIdOrRow || "").trim();
        })
        .filter(Boolean)
    );
    if (normalizedSubmissionIds.size > 0) {
      byRoundId.set(normalizedRoundId, normalizedSubmissionIds);
    }
  });

  return byRoundId;
};

const selectLaterProvisionalRow = (currentRow, candidateRow) => {
  if (!currentRow) {
    return candidateRow || null;
  }
  if (!candidateRow) {
    return currentRow;
  }
  return compareProvisionalRows(currentRow, candidateRow) <= 0 ? candidateRow : currentRow;
};

const formatImportedCountsByMemberId = (countsByMemberId) =>
  Object.fromEntries(
    Array.from(countsByMemberId.entries()).sort(([left], [right]) =>
      String(left).localeCompare(String(right), undefined, { numeric: true })
    )
  );

const hasMatchingAggregateScore = (existingSummations = [], aggregateScore) =>
  existingSummations.every((summation) => summation.aggregateScore === aggregateScore);

const loadLegacyProvisionalRowsByRoundId = async ({
  dataDir,
  longComponentStateFile,
  longSubmissionPattern,
  roundIds,
  attachableExampleOnlyFinalistCoderIdsByRoundId = new Map(),
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
  const normalizedAttachableExampleOnlyFinalistCoderIdsByRoundId =
    normalizeCoderIdSetByRoundId(attachableExampleOnlyFinalistCoderIdsByRoundId);
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
  const generatedExampleSubmissionOrdinalByStateId = new Map();
  const latestExampleOnlyProvisionalByStateId = new Map();
  const stateIdsWithNonExampleSubmissions = new Set();
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
          const currentExampleOrdinal =
            generatedExampleSubmissionOrdinalByStateId.get(longComponentStateId) || 0;
          const fallbackOrdinal = currentExampleOrdinal + 1;
          generatedExampleSubmissionOrdinalByStateId.set(longComponentStateId, fallbackOrdinal);
          const submissionNumber =
            parsePositiveInteger(row && row.submission_number) || fallbackOrdinal;
          const legacySubmissionId = deriveLegacySubmissionId({
            longComponentStateId,
            submissionNumber,
          });

          latestExampleOnlyProvisionalByStateId.set(
            longComponentStateId,
            selectLaterProvisionalRow(
              latestExampleOnlyProvisionalByStateId.get(longComponentStateId),
              {
                legacyRoundId: stateInfo.legacyRoundId,
                coderId: stateInfo.coderId,
                longComponentStateId,
                submissionNumber,
                legacySubmissionId,
                submitTimeMs: parseEpochMs(row && row.submit_time),
                aggregateScore: parseNumericScore(row && row.submission_points),
                isSyntheticExampleOnlyFinalist: true,
              }
            )
          );
          return;
        }

        stateIdsWithNonExampleSubmissions.add(longComponentStateId);
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
          isSyntheticExampleOnlyFinalist: false,
        });
      })
    )
  );

  stateInfoById.forEach((stateInfo, longComponentStateId) => {
    if (stateIdsWithNonExampleSubmissions.has(longComponentStateId)) {
      return;
    }

    const attachableCoderIds =
      normalizedAttachableExampleOnlyFinalistCoderIdsByRoundId.get(stateInfo.legacyRoundId);
    if (!attachableCoderIds || !attachableCoderIds.has(stateInfo.coderId)) {
      return;
    }

    const exampleOnlyProvisional = latestExampleOnlyProvisionalByStateId.get(longComponentStateId);
    if (!exampleOnlyProvisional) {
      return;
    }

    rowsByRoundId.get(stateInfo.legacyRoundId).push(exampleOnlyProvisional);
  });

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
  updateExistingScores = false,
  finalLegacySubmissionIdsByRoundId = new Map(),
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
  const legacyNonExampleProvisionalScores = legacyProvisionalRows.filter(
    (row) => row && row.isSyntheticExampleOnlyFinalist !== true
  ).length;
  const legacyExampleOnlyFinalistProvisionalScores =
    legacyProvisionalRows.length - legacyNonExampleProvisionalScores;
  const importedSubmissionByLegacySubmissionId =
    await provisionalScoreStore.listImportedNonExampleSubmissionsByLegacySubmissionId({
      challengeId,
    });
  const existingProvisionalSummationsBySubmissionId =
    await provisionalScoreStore.listExistingProvisionalSummationsBySubmissionId({
      challengeId,
    });
  const finalLegacySubmissionIds =
    normalizeLegacySubmissionIdSetByRoundId(finalLegacySubmissionIdsByRoundId).get(roundId) ||
    new Set();
  const canDemoteMisclassifiedFinalScores =
    updateExistingScores &&
    finalLegacySubmissionIds.size > 0 &&
    typeof provisionalScoreStore.listExistingFinalSummationsBySubmissionId === "function";
  const existingFinalSummationsBySubmissionId = canDemoteMisclassifiedFinalScores
    ? await provisionalScoreStore.listExistingFinalSummationsBySubmissionId({
      challengeId,
    })
    : new Map();
  const missingMemberIds = new Set(
    Array.from(missingMemberProvisionalSkipMemberIds || [])
      .map((memberId) => normalizeMemberId(memberId))
      .filter(Boolean)
  );

  let createdProvisionalScores = 0;
  let alreadyPresentProvisionalScores = 0;
  let updatedProvisionalScores = 0;
  let demotedFinalScores = 0;
  let malformedSkippedProvisionalScores = 0;
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
      malformedSkippedProvisionalScores += 1;
      skippedProvisionalRecords.push({
        legacyRoundId: roundId,
        memberId,
        memberHandle: memberHandle || undefined,
        coderIds: [String(provisionalRow.coderId || "").trim()].filter(Boolean),
        reasonCode: MALFORMED_PROVISIONAL_SCORE_REASON_CODE,
        affectedSurfaces: ["provisional-score"],
        legacySubmissionId: provisionalRow.legacySubmissionId,
        counts: {
          provisionalScore: 1,
        },
      });
      continue;
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
      if (
        updateExistingScores &&
        !hasMatchingAggregateScore(existingProvisionalSummations, provisionalRow.aggregateScore)
      ) {
        if (typeof provisionalScoreStore.updateProvisionalSummation !== "function") {
          throw new Error(
            "provisionalScoreStore must provide updateProvisionalSummation when updateExistingScores is enabled."
          );
        }
        await Promise.all(
          existingProvisionalSummations.map((existingProvisionalSummation) =>
            provisionalScoreStore.updateProvisionalSummation({
              reviewSummationId: existingProvisionalSummation.id,
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
            })
          )
        );
        existingProvisionalSummationsBySubmissionId.set(
          submissionId,
          existingProvisionalSummations.map((existingProvisionalSummation) => ({
            ...existingProvisionalSummation,
            aggregateScore: provisionalRow.aggregateScore,
          }))
        );
        updatedProvisionalScores += 1;
        incrementImportedCount(memberId);
        continue;
      }
      alreadyPresentProvisionalScores += 1;
      incrementImportedCount(memberId);
      continue;
    }

    const isExplicitFinalSubmission = finalLegacySubmissionIds.has(
      String(provisionalRow.legacySubmissionId || "").trim()
    );
    const misclassifiedFinalSummations =
      canDemoteMisclassifiedFinalScores && !isExplicitFinalSubmission
        ? existingFinalSummationsBySubmissionId.get(submissionId) || []
        : [];
    if (misclassifiedFinalSummations.length > 0) {
      if (typeof provisionalScoreStore.updateProvisionalSummation !== "function") {
        throw new Error(
          "provisionalScoreStore must provide updateProvisionalSummation when updateExistingScores is enabled."
        );
      }
      await Promise.all(
        misclassifiedFinalSummations.map((misclassifiedFinalSummation) =>
          provisionalScoreStore.updateProvisionalSummation({
            reviewSummationId: misclassifiedFinalSummation.id,
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
          })
        )
      );
      existingFinalSummationsBySubmissionId.set(submissionId, []);
      existingProvisionalSummationsBySubmissionId.set(
        submissionId,
        misclassifiedFinalSummations.map((misclassifiedFinalSummation) => ({
          ...misclassifiedFinalSummation,
          aggregateScore: provisionalRow.aggregateScore,
        }))
      );
      updatedProvisionalScores += 1;
      demotedFinalScores += misclassifiedFinalSummations.length;
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
    legacyNonExampleProvisionalScores,
    legacyExampleOnlyFinalistProvisionalScores,
    importedProvisionalScores:
      createdProvisionalScores + updatedProvisionalScores + alreadyPresentProvisionalScores,
    alreadyPresentProvisionalScores,
    createdProvisionalScores,
    ...(updateExistingScores ? { updatedProvisionalScores, demotedFinalScores } : {}),
    malformedSkippedProvisionalScores,
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

  const listExistingFinalSummationsBySubmissionId = async ({
    challengeId,
  }) => {
    const whereClauses = [
      `s."challengeId" = $1`,
      `COALESCE(rs."isFinal", false) = true`,
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

  const updateProvisionalSummation = async ({
    reviewSummationId,
    aggregateScore,
    isPassing,
    reviewedDate,
    legacySubmissionId,
    isFinal = false,
    isExample = false,
    metadata = null,
  }) => {
    const normalizedReviewSummationId = String(reviewSummationId || "").trim();
    if (!normalizedReviewSummationId) {
      throw new Error("updateProvisionalSummation requires reviewSummationId.");
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
    listImportedNonExampleSubmissionsByLegacySubmissionId,
    listExistingProvisionalSummationsBySubmissionId,
    listExistingFinalSummationsBySubmissionId,
    createProvisionalSummation,
    updateProvisionalSummation,
  };
};

module.exports = {
  DEFAULT_REVIEW_SCHEMA,
  loadLegacyProvisionalRowsByRoundId,
  reconcileRoundProvisionalScores,
  createReviewProvisionalScoreStore,
};
