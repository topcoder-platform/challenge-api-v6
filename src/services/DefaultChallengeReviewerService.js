/**
 * This service provides operations for default challenge reviewers.
 */
const _ = require("lodash");
const Joi = require("joi");
const helper = require("../common/helper");
const logger = require("../common/logger");
const constants = require("../../app-constants");
const errors = require("../common/errors");

const prismaModule = require("../common/prisma");
const prisma = prismaModule.getClient();
const { ReviewOpportunityTypeEnum } = prismaModule;

const defaultInclude = {
  challengeType: true,
  challengeTrack: true,
  timelineTemplate: true,
  phase: true,
};

const reviewerIdSchema = Joi.string().trim().required();

/**
 * Normalize record by removing audit fields
 *
 * @param {Object} record the record to sanitize
 * @returns {Object} sanitized record
 */
function sanitize(record) {
  if (!record) {
    return record;
  }
  const result = _.omit(record, constants.auditFields);

  if (record.challengeType) {
    result.challengeType = _.omit(record.challengeType, constants.auditFields);
  }
  if (record.challengeTrack) {
    result.challengeTrack = _.omit(record.challengeTrack, constants.auditFields);
  }
  if (record.timelineTemplate) {
    result.timelineTemplate = _.omit(record.timelineTemplate, constants.auditFields);
  }
  if (record.phase) {
    result.phase = _.omit(record.phase, constants.auditFields);
  }
  return result;
}

/**
 * Build search filter for prisma query.
 *
 * @param {Object} criteria search criteria
 * @returns {Object} prisma filter
 */
function getSearchFilter(criteria = {}) {
  const filter = {};

  if (!_.isEmpty(criteria.typeId)) {
    filter.typeId = { equals: criteria.typeId };
  }
  if (!_.isEmpty(criteria.trackId)) {
    filter.trackId = { equals: criteria.trackId };
  }
  if (!_.isUndefined(criteria.timelineTemplateId)) {
    filter.timelineTemplateId = _.isNil(criteria.timelineTemplateId)
      ? { equals: null }
      : { equals: criteria.timelineTemplateId };
  }
  if (!_.isEmpty(criteria.phaseName)) {
    filter.phaseName = { equals: criteria.phaseName };
  }
  if (!_.isEmpty(criteria.scorecardId)) {
    filter.scorecardId = { equals: criteria.scorecardId };
  }

  return filter;
}

/**
 * Search default challenge reviewers.
 *
 * @param {Object} criteria search criteria
 * @returns {Promise<Object>} paginated result
 */
async function searchDefaultChallengeReviewers(criteria = {}) {
  const searchFilter = getSearchFilter(_.omit(criteria, ["page", "perPage"]));

  const page = criteria.page || 1;
  const perPage = criteria.perPage || 50;

  const [total, rows] = await Promise.all([
    prisma.defaultChallengeReviewer.count({ where: searchFilter }),
    prisma.defaultChallengeReviewer.findMany({
      where: searchFilter,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: defaultInclude,
    }),
  ]);

  return {
    total,
    page,
    perPage,
    result: _.map(rows, sanitize),
  };
}

searchDefaultChallengeReviewers.schema = {
  criteria: Joi.object().keys({
    page: Joi.page(),
    perPage: Joi.perPage().default(50),
    typeId: Joi.optionalId(),
    trackId: Joi.optionalId(),
    timelineTemplateId: Joi.optionalId().allow(null),
    phaseName: Joi.string(),
    scorecardId: Joi.string(),
  }),
};

/**
 * Ensure related entities exist.
 *
 * @param {Object} data payload
 * @param {Boolean} isPartial indicates partial update
 */
async function validateRelatedEntities(data = {}, isPartial = false) {
  const validations = [];

  const shouldValidate = (value) => (!isPartial || !_.isUndefined(value));

  if (shouldValidate(data.typeId)) {
    validations.push(
      prisma.challengeType.findUnique({ where: { id: data.typeId } }).then((res) => {
        if (!res) {
          throw new errors.NotFoundError(`ChallengeType with id: ${data.typeId} doesn't exist`);
        }
      })
    );
  }

  if (shouldValidate(data.trackId)) {
    validations.push(
      prisma.challengeTrack.findUnique({ where: { id: data.trackId } }).then((res) => {
        if (!res) {
          throw new errors.NotFoundError(`ChallengeTrack with id: ${data.trackId} doesn't exist`);
        }
      })
    );
  }

  if (shouldValidate(data.timelineTemplateId) && !_.isNil(data.timelineTemplateId)) {
    validations.push(
      prisma.timelineTemplate.findUnique({ where: { id: data.timelineTemplateId } }).then((res) => {
        if (!res) {
          throw new errors.NotFoundError(
            `TimelineTemplate with id: ${data.timelineTemplateId} doesn't exist`
          );
        }
      })
    );
  }

  let phaseByName;
  if (shouldValidate(data.phaseName) && !_.isEmpty(data.phaseName)) {
    validations.push(
      prisma.phase.findUnique({ where: { name: data.phaseName } }).then((res) => {
        if (!res) {
          throw new errors.BadRequestError(`Invalid phaseName: ${data.phaseName}`);
        }
        phaseByName = res;
      })
    );
  }

  let phaseById;
  if (shouldValidate(data.phaseId) && !_.isNil(data.phaseId)) {
    validations.push(
      prisma.phase.findUnique({ where: { id: data.phaseId } }).then((res) => {
        if (!res) {
          throw new errors.NotFoundError(`Phase with id: ${data.phaseId} doesn't exist`);
        }
        phaseById = res;
      })
    );
  }

  await Promise.all(validations);

  if (phaseByName && phaseById && phaseByName.id !== phaseById.id) {
    throw new errors.BadRequestError(
      `phaseId ${phaseById.id} does not match phaseName ${phaseByName.name}`
    );
  }

  return { phaseByName, phaseById };
}

