"use strict";

const fs = require("fs");
const path = require("path");

const STANDARD_PHASE_NAMES = ["Registration", "Submission", "Review"];

const safeParseObject = (raw, filePath) => {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected a JSON object");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse existing state file ${filePath}: ${error.message}`);
  }
};

const normalizeExistingStateEntry = (legacyRoundId, payload) => {
  const normalizedRoundId = String(legacyRoundId || "").trim();
  if (!normalizedRoundId) {
    return null;
  }

  const source = payload && typeof payload === "object" ? payload : {};
  const existing = source.existing && typeof source.existing === "object" ? source.existing : {};

  return {
    legacyRoundId: normalizedRoundId,
    challengeId: source.challengeId ? String(source.challengeId) : null,
    existing: {
      phases: existing.phases,
      resources: existing.resources,
      submissions: existing.submissions,
      finalScores: existing.finalScores,
      provisionalScores: existing.provisionalScores,
    },
  };
};

const entriesFromPayload = (payload) => {
  if (Array.isArray(payload.rounds)) {
    return payload.rounds
      .map((entry) => normalizeExistingStateEntry(entry.legacyRoundId || entry.roundId, entry))
      .filter(Boolean);
  }

  if (payload.rounds && typeof payload.rounds === "object") {
    return Object.entries(payload.rounds)
      .map(([roundId, entry]) => normalizeExistingStateEntry(roundId, entry))
      .filter(Boolean);
  }

  return Object.entries(payload)
    .map(([roundId, entry]) => normalizeExistingStateEntry(roundId, entry))
    .filter(Boolean);
};

const parseNonNegativeInteger = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
};

const normalizeExistingCounts = (existing = {}) => ({
  phases: parseNonNegativeInteger(existing.phases),
  resources: parseNonNegativeInteger(existing.resources),
  submissions: parseNonNegativeInteger(existing.submissions),
  finalScores: parseNonNegativeInteger(existing.finalScores),
  provisionalScores: parseNonNegativeInteger(existing.provisionalScores),
});

