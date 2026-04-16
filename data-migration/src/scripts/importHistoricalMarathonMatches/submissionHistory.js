"use strict";

const crypto = require("crypto");

const {
  buildSubmissionArchiveFileName,
} = require("./submissionArchives");
const {
  ensureFileExists,
  listFilesByPattern,
  resolveFilePath,
  streamJsonArray,
} = require("./legacyDataReader");
const {
  MISSING_MEMBER_REASON_CODE,
} = require("./skippedArtifact");

const CONTEST_SUBMISSION_TYPE = "CONTEST_SUBMISSION";
const ACTIVE_SUBMISSION_STATUS = "ACTIVE";
const DEFAULT_REVIEW_SCHEMA = "reviews";

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

const normalizeMemberId = (value) => {
  const parsed = parsePositiveInteger(value);
  if (!parsed) {
    return null;
  }
  return String(parsed);
};

const normalizeReviewSchema = (value) => {
  const normalized = String(value || DEFAULT_REVIEW_SCHEMA).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid REVIEW_DB_SCHEMA "${normalized}"`);
  }
  return normalized;
};

const LEGACY_SUBMISSION_TEXT_FIELDS = [
  "submission",
  "submission_text",
  "submissionText",
  "text",
  "body",
  "source",
  "source_code",
  "sourceCode",
  "code",
  "content",
  "contents",
];

const isUsableLegacySubmissionText = (value) => {
  if (value === null || value === undefined) {
    return false;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return false;
  }
  return normalized.toLowerCase() !== "null";
};

const resolveLegacySubmissionText = (row) => {
  const record = row && typeof row === "object" ? row : {};
  for (const fieldName of LEGACY_SUBMISSION_TEXT_FIELDS) {
    if (isUsableLegacySubmissionText(record[fieldName])) {
      return String(record[fieldName]);
    }
  }
  return "";
};

const buildQualifiedTableName = (schemaName, tableName) =>
  `"${String(schemaName).replace(/"/g, "\"\"")}"."${String(tableName).replace(/"/g, "\"\"")}"`;