/**
 * Normalize payload values for persistence.
 *
 * @param {Object} data incoming data
 * @param {Boolean} isPartial whether payload is partial
 * @returns {Object} normalized data
 */
function normalizePayload(data = {}, isPartial = false) {
  const normalized = {};

  const shouldAssign = (value) => (!isPartial || !_.isUndefined(value));

  const toNullableId = (value) => (_.isNil(value) ? null : value);
  const toNullableInteger = (value) => (_.isNil(value) ? null : Number(value));
  const toNullableNumber = (value) => (_.isNil(value) ? null : Number(value));
  const toOpportunityType = (value) => (_.isNil(value) ? null : _.toUpper(value));

  if (shouldAssign(data.typeId)) {
    normalized.typeId = data.typeId;
  }
  if (shouldAssign(data.trackId)) {
    normalized.trackId = data.trackId;
  }
  if (shouldAssign(data.timelineTemplateId)) {
    normalized.timelineTemplateId = toNullableId(data.timelineTemplateId);
  }
  if (shouldAssign(data.scorecardId)) {
    normalized.scorecardId = _.isNil(data.scorecardId) ? null : String(data.scorecardId);
  }
  if (shouldAssign(data.isMemberReview)) {
    normalized.isMemberReview = data.isMemberReview;
  }
  if (shouldAssign(data.memberReviewerCount)) {
    normalized.memberReviewerCount = toNullableInteger(data.memberReviewerCount);
  } else if (!isPartial && _.isNil(data.memberReviewerCount)) {
    normalized.memberReviewerCount = null;
  }
  if (shouldAssign(data.phaseName)) {
    normalized.phaseName = data.phaseName;
  }
  if (shouldAssign(data.phaseId)) {
    normalized.phaseId = toNullableId(data.phaseId);
  }
  if (shouldAssign(data.fixedAmount)) {
    normalized.fixedAmount = toNullableNumber(data.fixedAmount);
  } else if (!isPartial && _.isNil(data.fixedAmount)) {
    normalized.fixedAmount = null;
  }
  if (shouldAssign(data.baseCoefficient)) {
    normalized.baseCoefficient = toNullableNumber(data.baseCoefficient);
  } else if (!isPartial && _.isNil(data.baseCoefficient)) {
    normalized.baseCoefficient = null;
  }
  if (shouldAssign(data.incrementalCoefficient)) {
    normalized.incrementalCoefficient = toNullableNumber(data.incrementalCoefficient);
  } else if (!isPartial && _.isNil(data.incrementalCoefficient)) {
    normalized.incrementalCoefficient = null;
  }
  if (shouldAssign(data.opportunityType)) {
    normalized.opportunityType = toOpportunityType(data.opportunityType);
  } else if (!isPartial && _.isNil(data.opportunityType)) {
    normalized.opportunityType = null;
  }
  if (shouldAssign(data.aiWorkflowId)) {
    normalized.aiWorkflowId = data.aiWorkflowId;
  }
  if (shouldAssign(data.shouldOpenOpportunity)) {
    normalized.shouldOpenOpportunity = data.shouldOpenOpportunity;
  }

  return normalized;
}

/**
 * Create a default challenge reviewer.
 *
 * @param {Object} authUser authenticated user
 * @param {Object} data payload
 * @returns {Promise<Object>} created record
 */