const parseLegacyRoundIdAsInteger = (roundId) => {
  const parsed = Number.parseInt(String(roundId || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const hasDuplicateStandardPhase = (phaseRows = []) => {
  const counts = {};
  phaseRows.forEach((row) => {
    const name = String(row && row.name ? row.name : "").trim();
    if (!STANDARD_PHASE_NAMES.includes(name)) {
      return;
    }
    counts[name] = (counts[name] || 0) + 1;
  });
  return Object.values(counts).some((count) => count > 1);
};

const normalizeSnapshotCountsForChallenge = (snapshotEntry, matchedChallengeId) => {
  if (!snapshotEntry || !snapshotEntry.existing) {
    return normalizeExistingCounts();
  }

  const snapshotChallengeId = snapshotEntry.challengeId ? String(snapshotEntry.challengeId) : null;
  if (snapshotChallengeId && snapshotChallengeId !== String(matchedChallengeId)) {
    return normalizeExistingCounts();
  }
  return normalizeExistingCounts(snapshotEntry.existing);
};

const buildDefaultExistingStateEntry = (legacyRoundId) => ({
  legacyRoundId,
  matchStatus: "none",
  reason: "no-matching-v6-challenge-found",
  challengeId: null,
  existing: normalizeExistingCounts(),
});

const buildExistingStateByRoundId = async ({
  prisma,
  roundIds,
  marathonTypeId,
  dataScienceTrackId,
  snapshotByRoundId = new Map(),
}) => {
  const byRoundId = new Map();
  roundIds.forEach((roundId) => {
    byRoundId.set(roundId, buildDefaultExistingStateEntry(roundId));
  });

  if (!prisma) {
    return byRoundId;
  }

  const legacyRoundIds = Array.from(
    new Set(
      roundIds
        .map((roundId) => parseLegacyRoundIdAsInteger(roundId))
        .filter((legacyRoundId) => Number.isFinite(legacyRoundId))
    )
  );
  if (legacyRoundIds.length === 0) {
    return byRoundId;
  }

  const challengeRows = await prisma.challenge.findMany({
    where: {
      legacyId: {
        in: legacyRoundIds,
      },
    },
    select: {
      id: true,
      legacyId: true,
      typeId: true,
      trackId: true,
    },
  });
  const challengeIds = challengeRows.map((row) => row.id);
  const phaseRows = challengeIds.length
    ? await prisma.challengePhase.findMany({
      where: {
        challengeId: { in: challengeIds },
        name: { in: STANDARD_PHASE_NAMES },
      },
      select: {
        challengeId: true,
        name: true,
      },
    })
    : [];

  const challengeRowsByLegacyRoundId = new Map();
  challengeRows.forEach((row) => {
    const legacyRoundId = String(row.legacyId);
    if (!challengeRowsByLegacyRoundId.has(legacyRoundId)) {
      challengeRowsByLegacyRoundId.set(legacyRoundId, []);
    }
    challengeRowsByLegacyRoundId.get(legacyRoundId).push(row);
  });

  const phaseRowsByChallengeId = new Map();
  phaseRows.forEach((row) => {
    if (!phaseRowsByChallengeId.has(row.challengeId)) {
      phaseRowsByChallengeId.set(row.challengeId, []);
    }
    phaseRowsByChallengeId.get(row.challengeId).push(row);
  });

  roundIds.forEach((roundId) => {
    const candidates = challengeRowsByLegacyRoundId.get(roundId) || [];
    if (candidates.length === 0) {
      byRoundId.set(roundId, buildDefaultExistingStateEntry(roundId));
      return;
    }

    if (candidates.length > 1) {
      byRoundId.set(roundId, {
        legacyRoundId: roundId,
        matchStatus: "ambiguous",
        reason: "existing-v6-challenge-match-ambiguous",
        challengeId: null,
        existing: normalizeExistingCounts(),
      });
      return;
    }

    const [candidate] = candidates;
    const candidatePhaseRows = phaseRowsByChallengeId.get(candidate.id) || [];

    if (candidate.typeId !== marathonTypeId || candidate.trackId !== dataScienceTrackId) {
      byRoundId.set(roundId, {
        legacyRoundId: roundId,
        matchStatus: "unsafe",
        reason: "matched-v6-challenge-not-marathon-match-data-science",
        challengeId: candidate.id,
        existing: normalizeExistingCounts(),
      });
      return;
    }
    if (hasDuplicateStandardPhase(candidatePhaseRows)) {
      byRoundId.set(roundId, {
        legacyRoundId: roundId,
        matchStatus: "unsafe",
        reason: "matched-v6-challenge-has-duplicate-standard-phases",
        challengeId: candidate.id,
        existing: normalizeExistingCounts(),
      });
      return;
    }

    const snapshotEntry = snapshotByRoundId.get(roundId);
    const snapshotCounts = normalizeSnapshotCountsForChallenge(snapshotEntry, candidate.id);
    byRoundId.set(roundId, {
      legacyRoundId: roundId,
      matchStatus: "safe",
      reason: "existing-v6-challenge-found",
      challengeId: candidate.id,
      existing: {
        phases: candidatePhaseRows.length,
        resources: snapshotCounts.resources,
        submissions: snapshotCounts.submissions,
        finalScores: snapshotCounts.finalScores,
        provisionalScores: snapshotCounts.provisionalScores,
      },
    });
  });

  return byRoundId;
};

const loadExistingState = (baseDir, filePath) => {
  if (!filePath) {
    return new Map();
  }

  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Existing state file not found: ${resolvedPath}`);
  }

  const raw = fs.readFileSync(resolvedPath, "utf8");
  const payload = safeParseObject(raw, resolvedPath);
  const entries = entriesFromPayload(payload);
  const byRoundId = new Map();
  entries.forEach((entry) => {
    byRoundId.set(entry.legacyRoundId, entry);
  });
  return byRoundId;
};

module.exports = {
  loadExistingState,
  buildExistingStateByRoundId,
};
