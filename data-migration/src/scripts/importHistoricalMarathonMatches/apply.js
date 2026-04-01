"use strict";

const STANDARD_PHASE_NAMES = ["Registration", "Submission", "Review"];

const parseRoundLegacyId = (roundId) => {
  const parsed = Number.parseInt(String(roundId || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid legacy round id "${roundId}"`);
  }
  return parsed;
};

const derivePhaseWindows = (roundId, counters) => {
  const registrationStartMs = counters && counters.registrationStartMs;
  const registrationEndMs = counters && counters.registrationEndMs;
  const latestSubmissionMs = counters && counters.latestNonExampleSubmitMs;
  const earliestSubmissionOpenMs = counters && counters.earliestSubmissionOpenMs;
  const earliestSubmissionMs = counters && counters.earliestNonExampleSubmitMs;

  if (!Number.isFinite(registrationStartMs) || !Number.isFinite(registrationEndMs)) {
    throw new Error(
      `Round ${roundId} is missing eligible registration timestamps needed for phase derivation.`
    );
  }
  if (!Number.isFinite(latestSubmissionMs)) {
    throw new Error(
      `Round ${roundId} is missing non-example submission timestamps needed for phase derivation.`
    );
  }

  const registrationStart = Math.min(registrationStartMs, registrationEndMs);
  const registrationEnd = Math.max(registrationStartMs, registrationEndMs);

  const rawSubmissionStartMs = Number.isFinite(earliestSubmissionOpenMs)
    ? earliestSubmissionOpenMs
    : earliestSubmissionMs;
  if (!Number.isFinite(rawSubmissionStartMs)) {
    throw new Error(
      `Round ${roundId} is missing both submission open_time and non-example submission start timestamps.`
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
  const submissionCount = counters && Number.isFinite(counters.nonExampleSubmissions)
    ? counters.nonExampleSubmissions
    : 0;

  return {
    legacyId,
    name:
      String((round && (round.short_name || round.name)) || "").trim() ||
      `Historical Marathon Match ${legacyId}`,
    description: `Imported historical Marathon Match from legacy round ${legacyId}`,
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

const runApplyMode = async ({ prisma, options, plan, actor }) => {
  const planRecordByRoundId = new Map((plan.records || []).map((record) => [record.legacyRoundId, record]));
  const actionableRoundIds = options.roundIds.filter((roundId) => {
    const counters = plan.roundDataById.get(roundId);
    if (!counters || !counters.round) {
      return false;
    }
    const decision = planRecordByRoundId.get(roundId) && planRecordByRoundId.get(roundId).decision;
    return decision === "create" || decision === "reuse/backfill-only";
  });

  let marathonTypeId = null;
  let dataScienceTrackId = null;
  let phaseIdsByName = null;
  let timelineTemplateId = null;
  if (actionableRoundIds.length > 0) {
    marathonTypeId = await resolveMarathonTypeId(prisma);
    dataScienceTrackId = await resolveDataScienceTrackId(prisma);
    phaseIdsByName = await resolveStandardPhaseIds(prisma);
    timelineTemplateId = await resolveCanonicalTimelineTemplateId(
      prisma,
      marathonTypeId,
      dataScienceTrackId
    );
  }

  const applyRecords = [];
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
      applyRecords.push({
        recordType: "apply-record",
        legacyRoundId: roundId,
        status: result.status,
        challengeId: result.challengeId,
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

  return { records: applyRecords, summary };
};

module.exports = {
  STANDARD_PHASE_NAMES,
  derivePhaseWindows,
  buildChallengePhaseRows,
  applyCreateRound,
  resolveMarathonTypeId,
  resolveDataScienceTrackId,
  runApplyMode,
};