async function createDefaultChallengeReviewer(authUser, data) {
  const references = await validateRelatedEntities(data);

  const userId = _.toString(authUser && authUser.userId ? authUser.userId : "system");
  const payload = normalizePayload(data);
  if (references.phaseById) {
    payload.phaseName = references.phaseById.name;
  } else if (references.phaseByName) {
    payload.phaseName = references.phaseByName.name;
  }
  payload.createdBy = userId;
  payload.updatedBy = userId;

  const duplicate = await prisma.defaultChallengeReviewer.findFirst({
    where: {
      typeId: payload.typeId,
      trackId: payload.trackId,
      timelineTemplateId: payload.timelineTemplateId,
      phaseName: payload.phaseName,
      scorecardId: payload.scorecardId,
      isMemberReview: payload.isMemberReview,
    },
  });
  if (duplicate) {
    throw new errors.ConflictError(
      "A default challenge reviewer already exists for the specified combination"
    );
  }

  let ret = await prisma.defaultChallengeReviewer.create({
    data: payload,
    include: defaultInclude,
  });

  ret = sanitize(ret);
  await helper.postBusEvent(constants.Topics.DefaultChallengeReviewerCreated, ret);
  return ret;
}

createDefaultChallengeReviewer.schema = {
  authUser: Joi.any(),
  data: Joi.object()
    .keys({
      typeId: Joi.id().required(),
      trackId: Joi.id().required(),
      timelineTemplateId: Joi.optionalId().allow(null),
      scorecardId: Joi.string().required(),
      isMemberReview: Joi.boolean().required(),
      memberReviewerCount: Joi.when("isMemberReview", {
        is: true,
        then: Joi.number().integer().min(1).required(),
        otherwise: Joi.valid(null),
      }),
      phaseName: Joi.string().required(),
      phaseId: Joi.optionalId().allow(null),
      fixedAmount: Joi.number().min(0).allow(null),
      baseCoefficient: Joi.number().min(0).max(1).allow(null),
      incrementalCoefficient: Joi.number().min(0).max(1).allow(null),
      opportunityType: Joi.string().valid(..._.values(ReviewOpportunityTypeEnum)).insensitive(),
      aiWorkflowId: Joi.when("isMemberReview", {
        is: false,
        then: Joi.string().required(),
        otherwise: Joi.valid(null),
      }),
      shouldOpenOpportunity: Joi.boolean().required(),
    })
    .required(),
};

/**
 * Retrieve a default challenge reviewer by id.
 *
 * @param {String} id record id
 * @returns {Promise<Object>} default challenge reviewer
 */
async function getDefaultChallengeReviewer(id) {
  const ret = await prisma.defaultChallengeReviewer.findUnique({
    where: { id },
    include: defaultInclude,
  });
  if (!ret || _.isUndefined(ret.id)) {
    throw new errors.NotFoundError(`DefaultChallengeReviewer with id: ${id} doesn't exist`);
  }
  return sanitize(ret);
}

getDefaultChallengeReviewer.schema = {
  id: reviewerIdSchema,
};

/**
 * Fully update a default challenge reviewer.
 *
 * @param {Object} authUser authenticated user
 * @param {String} id record id
 * @param {Object} data payload
 * @returns {Promise<Object>} updated record
 */
async function fullyUpdateDefaultChallengeReviewer(authUser, id, data) {
  await getDefaultChallengeReviewer(id);
  const references = await validateRelatedEntities(data);

  const payload = normalizePayload(data);
  if (references.phaseById) {
    payload.phaseName = references.phaseById.name;
  } else if (references.phaseByName) {
    payload.phaseName = references.phaseByName.name;
  }
  payload.updatedBy = _.toString(authUser && authUser.userId ? authUser.userId : "system");

  let ret = await prisma.defaultChallengeReviewer.update({
    where: { id },
    data: payload,
    include: defaultInclude,
  });

  ret = sanitize(ret);
  await helper.postBusEvent(constants.Topics.DefaultChallengeReviewerUpdated, ret);
  return ret;
}

fullyUpdateDefaultChallengeReviewer.schema = {
  authUser: Joi.any(),
  id: reviewerIdSchema,
  data: Joi.object()
    .keys({
      typeId: Joi.id().required(),
      trackId: Joi.id().required(),
      timelineTemplateId: Joi.optionalId().allow(null),
      scorecardId: Joi.string().required(),
      isMemberReview: Joi.boolean().required(),
      memberReviewerCount: Joi.when("isMemberReview", {
        is: true,
        then: Joi.number().integer().min(1).required(),
        otherwise: Joi.valid(null),
      }),
      phaseName: Joi.string().required(),
      phaseId: Joi.optionalId().allow(null),
      fixedAmount: Joi.number().min(0).allow(null),
      baseCoefficient: Joi.number().min(0).max(1).allow(null),
      incrementalCoefficient: Joi.number().min(0).max(1).allow(null),
      opportunityType: Joi.string().valid(..._.values(ReviewOpportunityTypeEnum)).insensitive(),
      aiWorkflowId: Joi.when("isMemberReview", {
        is: false,
        then: Joi.string().required(),
        otherwise: Joi.valid(null),
      }),
      shouldOpenOpportunity: Joi.boolean().required(),
    })
    .required(),
};

