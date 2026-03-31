"use strict";

const {
  ensureFileExists,
  listFilesByPattern,
  resolveFilePath,
  streamJsonArray,
} = require("./legacyDataReader");

const createEmptyCounters = () => ({
  round: null,
  componentIds: new Set(),
  problemIds: new Set(),
  eligibleRegistrants: new Set(),
  nonExampleSubmissions: 0,
  exampleSubmissions: 0,
  nonExampleSubmitterCoderIds: new Set(),
  finalCandidateCoderIds: new Set(),
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

const evaluateRoundPlan = (roundId, counters, existingStateEntry) => {
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
      summaryCounts: {
        eligibleRegistrants: 0,
        nonExampleSubmissions: 0,
        exampleSubmissionsFiltered: 0,
        plannedFinalScores: 0,
        plannedProvisionalScores: 0,
        finalistsWithoutAttachableSubmission: 0,
      },
      entityDeltas: {
        phases: buildEntityDelta(0, 0),
        resources: buildEntityDelta(0, 0),
        submissions: buildEntityDelta(0, 0),
        finalScores: { ...buildEntityDelta(0, 0), skippedUnattachableFinalists: 0 },
        provisionalScores: buildEntityDelta(0, 0),
      },
    };
  }

  const hasMarathonSignals =
    counters.componentIds.size > 0 &&
    (counters.nonExampleSubmissions > 0 ||
      counters.exampleSubmissions > 0 ||
      counters.finalCandidateCoderIds.size > 0 ||
      counters.eligibleRegistrants.size > 0);

  if (!hasMarathonSignals) {
    return {
      recordType: "round-plan",
      legacyRoundId: roundId,
      decision: "unresolved",
      reason: "selected-round-lacks-marathon-signal-data",
      matchedChallengeId: null,
      rerunClassification: "unresolved",
      traceability: {
        legacyRoundId: roundId,
        legacyComponentIds: sortIds(counters.componentIds),
        legacyProblemIds: sortIds(counters.problemIds),
      },
      summaryCounts: {
        eligibleRegistrants: counters.eligibleRegistrants.size,
        nonExampleSubmissions: counters.nonExampleSubmissions,
        exampleSubmissionsFiltered: counters.exampleSubmissions,
        plannedFinalScores: 0,
        plannedProvisionalScores: 0,
        finalistsWithoutAttachableSubmission: 0,
      },
      entityDeltas: {
        phases: buildEntityDelta(0, 0),
        resources: buildEntityDelta(0, 0),
        submissions: buildEntityDelta(0, 0),
        finalScores: { ...buildEntityDelta(0, 0), skippedUnattachableFinalists: 0 },
        provisionalScores: buildEntityDelta(0, 0),
      },
    };
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

  const hasMatchedChallenge = Boolean(existingStateEntry && existingStateEntry.challengeId);
  const decision = hasMatchedChallenge ? "reuse/backfill-only" : "create";
  const reason = hasMatchedChallenge
    ? "existing-v6-challenge-found"
    : "no-matching-v6-challenge-in-provided-state";
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
    traceability: {
      legacyRoundId: roundId,
      legacyComponentIds: sortIds(counters.componentIds),
      legacyProblemIds: sortIds(counters.problemIds),
    },
    summaryCounts: {
      eligibleRegistrants: counters.eligibleRegistrants.size,
      nonExampleSubmissions: counters.nonExampleSubmissions,
      exampleSubmissionsFiltered: counters.exampleSubmissions,
      plannedFinalScores: finalAttachableMemberCount,
      plannedProvisionalScores: counters.nonExampleSubmissions,
      finalistsWithoutAttachableSubmission,
    },
    entityDeltas,
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
        roundDataById.get(roundId).eligibleRegistrants.add(coderId);
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

        const isExample = String(row && row.example ? row.example : "").trim() === "1";
        if (isExample) {
          counters.exampleSubmissions += 1;
          return;
        }
        counters.nonExampleSubmissions += 1;
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

const buildDryRunPlan = async (options, existingStateByRoundId) => {
  const selectedRoundIds = [...options.roundIds];
  const roundDataById = buildRoundDataById(selectedRoundIds);
  await readLegacyPlanningInputs(options, roundDataById);

  const records = selectedRoundIds.map((roundId) =>
    evaluateRoundPlan(roundId, roundDataById.get(roundId), existingStateByRoundId.get(roundId))
  );
  const summary = summarizePlan(records, selectedRoundIds);
  return { records, summary };
};

module.exports = {
  buildDryRunPlan,
};
