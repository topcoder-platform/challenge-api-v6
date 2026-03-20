/**
 * Helper module for triggering Challenge Review Context generation
 * via tc-ai-api workflow and saving results to review-api.
 */

const _ = require("lodash");
const config = require("config");
const axios = require("axios");
const logger = require("./logger");
const m2mHelper = require("./m2m-helper");
const {
  getRunId,
  markGenerationStarted,
  setRunId,
  clearGeneration,
} = require("./review-context-generation-guard");

const WORKFLOW_POLL_INTERVAL_MS = 10000;
const WORKFLOW_POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes max wait

/**
 * Check if a challenge has AI Review Config that requires context generation.
 * @param {Object} challenge - The challenge object with reviewers
 * @returns {boolean} - True if challenge has AI reviewers with aiWorkflowId
 */
function shouldGenerateChallengeReviewContext(challenge) {
  const reviewers = _.get(challenge, "reviewers", []);
  if (!Array.isArray(reviewers) || reviewers.length === 0) {
    return false;
  }
  return reviewers.some(
    (reviewer) => reviewer && !reviewer.isMemberReview && reviewer.aiWorkflowId,
  );
}

/**
 * Trigger challenge context generation in the background (fire-and-forget).
 * If a previous run is in progress, it will be cancelled first.
 * This function returns immediately and runs the actual work asynchronously.
 * @param {string} challengeId - The challenge ID
 */
function triggerChallengeReviewContextGeneration(challengeId) {
  const existingRunId = getRunId(challengeId);

  if (existingRunId) {
    logger.info(
      `[ChallengeReviewContextHelper] Cancelling existing run ${existingRunId} for challenge ${challengeId}`,
    );
    cancelWorkflowRun(existingRunId, "Challenge updated, regenerating context").catch((err) => {
      logger.warn(
        `[ChallengeReviewContextHelper] Failed to cancel run ${existingRunId}: ${err.message}`,
      );
    });
    clearGeneration(challengeId);
  }

  markGenerationStarted(challengeId);
  logger.info(
    `[ChallengeReviewContextHelper] Triggering context generation for challenge ${challengeId}`,
  );

  runReviewContextGenerationAsync(challengeId).catch((err) => {
    logger.error(
      `[ChallengeReviewContextHelper] Context generation failed for challenge ${challengeId}: ${err.message}`,
      err,
    );
    clearGeneration(challengeId);
  });
}

/**
 * Cancel a workflow run via tc-ai-api.
 * @param {string} runId - The workflow run ID to cancel
 * @param {string} message - Cancellation reason message
 */
async function cancelWorkflowRun(runId, message) {
  const tcAiApiUrl = _.trimEnd(config.TC_AI_API_URL, "/");
  const workflowId = "challenge-context";

  let token;
  try {
    token = await m2mHelper.getM2MToken();
  } catch (tokenErr) {
    logger.error(`[ChallengeReviewContextHelper] Failed to get M2M token for cancel: ${tokenErr.message}`);
    return;
  }

  const cancelUrl = `${tcAiApiUrl}/workflows/${workflowId}/runs/${runId}/cancel`;
  await axios.post(
    cancelUrl,
    { message },
    {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      timeout: 15000,
    },
  );
  logger.info(`[ChallengeReviewContextHelper] Cancelled workflow run ${runId}`);
}

/**
 * Internal async function that performs the actual context generation workflow.
 * @param {string} challengeId - The challenge ID
 */
