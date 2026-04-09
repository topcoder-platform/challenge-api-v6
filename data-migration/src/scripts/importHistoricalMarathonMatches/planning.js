"use strict";

const {
  ensureFileExists,
  listFilesByPattern,
  resolveFilePath,
  streamJsonArray,
} = require("./legacyDataReader");
const {
  STANDARD_PHASE_NAMES,
  derivePhaseWindows,
} = require("./apply");
const {
  loadNormalizedIdentityByCoderId,
  buildEligibleMemberIdentities,
} = require("./participants");
const {
  MISSING_MEMBER_REASON_CODE,
  FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE,
  resolveSkippedFilePath,
  collectReasonCodes,
} = require("./skippedArtifact");
const {
  TARGET_MEMBER_RESOLUTION_UNAVAILABLE_REASON,
} = require("./targetMemberResolution");

const createEmptyCounters = () => ({
  round: null,
  componentIds: new Set(),
  problemIds: new Set(),
  descriptionProblemId: null,
  descriptionProblemText: null,
  eligibleRegistrants: new Set(),
  nonExampleSubmissions: 0,
  exampleSubmissions: 0,
  exampleOnlyFinalistSubmissions: 0,
  nonExampleSubmitterCoderIds: new Set(),
  nonExampleSubmissionCountsByCoderId: new Map(),
  exampleOnlyFinalistSubmissionCountsByCoderId: new Map(),
  finalCandidateCoderIds: new Set(),
  registrationStartMs: null,
  registrationEndMs: null,
  earliestSubmissionOpenMs: null,
  earliestNonExampleSubmitMs: null,
  latestNonExampleSubmitMs: null,
  earliestExampleOnlyFinalistSubmitMs: null,
  latestExampleOnlyFinalistSubmitMs: null,
});

const sortIds = (values) =>
  Array.from(values).sort((left, right) => {
    const leftNum = Number.parseInt(left, 10);
    const rightNum = Number.parseInt(right, 10);
    if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
      return leftNum - rightNum;
    }
    return String(left).localeCompare(String(right));
  });

const parseNonNegativeInteger = (value) => {
  const parsed = Number.parseInt(value, 10);
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

const normalizeMemberId = (value) => {
  const parsed = parsePositiveInteger(value);
  if (!parsed) {
    return null;
  }
  return String(parsed);
};

const parseLegacySqlTimestamp = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.toLowerCase() === "null") {
    return null;
  }
  const isoLike = normalized.includes("T")
    ? normalized
    : normalized.replace(" ", "T");
  const withZone = /([+-]\d{2}:?\d{2}|Z)$/i.test(isoLike) ? isoLike : `${isoLike}Z`;
  const parsed = Date.parse(withZone);
  if (!Number.isFinite(parsed)) {
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

const isUsableProblemText = (value) => {
  if (value === null || value === undefined) {
    return false;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return false;
  }
  return normalized.toLowerCase() !== "null";
};

const minMs = (left, right) => {
  if (!Number.isFinite(left)) {
    return Number.isFinite(right) ? right : null;
  }
  if (!Number.isFinite(right)) {
    return left;
  }
  return Math.min(left, right);
};

const maxMs = (left, right) => {
  if (!Number.isFinite(left)) {
    return Number.isFinite(right) ? right : null;
  }
  if (!Number.isFinite(right)) {
    return left;
  }
  return Math.max(left, right);
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

const buildEntityDelta = (target, existing) => {
  const safeTarget = parseNonNegativeInteger(target);
  const safeExisting = parseNonNegativeInteger(existing);
  const unchanged = Math.min(safeTarget, safeExisting);
  return {
    target: safeTarget,
    existing: safeExisting,
    toCreate: Math.max(0, safeTarget - safeExisting),
    unchanged,
  };
};

const buildRoundSummaryCounts = ({
  counters,
  plannedFinalScores = 0,
  plannedProvisionalScores = 0,
  finalistsWithoutAttachableSubmission = 0,
}) => ({
  eligibleRegistrants: counters.eligibleRegistrants.size,
  nonExampleSubmissions: counters.nonExampleSubmissions,
  exampleSubmissionsFiltered: counters.exampleSubmissions,
  exampleOnlyFinalistSubmissions: counters.exampleOnlyFinalistSubmissions,
  plannedFinalScores,
  plannedProvisionalScores,
  finalistsWithoutAttachableSubmission,
});

const buildZeroEntityDeltas = () => ({
  phases: buildEntityDelta(0, 0),
  resources: buildEntityDelta(0, 0),
  submissions: buildEntityDelta(0, 0),
  finalScores: { ...buildEntityDelta(0, 0), skippedUnattachableFinalists: 0 },
  provisionalScores: buildEntityDelta(0, 0),
});

const buildZeroPartitions = () => ({
  resources: {
    toCreate: 0,
    alreadyPresent: 0,
    missingMember: 0,
    explicitSkips: {
      total: 0,
      byReason: {},
    },
  },
  submissions: {
    legacyNonExample: 0,
    legacyExampleFiltered: 0,
    legacyExampleOnlyFinalists: 0,
    toImport: 0,
    alreadyPresent: 0,
    missingMember: 0,
    explicitSkips: {
      total: 0,
      byReason: {},
    },
  },
  finalScores: {
    legacyFinalCandidates: 0,
    toImport: 0,
    alreadyPresent: 0,
    missingMember: 0,
    explicitSkips: {
      total: 0,
      byReason: {},
    },
  },
  provisionalScores: {
    legacyNonExample: 0,
    legacyExampleOnlyFinalists: 0,
    toImport: 0,
    alreadyPresent: 0,
    missingMember: 0,
    explicitSkips: {
      total: 0,
      byReason: {},
    },
  },
});

const addCount = (map, key, value = 1) => {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return;
  }
  const increment = parseNonNegativeInteger(value);
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + increment);
};

