"use strict";

const {
  DEFAULT_USER_PATTERN,
  loadNormalizedIdentityByCoderId,
  buildEligibleMemberIdentities,
} = require("./participants");
const {
  resolveSkippedFilePath,
  normalizeSkipRecords,
  collectReasonCodes,
  writeSkippedArtifact,
  MISSING_MEMBER_REASON_CODE,
  FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE,
} = require("./skippedArtifact");
const {
  DEFAULT_REVIEW_SCHEMA,
  loadNonExampleLegacySubmissionRowsByRoundId,
  createReviewSubmissionStore,
  reconcileRoundSubmissionHistory,
} = require("./submissionHistory");
const {
  loadLegacyFinalRowsByRoundId,
  createReviewFinalScoreStore,
  reconcileRoundFinalScores,
} = require("./finalScores");
const {
  loadLegacyProvisionalRowsByRoundId,
  createReviewProvisionalScoreStore,
  reconcileRoundProvisionalScores,
} = require("./provisionalScores");

const STANDARD_PHASE_NAMES = ["Registration", "Submission", "Review"];
const DEFAULT_SUBMITTER_ROLE_ID = "732339e7-8e30-49d7-9198-cccf9451e221";
const TEMPORARY_RESOURCE_WRITE_STATUS = "ACTIVE";
const buildFallbackImportedDescription = (legacyId) =>
  `Imported historical Marathon Match from legacy round ${legacyId}`;

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

const resolveChallengeDescription = ({ legacyId, counters }) => {
  const candidate = counters && counters.descriptionProblemText;
  if (isUsableProblemText(candidate)) {
    return String(candidate);
  }
  return buildFallbackImportedDescription(legacyId);
};

