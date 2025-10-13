/**
 * This service provides operations of challenge phases.
 */
const _ = require("lodash");
const Joi = require("joi");
const moment = require("moment");
const { Prisma } = require("@prisma/client");
const config = require("config");
const helper = require("../common/helper");
const logger = require("../common/logger");
const errors = require("../common/errors");
const constants = require("../../app-constants");
const { getReviewClient } = require("../common/review-prisma");

const { getClient } = require("../common/prisma");
const prisma = getClient();
const PENDING_REVIEW_STATUSES = Object.freeze(["PENDING", "IN_PROGRESS", "DRAFT", "SUBMITTED"]);

async function hasPendingScorecardsForPhase(challengePhaseId) {
  if (!config.REVIEW_DB_URL) {
    logger.debug(
      `Skipping pending scorecard check for phase ${challengePhaseId} because REVIEW_DB_URL is not configured`
    );
    return false;
  }

  const reviewPrisma = getReviewClient();
  const reviewSchema = config.REVIEW_DB_SCHEMA;
  const reviewTable = Prisma.raw(`"${reviewSchema}"."review"`);
  const statusText = Prisma.raw(`"status"::text`);

  const pendingStatusClause =
    PENDING_REVIEW_STATUSES.length > 0
      ? Prisma.sql`${statusText} IN (${Prisma.join(
          PENDING_REVIEW_STATUSES.map((status) => Prisma.sql`${status}`)
        )})`
      : Prisma.sql`FALSE`;

  let rows;
  try {
    rows = await reviewPrisma.$queryRaw(
      Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM ${reviewTable}
        WHERE "phaseId" = ${challengePhaseId}
          AND (
            "status" IS NULL
            OR ${pendingStatusClause}
          )
      `
    );
  } catch (err) {
    logger.error(
      `Failed to check pending scorecards for phase ${challengePhaseId}: ${err.message}`,
      err
    );
    throw err;
  }

  const [{ count = 0 } = {}] = rows || [];
  return Number(count) > 0;
}

async function checkChallengeExists(challengeId) {
  const challenge = await prisma.challenge.findUnique({ where: { id: challengeId } });
  if (!challenge) {
    throw new errors.NotFoundError(`Challenge with id: ${challengeId} doesn't exist`);
  }
}

/**
 * Get all phase information for that challenge
 * @param {String} challengeId the challenge id
 * @returns {[Object]} the list of challenge phase
 */
async function getAllChallengePhases(challengeId) {
  await checkChallengeExists(challengeId);
  const result = await prisma.challengePhase.findMany({
    where: { challengeId },
    include: { phase: true, constraints: true },
  });

  return _.map(result, (obj) => {
    const ret = _.omit(obj, constants.auditFields);
    ret.phase = _.omit(obj.phase, constants.auditFields);
    ret.constraints = _.map(obj.constraints, (constraint) =>
      _.omit(constraint, constants.auditFields)
    );
    return ret;
  });
}

getAllChallengePhases.schema = {
  challengeId: Joi.id(),
};

/**
 * Get challenge phase.
 * @param {String} challengeId the challenge id
 * @param {String} id the challenge phase id
 * @returns {Object} the challengePhase with given challengeId and id
 */
async function getChallengePhase(challengeId, id) {
  await checkChallengeExists(challengeId);
  const result = await prisma.challengePhase.findFirst({
    where: { challengeId, id },
    include: { phase: true, constraints: true },
  });
  if (!result) {
    throw new errors.NotFoundError(
      `ChallengePhase with challengeId: ${challengeId},  phaseId: ${id} doesn't exist`
    );
  }
  const ret = _.omit(result, constants.auditFields);
  ret.phase = _.omit(result.phase, constants.auditFields);
  ret.constraints = _.map(result.constraints, (constraint) => _.omit(constraint));
  return ret;
}

getChallengePhase.schema = {
  challengeId: Joi.id(),
  id: Joi.id(),
};

/**
 * Partially update challenge phase
 * @param {Object} currentUser the user who perform operation
 * @param {String} challengeId the challenge id
 * @param {String} id the phase id
 * @returns {Object} the updated challengePhase
 */
async function partiallyUpdateChallengePhase(currentUser, challengeId, id, data) {
  await checkChallengeExists(challengeId);
  const challengePhase = await prisma.challengePhase.findFirst({
    where: { challengeId, id },
    include: { constraints: true },
  });
  if (!challengePhase) {
    throw new errors.NotFoundError(
      `ChallengePhase with challengeId: ${challengeId},  phaseId: ${id} doesn't exist`
    );
  }
  // isOpen should be false if it's passed as null
  if ("isOpen" in data) {
    if (!data["isOpen"]) {
      data["isOpen"] = false;
    }
  }

  // check ChallengePhase data
  if (data["phaseId"]) {
    const phase = await prisma.phase.findUnique({ where: { id: data["phaseId"] } });
    if (!phase) {
      throw new errors.BadRequestError(`phaseId should be a valid phase`);
    }
  }

  if (data["predecessor"]) {
    const predecessor = await prisma.challengePhase.findFirst({
      where: { challengeId, id: data["predecessor"] },
    });
    if (!predecessor) {
      throw new errors.BadRequestError(
        `predecessor should be a valid challenge phase in the same challenge: ${challengeId}`
      );
    }
  }

  if (data["scheduledStartDate"] || data["scheduledEndDate"]) {
    const startDate = data["scheduledStartDate"] || challengePhase.scheduledStartDate;
    const endDate = data["scheduledEndDate"] || challengePhase.scheduledEndDate;
    if (moment(startDate).isAfter(moment(endDate))) {
      throw new errors.BadRequestError(
        `scheduledStartDate: ${startDate.toISOString()} should not be after scheduledEndDate: ${endDate.toISOString()}`
      );
    }
  }

  if (data["actualStartDate"] || data["actualEndDate"]) {
    const startDate = data["actualStartDate"] || challengePhase.actualStartDate;
    const endDate = data["actualEndDate"] || challengePhase.actualEndDate;
    if (moment(startDate).isAfter(moment(endDate))) {
      throw new errors.BadRequestError(
        `actualStartDate: ${startDate.toISOString()} should not be after actualEndDate: ${endDate.toISOString()}`
      );
    }
  }

  if (data["constraints"] && data["constraints"].length > 0) {
    for (const constrain of data["constraints"]) {
      if (constrain.id && !challengePhase.constraints.some((cst) => cst.id === constrain.id)) {
        throw new errors.BadRequestError(
          `constraint: ${constrain.id} is not exists for the ChallengePhase`
        );
      }
    }
  }

  const isClosingPhase =
    "isOpen" in data && data["isOpen"] === false && Boolean(challengePhase.isOpen);
  const isReopeningPhase =
    "isOpen" in data && data["isOpen"] === true && !challengePhase.isOpen;
  if (isClosingPhase) {
    const pendingScorecards = await hasPendingScorecardsForPhase(challengePhase.id);
    if (pendingScorecards) {
      const phaseName = challengePhase.name || "phase";
      throw new errors.ForbiddenError(
        `Cannot close ${phaseName} because there are still pending scorecards`
      );
    }
  }
  if (isReopeningPhase) {
    data.actualEndDate = null;
  }

  // Update ChallengePhase
  data.updatedBy = String(currentUser.userId);
  if (!_.isNil(data.duration)) {
    const startInput = !_.isNil(data.scheduledStartDate)
      ? data.scheduledStartDate
      : !_.isNil(challengePhase.scheduledStartDate)
      ? challengePhase.scheduledStartDate
      : null;
    if (startInput) {
      const startDate = new Date(startInput);
      if (!Number.isNaN(startDate.getTime())) {
        const recalculatedScheduledEndDate = new Date(
          startDate.getTime() + Number(data.duration) * 1000
        );
        data.scheduledEndDate = recalculatedScheduledEndDate;
      }
    }
  }
  const dataToUpdate = _.omit(data, "constraints");
  const result = await prisma.$transaction(async (tx) => {
    const result = await tx.challengePhase.update({
      data: dataToUpdate,
      where: {
        id: challengePhase.id,
      },
    });
    if (data["constraints"]) {
      for (const constraint of data["constraints"]) {
        if (constraint.id) {
          await tx.challengePhaseConstraint.update({
            data: {
              name: constraint.name,
              value: constraint.value,
              updatedBy: String(currentUser.userId),
            },
            where: {
              id: constraint.id,
            },
          });
        } else {
          await tx.challengePhaseConstraint.create({
            data: {
              name: constraint.name,
              value: constraint.value,
              challengePhaseId: result.id,
              createdBy: String(currentUser.userId),
              updatedBy: String(currentUser.userId),
            },
          });
        }
      }
    }
    return result;
  });
  helper.flushInternalCache();
  // post bus event
  await helper.postBusEvent(
    constants.Topics.ChallengePhaseUpdated,
    _.assignIn({ id: result.id }, data)
  );
  return _.omit(result, constants.auditFields);
}

partiallyUpdateChallengePhase.schema = {
  currentUser: Joi.any(),
  challengeId: Joi.id(),
  id: Joi.id(),
  data: Joi.object().keys({
    challengeId: Joi.any().forbidden(),
    name: Joi.string().trim().min(1).optional(),
    isOpen: Joi.boolean().allow(null).optional(),
    phaseId: Joi.id().optional(),
    predecessor: Joi.id().optional(),
    duration: Joi.number().integer().min(1).optional(),
    scheduledStartDate: Joi.date().iso().optional(),
    scheduledEndDate: Joi.date().iso().optional(),
    actualStartDate: Joi.date().iso().optional(),
    actualEndDate: Joi.date().iso().optional(),
    description: Joi.string().optional(),
    constraints: Joi.array()
      .items(
        Joi.object({
          id: Joi.any().optional(),
          name: Joi.string().required(),
          value: Joi.number().integer().min(0).required(),
        })
      )
      .optional(),
  }),
};

/**
 * Delete challenge phase.
 * @param {Object} currentUser the user who perform operation
 * @param {String} challengeId the challenge id
 * @param {String} id the phase id
 * @returns {Object} the deleted challenge phase
 */
async function deleteChallengePhase(currentUser, challengeId, id) {
  await checkChallengeExists(challengeId);
  const result = await prisma.challengePhase.findFirst({
    where: { challengeId, id },
  });
  if (!result) {
    throw new errors.NotFoundError(
      `ChallengePhase with challengeId: ${challengeId},  phaseId: ${id} doesn't exist`
    );
  }
  await prisma.$transaction(async (tx) => {
    // recalculates the predecessors
    await tx.challengePhase.updateMany({
      data: {
        // if result.predecessor exists, update successor's predecessor to predecessor of current challenge phase
        // otherwise update successor's predecessor to null
        predecessor: result.predecessor || null,
        updatedBy: String(currentUser.userId),
      },
      where: {
        challengeId,
        predecessor: result.id,
      },
    });
    // delete challengePhaseConstraint
    await tx.challengePhaseConstraint.deleteMany({
      where: {
        challengePhaseId: result.id,
      },
    });
    // delete challengePhase
    await tx.challengePhase.delete({
      where: {
        id: result.id,
      },
    });
  });
  helper.flushInternalCache();
  const ret = _.omit(result, constants.auditFields);
  // post bus event
  await helper.postBusEvent(constants.Topics.ChallengePhaseDeleted, ret);
  return ret;
}

deleteChallengePhase.schema = {
  currentUser: Joi.any(),
  challengeId: Joi.id(),
  id: Joi.id(),
};

module.exports = {
  getAllChallengePhases,
  getChallengePhase,
  partiallyUpdateChallengePhase,
  deleteChallengePhase,
};

logger.buildService(module.exports);
