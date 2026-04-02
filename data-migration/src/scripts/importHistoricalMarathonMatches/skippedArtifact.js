"use strict";

const fs = require("fs");
const path = require("path");

const SKIPPED_ARTIFACT_SCHEMA_VERSION = 1;
const MISSING_MEMBER_REASON_CODE = "missing-member";
const FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE =
  "finalist-without-attachable-submission";

const normalizeMemberIdForSort = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return null;
};

const normalizeAffectedSurfaces = (value) => {
  const surfaces = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      surfaces
        .map((surface) => String(surface || "").trim())
        .filter(Boolean)
    )
  );
};

const compareSkipRecords = (left, right) => {
  const leftRound = String(left.legacyRoundId || "");
  const rightRound = String(right.legacyRoundId || "");
  const roundDelta = leftRound.localeCompare(rightRound, undefined, { numeric: true });
  if (roundDelta !== 0) {
    return roundDelta;
  }

  const leftMemberNum = normalizeMemberIdForSort(left.memberId);
  const rightMemberNum = normalizeMemberIdForSort(right.memberId);
  if (Number.isFinite(leftMemberNum) && Number.isFinite(rightMemberNum) && leftMemberNum !== rightMemberNum) {
    return leftMemberNum - rightMemberNum;
  }

  const leftMember = String(left.memberId || "");
  const rightMember = String(right.memberId || "");
  const memberDelta = leftMember.localeCompare(rightMember);
  if (memberDelta !== 0) {
    return memberDelta;
  }

  const leftReason = String(left.reasonCode || "");
  const rightReason = String(right.reasonCode || "");
  const reasonDelta = leftReason.localeCompare(rightReason);
  if (reasonDelta !== 0) {
    return reasonDelta;
  }

  const leftLegacySubmissionId = String(left.legacySubmissionId || "");
  const rightLegacySubmissionId = String(right.legacySubmissionId || "");
  const legacySubmissionDelta = leftLegacySubmissionId.localeCompare(rightLegacySubmissionId);
  if (legacySubmissionDelta !== 0) {
    return legacySubmissionDelta;
  }

  const leftSurfaces = normalizeAffectedSurfaces(left.affectedSurfaces).join("|");
  const rightSurfaces = normalizeAffectedSurfaces(right.affectedSurfaces).join("|");
  return leftSurfaces.localeCompare(rightSurfaces);
};

const normalizeSkipRecord = (record) => {
  const normalized = {
    legacyRoundId: String(record && record.legacyRoundId ? record.legacyRoundId : "").trim(),
    memberId: String(record && record.memberId ? record.memberId : "").trim(),
    reasonCode: String(record && record.reasonCode ? record.reasonCode : "").trim(),
    affectedSurfaces: normalizeAffectedSurfaces(record && record.affectedSurfaces),
  };
  if (record && record.memberHandle) {
    normalized.memberHandle = String(record.memberHandle).trim();
  }
  if (record && Array.isArray(record.coderIds) && record.coderIds.length > 0) {
    normalized.coderIds = Array.from(
      new Set(record.coderIds.map((coderId) => String(coderId || "").trim()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  }
  if (record && record.legacySubmissionId) {
    normalized.legacySubmissionId = String(record.legacySubmissionId).trim();
  }
  if (record && record.counts && typeof record.counts === "object") {
    const entries = Object.entries(record.counts)
      .map(([key, value]) => [String(key), Number.parseInt(value, 10)])
      .filter(([, value]) => Number.isFinite(value) && value > 0)
      .sort(([left], [right]) => left.localeCompare(right));
    if (entries.length > 0) {
      normalized.counts = Object.fromEntries(entries);
    }
  }
  return normalized;
};

const normalizeSkipRecords = (records = []) =>
  records
    .map((record) => normalizeSkipRecord(record))
    .filter(
      (record) =>
        record.legacyRoundId &&
        record.memberId &&
        record.reasonCode &&
        record.affectedSurfaces.length > 0
    )
    .sort(compareSkipRecords);

const collectReasonCodes = (records = []) =>
  Array.from(
    new Set(
      records
        .map((record) => String(record && record.reasonCode ? record.reasonCode : "").trim())
        .filter(Boolean)
    )
  ).sort();

const resolveSkippedFilePath = ({
  skippedFilePath,
  roundIds = [],
  cwd = process.cwd(),
}) => {
  const normalizedPath = String(skippedFilePath || "").trim();
  if (normalizedPath) {
    return path.isAbsolute(normalizedPath)
      ? normalizedPath
      : path.resolve(cwd, normalizedPath);
  }
  const roundToken = Array.from(new Set(roundIds.map((roundId) => String(roundId || "").trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .join("-");
  const suffix = roundToken || "selected-rounds";
  return path.resolve(cwd, `historical-mm-skipped-${suffix}.json`);
};

const buildSkippedArtifact = ({ selectedRoundIds = [], records = [] }) => {
  const normalizedRecords = normalizeSkipRecords(records);
  return {
    schemaVersion: SKIPPED_ARTIFACT_SCHEMA_VERSION,
    selectedRoundIds: [...selectedRoundIds],
    reasonCodes: collectReasonCodes(normalizedRecords),
    records: normalizedRecords,
  };
};

const writeSkippedArtifact = ({ filePath, selectedRoundIds = [], records = [] }) => {
  const artifact = buildSkippedArtifact({ selectedRoundIds, records });
  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
};

module.exports = {
  SKIPPED_ARTIFACT_SCHEMA_VERSION,
  MISSING_MEMBER_REASON_CODE,
  FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE,
  resolveSkippedFilePath,
  normalizeSkipRecords,
  collectReasonCodes,
  buildSkippedArtifact,
  writeSkippedArtifact,
};