async function runReviewContextGenerationAsync(challengeId) {
  const tcAiApiUrl = _.trimEnd(config.TC_AI_API_URL, "/");
  const reviewsApiUrl = _.trimEnd(config.REVIEWS_API_URL, "/");

  let token;
  try {
    token = await m2mHelper.getM2MToken();
  } catch (tokenErr) {
    logger.error(
      `[ChallengeReviewContextHelper] Failed to get M2M token for challenge ${challengeId}: ${tokenErr.message}`,
    );
    clearGeneration(challengeId);
    return;
  }

  const authHeader = { Authorization: `Bearer ${token}` };
  const workflowId = "challenge-context";

  // Step 1: Create the workflow run
  const createRunUrl = `${tcAiApiUrl}/workflows/${workflowId}/create-run`;
  let runId;

  try {
    logger.debug(
      `[ChallengeReviewContextHelper] Creating workflow run at ${createRunUrl} for challenge ${challengeId}`,
    );
    const createResponse = await axios.post(
      createRunUrl,
      {},
      {
        headers: { ...authHeader, "Content-Type": "application/json" },
        timeout: 30000,
      },
    );
    runId = _.get(createResponse, "data.runId");
    if (!runId) {
      throw new Error("No runId returned from workflow creation");
    }
    setRunId(challengeId, runId);
    logger.debug(
      `[ChallengeReviewContextHelper] Created run ${runId} for challenge ${challengeId}`,
    );
  } catch (createErr) {
    logger.error(
      `[ChallengeReviewContextHelper] Failed to create workflow run for challenge ${challengeId}: ${createErr.message}`,
    );
    clearGeneration(challengeId);
    return;
  }

  // Step 2: Start the run with input data
  const startRunUrl = `${tcAiApiUrl}/workflows/${workflowId}/start?runId=${runId}`;

  try {
    logger.debug(
      `[ChallengeReviewContextHelper] Starting workflow run ${runId} for challenge ${challengeId}`,
    );
    await axios.post(
      startRunUrl,
      { inputData: { challengeId } },
      { headers: { ...authHeader, "Content-Type": "application/json" }, timeout: 30000 },
    );
    logger.info(
      `[ChallengeReviewContextHelper] Workflow started for challenge ${challengeId}, runId: ${runId}`,
    );
  } catch (startErr) {
    logger.error(
      `[ChallengeReviewContextHelper] Failed to start workflow run for challenge ${challengeId}: ${startErr.message}`,
    );
    clearGeneration(challengeId);
    return;
  }

  // Step 3: Poll for workflow completion
  const workflowStatusUrl = `${tcAiApiUrl}/workflows/${workflowId}/runs/${runId}`;
  const startTime = Date.now();
  let workflowResult = null;

  while (Date.now() - startTime < WORKFLOW_POLL_TIMEOUT_MS) {
    try {
      await sleep(WORKFLOW_POLL_INTERVAL_MS);
      const statusResponse = await axios.get(workflowStatusUrl, {
        headers: authHeader,
        timeout: 15000,
      });
      const result = _.get(statusResponse, "data", {});
      const status = result.status;
      logger.debug(`[ChallengeReviewContextHelper] Workflow ${runId} status: ${status}`);

      if (status === "success") {
        workflowResult = result.result;
        break;
      } else if (status === "failed") {
        const errorMsg =
          _.get(result, "error.message") || _.get(result, "error") || "Workflow execution failed";
        throw new Error(`Workflow failed: ${errorMsg}`);
      }
    } catch (pollErr) {
      if (pollErr.message.includes("Workflow failed")) {
        throw pollErr;
      }
      // For network errors, log and continue polling
      logger.warn(
        `[ChallengeReviewContextHelper] Polling error for workflow ${runId}: ${pollErr.message}`,
      );
    }
  }

  if (!workflowResult) {
    logger.error(
      `[ChallengeReviewContextHelper] Workflow ${runId} timed out or returned no result for challenge ${challengeId}`,
    );
    clearGeneration(challengeId);
    return;
  }

  logger.info(
    `[ChallengeReviewContextHelper] Workflow completed for challenge ${challengeId}, saving context`,
  );

  // Step 3: Check if context already exists
  const contextGetUrl = `${reviewsApiUrl}/v6/ai-review/context/${challengeId}`;
  let existingContext = null;

  try {
    const getResponse = await axios.get(contextGetUrl, {
      headers: authHeader,
      timeout: 15000,
      validateStatus: (status) => status < 500,
    });
    if (getResponse.status === 200 && getResponse.data) {
      existingContext = getResponse.data;
    }
  } catch (getErr) {
    logger.debug(
      `[ChallengeReviewContextHelper] No existing context found for challenge ${challengeId}`,
    );
  }

  // Step 4: Save or update context in review-api
  const contextPayload = {
    challengeId,
    context: workflowResult,
  };

  try {
    if (existingContext) {
      const contextPutUrl = `${reviewsApiUrl}/v6/ai-review/context/${challengeId}`;
      await axios.put(contextPutUrl, contextPayload, {
        headers: { ...authHeader, "Content-Type": "application/json" },
        timeout: 30000,
      });
      logger.info(`[ChallengeReviewContextHelper] Updated context for challenge ${challengeId}`);
    } else {
      const contextPostUrl = `${reviewsApiUrl}/v6/ai-review/context`;
      await axios.post(contextPostUrl, contextPayload, {
        headers: { ...authHeader, "Content-Type": "application/json" },
        timeout: 30000,
      });
      logger.info(`[ChallengeReviewContextHelper] Created context for challenge ${challengeId}`);
    }
  } catch (saveErr) {
    logger.error(
      `[ChallengeReviewContextHelper] Failed to save context for challenge ${challengeId}: ${saveErr.message}`,
    );
    clearGeneration(challengeId);
    return;
  }

  clearGeneration(challengeId);
  logger.info(
    `[ChallengeReviewContextHelper] Context generation complete for challenge ${challengeId}`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  shouldGenerateChallengeReviewContext,
  triggerChallengeReviewContextGeneration,
};
