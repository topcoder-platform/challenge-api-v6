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

const createEmptyCounters = () => ({
  round: null,
  componentIds: new Set(),
  problemIds: new Set(),
  eligibleRegistrants: new Set(),
  nonExampleSubmissions: 0,
  exampleSubmissions: 0,
  nonExampleSubmitterCoderIds: new Set(),
  finalCandidateCoderIds: new Set(),
  registrationStartMs: null,
  registrationEndMs: null,
  earliestSubmissionOpenMs: null,
  earliestNonExampleSubmitMs: null,
  latestNonExampleSubmitMs: null,
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

const buildUnresolvedRecord = ({ roundId, reason, counters, traceability, matchedChallengeId = null }) => ({
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

const isMarathonRoundType = (round) => String(round && round.round_type_id ? round.round_type_id : "").trim() === "13";

const evaluateRoundPlan = (roundId, counters, existingStateEntry, prerequisites) => {
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
    });
  }

  const finalAttachableMemberCount = Array.from(counters.finalCandidateCoderIds).filter((coderId) =>
    counters.nonExampleSubmitterCoderIds.has(coderId)
  ).length;
  const finalistsWithoutAttachableSubmission = Math.max(
    0,
    counters.finalCandidateCoderIds.size - finalAttachableMemberCount
  );

  const targets = {
    phases: 3,
    resources: counters.eligibleRegistrants.size,
    submissions: counters.nonExampleSubmissions,
    finalScores: finalAttachableMemberCount,
    provisionalScores: counters.nonExampleSubmissions,
  };

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
    });
  }

  const existingCounts = existingStateEntry && existingStateEntry.existing ? existingStateEntry.existing : {};
  const entityDeltas = {
    phases: buildEntityDelta(targets.phases, existingCounts.phases),
    resources: buildEntityDelta(targets.resources, existingCounts.resources),
    submissions: buildEntityDelta(targets.submissions, existingCounts.submissions),
    finalScores: {
      ...buildEntityDelta(targets.finalScores, existingCounts.finalScores),
      skippedUnattachableFinalists: finalistsWithoutAttachableSubmission,
    },
    provisionalScores: buildEntityDelta(targets.provisionalScores, existingCounts.provisionalScores),
  };

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
      });
    }
    if (!prerequisites.canonicalTimelineTemplate.resolved) {
      return buildUnresolvedRecord({
        roundId,
        reason: prerequisites.canonicalTimelineTemplate.reason,
        counters,
        traceability,
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
      });
    }
  }

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
      plannedFinalScores: finalAttachableMemberCount,
      plannedProvisionalScores: counters.nonExampleSubmissions,
      finalistsWithoutAttachableSubmission,
    }),
    entityDeltas,
    createPathChallengeShape,
    createPathPhasePlan,
  };
};

const summarizePlan = (records, selectedRoundIds) => {
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
  };

  records.forEach((record) => {
    if (countsByDecision[record.decision] !== undefined) {
      countsByDecision[record.decision] += 1;
    }
    totals.eligibleRegistrants += record.summaryCounts.eligibleRegistrants;
    totals.nonExampleSubmissions += record.summaryCounts.nonExampleSubmissions;
    totals.exampleSubmissionsFiltered += record.summaryCounts.exampleSubmissionsFiltered;
    totals.plannedFinalScores += record.summaryCounts.plannedFinalScores;
    totals.plannedProvisionalScores += record.summaryCounts.plannedProvisionalScores;
    totals.finalistsWithoutAttachableSubmission +=
      record.summaryCounts.finalistsWithoutAttachableSubmission;
    totals.toCreate.phases += record.entityDeltas.phases.toCreate;
    totals.toCreate.resources += record.entityDeltas.resources.toCreate;
    totals.toCreate.submissions += record.entityDeltas.submissions.toCreate;
    totals.toCreate.finalScores += record.entityDeltas.finalScores.toCreate;
    totals.toCreate.provisionalScores += record.entityDeltas.provisionalScores.toCreate;
  });

  return {
    recordType: "plan-summary",
    selectedRoundIds,
    roundsRequested: selectedRoundIds.length,
    countsByDecision,
    totals,
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
  const longComponentStateById = new Map();

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
    for (const counters of roundDataById.values()) {
      if (counters.componentIds.has(componentId)) {
        counters.problemIds.add(problemId);
      }
    }
  });

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
        if (isExample) {
          counters.exampleSubmissions += 1;
          return;
        }
        counters.nonExampleSubmissions += 1;

        const submitMs = parseEpochMs(row && row.submit_time);
        counters.earliestNonExampleSubmitMs = minMs(counters.earliestNonExampleSubmitMs, submitMs);
        counters.latestNonExampleSubmitMs = maxMs(counters.latestNonExampleSubmitMs, submitMs);

        if (stateInfo.coderId) {
          counters.nonExampleSubmitterCoderIds.add(stateInfo.coderId);
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
};

const buildDryRunPlan = async (options, existingStateByRoundId, planningPrerequisites = {}) => {
  const normalizedPrerequisites = normalizePlanningPrerequisites(planningPrerequisites);
  const selectedRoundIds = [...options.roundIds];
  const roundDataById = buildRoundDataById(selectedRoundIds);
  await readLegacyPlanningInputs(options, roundDataById);

  const records = selectedRoundIds.map((roundId) =>
    evaluateRoundPlan(
      roundId,
      roundDataById.get(roundId),
      existingStateByRoundId.get(roundId),
      normalizedPrerequisites
    )
  );
  const summary = summarizePlan(records, selectedRoundIds);
  return { records, summary, roundDataById };
};

module.exports = {
  buildDryRunPlan,
};