const compareSubmissionRows = (left, right) => {
  const leftSubmitTime = Number.isFinite(left.submitTimeMs) ? left.submitTimeMs : Number.MAX_SAFE_INTEGER;
  const rightSubmitTime = Number.isFinite(right.submitTimeMs) ? right.submitTimeMs : Number.MAX_SAFE_INTEGER;
  if (leftSubmitTime !== rightSubmitTime) {
    return leftSubmitTime - rightSubmitTime;
  }

  const leftState = String(left.longComponentStateId || "");
  const rightState = String(right.longComponentStateId || "");
  const stateDelta = leftState.localeCompare(rightState, undefined, { numeric: true });
  if (stateDelta !== 0) {
    return stateDelta;
  }

  const leftSubmissionNumber = Number.isFinite(left.submissionNumber) ? left.submissionNumber : Number.MAX_SAFE_INTEGER;
  const rightSubmissionNumber = Number.isFinite(right.submissionNumber) ? right.submissionNumber : Number.MAX_SAFE_INTEGER;
  if (leftSubmissionNumber !== rightSubmissionNumber) {
    return leftSubmissionNumber - rightSubmissionNumber;
  }

  return String(left.legacySubmissionId || "").localeCompare(String(right.legacySubmissionId || ""));
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

const selectLaterSubmissionRow = (currentRow, candidateRow) => {
  if (!currentRow) {
    return candidateRow || null;
  }
  if (!candidateRow) {
    return currentRow;
  }
  return compareSubmissionRows(currentRow, candidateRow) <= 0 ? candidateRow : currentRow;
};

const deriveLegacySubmissionId = ({ longComponentStateId, submissionNumber }) => {
  const normalizedStateId = String(longComponentStateId || "").trim();
  if (!normalizedStateId) {
    throw new Error("Cannot derive legacySubmissionId without long_component_state_id.");
  }
  const normalizedSubmissionNumber = parsePositiveInteger(submissionNumber);
  if (!normalizedSubmissionNumber) {
    throw new Error("Cannot derive legacySubmissionId without a positive submission_number.");
  }
  const suffix = String(normalizedSubmissionNumber).padStart(4, "0");
  return `${normalizedStateId}${suffix}`;
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

const loadNonExampleLegacySubmissionRowsByRoundId = async ({
  dataDir,
  longComponentStateFile,
  longSubmissionPattern,
  roundIds,
  attachableExampleOnlyFinalistCoderIdsByRoundId = new Map(),
}) => {
  const selectedRoundIds = Array.from(new Set((roundIds || []).map((roundId) => String(roundId || "").trim()).filter(Boolean)));
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
  const latestExampleOnlyCandidateByStateId = new Map();
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
          latestExampleOnlyCandidateByStateId.set(
            longComponentStateId,
            selectLaterSubmissionRow(
              latestExampleOnlyCandidateByStateId.get(longComponentStateId),
              {
                legacyRoundId: stateInfo.legacyRoundId,
                coderId: stateInfo.coderId,
                longComponentStateId,
                submissionNumber,
                submitTimeMs: parseEpochMs(row && row.submit_time),
                submittedDate: parseEpochMs(row && row.submit_time)
                  ? new Date(parseEpochMs(row && row.submit_time))
                  : null,
                legacySubmissionId,
                isSyntheticExampleOnlyFinalist: true,
                submissionText: resolveLegacySubmissionText(row),
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
          submitTimeMs: parseEpochMs(row && row.submit_time),
          submittedDate: parseEpochMs(row && row.submit_time)
            ? new Date(parseEpochMs(row && row.submit_time))
            : null,
          legacySubmissionId,
          isSyntheticExampleOnlyFinalist: false,
          submissionText: resolveLegacySubmissionText(row),
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

    const exampleOnlyCandidate = latestExampleOnlyCandidateByStateId.get(longComponentStateId);
    if (!exampleOnlyCandidate) {
      return;
    }

    rowsByRoundId.get(stateInfo.legacyRoundId).push(exampleOnlyCandidate);
  });

  rowsByRoundId.forEach((rows, roundId) => {
    const sortedRows = [...rows].sort(compareSubmissionRows);
    rowsByRoundId.set(roundId, sortedRows);
  });

  return rowsByRoundId;
};

const formatImportedCountsByMemberId = (countsByMemberId) =>
  Object.fromEntries(
    Array.from(countsByMemberId.entries()).sort(([left], [right]) =>
      String(left).localeCompare(String(right), undefined, { numeric: true })
    )
  );

const createReviewSubmissionStore = async ({
  reviewClient,
  reviewSchema = DEFAULT_REVIEW_SCHEMA,
  actor = "historical-mm-importer",
}) => {
  if (!reviewClient || typeof reviewClient.$queryRawUnsafe !== "function") {
    throw new Error("Review DB client with $queryRawUnsafe is required for submission import.");
  }

  const schema = normalizeReviewSchema(reviewSchema);
  const submissionTable = buildQualifiedTableName(schema, "submission");

  const columnRows = await reviewClient.$queryRawUnsafe(
    `SELECT column_name AS "columnName",
            data_type AS "dataType",
            udt_name AS "udtName"
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = 'submission'`,
    schema
  );
  const columnsByName = new Map(
    (columnRows || []).map((columnRow) => [String(columnRow.columnName), columnRow])
  );

  if (!columnsByName.has("challengeId") || !columnsByName.has("legacySubmissionId")) {
    throw new Error(
      `Review submission table ${schema}.submission must expose challengeId and legacySubmissionId columns.`
    );
  }

  const toEnumCastExpression = ({ index, udtName }) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(udtName || ""))) {
      throw new Error(`Unsupported enum type "${udtName}" for submission.type.`);
    }
    return `$${index}::"${schema}"."${udtName}"`;
  };

  const listExistingSubmissionsByLegacyId = async ({ challengeId }) => {
    const selectedColumns = [`"legacySubmissionId"`];
    if (columnsByName.has("memberId")) {
      selectedColumns.push(`"memberId"`);
    }
    if (columnsByName.has("submitter")) {
      selectedColumns.push(`"submitter"`);
    }
    if (columnsByName.has("systemFileName")) {
      selectedColumns.push(`"systemFileName"`);
    }
    if (columnsByName.has("virusScan")) {
      selectedColumns.push(`"virusScan"`);
    }
    if (columnsByName.has("isFileSubmission")) {
      selectedColumns.push(`"isFileSubmission"`);
    }

    const rows = await reviewClient.$queryRawUnsafe(
      `SELECT ${selectedColumns.join(", ")}
         FROM ${submissionTable}
        WHERE "challengeId" = $1
          AND "legacySubmissionId" IS NOT NULL`,
      challengeId
    );

    const byLegacyId = new Map();
    (rows || []).forEach((row) => {
      const legacySubmissionId = String(row && row.legacySubmissionId ? row.legacySubmissionId : "").trim();
      if (!legacySubmissionId) {
        return;
      }
      byLegacyId.set(legacySubmissionId, {
        legacySubmissionId,
        memberId: normalizeMemberId(row && row.memberId),
        submitter: row && row.submitter ? String(row.submitter) : null,
        systemFileName:
          row && row.systemFileName !== null && row.systemFileName !== undefined
            ? String(row.systemFileName).trim()
            : null,
        virusScan:
          row && (row.virusScan === true || row.virusScan === false) ? row.virusScan : null,
        isFileSubmission:
          row && (row.isFileSubmission === true || row.isFileSubmission === false)
            ? row.isFileSubmission
            : null,
      });
    });
    return byLegacyId;
  };

  const createSubmission = async ({
    challengeId,
    legacySubmissionId,
    memberId,
    memberHandle,
    submittedDate,
  }) => {
    const normalizedLegacySubmissionId = String(legacySubmissionId || "").trim();
    if (!normalizedLegacySubmissionId) {
      throw new Error("createSubmission requires legacySubmissionId.");
    }
    const archiveFileName = columnsByName.has("systemFileName")
      ? buildSubmissionArchiveFileName({
        challengeId,
        legacySubmissionId: normalizedLegacySubmissionId,
      })
      : null;

    const derivedId = crypto
      .createHash("sha1")
      .update(normalizedLegacySubmissionId)
      .digest("hex")
      .slice(0, 14);

    const columns = [];
    const placeholders = [];
    const values = [];
    const pushColumn = (columnName, value, placeholderExpression = null) => {
      columns.push(`"${columnName}"`);
      values.push(value);
      placeholders.push(placeholderExpression || `$${values.length}`);
    };

    if (columnsByName.has("id")) {
      pushColumn("id", derivedId);
    }
    pushColumn("challengeId", challengeId);
    pushColumn("legacySubmissionId", normalizedLegacySubmissionId);
    if (columnsByName.has("memberId") && memberId) {
      pushColumn("memberId", String(memberId));
    }
    if (columnsByName.has("submitter")) {
      pushColumn("submitter", memberHandle || null);
    }
    if (columnsByName.has("submittedDate") && submittedDate) {
      pushColumn("submittedDate", submittedDate);
    }
    if (columnsByName.has("systemFileName") && archiveFileName) {
      pushColumn("systemFileName", archiveFileName);
    }
    if (columnsByName.has("virusScan")) {
      pushColumn("virusScan", true);
    }
    if (columnsByName.has("isFileSubmission")) {
      pushColumn("isFileSubmission", true);
    }
    if (columnsByName.has("isExample")) {
      pushColumn("isExample", false);
    }
    if (columnsByName.has("createdBy")) {
      pushColumn("createdBy", actor);
    }
    if (columnsByName.has("updatedBy")) {
      pushColumn("updatedBy", actor);
    }
    if (columnsByName.has("type")) {
      const typeColumn = columnsByName.get("type");
      const placeholderExpression =
        String(typeColumn.dataType || "").toUpperCase() === "USER-DEFINED"
          ? toEnumCastExpression({ index: values.length + 1, udtName: typeColumn.udtName })
          : `$${values.length + 1}`;
      pushColumn("type", CONTEST_SUBMISSION_TYPE, placeholderExpression);
    }
    if (columnsByName.has("status")) {
      const statusColumn = columnsByName.get("status");
      const placeholderExpression =
        String(statusColumn.dataType || "").toUpperCase() === "USER-DEFINED"
          ? toEnumCastExpression({ index: values.length + 1, udtName: statusColumn.udtName })
          : `$${values.length + 1}`;
      pushColumn("status", ACTIVE_SUBMISSION_STATUS, placeholderExpression);
    }

    await reviewClient.$queryRawUnsafe(
      `INSERT INTO ${submissionTable} (${columns.join(", ")})
            VALUES (${placeholders.join(", ")})`,
      ...values
    );
  };

  /**
   * Backfills file-submission metadata for an already imported review submission row.
   *
   * @param {Object} params reconciliation parameters
   * @param {string} params.challengeId v6 challenge identifier for the submission row
   * @param {string} params.legacySubmissionId deterministic legacy submission identifier
   * @param {Object} [params.existingSubmission] current row snapshot returned from
   * listExistingSubmissionsByLegacyId
   * @returns {Promise<boolean>} true when an UPDATE was issued, otherwise false
   * @throws {Error} when legacySubmissionId is blank
   */
  const updateSubmissionMetadata = async ({
    challengeId,
    legacySubmissionId,
    existingSubmission = null,
  }) => {
    const normalizedLegacySubmissionId = String(legacySubmissionId || "").trim();
    if (!normalizedLegacySubmissionId) {
      throw new Error("updateSubmissionMetadata requires legacySubmissionId.");
    }

    const assignments = [];
    const values = [];
    const pushAssignment = (columnName, value) => {
      assignments.push(`"${columnName}" = $${values.length + 1}`);
      values.push(value);
    };

    const currentSystemFileName =
      existingSubmission &&
      existingSubmission.systemFileName !== null &&
      existingSubmission.systemFileName !== undefined
        ? String(existingSubmission.systemFileName).trim()
        : null;
    const expectedArchiveFileName = columnsByName.has("systemFileName")
      ? buildSubmissionArchiveFileName({
        challengeId,
        legacySubmissionId: normalizedLegacySubmissionId,
      })
      : null;
    if (
      columnsByName.has("systemFileName") &&
      expectedArchiveFileName &&
      currentSystemFileName !== expectedArchiveFileName
    ) {
      pushAssignment("systemFileName", expectedArchiveFileName);
    }
    if (columnsByName.has("virusScan") && (!existingSubmission || existingSubmission.virusScan !== true)) {
      pushAssignment("virusScan", true);
    }
    if (
      columnsByName.has("isFileSubmission") &&
      (!existingSubmission || existingSubmission.isFileSubmission !== true)
    ) {
      pushAssignment("isFileSubmission", true);
    }
    if (assignments.length === 0) {
      return false;
    }
    if (columnsByName.has("updatedBy")) {
      pushAssignment("updatedBy", actor);
    }

    values.push(challengeId);
    values.push(normalizedLegacySubmissionId);
    await reviewClient.$queryRawUnsafe(
      `UPDATE ${submissionTable}
          SET ${assignments.join(", ")}
        WHERE "challengeId" = $${values.length - 1}
          AND "legacySubmissionId" = $${values.length}`,
      ...values
    );
    return true;
  };

  return {
    listExistingSubmissionsByLegacyId,
    createSubmission,
    updateSubmissionMetadata,
  };
};

