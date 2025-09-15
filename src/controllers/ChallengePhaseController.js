/**
 * Controller for challenge phase endpoints
 */
const service = require("../services/ChallengePhaseService");

/**
 * Get all challenge phases
 * @param {Object} req the request
 * @param {Object} res the response
 */
async function getAllChallengePhases(req, res) {
  const result = await service.getAllChallengePhases(req.params.challengeId);
  res.send(result);
}

/**
 * Get challenge phase
 * @param {Object} req the request
 * @param {Object} res the response
 */
async function getChallengePhase(req, res) {
  const result = await service.getChallengePhase(req.params.challengeId, req.params.id);
  res.send(result);
}

/**
 * Partially update challenge phase
 * @param {Object} req the request
 * @param {Object} res the response
 */
async function partiallyUpdateChallengePhase(req, res) {
  const result = await service.partiallyUpdateChallengePhase(
    req.authUser,
    req.params.challengeId,
    req.params.id,
    req.body
  );
  res.send(result);
}

/**
 * Delete challenge phase
 * @param {Object} req the request
 * @param {Object} res the response
 */
async function deleteChallengePhase(req, res) {
  const result = await service.deleteChallengePhase(
    req.authUser,
    req.params.challengeId,
    req.params.id
  );
  res.send(result);
}

module.exports = {
  getAllChallengePhases,
  getChallengePhase,
  partiallyUpdateChallengePhase,
  deleteChallengePhase,
};