const toSortedArray = (valueSet) =>
  Array.from(valueSet || []).sort((left, right) =>
    String(left).localeCompare(String(right), undefined, { numeric: true })
  );

const resolveIdentityForCoderId = (coderId, normalizedIdentityByCoderId = new Map()) => {
  const normalizedCoderId = String(coderId || "").trim();
  if (!normalizedCoderId) {
    return null;
  }
  const knownIdentity = normalizedIdentityByCoderId.get(normalizedCoderId);
  if (knownIdentity && normalizeMemberId(knownIdentity.memberId)) {
    return {
      coderId: normalizedCoderId,
      memberId: normalizeMemberId(knownIdentity.memberId),
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

const buildUnresolvedRecord = ({
  roundId,
  reason,
  counters,
  traceability,
  matchedChallengeId = null,
  skippedFilePath = null,
}) => ({
  recordType: "round-plan",
  legacyRoundId: roundId,
  decision: "unresolved",
  reason,
  matchedChallengeId,
  rerunClassification: "unresolved",
  traceability,
  summaryCounts: buildRoundSummaryCounts({
    counters,
    plannedFinalScores: 0,
    plannedProvisionalScores: 0,
    finalistsWithoutAttachableSubmission: 0,
  }),
  entityDeltas: buildZeroEntityDeltas(),
  partitions: buildZeroPartitions(),
  plannedSkipRecords: [],
  skippedFileArtifact: skippedFilePath
    ? {
      path: skippedFilePath,
      reasonCodes: [],
      recordCount: 0,
    }
    : null,
  createPathChallengeShape: null,
  createPathPhasePlan: null,
});

const normalizePlanningPrerequisites = (prerequisites = {}) => ({
  authoritativeDiscovery: {
    available:
      prerequisites.authoritativeDiscovery &&
      prerequisites.authoritativeDiscovery.available === false
        ? false
        : true,
    reason:
      (prerequisites.authoritativeDiscovery && prerequisites.authoritativeDiscovery.reason) ||
      "authoritative-existing-v6-discovery-unavailable",
  },
  canonicalTimelineTemplate: {
    resolved:
      prerequisites.canonicalTimelineTemplate &&
      prerequisites.canonicalTimelineTemplate.resolved === false
        ? false
        : true,
    timelineTemplateId:
      (prerequisites.canonicalTimelineTemplate &&
        prerequisites.canonicalTimelineTemplate.timelineTemplateId) ||
      null,
    reason:
      (prerequisites.canonicalTimelineTemplate &&
        prerequisites.canonicalTimelineTemplate.reason) ||
      "canonical-mm-ds-timeline-template-unresolved",
  },
  memberResolution: {
    available:
      prerequisites.memberResolution &&
      prerequisites.memberResolution.available === false
        ? false
        : true,
    reason:
      (prerequisites.memberResolution && prerequisites.memberResolution.reason) ||
      TARGET_MEMBER_RESOLUTION_UNAVAILABLE_REASON,
    resolvedMemberIds:
      prerequisites.memberResolution &&
      prerequisites.memberResolution.resolvedMemberIds instanceof Set
        ? new Set(
          Array.from(prerequisites.memberResolution.resolvedMemberIds)
            .map((memberId) => normalizeMemberId(memberId))
            .filter(Boolean)
        )
        : null,
  },
});

const formatIsoDate = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  return value.toISOString();
};

const buildCreatePathChallengeShape = (timelineTemplateId) => ({
  type: "Marathon Match",
  track: "Data Science",
  status: "COMPLETED",
  phaseNames: [...STANDARD_PHASE_NAMES],
  timelineTemplateId,
});

const buildCreatePathPhasePlan = (roundId, counters) => {
  const windows = derivePhaseWindows(roundId, counters);
  return STANDARD_PHASE_NAMES.reduce((acc, phaseName) => {
    const key = phaseName.toLowerCase();
    const window = windows[key];
    acc[phaseName] = {
      isOpen: false,
      startDate: formatIsoDate(window && window.startDate),
      endDate: formatIsoDate(window && window.endDate),
    };
    return acc;
  }, {});
};

const normalizeResolvedMemberIds = (resolvedMemberIds) => {
  if (!resolvedMemberIds) {
    return new Set();
  }
  const values =
    resolvedMemberIds instanceof Set
      ? Array.from(resolvedMemberIds)
      : Array.isArray(resolvedMemberIds)
      ? resolvedMemberIds
      : [];
  return new Set(values.map((memberId) => normalizeMemberId(memberId)).filter(Boolean));
};

const resolveMemberPlanningPrerequisite = async ({
  options,
  normalizedPrerequisites,
  roundDataById,
  normalizedIdentityByCoderId,
}) => {
  const result = {
    available: normalizedPrerequisites.memberResolution.available,
    reason: normalizedPrerequisites.memberResolution.reason,
    resolvedMemberIds: normalizeResolvedMemberIds(
      normalizedPrerequisites.memberResolution.resolvedMemberIds
    ),
  };

  if (!result.available) {
    return result;
  }
  if (result.resolvedMemberIds.size > 0) {
    return result;
  }
  if (typeof options.resolveMemberPresence !== "function") {
    return {
      available: false,
      reason: normalizedPrerequisites.memberResolution.reason,
      resolvedMemberIds: new Set(),
    };
  }

  const memberIds = new Set();
  for (const counters of roundDataById.values()) {
    counters.eligibleRegistrants.forEach((coderId) => {
      const identity = resolveIdentityForCoderId(coderId, normalizedIdentityByCoderId);
      const normalized = normalizeMemberId(identity && identity.memberId);
      if (normalized) {
        memberIds.add(normalized);
      }
    });
    counters.nonExampleSubmitterCoderIds.forEach((coderId) => {
      const identity = resolveIdentityForCoderId(coderId, normalizedIdentityByCoderId);
      const normalized = normalizeMemberId(identity && identity.memberId);
      if (normalized) {
        memberIds.add(normalized);
      }
    });
    counters.finalCandidateCoderIds.forEach((coderId) => {
      const identity = resolveIdentityForCoderId(coderId, normalizedIdentityByCoderId);
      const normalized = normalizeMemberId(identity && identity.memberId);
      if (normalized) {
        memberIds.add(normalized);
      }
    });
  }

  try {
    const resolved = await options.resolveMemberPresence({
      memberIds: Array.from(memberIds),
    });
    const resolvedSet = normalizeResolvedMemberIds(resolved);
    return {
      available: true,
      reason: normalizedPrerequisites.memberResolution.reason,
      resolvedMemberIds: resolvedSet,
    };
  } catch (error) {
    return {
      available: false,
      reason: normalizedPrerequisites.memberResolution.reason,
      resolvedMemberIds: new Set(),
      error,
    };
  }
};

const buildSurfacePartitionsForRound = ({
  roundId,
  counters,
  existingStateEntry,
  normalizedIdentityByCoderId,
  resolvedMemberIds,
}) => {
  const existingCounts = existingStateEntry && existingStateEntry.existing ? existingStateEntry.existing : {};
  const partitions = buildZeroPartitions();
  partitions.submissions.legacyNonExample = counters.nonExampleSubmissions;
  partitions.submissions.legacyExampleFiltered = counters.exampleSubmissions;
  partitions.submissions.legacyExampleOnlyFinalists = counters.exampleOnlyFinalistSubmissions;
  partitions.provisionalScores.legacyNonExample = counters.nonExampleSubmissions;
  partitions.provisionalScores.legacyExampleOnlyFinalists =
    counters.exampleOnlyFinalistSubmissions;
  partitions.finalScores.legacyFinalCandidates = counters.finalCandidateCoderIds.size;

  const memberStatsByMemberId = new Map();
  const ensureMemberStats = ({ memberId, memberHandle = null, coderId = null }) => {
    if (!memberId) {
      return null;
    }
    const normalizedMemberId = normalizeMemberId(memberId);
    if (!normalizedMemberId) {
      return null;
    }
    if (!memberStatsByMemberId.has(normalizedMemberId)) {
      memberStatsByMemberId.set(normalizedMemberId, {
        memberId: normalizedMemberId,
        memberHandle: memberHandle || null,
        coderIds: new Set(),
        eligibleResourceCount: 0,
        attachableSubmissionCount: 0,
        finalCandidateCount: 0,
      });
    }
    const stats = memberStatsByMemberId.get(normalizedMemberId);
    if (memberHandle && !stats.memberHandle) {
      stats.memberHandle = memberHandle;
    }
    if (coderId) {
      stats.coderIds.add(String(coderId));
    }
    return stats;
  };

  const eligibleMemberIdentities = buildEligibleMemberIdentities({
    eligibleCoderIds: counters.eligibleRegistrants,
    normalizedIdentityByCoderId,
  });
  eligibleMemberIdentities.forEach((identity) => {
    const stats = ensureMemberStats({
      memberId: identity.memberId,
      memberHandle: identity.memberHandle,
    });
    if (!stats) {
      return;
    }
    stats.eligibleResourceCount += 1;
    (identity.coderIds || []).forEach((coderId) => stats.coderIds.add(String(coderId)));
  });

  counters.nonExampleSubmissionCountsByCoderId.forEach((count, coderId) => {
    const identity = resolveIdentityForCoderId(coderId, normalizedIdentityByCoderId);
    if (!identity) {
      return;
    }
    const stats = ensureMemberStats(identity);
    if (!stats) {
      return;
    }
    stats.attachableSubmissionCount += parseNonNegativeInteger(count);
  });

  counters.exampleOnlyFinalistSubmissionCountsByCoderId.forEach((count, coderId) => {
    const identity = resolveIdentityForCoderId(coderId, normalizedIdentityByCoderId);
    if (!identity) {
      return;
    }
    const stats = ensureMemberStats(identity);
    if (!stats) {
      return;
    }
    stats.attachableSubmissionCount += parseNonNegativeInteger(count);
  });

  counters.finalCandidateCoderIds.forEach((coderId) => {
    const identity = resolveIdentityForCoderId(coderId, normalizedIdentityByCoderId);
    if (!identity) {
      return;
    }
    const stats = ensureMemberStats(identity);
    if (!stats) {
      return;
    }
    stats.finalCandidateCount += 1;
  });

  const missingMemberSkipRecords = [];
  const explicitSkipRecords = [];
  let materializableResourceCount = 0;
  let materializableSubmissionCount = 0;
  let materializableFinalScoreCount = 0;
  let materializableProvisionalCount = 0;

  memberStatsByMemberId.forEach((stats) => {
    const isResolved = resolvedMemberIds.has(stats.memberId);
    const missingResourceCount = isResolved ? 0 : stats.eligibleResourceCount;
    const missingSubmissionCount = isResolved ? 0 : stats.attachableSubmissionCount;
    const missingProvisionalCount = isResolved ? 0 : stats.attachableSubmissionCount;
    const hasAttachableFinal = stats.attachableSubmissionCount > 0;
    const missingFinalCount = isResolved ? 0 : stats.finalCandidateCount;
    const explicitFinalSkipCount =
      isResolved && !hasAttachableFinal
        ? stats.finalCandidateCount
        : 0;
    const importableFinalCount =
      isResolved && hasAttachableFinal
        ? stats.finalCandidateCount
        : 0;

    partitions.resources.missingMember += missingResourceCount;
    partitions.submissions.missingMember += missingSubmissionCount;
    partitions.provisionalScores.missingMember += missingProvisionalCount;
    partitions.finalScores.missingMember += missingFinalCount;

    materializableResourceCount += isResolved ? stats.eligibleResourceCount : 0;
    materializableSubmissionCount += isResolved ? stats.attachableSubmissionCount : 0;
    materializableProvisionalCount += isResolved ? stats.attachableSubmissionCount : 0;
    materializableFinalScoreCount += importableFinalCount;

    if (!isResolved) {
      const affectedSurfaces = [];
      const counts = {};
      if (missingResourceCount > 0) {
        affectedSurfaces.push("resource");
        counts.resource = missingResourceCount;
      }
      if (missingSubmissionCount > 0) {
        affectedSurfaces.push("submission");
        counts.submission = missingSubmissionCount;
      }
      if (missingFinalCount > 0) {
        affectedSurfaces.push("final-score");
        counts.finalScore = missingFinalCount;
      }
      if (missingProvisionalCount > 0) {
        affectedSurfaces.push("provisional-score");
        counts.provisionalScore = missingProvisionalCount;
      }
      if (affectedSurfaces.length > 0) {
        missingMemberSkipRecords.push({
          legacyRoundId: roundId,
          memberId: stats.memberId,
          memberHandle: stats.memberHandle || undefined,
          coderIds: toSortedArray(stats.coderIds),
          reasonCode: MISSING_MEMBER_REASON_CODE,
          affectedSurfaces,
          counts,
        });
      }
    }

    if (explicitFinalSkipCount > 0) {
      partitions.finalScores.explicitSkips.total += explicitFinalSkipCount;
      partitions.finalScores.explicitSkips.byReason[
        FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE
      ] = (partitions.finalScores.explicitSkips.byReason[
        FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE
      ] || 0) + explicitFinalSkipCount;
      explicitSkipRecords.push({
        legacyRoundId: roundId,
        memberId: stats.memberId,
        memberHandle: stats.memberHandle || undefined,
        coderIds: toSortedArray(stats.coderIds),
        reasonCode: FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE,
        affectedSurfaces: ["final-score"],
        counts: { finalScore: explicitFinalSkipCount },
      });
    }
  });

  partitions.resources.alreadyPresent = Math.min(
    materializableResourceCount,
    parseNonNegativeInteger(existingCounts.resources)
  );
  partitions.resources.toCreate = Math.max(
    0,
    materializableResourceCount - partitions.resources.alreadyPresent
  );

  partitions.submissions.alreadyPresent = Math.min(
    materializableSubmissionCount,
    parseNonNegativeInteger(existingCounts.submissions)
  );
  partitions.submissions.toImport = Math.max(
    0,
    materializableSubmissionCount - partitions.submissions.alreadyPresent
  );

  partitions.finalScores.alreadyPresent = Math.min(
    materializableFinalScoreCount,
    parseNonNegativeInteger(existingCounts.finalScores)
  );
  partitions.finalScores.toImport = Math.max(
    0,
    materializableFinalScoreCount - partitions.finalScores.alreadyPresent
  );

  partitions.provisionalScores.alreadyPresent = Math.min(
    materializableProvisionalCount,
    parseNonNegativeInteger(existingCounts.provisionalScores)
  );
  partitions.provisionalScores.toImport = Math.max(
    0,
    materializableProvisionalCount - partitions.provisionalScores.alreadyPresent
  );

  const plannedSkipRecords = [...missingMemberSkipRecords, ...explicitSkipRecords].sort((left, right) => {
    const leftMember = String(left.memberId || "");
    const rightMember = String(right.memberId || "");
    if (leftMember !== rightMember) {
      return leftMember.localeCompare(rightMember, undefined, { numeric: true });
    }
    return String(left.reasonCode || "").localeCompare(String(right.reasonCode || ""));
  });

  return {
    partitions,
    plannedSkipRecords,
    materializable: {
      resources: materializableResourceCount,
      submissions: materializableSubmissionCount,
      finalScores: materializableFinalScoreCount,
      provisionalScores: materializableProvisionalCount,
    },
  };
};

const isMarathonRoundType = (round) => String(round && round.round_type_id ? round.round_type_id : "").trim() === "13";

const evaluateRoundPlan = ({
  roundId,
  counters,
  existingStateEntry,
  prerequisites,
  normalizedIdentityByCoderId,
  resolvedMemberIds,
  skippedFilePath,
}) => {
  if (!counters.round) {
    return {
      recordType: "round-plan",
      legacyRoundId: roundId,
      decision: "unmatched",
      reason: "selected-round-not-found-in-legacy-source",
      matchedChallengeId: null,
      rerunClassification: "unresolved",
      traceability: {
        legacyRoundId: roundId,
        legacyComponentIds: [],
        legacyProblemIds: [],
      },
      summaryCounts: buildRoundSummaryCounts({
        counters: createEmptyCounters(),
      }),
      entityDeltas: buildZeroEntityDeltas(),
      partitions: buildZeroPartitions(),
      plannedSkipRecords: [],
      skippedFileArtifact: skippedFilePath
        ? {
          path: skippedFilePath,
          reasonCodes: [],
          recordCount: 0,
        }
        : null,
      createPathChallengeShape: null,
      createPathPhasePlan: null,
    };
  }

  const traceability = {
    legacyRoundId: roundId,
    legacyComponentIds: sortIds(counters.componentIds),
    legacyProblemIds: sortIds(counters.problemIds),
  };

  if (!isMarathonRoundType(counters.round)) {
    return buildUnresolvedRecord({
      roundId,
      reason: "selected-round-round-type-is-not-marathon-match",
      counters,
      traceability,
      skippedFilePath,
    });
  }

  const hasMarathonSignals =
    counters.componentIds.size > 0 &&
    (counters.nonExampleSubmissions > 0 ||
      counters.exampleSubmissions > 0 ||
      counters.finalCandidateCoderIds.size > 0 ||
      counters.eligibleRegistrants.size > 0);

  if (!hasMarathonSignals) {
    return buildUnresolvedRecord({
      roundId,
      reason: "selected-round-lacks-marathon-signal-data",
      counters,
      traceability,
      skippedFilePath,
    });
  }

  const matchStatus = existingStateEntry && existingStateEntry.matchStatus
    ? existingStateEntry.matchStatus
    : "none";
  if (matchStatus === "ambiguous" || matchStatus === "unsafe") {
    return buildUnresolvedRecord({
      roundId,
      reason: existingStateEntry.reason,
      counters,
      traceability,
      matchedChallengeId: existingStateEntry.challengeId || null,
      skippedFilePath,
    });
  }

  const hasMatchedChallenge = matchStatus === "safe" && Boolean(existingStateEntry.challengeId);
  let createPathChallengeShape = null;
  let createPathPhasePlan = null;
  if (!hasMatchedChallenge) {
    if (!prerequisites.authoritativeDiscovery.available) {
      return buildUnresolvedRecord({
        roundId,
        reason: prerequisites.authoritativeDiscovery.reason,
        counters,
        traceability,
        skippedFilePath,
      });
    }
    if (!prerequisites.canonicalTimelineTemplate.resolved) {
      return buildUnresolvedRecord({
        roundId,
        reason: prerequisites.canonicalTimelineTemplate.reason,
        counters,
        traceability,
        skippedFilePath,
      });
    }
    try {
      createPathChallengeShape = buildCreatePathChallengeShape(
        prerequisites.canonicalTimelineTemplate.timelineTemplateId
      );
      createPathPhasePlan = buildCreatePathPhasePlan(roundId, counters);
    } catch {
      return buildUnresolvedRecord({
        roundId,
        reason: "create-phase-plan-derivation-failed",
        counters,
        traceability,
        skippedFilePath,
      });
    }
  }
  if (!prerequisites.memberResolution.available) {
    return buildUnresolvedRecord({
      roundId,
      reason: prerequisites.memberResolution.reason,
      counters,
      traceability,
      matchedChallengeId: hasMatchedChallenge ? existingStateEntry.challengeId : null,
      skippedFilePath,
    });
  }

  const partitioned = buildSurfacePartitionsForRound({
    roundId,
    counters,
    existingStateEntry,
    normalizedIdentityByCoderId,
    resolvedMemberIds,
  });
  const finalistsWithoutAttachableSubmission = parseNonNegativeInteger(
    partitioned.partitions.finalScores.explicitSkips.byReason[
      FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE
    ]
  );

  const existingCounts = existingStateEntry && existingStateEntry.existing ? existingStateEntry.existing : {};
  const entityDeltas = {
    phases: buildEntityDelta(3, existingCounts.phases),
    resources: buildEntityDelta(partitioned.materializable.resources, existingCounts.resources),
    submissions: buildEntityDelta(partitioned.materializable.submissions, existingCounts.submissions),
    finalScores: {
      ...buildEntityDelta(partitioned.materializable.finalScores, existingCounts.finalScores),
      skippedUnattachableFinalists: finalistsWithoutAttachableSubmission,
    },
    provisionalScores: buildEntityDelta(
      partitioned.materializable.provisionalScores,
      existingCounts.provisionalScores
    ),
  };

  const decision = hasMatchedChallenge ? "reuse/backfill-only" : "create";
  const reason = hasMatchedChallenge
    ? "existing-v6-challenge-found"
    : "no-matching-v6-challenge-found";
  const rerunClassification =
    decision === "reuse/backfill-only" &&
    Object.values(entityDeltas)
      .map((value) => value.toCreate || 0)
      .every((toCreate) => toCreate === 0)
      ? "no-op"
      : decision === "reuse/backfill-only"
      ? "partial-backfill"
      : "new-work";

  return {
    recordType: "round-plan",
    legacyRoundId: roundId,
    decision,
    reason,
    matchedChallengeId: hasMatchedChallenge ? existingStateEntry.challengeId : null,
    rerunClassification,
    traceability,
    summaryCounts: buildRoundSummaryCounts({
      counters,
      plannedFinalScores:
        partitioned.partitions.finalScores.toImport +
        partitioned.partitions.finalScores.alreadyPresent,
      plannedProvisionalScores:
        partitioned.partitions.provisionalScores.toImport +
        partitioned.partitions.provisionalScores.alreadyPresent,
      finalistsWithoutAttachableSubmission,
    }),
    entityDeltas,
    partitions: partitioned.partitions,
    plannedSkipRecords: partitioned.plannedSkipRecords,
    skippedFileArtifact: {
      path: skippedFilePath,
      reasonCodes: collectReasonCodes(partitioned.plannedSkipRecords),
      recordCount: partitioned.plannedSkipRecords.length,
    },
    createPathChallengeShape,
    createPathPhasePlan,
  };
};

const summarizePlan = (records, selectedRoundIds, skippedFilePath) => {
  const countsByDecision = {
    create: 0,
    "reuse/backfill-only": 0,
    unresolved: 0,
    unmatched: 0,
  };

  const totals = {
    eligibleRegistrants: 0,
    nonExampleSubmissions: 0,
    exampleSubmissionsFiltered: 0,
    exampleOnlyFinalistSubmissions: 0,
    plannedFinalScores: 0,
    plannedProvisionalScores: 0,
    finalistsWithoutAttachableSubmission: 0,
    toCreate: {
      phases: 0,
      resources: 0,
      submissions: 0,
      finalScores: 0,
      provisionalScores: 0,
    },
    partitions: buildZeroPartitions(),
  };
  const reasonCodes = new Set();
  let plannedSkipRecordCount = 0;

  records.forEach((record) => {
    if (countsByDecision[record.decision] !== undefined) {
      countsByDecision[record.decision] += 1;
    }
    totals.eligibleRegistrants += record.summaryCounts.eligibleRegistrants;
    totals.nonExampleSubmissions += record.summaryCounts.nonExampleSubmissions;
    totals.exampleSubmissionsFiltered += record.summaryCounts.exampleSubmissionsFiltered;
    totals.exampleOnlyFinalistSubmissions +=
      parseNonNegativeInteger(record.summaryCounts.exampleOnlyFinalistSubmissions);
    totals.plannedFinalScores += record.summaryCounts.plannedFinalScores;
    totals.plannedProvisionalScores += record.summaryCounts.plannedProvisionalScores;
    totals.finalistsWithoutAttachableSubmission +=
      record.summaryCounts.finalistsWithoutAttachableSubmission;
    totals.toCreate.phases += record.entityDeltas.phases.toCreate;
    totals.toCreate.resources += record.entityDeltas.resources.toCreate;
    totals.toCreate.submissions += record.entityDeltas.submissions.toCreate;
    totals.toCreate.finalScores += record.entityDeltas.finalScores.toCreate;
    totals.toCreate.provisionalScores += record.entityDeltas.provisionalScores.toCreate;

    if (record.partitions) {
      totals.partitions.resources.toCreate += record.partitions.resources.toCreate;
      totals.partitions.resources.alreadyPresent += record.partitions.resources.alreadyPresent;
      totals.partitions.resources.missingMember += record.partitions.resources.missingMember;
      totals.partitions.resources.explicitSkips.total +=
        record.partitions.resources.explicitSkips.total;

      totals.partitions.submissions.legacyNonExample +=
        record.partitions.submissions.legacyNonExample;
      totals.partitions.submissions.legacyExampleFiltered +=
        record.partitions.submissions.legacyExampleFiltered;
      totals.partitions.submissions.legacyExampleOnlyFinalists +=
        parseNonNegativeInteger(record.partitions.submissions.legacyExampleOnlyFinalists);
      totals.partitions.submissions.toImport += record.partitions.submissions.toImport;
      totals.partitions.submissions.alreadyPresent +=
        record.partitions.submissions.alreadyPresent;
      totals.partitions.submissions.missingMember += record.partitions.submissions.missingMember;
      totals.partitions.submissions.explicitSkips.total +=
        record.partitions.submissions.explicitSkips.total;

      totals.partitions.finalScores.legacyFinalCandidates +=
        record.partitions.finalScores.legacyFinalCandidates;
      totals.partitions.finalScores.toImport += record.partitions.finalScores.toImport;
      totals.partitions.finalScores.alreadyPresent +=
        record.partitions.finalScores.alreadyPresent;
      totals.partitions.finalScores.missingMember += record.partitions.finalScores.missingMember;
      totals.partitions.finalScores.explicitSkips.total +=
        record.partitions.finalScores.explicitSkips.total;
      Object.entries(record.partitions.finalScores.explicitSkips.byReason || {}).forEach(
        ([reasonCode, count]) => {
          totals.partitions.finalScores.explicitSkips.byReason[reasonCode] =
            (totals.partitions.finalScores.explicitSkips.byReason[reasonCode] || 0) +
            parseNonNegativeInteger(count);
        }
      );

      totals.partitions.provisionalScores.legacyNonExample +=
        record.partitions.provisionalScores.legacyNonExample;
      totals.partitions.provisionalScores.legacyExampleOnlyFinalists +=
        parseNonNegativeInteger(record.partitions.provisionalScores.legacyExampleOnlyFinalists);
      totals.partitions.provisionalScores.toImport +=
        record.partitions.provisionalScores.toImport;
      totals.partitions.provisionalScores.alreadyPresent +=
        record.partitions.provisionalScores.alreadyPresent;
      totals.partitions.provisionalScores.missingMember +=
        record.partitions.provisionalScores.missingMember;
      totals.partitions.provisionalScores.explicitSkips.total +=
        record.partitions.provisionalScores.explicitSkips.total;
    }

    (record.plannedSkipRecords || []).forEach((skipRecord) => {
      reasonCodes.add(skipRecord.reasonCode);
      plannedSkipRecordCount += 1;
    });
  });

  return {
    recordType: "plan-summary",
    selectedRoundIds,
    roundsRequested: selectedRoundIds.length,
    countsByDecision,
    totals,
    skippedFileArtifact: {
      path: skippedFilePath,
      reasonCodes: Array.from(reasonCodes).sort(),
      recordCount: plannedSkipRecordCount,
    },
  };
};

const buildRoundDataById = (selectedRoundIds) => {
  const map = new Map();
  selectedRoundIds.forEach((roundId) => {
    map.set(roundId, createEmptyCounters());
  });
  return map;
};

const readLegacyPlanningInputs = async (options, roundDataById) => {
  const fixedFiles = {
    round: resolveFilePath(options.dataDir, options.roundFile),
    roundComponent: resolveFilePath(options.dataDir, options.roundComponentFile),
    component: resolveFilePath(options.dataDir, options.componentFile),
    problem: resolveFilePath(options.dataDir, options.problemFile),
    longComponentState: resolveFilePath(options.dataDir, options.longComponentStateFile),
  };

  Object.entries(fixedFiles).forEach(([label, filePath]) => {
    ensureFileExists(filePath, label);
  });

  const roundRegistrationFiles = listFilesByPattern(
    options.dataDir,
    options.roundRegistrationPattern,
    "round registration"
  );
  const longSubmissionFiles = listFilesByPattern(
    options.dataDir,
    options.longSubmissionPattern,
    "long submission"
  );
  const longCompResultFiles = listFilesByPattern(
    options.dataDir,
    options.longCompResultPattern,
    "long comp result"
  );

  const selectedRoundIdSet = new Set(roundDataById.keys());
  const selectedComponentIds = new Set();
  const selectedProblemIds = new Set();
  const componentProblemIdById = new Map();
  const problemTextByProblemId = new Map();
  const longComponentStateById = new Map();
  const stateSubmissionSummaryById = new Map();

  await streamJsonArray(fixedFiles.round, "round", (row) => {
    const roundId = String(row && row.round_id ? row.round_id : "").trim();
    if (!selectedRoundIdSet.has(roundId)) {
      return;
    }
    roundDataById.get(roundId).round = row;
  });

  await streamJsonArray(fixedFiles.roundComponent, "round_component", (row) => {
    const roundId = String(row && row.round_id ? row.round_id : "").trim();
    if (!selectedRoundIdSet.has(roundId)) {
      return;
    }
    const componentId = String(row && row.component_id ? row.component_id : "").trim();
    if (!componentId) {
      return;
    }
    roundDataById.get(roundId).componentIds.add(componentId);
    selectedComponentIds.add(componentId);
  });

  await streamJsonArray(fixedFiles.component, "component", (row) => {
    const componentId = String(row && row.component_id ? row.component_id : "").trim();
    if (!selectedComponentIds.has(componentId)) {
      return;
    }
    const problemId = String(row && row.problem_id ? row.problem_id : "").trim();
    if (!problemId) {
      return;
    }
    componentProblemIdById.set(componentId, problemId);
    selectedProblemIds.add(problemId);
    for (const counters of roundDataById.values()) {
      if (counters.componentIds.has(componentId)) {
        counters.problemIds.add(problemId);
      }
    }
  });

  await streamJsonArray(fixedFiles.problem, "problem", (row) => {
    const problemId = String(row && row.problem_id ? row.problem_id : "").trim();
    if (!selectedProblemIds.has(problemId)) {
      return;
    }
    const rawProblemText =
      row && Object.prototype.hasOwnProperty.call(row, "problem_text")
        ? row.problem_text
        : null;
    problemTextByProblemId.set(problemId, rawProblemText);
  });

  for (const counters of roundDataById.values()) {
    counters.descriptionProblemId = null;
    counters.descriptionProblemText = null;

    for (const componentId of sortIds(counters.componentIds)) {
      const problemId = componentProblemIdById.get(componentId);
      if (!problemId) {
        continue;
      }
      const rawProblemText = problemTextByProblemId.get(problemId);
      if (!isUsableProblemText(rawProblemText)) {
        continue;
      }

      counters.descriptionProblemId = problemId;
      counters.descriptionProblemText = String(rawProblemText);
      break;
    }
  }

  await Promise.all(
    roundRegistrationFiles.map((filePath) =>
      streamJsonArray(filePath, "round_registration", (row) => {
        const roundId = String(row && row.round_id ? row.round_id : "").trim();
        if (!selectedRoundIdSet.has(roundId)) {
          return;
        }
        const isEligible = String(row && row.eligible ? row.eligible : "").trim() === "1";
        if (!isEligible) {
          return;
        }
        const coderId = String(row && row.coder_id ? row.coder_id : "").trim();
        if (!coderId) {
          return;
        }
        const counters = roundDataById.get(roundId);
        counters.eligibleRegistrants.add(coderId);

        const registrationMs = parseLegacySqlTimestamp(row.timestamp);
        counters.registrationStartMs = minMs(counters.registrationStartMs, registrationMs);
        counters.registrationEndMs = maxMs(counters.registrationEndMs, registrationMs);
      })
    )
  );

  await streamJsonArray(fixedFiles.longComponentState, "long_component_state", (row) => {
    const roundId = String(row && row.round_id ? row.round_id : "").trim();
    if (!selectedRoundIdSet.has(roundId)) {
      return;
    }
    const longComponentStateId = String(
      row && row.long_component_state_id ? row.long_component_state_id : ""
    ).trim();
    if (!longComponentStateId) {
      return;
    }
    const coderId = String(row && row.coder_id ? row.coder_id : "").trim();
    longComponentStateById.set(longComponentStateId, {
      roundId,
      coderId,
    });
    stateSubmissionSummaryById.set(longComponentStateId, {
      roundId,
      coderId,
      nonExampleCount: 0,
      exampleCount: 0,
      latestExampleSubmitMs: null,
    });
  });

  await Promise.all(
    longSubmissionFiles.map((filePath) =>
      streamJsonArray(filePath, "long_submission", (row) => {
        const longComponentStateId = String(
          row && row.long_component_state_id ? row.long_component_state_id : ""
        ).trim();
        const stateInfo = longComponentStateById.get(longComponentStateId);
        if (!stateInfo) {
          return;
        }
        const counters = roundDataById.get(stateInfo.roundId);
        if (!counters) {
          return;
        }

        const submissionOpenMs = parseEpochMs(row && row.open_time);
        counters.earliestSubmissionOpenMs = minMs(counters.earliestSubmissionOpenMs, submissionOpenMs);

        const isExample = String(row && row.example ? row.example : "").trim() === "1";
        const stateSubmissionSummary =
          stateSubmissionSummaryById.get(longComponentStateId) || {
            roundId: stateInfo.roundId,
            coderId: stateInfo.coderId,
            nonExampleCount: 0,
            exampleCount: 0,
            latestExampleSubmitMs: null,
          };
        stateSubmissionSummaryById.set(longComponentStateId, stateSubmissionSummary);
        if (isExample) {
          counters.exampleSubmissions += 1;
          stateSubmissionSummary.exampleCount += 1;
          stateSubmissionSummary.latestExampleSubmitMs = maxMs(
            stateSubmissionSummary.latestExampleSubmitMs,
            parseEpochMs(row && row.submit_time)
          );
          return;
        }
        counters.nonExampleSubmissions += 1;
        stateSubmissionSummary.nonExampleCount += 1;

        const submitMs = parseEpochMs(row && row.submit_time);
        counters.earliestNonExampleSubmitMs = minMs(counters.earliestNonExampleSubmitMs, submitMs);
        counters.latestNonExampleSubmitMs = maxMs(counters.latestNonExampleSubmitMs, submitMs);

        if (stateInfo.coderId) {
          counters.nonExampleSubmitterCoderIds.add(stateInfo.coderId);
          addCount(counters.nonExampleSubmissionCountsByCoderId, stateInfo.coderId, 1);
        }
      })
    )
  );

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
        roundDataById.get(roundId).finalCandidateCoderIds.add(coderId);
      })
    )
  );

  stateSubmissionSummaryById.forEach((summary) => {
    const counters = roundDataById.get(summary.roundId);
    if (!counters) {
      return;
    }
    if (summary.nonExampleCount > 0 || summary.exampleCount <= 0) {
      return;
    }
    if (!counters.finalCandidateCoderIds.has(summary.coderId)) {
      return;
    }

    counters.exampleOnlyFinalistSubmissions += 1;
    addCount(counters.exampleOnlyFinalistSubmissionCountsByCoderId, summary.coderId, 1);
    counters.earliestExampleOnlyFinalistSubmitMs = minMs(
      counters.earliestExampleOnlyFinalistSubmitMs,
      summary.latestExampleSubmitMs
    );
    counters.latestExampleOnlyFinalistSubmitMs = maxMs(
      counters.latestExampleOnlyFinalistSubmitMs,
      summary.latestExampleSubmitMs
    );
  });
};

