/**
 * Controller for default challenge reviewer endpoints.
 */
const HttpStatus = require("http-status-codes");
const service = require("../services/DefaultChallengeReviewerService");
const helper = require("../common/helper");

/**
 * Search default challenge reviewers.
 *
 * @param {Object} req the request
 * @param {Object} res the response
 */
async function searchDefaultChallengeReviewers(req, res) {
  const result = await service.searchDefaultChallengeReviewers(req.query);
  helper.setResHeaders(req, res, result);
  res.send(result.result);
}

/**
 * Create default challenge reviewer.
 *
 * @param {Object} req the request
 * @param {Object} res the response
 */
async function createDefaultChallengeReviewer(req, res) {
  const result = await service.createDefaultChallengeReviewer(req.authUser, req.body);
  res.status(HttpStatus.CREATED).send(result);
}

/**
 * Get default challenge reviewer.
 *
 * @param {Object} req the request
 * @param {Object} res the response
 */
async function getDefaultChallengeReviewer(req, res) {
  const result = await service.getDefaultChallengeReviewer(
    req.params.defaultChallengeReviewerId
  );
  res.send(result);
}

/**
 * Fully update default challenge reviewer.
 *
 * @param {Object} req the request
 * @param {Object} res the response
 */
async function fullyUpdateDefaultChallengeReviewer(req, res) {
  const result = await service.fullyUpdateDefaultChallengeReviewer(
    req.authUser,
    req.params.defaultChallengeReviewerId,
    req.body
  );
  res.send(result);
}

/**
 * Partially update default challenge reviewer.
 *
 * @param {Object} req the request
 * @param {Object} res the response
 */
async function partiallyUpdateDefaultChallengeReviewer(req, res) {
  const result = await service.partiallyUpdateDefaultChallengeReviewer(
    req.authUser,
    req.params.defaultChallengeReviewerId,
    req.body
  );
  res.send(result);
}

/**
 * Delete default challenge reviewer.
 *
 * @param {Object} req the request
 * @param {Object} res the response
 */
async function deleteDefaultChallengeReviewer(req, res) {
  const result = await service.deleteDefaultChallengeReviewer(
    req.params.defaultChallengeReviewerId
  );
  res.send(result);
}

module.exports = {
  searchDefaultChallengeReviewers,
  createDefaultChallengeReviewer,
  getDefaultChallengeReviewer,
  fullyUpdateDefaultChallengeReviewer,
  partiallyUpdateDefaultChallengeReviewer,
  deleteDefaultChallengeReviewer,
};

