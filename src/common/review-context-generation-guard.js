/**
 * In-memory guard to prevent duplicate context generation triggers.
 * Tracks challengeId -> { timestamp, runId } of ongoing context generation.
 * Entries auto-expire after EXPIRY_MS to handle failed processes.
 */

const EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

const generationCache = new Map();

/**
 * Check if context generation is currently in progress for a challenge.
 * @param {string} challengeId - The challenge ID
 * @returns {boolean} - True if generation is in progress (started within EXPIRY_MS)
 */
function isGenerationInProgress(challengeId) {
  const entry = generationCache.get(challengeId);
  if (!entry) {
    return false;
  }
  const elapsed = Date.now() - entry.timestamp;
  if (elapsed > EXPIRY_MS) {
    generationCache.delete(challengeId);
    return false;
  }
  return true;
}

/**
 * Get the current runId for a challenge's in-progress generation.
 * @param {string} challengeId - The challenge ID
 * @returns {string|null} - The runId if in progress, null otherwise
 */
function getRunId(challengeId) {
  const entry = generationCache.get(challengeId);
  if (!entry) {
    return null;
  }
  const elapsed = Date.now() - entry.timestamp;
  if (elapsed > EXPIRY_MS) {
    generationCache.delete(challengeId);
    return null;
  }
  return entry.runId || null;
}

/**
 * Mark that context generation has started for a challenge.
 * @param {string} challengeId - The challenge ID
 * @param {string} runId - The workflow run ID (optional, can be set later)
 */
function markGenerationStarted(challengeId, runId = null) {
  generationCache.set(challengeId, { timestamp: Date.now(), runId });
}

/**
 * Update the runId for an in-progress generation.
 * @param {string} challengeId - The challenge ID
 * @param {string} runId - The workflow run ID
 */
function setRunId(challengeId, runId) {
  const entry = generationCache.get(challengeId);
  if (entry) {
    entry.runId = runId;
  }
}

/**
 * Clear the generation entry for a challenge (on completion or failure).
 * @param {string} challengeId - The challenge ID
 */
function clearGeneration(challengeId) {
  generationCache.delete(challengeId);
}

module.exports = {
  isGenerationInProgress,
  getRunId,
  markGenerationStarted,
  setRunId,
  clearGeneration,
};