const buildDryRunPlan = async (options, existingStateByRoundId, planningPrerequisites = {}) => {
  const normalizedPrerequisites = normalizePlanningPrerequisites(planningPrerequisites);
  const selectedRoundIds = [...options.roundIds];
  const skippedFilePath = resolveSkippedFilePath({
    skippedFilePath: options.skippedFilePath,
    roundIds: selectedRoundIds,
    cwd: options.cwd || process.cwd(),
  });
  const roundDataById = buildRoundDataById(selectedRoundIds);
  await readLegacyPlanningInputs(options, roundDataById);

  const allKnownCoderIds = new Set();
  roundDataById.forEach((counters) => {
    counters.eligibleRegistrants.forEach((coderId) => allKnownCoderIds.add(String(coderId)));
    counters.nonExampleSubmitterCoderIds.forEach((coderId) => allKnownCoderIds.add(String(coderId)));
    counters.finalCandidateCoderIds.forEach((coderId) => allKnownCoderIds.add(String(coderId)));
  });
  const normalizedIdentityByCoderId = await loadNormalizedIdentityByCoderId({
    dataDir: options.dataDir,
    userPattern: options.userPattern,
    coderIds: allKnownCoderIds,
  });

  const memberResolution = await resolveMemberPlanningPrerequisite({
    options,
    normalizedPrerequisites,
    roundDataById,
    normalizedIdentityByCoderId,
  });
  normalizedPrerequisites.memberResolution = {
    available: memberResolution.available,
    reason: memberResolution.reason,
    resolvedMemberIds: memberResolution.resolvedMemberIds,
  };

  const records = selectedRoundIds.map((roundId) =>
    evaluateRoundPlan({
      roundId,
      counters: roundDataById.get(roundId),
      existingStateEntry: existingStateByRoundId.get(roundId),
      prerequisites: normalizedPrerequisites,
      normalizedIdentityByCoderId,
      resolvedMemberIds: memberResolution.resolvedMemberIds,
      skippedFilePath,
    })
  );
  const summary = summarizePlan(records, selectedRoundIds, skippedFilePath);
  return { records, summary, roundDataById };
};

module.exports = {
  buildDryRunPlan,
};
