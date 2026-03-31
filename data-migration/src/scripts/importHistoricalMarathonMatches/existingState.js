"use strict";

const fs = require("fs");
const path = require("path");

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
};