/**
 * Partially update a default challenge reviewer.
 *
 * @param {Object} authUser authenticated user
 * @param {String} id record id
 * @param {Object} data payload
 * @returns {Promise<Object>} updated record
 */
async function partiallyUpdateDefaultChallengeReviewer(authUser, id, data) {
  const existing = await getDefaultChallengeReviewer(id);
  const references = await validateRelatedEntities(data, true);

  const payload = normalizePayload(data, true);
  if (_.isUndefined(data.phaseName) && !_.isUndefined(data.phaseId) && references.phaseById) {
    payload.phaseName = references.phaseById.name;
  }

  const targetIsMemberReview = !_.isUndefined(data.isMemberReview)
    ? data.isMemberReview
    : existing.isMemberReview;
  const memberCountProvided = _.has(data, "memberReviewerCount");
  const opportunityTypeProvided = _.has(data, "opportunityType");

  if (targetIsMemberReview) {
    if (memberCountProvided) {
      if (_.isNil(data.memberReviewerCount)) {
        throw new errors.BadRequestError(
          "memberReviewerCount cannot be null when isMemberReview is true"
        );
      }
    } else if (_.isNil(existing.memberReviewerCount)) {
      throw new errors.BadRequestError(
        "memberReviewerCount must be provided when isMemberReview is true"
      );
    }
  } else {
    if (memberCountProvided && !_.isNil(data.memberReviewerCount)) {
      throw new errors.BadRequestError(
        "memberReviewerCount is only allowed when isMemberReview is true"
      );
    }
    if (opportunityTypeProvided && !_.isNil(data.opportunityType)) {
      throw new errors.BadRequestError(
        "opportunityType is only allowed when isMemberReview is true"
      );
    }
  }

  if (!targetIsMemberReview) {
    if (memberCountProvided || data.isMemberReview === false) {
      payload.memberReviewerCount = null;
    }
    if (opportunityTypeProvided || data.isMemberReview === false) {
      payload.opportunityType = null;
    }
  }

  payload.updatedBy = _.toString(authUser && authUser.userId ? authUser.userId : "system");

  let ret = await prisma.defaultChallengeReviewer.update({
    where: { id },
    data: payload,
    include: defaultInclude,
  });

  ret = sanitize(ret);
  await helper.postBusEvent(
    constants.Topics.DefaultChallengeReviewerUpdated,
    _.assignIn({ id }, _.omit(payload, ["updatedBy"]))
  );
  return ret;
}

partiallyUpdateDefaultChallengeReviewer.schema = {
  authUser: Joi.any(),
  id: reviewerIdSchema,
  data: Joi.object()
    .keys({
      typeId: Joi.optionalId(),
      trackId: Joi.optionalId(),
      timelineTemplateId: Joi.optionalId().allow(null),
      scorecardId: Joi.string(),
      isMemberReview: Joi.boolean(),
      memberReviewerCount: Joi.number().integer().min(1).allow(null),
      phaseName: Joi.string(),
      phaseId: Joi.optionalId().allow(null),
      fixedAmount: Joi.number().min(0).allow(null),
      baseCoefficient: Joi.number().min(0).max(1).allow(null),
      incrementalCoefficient: Joi.number().min(0).max(1).allow(null),
      opportunityType: Joi.string()
        .valid(..._.values(ReviewOpportunityTypeEnum))
        .insensitive()
        .allow(null),
      aiWorkflowId: Joi.string(),
      shouldOpenOpportunity: Joi.boolean(),
    })
    .required(),
};

/**
 * Delete a default challenge reviewer.
 *
 * @param {String} id record id
 * @returns {Promise<Object>} deleted record
 */
async function deleteDefaultChallengeReviewer(id) {
  const existing = await prisma.defaultChallengeReviewer.findUnique({
    where: { id },
    include: defaultInclude,
  });
  if (!existing || _.isUndefined(existing.id)) {
    throw new errors.NotFoundError(`DefaultChallengeReviewer with id: ${id} doesn't exist`);
  }

  await prisma.defaultChallengeReviewer.delete({ where: { id } });

  const ret = sanitize(existing);
  await helper.postBusEvent(constants.Topics.DefaultChallengeReviewerDeleted, ret);
  return ret;
}

deleteDefaultChallengeReviewer.schema = {
  id: reviewerIdSchema,
};

module.exports = {
  searchDefaultChallengeReviewers,
  createDefaultChallengeReviewer,
  getDefaultChallengeReviewer,
  fullyUpdateDefaultChallengeReviewer,
  partiallyUpdateDefaultChallengeReviewer,
  deleteDefaultChallengeReviewer,
};

logger.buildService(module.exports);