const createReviewSubmissionArchiveStore = async ({
  reviewClient,
  reviewSchema = DEFAULT_REVIEW_SCHEMA,
}) => {
  if (!reviewClient || typeof reviewClient.$queryRawUnsafe !== "function") {
    throw new Error(
      "Review DB client with $queryRawUnsafe is required for submission archive reconciliation."
    );
  }

  const schema = normalizeReviewSchema(reviewSchema);
  const submissionTable = buildQualifiedTableName(schema, "submission");
  const columnRows = await reviewClient.$queryRawUnsafe(
    `SELECT column_name AS "columnName"
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = 'submission'`,
    schema
  );
  const columnNames = new Set((columnRows || []).map((columnRow) => String(columnRow.columnName)));

  if (!columnNames.has("challengeId") || !columnNames.has("legacySubmissionId")) {
    throw new Error(
      `Review submission table ${schema}.submission must expose challengeId and legacySubmissionId columns.`
    );
  }
  if (!columnNames.has("url")) {
    throw new Error(`Review submission table ${schema}.submission must expose url column.`);
  }

  const listSubmissionsByLegacyId = async ({ challengeId }) => {
    const rows = await reviewClient.$queryRawUnsafe(
      `SELECT "legacySubmissionId", "url"
         FROM ${submissionTable}
        WHERE "challengeId" = $1
          AND "legacySubmissionId" IS NOT NULL`,
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
      if (byLegacySubmissionId.has(legacySubmissionId)) {
        throw new Error(
          `Challenge ${challengeId} has duplicate submission rows for legacySubmissionId "${legacySubmissionId}".`
        );
      }

      byLegacySubmissionId.set(legacySubmissionId, {
        legacySubmissionId,
        url:
          row && row.url !== null && row.url !== undefined ? String(row.url) : null,
      });
    });
    return byLegacySubmissionId;
  };

  const updateSubmissionUrl = async ({ challengeId, legacySubmissionId, url }) => {
    const normalizedLegacySubmissionId = String(legacySubmissionId || "").trim();
    const normalizedUrl = String(url || "").trim();
    if (!normalizedLegacySubmissionId) {
      throw new Error("updateSubmissionUrl requires legacySubmissionId.");
    }
    if (!normalizedUrl) {
      throw new Error("updateSubmissionUrl requires url.");
    }

    await reviewClient.$queryRawUnsafe(
      `UPDATE ${submissionTable}
          SET "url" = $1
        WHERE "challengeId" = $2
          AND "legacySubmissionId" = $3`,
      normalizedUrl,
      challengeId,
      normalizedLegacySubmissionId
    );
  };

  return {
    listSubmissionsByLegacyId,
    updateSubmissionUrl,
  };
};