const parseRoundLegacyId = (roundId) => {
  const parsed = Number.parseInt(String(roundId || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid legacy round id "${roundId}"`);
  }
  return parsed;
};

const minSubmissionMs = (left, right) => {
  if (!Number.isFinite(left)) {
    return Number.isFinite(right) ? right : null;
  }
  if (!Number.isFinite(right)) {
    return left;
  }
  return Math.min(left, right);
};

const maxSubmissionMs = (left, right) => {
  if (!Number.isFinite(left)) {
    return Number.isFinite(right) ? right : null;
  }
  if (!Number.isFinite(right)) {
    return left;
  }
  return Math.max(left, right);
};

const derivePhaseWindows = (roundId, counters) => {
  const registrationStartMs = counters && counters.registrationStartMs;
  const registrationEndMs = counters && counters.registrationEndMs;
  const latestSubmissionMs = maxSubmissionMs(
    counters && counters.latestNonExampleSubmitMs,
    counters && counters.latestExampleOnlyFinalistSubmitMs
  );
  const earliestSubmissionOpenMs = counters && counters.earliestSubmissionOpenMs;
  const earliestSubmissionMs = minSubmissionMs(
    counters && counters.earliestNonExampleSubmitMs,
    counters && counters.earliestExampleOnlyFinalistSubmitMs
  );

  if (!Number.isFinite(registrationStartMs) || !Number.isFinite(registrationEndMs)) {
    throw new Error(
      `Round ${roundId} is missing eligible registration timestamps needed for phase derivation.`
    );
  }
  if (!Number.isFinite(latestSubmissionMs)) {
    throw new Error(
      `Round ${roundId} is missing attachable submission timestamps needed for phase derivation.`
    );
  }

  const registrationStart = Math.min(registrationStartMs, registrationEndMs);
  const registrationEnd = Math.max(registrationStartMs, registrationEndMs);

  const rawSubmissionStartMs = Number.isFinite(earliestSubmissionOpenMs)
    ? earliestSubmissionOpenMs
    : earliestSubmissionMs;
  if (!Number.isFinite(rawSubmissionStartMs)) {
    throw new Error(
      `Round ${roundId} is missing both submission open_time and attachable submission start timestamps.`
    );
  }

  const submissionStart = Math.min(rawSubmissionStartMs, latestSubmissionMs);
  const submissionEnd = Math.max(rawSubmissionStartMs, latestSubmissionMs);
  const reviewStart = submissionEnd;
  const reviewEnd = submissionEnd;

  return {
    registration: {
      startDate: new Date(registrationStart),
      endDate: new Date(registrationEnd),
    },
    submission: {
      startDate: new Date(submissionStart),
      endDate: new Date(submissionEnd),
    },
    review: {
      startDate: new Date(reviewStart),
      endDate: new Date(reviewEnd),
    },
  };
};

const phaseDurationSeconds = (startDate, endDate) =>
  Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 1000));

const buildChallengePhaseRows = ({ challengeId, phaseIdsByName, windows, actor }) => {
  const rows = [];

  STANDARD_PHASE_NAMES.forEach((phaseName) => {
    const phaseId = phaseIdsByName[phaseName];
    if (!phaseId) {
      throw new Error(`Missing phase id for standard phase "${phaseName}"`);
    }
    const window = windows[phaseName.toLowerCase()];
    if (!window) {
      throw new Error(`Missing phase window for standard phase "${phaseName}"`);
    }

    rows.push({
      challengeId,
      phaseId,
      name: phaseName,
      isOpen: false,
      duration: phaseDurationSeconds(window.startDate, window.endDate),
      scheduledStartDate: window.startDate,
      scheduledEndDate: window.endDate,
      actualStartDate: window.startDate,
      actualEndDate: window.endDate,
      createdBy: actor,
      updatedBy: actor,
    });
  });

  return rows;
};

const buildChallengeCreateData = ({
  roundId,
  round,
  actor,
  marathonTypeId,
  dataScienceTrackId,
  timelineTemplateId,
  counters,
  windows,
}) => {
  const legacyId = parseRoundLegacyId(roundId);
  const registrationCount = counters && counters.eligibleRegistrants ? counters.eligibleRegistrants.size : 0;
  const nonExampleSubmissionCount =
    counters && Number.isFinite(counters.nonExampleSubmissions)
      ? counters.nonExampleSubmissions
      : 0;
  const exampleOnlyFinalistSubmissionCount =
    counters && Number.isFinite(counters.exampleOnlyFinalistSubmissions)
      ? counters.exampleOnlyFinalistSubmissions
      : 0;
  const submissionCount = nonExampleSubmissionCount + exampleOnlyFinalistSubmissionCount;

  return {
    legacyId,
    name:
      String((round && (round.short_name || round.name)) || "").trim() ||
      `Historical Marathon Match ${legacyId}`,
    description: resolveChallengeDescription({ legacyId, counters }),
    typeId: marathonTypeId,
    trackId: dataScienceTrackId,
    timelineTemplateId,
    status: "COMPLETED",
    currentPhaseNames: [],
    tags: [],
    groups: [],
    numOfRegistrants: registrationCount,
    numOfSubmissions: submissionCount,
    registrationStartDate: windows.registration.startDate,
    registrationEndDate: windows.registration.endDate,
    submissionStartDate: windows.submission.startDate,
    submissionEndDate: windows.submission.endDate,
    startDate: windows.registration.startDate,
    endDate: windows.review.endDate,
    createdBy: actor,
    updatedBy: actor,
  };
};

const countStandardPhaseRows = (phaseRows) => {
  const counts = {};
  STANDARD_PHASE_NAMES.forEach((phaseName) => {
    counts[phaseName] = 0;
  });
  phaseRows.forEach((phaseRow) => {
    if (counts[phaseRow.name] !== undefined) {
      counts[phaseRow.name] += 1;
    }
  });
  return counts;
};

const findMissingStandardPhaseNames = (phaseRows) => {
  const counts = countStandardPhaseRows(phaseRows);
  STANDARD_PHASE_NAMES.forEach((phaseName) => {
    if (counts[phaseName] > 1) {
      throw new Error(`Matched challenge has duplicate "${phaseName}" phase rows.`);
    }
  });
  return STANDARD_PHASE_NAMES.filter((phaseName) => counts[phaseName] === 0);
};

const applyCreateRound = async ({
  prisma,
  roundId,
  round,
  counters,
  actor,
  marathonTypeId,
  dataScienceTrackId,
  timelineTemplateId,
  phaseIdsByName,
}) => {
  const legacyId = parseRoundLegacyId(roundId);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.challenge.findMany({
      where: { legacyId },
      select: { id: true, typeId: true, trackId: true },
      take: 3,
    });
    if (existing.length > 1) {
      throw new Error(
        `Round ${roundId} matched multiple existing v6 challenges by legacyId ${legacyId}; refusing unsafe reuse.`
      );
    }
    if (existing.length === 1) {
      const existingChallenge = existing[0];
      if (
        existingChallenge.typeId !== marathonTypeId ||
        existingChallenge.trackId !== dataScienceTrackId
      ) {
        throw new Error(
          `Round ${roundId} matched challenge ${existingChallenge.id} but it cannot be reused because it is not Marathon Match / Data Science.`
        );
      }

      const existingStandardPhases = await tx.challengePhase.findMany({
        where: {
          challengeId: existingChallenge.id,
          name: { in: STANDARD_PHASE_NAMES },
        },
        select: {
          id: true,
          name: true,
          isOpen: true,
          scheduledStartDate: true,
          scheduledEndDate: true,
          actualStartDate: true,
          actualEndDate: true,
        },
      });
      const missingPhaseNames = findMissingStandardPhaseNames(existingStandardPhases);

      if (missingPhaseNames.length > 0) {
        const windows = derivePhaseWindows(roundId, counters);
        const newPhaseRows = buildChallengePhaseRows({
          challengeId: existingChallenge.id,
          phaseIdsByName,
          windows,
          actor,
        }).filter((phaseRow) => missingPhaseNames.includes(phaseRow.name));

        if (newPhaseRows.length > 0) {
          await tx.challengePhase.createMany({ data: newPhaseRows });
        }
      }

      return {
        status: "existing",
        challengeId: existingChallenge.id,
        legacyRoundId: roundId,
      };
    }

    const windows = derivePhaseWindows(roundId, counters);
    const challenge = await tx.challenge.create({
      data: buildChallengeCreateData({
        roundId,
        round,
        actor,
        marathonTypeId,
        dataScienceTrackId,
        timelineTemplateId,
        counters,
        windows,
      }),
      select: { id: true },
    });

    const phaseRows = buildChallengePhaseRows({
      challengeId: challenge.id,
      phaseIdsByName,
      windows,
      actor,
    });
    await tx.challengePhase.createMany({ data: phaseRows });

    return {
      status: "created",
      challengeId: challenge.id,
      legacyRoundId: roundId,
    };
  });
};

const requireSingleMatch = (items, label) => {
  if (items.length !== 1) {
    throw new Error(`Expected exactly one ${label}, found ${items.length}.`);
  }
  return items[0];
};

const resolveMarathonTypeId = async (prisma) => {
  const candidates = await prisma.challengeType.findMany({
    where: {
      OR: [{ name: { equals: "Marathon Match", mode: "insensitive" } }, { abbreviation: "MM" }],
    },
    select: { id: true },
  });
  return requireSingleMatch(candidates, "Marathon Match challenge type").id;
};

const resolveDataScienceTrackId = async (prisma) => {
  const candidates = await prisma.challengeTrack.findMany({
    where: {
      OR: [
        { name: { equals: "Data Science", mode: "insensitive" } },
        { abbreviation: "DS" },
        { track: "DATA_SCIENCE" },
      ],
    },
    select: { id: true },
  });
  return requireSingleMatch(candidates, "Data Science track").id;
};

const resolveStandardPhaseIds = async (prisma) => {
  const phases = await prisma.phase.findMany({
    where: { name: { in: STANDARD_PHASE_NAMES } },
    select: { id: true, name: true },
  });
  const grouped = phases.reduce((acc, phase) => {
    if (!acc[phase.name]) {
      acc[phase.name] = [];
    }
    acc[phase.name].push(phase.id);
    return acc;
  }, {});

  const result = {};
  STANDARD_PHASE_NAMES.forEach((phaseName) => {
    const ids = grouped[phaseName] || [];
    if (ids.length !== 1) {
      throw new Error(`Expected exactly one "${phaseName}" phase row, found ${ids.length}.`);
    }
    result[phaseName] = ids[0];
  });
  return result;
};

const hasStandardMarathonShape = (phaseNames) => {
  if (!Array.isArray(phaseNames) || phaseNames.length !== STANDARD_PHASE_NAMES.length) {
    return false;
  }
  const normalized = phaseNames.map((name) => String(name || "").trim().toLowerCase());
  const unique = new Set(normalized);
  if (unique.size !== STANDARD_PHASE_NAMES.length) {
    return false;
  }
  return STANDARD_PHASE_NAMES.every((name) => unique.has(name.toLowerCase()));
};

const resolveCanonicalTimelineTemplateId = async (prisma, marathonTypeId, dataScienceTrackId) => {
  const mappings = await prisma.challengeTimelineTemplate.findMany({
    where: { typeId: marathonTypeId, trackId: dataScienceTrackId },
    select: {
      id: true,
      isDefault: true,
      timelineTemplateId: true,
      timelineTemplate: {
        select: {
          id: true,
          phases: { select: { phaseId: true } },
        },
      },
    },
  });
  if (mappings.length === 0) {
    throw new Error("No ChallengeTimelineTemplate mappings found for Marathon Match/Data Science.");
  }

  const phaseIds = Array.from(
    new Set(
      mappings.flatMap((mapping) =>
        (mapping.timelineTemplate && mapping.timelineTemplate.phases) || []
      ).map((phase) => phase.phaseId)
    )
  );
  const phaseRows = phaseIds.length
    ? await prisma.phase.findMany({ where: { id: { in: phaseIds } }, select: { id: true, name: true } })
    : [];
  const phaseNameById = new Map(phaseRows.map((phase) => [phase.id, phase.name]));

  const valid = mappings.filter((mapping) => {
    const phaseNames = (mapping.timelineTemplate && mapping.timelineTemplate.phases) || [];
    const names = phaseNames
      .map((phase) => phaseNameById.get(phase.phaseId))
      .filter((name) => Boolean(name));
    return hasStandardMarathonShape(names);
  });

  if (valid.length === 0) {
    throw new Error(
      "No canonical Marathon Match/Data Science timeline template mapping found with Registration/Submission/Review shape."
    );
  }
  if (valid.length === 1) {
    return valid[0].timelineTemplateId;
  }

  const defaultCandidates = valid.filter((candidate) => candidate.isDefault);
  if (defaultCandidates.length === 1) {
    return defaultCandidates[0].timelineTemplateId;
  }

  throw new Error(
    `Expected one canonical Marathon Match/Data Science timeline mapping, found ${valid.length} valid candidates.`
  );
};

const normalizeChallengeStatus = (value) => String(value || "").trim().toUpperCase();

const createPrismaChallengeStatusController = ({ prisma, actor }) => {
  if (
    !prisma ||
    !prisma.challenge ||
    typeof prisma.challenge.findUnique !== "function" ||
    typeof prisma.challenge.update !== "function"
  ) {
    return null;
  }

  return {
    getChallengeStatus: async (challengeId) => {
      const challenge = await prisma.challenge.findUnique({
        where: { id: challengeId },
        select: { status: true },
      });
      if (!challenge || !challenge.status) {
        throw new Error(`Unable to read challenge status for ${challengeId}.`);
      }
      return normalizeChallengeStatus(challenge.status);
    },
    updateChallengeStatus: async (challengeId, status) =>
      prisma.challenge.update({
        where: { id: challengeId },
        data: {
          status,
          updatedBy: actor,
        },
        select: { id: true, status: true },
      }),
  };
};

const isCompletedChallengeResourceConstraintError = (error) => {
  if (!error) {
    return false;
  }
  const message = String(error.message || "").toLowerCase();
  const responseBody = String(error.responseBody || "").toLowerCase();
  const searchable = `${message} ${responseBody}`;
  const hasCompletedSignal = searchable.includes("completed");
  const hasChallengeSignal = searchable.includes("challenge");
  const hasConstraintStatus =
    error.httpStatus === undefined ||
    error.httpStatus === null ||
    [400, 403, 422].includes(Number.parseInt(error.httpStatus, 10));
  return hasCompletedSignal && hasChallengeSignal && hasConstraintStatus;
};

const collectPlannedSkipRecords = (roundIds, planRecordByRoundId) => {
  const records = [];
  roundIds.forEach((roundId) => {
    const planRecord = planRecordByRoundId.get(roundId);
    if (!planRecord || !Array.isArray(planRecord.plannedSkipRecords)) {
      return;
    }
    planRecord.plannedSkipRecords.forEach((record) => {
      records.push(record);
    });
  });
  return normalizeSkipRecords(records);
};

const hasAffectedSurface = (record, surfaceName) =>
  Array.isArray(record && record.affectedSurfaces) &&
  record.affectedSurfaces.some(
    (surface) => String(surface || "").trim().toLowerCase() === String(surfaceName || "").trim().toLowerCase()
  );

const collectMissingMemberSkipMemberIdsByRoundId = ({
  roundIds,
  planRecordByRoundId,
  affectedSurface,
}) => {
  const byRoundId = new Map();

  roundIds.forEach((roundId) => {
    const planRecord = planRecordByRoundId.get(roundId);
    const skipMemberIds = new Set();

    if (planRecord && Array.isArray(planRecord.plannedSkipRecords)) {
      planRecord.plannedSkipRecords.forEach((record) => {
        const reasonCode = String(record && record.reasonCode ? record.reasonCode : "").trim();
        if (reasonCode !== MISSING_MEMBER_REASON_CODE) {
          return;
        }
        if (!hasAffectedSurface(record, affectedSurface)) {
          return;
        }
        const memberId = parseMemberId(record && record.memberId);
        if (memberId) {
          skipMemberIds.add(memberId);
        }
      });
    }

    byRoundId.set(roundId, skipMemberIds);
  });

  return byRoundId;
};

const collectSkipMemberIdsByRoundId = ({
  roundIds,
  planRecordByRoundId,
  reasonCode,
  affectedSurface,
}) => {
  const byRoundId = new Map();
  const normalizedReasonCode = String(reasonCode || "").trim();

  roundIds.forEach((roundId) => {
    const planRecord = planRecordByRoundId.get(roundId);
    const skipMemberIds = new Set();

    if (planRecord && Array.isArray(planRecord.plannedSkipRecords)) {
      planRecord.plannedSkipRecords.forEach((record) => {
        const candidateReasonCode = String(
          record && record.reasonCode ? record.reasonCode : ""
        ).trim();
        if (candidateReasonCode !== normalizedReasonCode) {
          return;
        }
        if (!hasAffectedSurface(record, affectedSurface)) {
          return;
        }
        const memberId = parseMemberId(record && record.memberId);
        if (memberId) {
          skipMemberIds.add(memberId);
        }
      });
    }

    byRoundId.set(roundId, skipMemberIds);
  });

  return byRoundId;
};

const resolveTargetedRerunSelection = ({ options, planRecordByRoundId }) => {
  const roundIds = Array.isArray(options && options.roundIds) ? options.roundIds : [];
  if (roundIds.length !== 1) {
    throw new Error("--targeted-rerun requires exactly one selected round.");
  }
  const [roundId] = roundIds;
  const challengeIdOverride = String((options && options.challengeId) || "").trim();
  if (!challengeIdOverride) {
    throw new Error("--targeted-rerun requires --challenge-id <id>.");
  }

  const planRecord = planRecordByRoundId.get(roundId);
  if (!planRecord) {
    throw new Error(
      `Targeted rerun requires a plan record for selected round ${roundId}; none was generated.`
    );
  }
  if (planRecord.decision !== "reuse/backfill-only") {
    throw new Error(
      `Targeted rerun requires selected round ${roundId} to be already imported (decision reuse/backfill-only), but got ${planRecord.decision}.`
    );
  }

  const matchedChallengeId = String((planRecord && planRecord.matchedChallengeId) || "").trim();
  if (!matchedChallengeId) {
    throw new Error(
      `Targeted rerun requires selected round ${roundId} to resolve an existing matched challenge id.`
    );
  }
  if (challengeIdOverride !== matchedChallengeId) {
    throw new Error(
      `Targeted rerun challenge-id override "${challengeIdOverride}" does not match selected round ${roundId} target challenge "${matchedChallengeId}".`
    );
  }

  return {
    roundId,
    challengeId: matchedChallengeId,
  };
};

const runTargetedRerunMode = async ({ options, plan, prisma, actor = "historical-mm-importer" }) => {
  const planRecordByRoundId = new Map((plan.records || []).map((record) => [record.legacyRoundId, record]));
  const selection = resolveTargetedRerunSelection({ options, planRecordByRoundId });
  const roundDataById = plan && plan.roundDataById instanceof Map ? plan.roundDataById : null;
  const counters = roundDataById ? roundDataById.get(selection.roundId) : null;
  const legacyProblemId = String(
    counters && counters.descriptionProblemId ? counters.descriptionProblemId : ""
  ).trim();
  const candidateProblemText = counters && counters.descriptionProblemText;
  const hasProblemTextUpdate = isUsableProblemText(candidateProblemText);

  if (hasProblemTextUpdate) {
    if (
      !prisma ||
      !prisma.challenge ||
      typeof prisma.challenge.update !== "function"
    ) {
      throw new Error(
        "Targeted rerun requires Prisma challenge.update to apply description patches."
      );
    }
    await prisma.challenge.update({
      where: { id: selection.challengeId },
      data: {
        description: String(candidateProblemText),
        updatedBy: String(actor || "").trim() || "historical-mm-importer",
      },
      select: { id: true },
    });

    return {
      records: [
        {
          recordType: "apply-record",
          legacyRoundId: selection.roundId,
          status: "targeted-rerun-applied",
          challengeId: selection.challengeId,
          mode: "targeted-rerun",
          writesAttempted: true,
          descriptionUpdated: true,
          descriptionSource: "legacy-problem-text",
          legacyProblemId: legacyProblemId || null,
          reason: "targeted-rerun-description-updated-from-legacy-problem-text",
        },
      ],
      summary: {
        recordType: "apply-summary",
        created: 0,
        existing: 0,
        unmatched: 0,
        unresolved: 0,
        errors: 0,
        targetedRerunValidated: 1,
        targetedRerunDescriptionUpdated: 1,
        targetedRerunDescriptionPreserved: 0,
        targetedRerunWritesAttempted: 1,
        skippedFileArtifact: null,
      },
    };
  }

  return {
    records: [
      {
        recordType: "apply-record",
        legacyRoundId: selection.roundId,
        status: "targeted-rerun-preserved",
        challengeId: selection.challengeId,
        mode: "targeted-rerun",
        writesAttempted: false,
        descriptionUpdated: false,
        descriptionSource: "existing-description-preserved-no-usable-legacy-problem-text",
        legacyProblemId: null,
        reason: "targeted-rerun-description-preserved-no-usable-legacy-problem-text",
      },
    ],
    summary: {
      recordType: "apply-summary",
      created: 0,
      existing: 0,
      unmatched: 0,
      unresolved: 0,
      errors: 0,
      targetedRerunValidated: 1,
      targetedRerunDescriptionUpdated: 0,
      targetedRerunDescriptionPreserved: 1,
      targetedRerunWritesAttempted: 0,
      skippedFileArtifact: null,
    },
  };
};

const runApplyMode = async ({
  prisma,
  options,
  plan,
  actor,
  normalizedIdentityByCoderId: providedNormalizedIdentityByCoderId,
}) => {
  const planRecordByRoundId = new Map((plan.records || []).map((record) => [record.legacyRoundId, record]));
  const skippedFilePath = resolveSkippedFilePath({
    skippedFilePath: options.skippedFilePath,
    roundIds: options.roundIds,
    cwd: options.cwd || process.cwd(),
  });
  const plannedSkipRecords = collectPlannedSkipRecords(options.roundIds, planRecordByRoundId);
  const missingMemberResourceSkipMemberIdsByRoundId =
    collectMissingMemberSkipMemberIdsByRoundId({
      roundIds: options.roundIds,
      planRecordByRoundId,
      affectedSurface: "resource",
    });
  const missingMemberSubmissionSkipMemberIdsByRoundId =
    collectMissingMemberSkipMemberIdsByRoundId({
      roundIds: options.roundIds,
      planRecordByRoundId,
      affectedSurface: "submission",
    });
  const missingMemberFinalSkipMemberIdsByRoundId =
    collectMissingMemberSkipMemberIdsByRoundId({
      roundIds: options.roundIds,
      planRecordByRoundId,
      affectedSurface: "final-score",
    });
  const missingMemberProvisionalSkipMemberIdsByRoundId =
    collectMissingMemberSkipMemberIdsByRoundId({
      roundIds: options.roundIds,
      planRecordByRoundId,
      affectedSurface: "provisional-score",
    });
  const plannedUnattachableFinalSkipMemberIdsByRoundId = collectSkipMemberIdsByRoundId({
    roundIds: options.roundIds,
    planRecordByRoundId,
    reasonCode: FINALIST_WITHOUT_ATTACHABLE_SUBMISSION_REASON_CODE,
    affectedSurface: "final-score",
  });
  let skippedArtifact = writeSkippedArtifact({
    filePath: skippedFilePath,
    selectedRoundIds: options.roundIds,
    records: plannedSkipRecords,
  });

  const actionableRoundIds = options.roundIds.filter((roundId) => {
    const counters = plan.roundDataById.get(roundId);
    if (!counters || !counters.round) {
      return false;
    }
    const decision = planRecordByRoundId.get(roundId) && planRecordByRoundId.get(roundId).decision;
    return decision === "create" || decision === "reuse/backfill-only";
  });
  const createRoundIds = actionableRoundIds.filter((roundId) => {
    const decision = planRecordByRoundId.get(roundId) && planRecordByRoundId.get(roundId).decision;
    return decision === "create";
  });
  const submitterRoleId = String(options.submitterRoleId || DEFAULT_SUBMITTER_ROLE_ID).trim();
  const submissionImportEnabled = options.importSubmissions === true;
  const finalScoreImportEnabled = options.importFinalScores === true;
  const provisionalScoreImportEnabled = options.importProvisionalScores === true;

  const resourceClient = options.resourceClient;
  if (actionableRoundIds.length > 0 && !resourceClient) {
    throw new Error("Resource API client is required for apply mode participant reconciliation.");
  }
  if (actionableRoundIds.length > 0 && submissionImportEnabled && !options.reviewClient && !options.submissionStore) {
    throw new Error(
      "Review DB client is required for apply mode submission-history reconciliation."
    );
  }
  if (
    actionableRoundIds.length > 0 &&
    finalScoreImportEnabled &&
    !options.reviewClient &&
    !options.finalScoreStore
  ) {
    throw new Error(
      "Review DB client is required for apply mode final-score reconciliation."
    );
  }
  if (
    actionableRoundIds.length > 0 &&
    provisionalScoreImportEnabled &&
    !options.reviewClient &&
    !options.provisionalScoreStore
  ) {
    throw new Error(
      "Review DB client is required for apply mode provisional-score reconciliation."
    );
  }
  const challengeStatusController =
    options.challengeStatusController ||
    createPrismaChallengeStatusController({ prisma, actor });

  let normalizedIdentityByCoderId =
    options.normalizedIdentityByCoderId instanceof Map
      ? options.normalizedIdentityByCoderId
      : providedNormalizedIdentityByCoderId instanceof Map
      ? providedNormalizedIdentityByCoderId
      : null;
  if (!normalizedIdentityByCoderId) {
    const relevantCoderIds = new Set();
    actionableRoundIds.forEach((roundId) => {
      const counters = plan.roundDataById.get(roundId);
      if (!counters || !(counters.eligibleRegistrants instanceof Set)) {
        return;
      }
      counters.eligibleRegistrants.forEach((coderId) => {
        const normalizedCoderId = String(coderId || "").trim();
        if (normalizedCoderId) {
          relevantCoderIds.add(normalizedCoderId);
        }
      });
      if (counters.nonExampleSubmitterCoderIds instanceof Set) {
        counters.nonExampleSubmitterCoderIds.forEach((coderId) => {
          const normalizedCoderId = String(coderId || "").trim();
          if (normalizedCoderId) {
            relevantCoderIds.add(normalizedCoderId);
          }
        });
      }
      if (counters.finalCandidateCoderIds instanceof Set) {
        counters.finalCandidateCoderIds.forEach((coderId) => {
          const normalizedCoderId = String(coderId || "").trim();
          if (normalizedCoderId) {
            relevantCoderIds.add(normalizedCoderId);
          }
        });
      }
    });

    normalizedIdentityByCoderId = await loadNormalizedIdentityByCoderId({
      dataDir: options.dataDir,
      userPattern: options.userPattern || DEFAULT_USER_PATTERN,
      coderIds: relevantCoderIds,
    });
  }

  let roundSubmissionRowsByRoundId = new Map();
  let roundFinalRowsByRoundId = new Map();
  let roundProvisionalRowsByRoundId = new Map();
  let submissionStore = null;
  let finalScoreStore = null;
  let provisionalScoreStore = null;
  if (submissionImportEnabled && actionableRoundIds.length > 0) {
    roundSubmissionRowsByRoundId = await loadNonExampleLegacySubmissionRowsByRoundId({
      dataDir: options.dataDir,
      longComponentStateFile: options.longComponentStateFile,
      longSubmissionPattern: options.longSubmissionPattern,
      roundIds: actionableRoundIds,
      attachableExampleOnlyFinalistCoderIdsByRoundId: new Map(
        actionableRoundIds.map((roundId) => [
          roundId,
          (plan.roundDataById.get(roundId) &&
            plan.roundDataById.get(roundId).finalCandidateCoderIds) ||
            new Set(),
        ])
      ),
    });
    submissionStore =
      options.submissionStore ||
      (await createReviewSubmissionStore({
        reviewClient: options.reviewClient,
        reviewSchema: options.reviewSchema || DEFAULT_REVIEW_SCHEMA,
        actor,
      }));
  }
  if (finalScoreImportEnabled && actionableRoundIds.length > 0) {
    roundFinalRowsByRoundId = await loadLegacyFinalRowsByRoundId({
      dataDir: options.dataDir,
      longComponentStateFile: options.longComponentStateFile,
      longCompResultPattern: options.longCompResultPattern,
      roundIds: actionableRoundIds,
    });
    finalScoreStore =
      options.finalScoreStore ||
      (await createReviewFinalScoreStore({
        reviewClient: options.reviewClient,
        reviewSchema: options.reviewSchema || DEFAULT_REVIEW_SCHEMA,
        actor,
      }));
  }
  if (provisionalScoreImportEnabled && actionableRoundIds.length > 0) {
    roundProvisionalRowsByRoundId = await loadLegacyProvisionalRowsByRoundId({
      dataDir: options.dataDir,
      longComponentStateFile: options.longComponentStateFile,
      longSubmissionPattern: options.longSubmissionPattern,
      roundIds: actionableRoundIds,
      attachableExampleOnlyFinalistCoderIdsByRoundId: new Map(
        actionableRoundIds.map((roundId) => [
          roundId,
          (plan.roundDataById.get(roundId) &&
            plan.roundDataById.get(roundId).finalCandidateCoderIds) ||
            new Set(),
        ])
      ),
    });
    provisionalScoreStore =
      options.provisionalScoreStore ||
      (await createReviewProvisionalScoreStore({
        reviewClient: options.reviewClient,
        reviewSchema: options.reviewSchema || DEFAULT_REVIEW_SCHEMA,
        actor,
      }));
  }

  let marathonTypeId = null;
  let dataScienceTrackId = null;
  let phaseIdsByName = null;
  let timelineTemplateId = null;
  if (actionableRoundIds.length > 0) {
    marathonTypeId = await resolveMarathonTypeId(prisma);
    dataScienceTrackId = await resolveDataScienceTrackId(prisma);
    phaseIdsByName = await resolveStandardPhaseIds(prisma);
    if (createRoundIds.length > 0) {
      timelineTemplateId = await resolveCanonicalTimelineTemplateId(
        prisma,
        marathonTypeId,
        dataScienceTrackId
      );
    }
  }

  const applyRecords = [];
  const runtimeSkipRecords = [];
  for (const roundId of options.roundIds) {
    const counters = plan.roundDataById.get(roundId);
    const planRecord = planRecordByRoundId.get(roundId);
    const decision = planRecord && planRecord.decision;
    if (!counters || !counters.round || decision === "unmatched") {
      applyRecords.push({
        recordType: "apply-record",
        legacyRoundId: roundId,
        status: "unmatched",
        reason:
          (planRecord && planRecord.reason) || "selected-round-not-found-in-legacy-source",
      });
      continue;
    }

    if (decision !== "create" && decision !== "reuse/backfill-only") {
      applyRecords.push({
        recordType: "apply-record",
        legacyRoundId: roundId,
        status: "unresolved",
        reason: (planRecord && planRecord.reason) || "round-not-actionable-for-apply",
      });
      continue;
    }

    try {
      const result = await applyCreateRound({
        prisma,
        roundId,
        round: counters.round,
        counters,
        actor,
        marathonTypeId,
        dataScienceTrackId,
        timelineTemplateId,
        phaseIdsByName,
      });
      const resourceReconciliation = await reconcileSubmitterResourcesForRound({
        challengeId: result.challengeId,
        counters,
        normalizedIdentityByCoderId,
        resourceClient,
        submitterRoleId,
        challengeStatusController,
        missingMemberResourceSkipMemberIds:
          missingMemberResourceSkipMemberIdsByRoundId.get(roundId) || new Set(),
      });
      const submissionReconciliation =
        submissionImportEnabled && submissionStore
          ? await reconcileRoundSubmissionHistory({
            roundId,
            challengeId: result.challengeId,
            rowsByRoundId: roundSubmissionRowsByRoundId,
            normalizedIdentityByCoderId,
            missingMemberSubmissionSkipMemberIds:
                missingMemberSubmissionSkipMemberIdsByRoundId.get(roundId) || new Set(),
            submissionStore,
          })
          : null;
      if (submissionReconciliation && Array.isArray(submissionReconciliation.skippedSubmissionRecords)) {
        runtimeSkipRecords.push(...submissionReconciliation.skippedSubmissionRecords);
      }
      const finalScoreReconciliation =
        finalScoreImportEnabled && finalScoreStore
          ? await reconcileRoundFinalScores({
            roundId,
            challengeId: result.challengeId,
            finalRowsByRoundId: roundFinalRowsByRoundId,
            normalizedIdentityByCoderId,
            missingMemberFinalSkipMemberIds:
                missingMemberFinalSkipMemberIdsByRoundId.get(roundId) || new Set(),
            plannedUnattachableFinalSkipMemberIds:
                plannedUnattachableFinalSkipMemberIdsByRoundId.get(roundId) || new Set(),
            finalScoreStore,
          })
          : null;
      if (finalScoreReconciliation && Array.isArray(finalScoreReconciliation.runtimeSkipRecords)) {
        runtimeSkipRecords.push(...finalScoreReconciliation.runtimeSkipRecords);
      }
      const provisionalScoreReconciliation =
        provisionalScoreImportEnabled && provisionalScoreStore
          ? await reconcileRoundProvisionalScores({
            roundId,
            challengeId: result.challengeId,
            provisionalRowsByRoundId: roundProvisionalRowsByRoundId,
            normalizedIdentityByCoderId,
            missingMemberProvisionalSkipMemberIds:
                missingMemberProvisionalSkipMemberIdsByRoundId.get(roundId) || new Set(),
            provisionalScoreStore,
          })
          : null;
      if (
        provisionalScoreReconciliation &&
        Array.isArray(provisionalScoreReconciliation.skippedProvisionalRecords)
      ) {
        runtimeSkipRecords.push(...provisionalScoreReconciliation.skippedProvisionalRecords);
      }
      applyRecords.push({
        recordType: "apply-record",
        legacyRoundId: roundId,
        status: result.status,
        challengeId: result.challengeId,
        resourceReconciliation,
        ...(submissionReconciliation ? { submissionReconciliation } : {}),
        ...(finalScoreReconciliation ? { finalScoreReconciliation } : {}),
        ...(provisionalScoreReconciliation ? { provisionalScoreReconciliation } : {}),
      });
    } catch (error) {
      applyRecords.push({
        recordType: "apply-record",
        legacyRoundId: roundId,
        status: "error",
        reason: error.message,
      });
      throw error;
    }
  }

  const finalSkipRecords = normalizeSkipRecords([
    ...plannedSkipRecords,
    ...runtimeSkipRecords,
  ]);
  skippedArtifact = writeSkippedArtifact({
    filePath: skippedFilePath,
    selectedRoundIds: options.roundIds,
    records: finalSkipRecords,
  });

  const summary = applyRecords.reduce(
    (acc, record) => {
      if (record.status === "created") {
        acc.created += 1;
      } else if (record.status === "existing") {
        acc.existing += 1;
      } else if (record.status === "unmatched") {
        acc.unmatched += 1;
      } else if (record.status === "unresolved") {
        acc.unresolved += 1;
      } else if (record.status === "error") {
        acc.errors += 1;
      }
      return acc;
    },
    { recordType: "apply-summary", created: 0, existing: 0, unmatched: 0, unresolved: 0, errors: 0 }
  );
  summary.skippedFileArtifact = {
    path: skippedFilePath,
    reasonCodes: collectReasonCodes(finalSkipRecords),
    recordCount: skippedArtifact.records.length,
  };

  return { records: applyRecords, summary };
};

const parseMemberId = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const reconcileSubmitterResourcesForRound = async ({
  challengeId,
  counters,
  normalizedIdentityByCoderId,
  resourceClient,
  submitterRoleId,
  challengeStatusController,
  missingMemberResourceSkipMemberIds = new Set(),
}) => {
  const plannedMissingMemberSkipIds =
    missingMemberResourceSkipMemberIds instanceof Set
      ? missingMemberResourceSkipMemberIds
      : new Set();
  const eligibleMemberIdentities = buildEligibleMemberIdentities({
    eligibleCoderIds: counters && counters.eligibleRegistrants ? counters.eligibleRegistrants : new Set(),
    normalizedIdentityByCoderId,
  }).filter((identity) => !plannedMissingMemberSkipIds.has(identity.memberId));
  const targetEligibleRegistrants = eligibleMemberIdentities.length;
  if (targetEligibleRegistrants === 0) {
    return {
      targetEligibleRegistrants: 0,
      existingSubmitterResources: 0,
      createdSubmitterResources: 0,
      unchangedSubmitterResources: 0,
    };
  }

  const existingResources = await resourceClient.listSubmitterResources(challengeId, submitterRoleId);
  const eligibleMemberIds = new Set(eligibleMemberIdentities.map((identity) => identity.memberId));
  const existingEligibleMemberIds = new Set();

  (existingResources || []).forEach((resource) => {
    if (!resource || typeof resource !== "object") {
      return;
    }
    const resourceRoleId = String(resource.roleId || "").trim();
    if (resourceRoleId && resourceRoleId !== submitterRoleId) {
      return;
    }

    const memberId = parseMemberId(resource.memberId);
    if (!memberId || !eligibleMemberIds.has(memberId)) {
      return;
    }
    existingEligibleMemberIds.add(memberId);
  });

  let createdSubmitterResources = 0;
  let usedTemporaryStatusTransition = false;
  let originalChallengeStatus = null;

  const transitionChallengeToTemporaryWritableStatus = async () => {
    if (!challengeStatusController) {
      return false;
    }
    if (usedTemporaryStatusTransition) {
      return true;
    }
    if (
      typeof challengeStatusController.getChallengeStatus !== "function" ||
      typeof challengeStatusController.updateChallengeStatus !== "function"
    ) {
      return false;
    }

    const currentStatus = normalizeChallengeStatus(
      await challengeStatusController.getChallengeStatus(challengeId)
    );
    if (currentStatus !== "COMPLETED") {
      return false;
    }

    await challengeStatusController.updateChallengeStatus(
      challengeId,
      TEMPORARY_RESOURCE_WRITE_STATUS
    );
    usedTemporaryStatusTransition = true;
    originalChallengeStatus = currentStatus;
    return true;
  };

  let operationError = null;
  let restorationError = null;
  try {
    for (const identity of eligibleMemberIdentities) {
      if (existingEligibleMemberIds.has(identity.memberId)) {
        continue;
      }

      const createPayload = {
        challengeId,
        memberId: String(identity.memberId),
        roleId: submitterRoleId,
      };

      try {
        await resourceClient.createSubmitterResource(createPayload);
      } catch (error) {
        const shouldAttemptStatusTransition =
          isCompletedChallengeResourceConstraintError(error) &&
          (await transitionChallengeToTemporaryWritableStatus());
        if (!shouldAttemptStatusTransition) {
          throw error;
        }
        await resourceClient.createSubmitterResource(createPayload);
      }

      existingEligibleMemberIds.add(identity.memberId);
      createdSubmitterResources += 1;
    }
  } catch (error) {
    operationError = error;
  } finally {
    if (usedTemporaryStatusTransition && originalChallengeStatus) {
      try {
        await challengeStatusController.updateChallengeStatus(
          challengeId,
          originalChallengeStatus
        );
      } catch (restoreError) {
        restorationError = restoreError;
      }
    }
  }

  if (restorationError && operationError) {
    throw new Error(
      `${operationError.message} Failed to restore challenge ${challengeId} status to ${originalChallengeStatus}: ${restorationError.message}`
    );
  }
  if (restorationError) {
    throw new Error(
      `Failed to restore challenge ${challengeId} status to ${originalChallengeStatus}: ${restorationError.message}`
    );
  }
  if (operationError) {
    throw operationError;
  }

  const result = {
    targetEligibleRegistrants,
    existingSubmitterResources: targetEligibleRegistrants - createdSubmitterResources,
    createdSubmitterResources,
    unchangedSubmitterResources: targetEligibleRegistrants - createdSubmitterResources,
  };
  if (usedTemporaryStatusTransition) {
    result.usedTemporaryStatusTransition = true;
    result.originalChallengeStatus = originalChallengeStatus;
    result.temporaryChallengeStatus = TEMPORARY_RESOURCE_WRITE_STATUS;
  }
  return result;
};

module.exports = {
  STANDARD_PHASE_NAMES,
  DEFAULT_SUBMITTER_ROLE_ID,
  derivePhaseWindows,
  buildChallengePhaseRows,
  applyCreateRound,
  resolveMarathonTypeId,
  resolveDataScienceTrackId,
  resolveCanonicalTimelineTemplateId,
  reconcileSubmitterResourcesForRound,
  runTargetedRerunMode,
  runApplyMode,
};