const reconcileRoundSubmissionHistory = async ({
  roundId,
  challengeId,
  rowsByRoundId,
  normalizedIdentityByCoderId,
  missingMemberSubmissionSkipMemberIds = new Set(),
  submissionStore,
}) => {
  if (!submissionStore) {
    throw new Error("submissionStore is required for submission reconciliation.");
  }

  const legacyRows = rowsByRoundId.get(roundId) || [];
  const legacyNonExampleSubmissions = legacyRows.filter(
    (row) => row && row.isSyntheticExampleOnlyFinalist !== true
  ).length;
  const legacyExampleOnlyFinalistSubmissions = legacyRows.length - legacyNonExampleSubmissions;
  const existingByLegacySubmissionId = await submissionStore.listExistingSubmissionsByLegacyId({
    challengeId,
  });

  let createdSubmissions = 0;
  let alreadyPresentSubmissions = 0;
  let missingMemberSkippedSubmissions = 0;
  const importedCountsByMemberId = new Map();
  const importedMemberIds = new Set();
  const missingMemberIds = new Set();
  const skippedSubmissionRecords = [];
  const missingMemberIdsSet =
    missingMemberSubmissionSkipMemberIds instanceof Set
      ? new Set(Array.from(missingMemberSubmissionSkipMemberIds).map((memberId) => normalizeMemberId(memberId)).filter(Boolean))
      : new Set();

  const incrementImportedCount = (memberId) => {
    importedMemberIds.add(memberId);
    importedCountsByMemberId.set(memberId, (importedCountsByMemberId.get(memberId) || 0) + 1);
  };

  for (const row of legacyRows) {
    const identity = resolveIdentityForCoderId(row.coderId, normalizedIdentityByCoderId);
    const memberId = normalizeMemberId(identity && identity.memberId);
    const memberHandle = identity && identity.memberHandle ? identity.memberHandle : null;
    if (!memberId || missingMemberIdsSet.has(memberId)) {
      missingMemberSkippedSubmissions += 1;
      if (memberId) {
        missingMemberIds.add(memberId);
      }
      skippedSubmissionRecords.push({
        legacyRoundId: roundId,
        memberId: memberId || String(row.coderId || "").trim(),
        memberHandle: memberHandle || undefined,
        coderIds: [String(row.coderId || "").trim()].filter(Boolean),
        reasonCode: MISSING_MEMBER_REASON_CODE,
        affectedSurfaces: ["submission"],
        legacySubmissionId: row.legacySubmissionId,
        counts: {
          submission: 1,
        },
      });
      continue;
    }

    const existing = existingByLegacySubmissionId.get(row.legacySubmissionId);
    if (existing) {
      const existingMemberId = normalizeMemberId(existing.memberId);
      if (existingMemberId && existingMemberId !== memberId) {
        throw new Error(
          `Existing submission legacySubmissionId "${row.legacySubmissionId}" is linked to memberId ${existingMemberId} but legacy coder ${row.coderId} resolves to memberId ${memberId}.`
        );
      }
      if (typeof submissionStore.updateSubmissionMetadata === "function") {
        await submissionStore.updateSubmissionMetadata({
          challengeId,
          legacySubmissionId: row.legacySubmissionId,
          existingSubmission: existing,
        });
      }
      alreadyPresentSubmissions += 1;
      incrementImportedCount(memberId);
      continue;
    }

    await submissionStore.createSubmission({
      challengeId,
      legacySubmissionId: row.legacySubmissionId,
      memberId,
      memberHandle,
      submittedDate: row.submittedDate,
    });
    existingByLegacySubmissionId.set(row.legacySubmissionId, {
      legacySubmissionId: row.legacySubmissionId,
      memberId,
      submitter: memberHandle,
    });
    createdSubmissions += 1;
    incrementImportedCount(memberId);
  }

  return {
    legacyNonExampleSubmissions,
    legacyExampleOnlyFinalistSubmissions,
    importedSubmissions: createdSubmissions + alreadyPresentSubmissions,
    alreadyPresentSubmissions,
    createdSubmissions,
    missingMemberSkippedSubmissions,
    importedDistinctSubmitters: importedMemberIds.size,
    missingMemberDistinctSubmitters: missingMemberIds.size,
    importedSubmissionCountsByMemberId: formatImportedCountsByMemberId(importedCountsByMemberId),
    skippedSubmissionRecords,
  };
};

module.exports = {
  CONTEST_SUBMISSION_TYPE,
  ACTIVE_SUBMISSION_STATUS,
  DEFAULT_REVIEW_SCHEMA,
  deriveLegacySubmissionId,
  loadNonExampleLegacySubmissionRowsByRoundId,
  createReviewSubmissionStore,
  createReviewSubmissionArchiveStore,
  reconcileRoundSubmissionHistory,
  resolveLegacySubmissionText,
};
