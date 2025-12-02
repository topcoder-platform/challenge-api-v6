/**
 * This service provides operations of challenge.
 */
const _ = require("lodash");
const Joi = require("joi");
const { Prisma } = require("@prisma/client");
const { v4: uuid } = require('uuid');
const config = require("config");
const xss = require("xss");
const helper = require("../common/helper");
const logger = require("../common/logger");
const errors = require("../common/errors");
const constants = require("../../app-constants");
const ChallengeTimelineTemplateService = require("./ChallengeTimelineTemplateService");
const { BadRequestError } = require("../common/errors");

const phaseHelper = require("../common/phase-helper");
const projectHelper = require("../common/project-helper");
const challengeHelper = require("../common/challenge-helper");
const { getReviewClient } = require("../common/review-prisma");

const PhaseAdvancer = require("../phase-management/PhaseAdvancer");

const { hasAdminRole } = require("../common/role-helper");
const { enrichChallengeForResponse, convertToISOString } = require("../common/challenge-helper");
const deepEqual = require("deep-equal");
const prismaHelper = require("../common/prisma-helper");

const {
  getClient,
  ReviewTypeEnum,
  DiscussionTypeEnum,
  ChallengeStatusEnum,
  PrizeSetTypeEnum,
  ReviewOpportunityTypeEnum,
} = require("../common/prisma");
const prisma = getClient();

// Provide aliases for friendlier sortBy query params
const sortByAliases = {
  updated: constants.validChallengeParams.Updated,
  created: constants.validChallengeParams.Created,
};

const allowedSortByValues = _.uniq([
  ..._.values(constants.validChallengeParams),
  ...Object.keys(sortByAliases),
]);

// Minimal domain adapter for PhaseAdvancer to fetch phase-specific facts.
// For now this returns an empty factResponses array which makes the
// PhaseAdvancer default to conservative behavior when such facts are needed.
// This avoids runtime errors until a richer domain is implemented.
const challengeDomain = {
  /**
   * Retrieve phase-specific facts from downstream services (stubbed).
   * @param {{ legacyId: number | null, facts: Array<number> }} _request
   * @returns {Promise<{ factResponses: Array<{ response: object }> }>}
   */
  async getPhaseFacts(_request) {
    return { factResponses: [] };
  },
};

const phaseAdvancer = new PhaseAdvancer(challengeDomain);

const REVIEW_STATUS_BLOCKING = Object.freeze(["IN_PROGRESS", "COMPLETED"]);
const REVIEW_PHASE_NAMES = Object.freeze([
  "checkpoint review",
  "checkpoint screening",
  "screening",
  "review",
  "approval",
]);
const REVIEW_PHASE_NAME_SET = new Set(REVIEW_PHASE_NAMES);
const REQUIRED_REVIEW_PHASE_NAME_SET = new Set([...REVIEW_PHASE_NAMES, "iterative review"]);

/**
 * Enrich skills data with full details from standardized skills API.
 * @param {Object} challenge the challenge object
 * @param {Object} [options]
 * @param {Map<string, Object>} [options.skillLookup] optional map of skillId -> skill payload
 */
async function enrichSkillsData(challenge, { skillLookup } = {}) {
  if (!Array.isArray(challenge.skills) || challenge.skills.length === 0) {
    return;
  }

  const skillIds = _(challenge.skills)
    .map((skill) => skill.skillId || skill.id)
    .filter((id) => !_.isNil(id))
    .uniq()
    .value();

  if (skillIds.length === 0) {
    return;
  }

  let lookup = skillLookup;
  if (!lookup) {
    try {
      const standSkills = await helper.getStandSkills(skillIds);
      lookup = new Map();
      standSkills.forEach((skill) => {
        if (skill && skill.id) {
          lookup.set(skill.id, skill);
        }
      });
    } catch (error) {
      logger.error("Failed to enrich skills data:", error);
      challenge.skills = challenge.skills.map((skill) => ({
        id: skill.skillId || skill.id,
        name: skill.name || "",
      }));
      return;
    }
  }

  const getFromLookup = (skillId) => {
    if (!lookup) {
      return null;
    }
    if (lookup instanceof Map) {
      return lookup.get(skillId);
    }
    return lookup[skillId];
  };

  challenge.skills = challenge.skills.map((skill) => {
    const skillId = skill.skillId || skill.id;
    const found = getFromLookup(skillId);
    if (found) {
      const enrichedSkill = {
        id: skillId,
        name: found.name,
      };

      if (found.category) {
        enrichedSkill.category = {
          id: found.category.id,
          name: found.category.name,
        };
      }

      return enrichedSkill;
    }

    return {
      id: skillId,
      name: skill.name || "",
    };
  });
}

/**
 * Enrich skills for a list of challenges using a single lookup call when possible.
 * @param {Array<Object>} challenges
 */
async function enrichSkillsDataBulk(challenges) {
  const challengesWithSkills = challenges.filter(
    (challenge) => Array.isArray(challenge.skills) && challenge.skills.length > 0
  );

  if (challengesWithSkills.length === 0) {
    return;
  }

  const uniqueSkillIds = _(challengesWithSkills)
    .flatMap((challenge) =>
      challenge.skills.map((skill) => skill.skillId || skill.id).filter((id) => !_.isNil(id))
    )
    .uniq()
    .value();

  if (uniqueSkillIds.length === 0) {
    return;
  }

  let lookup = null;
  try {
    const standSkills = await helper.getStandSkills(uniqueSkillIds);
    lookup = new Map();
    standSkills.forEach((skill) => {
      if (skill && skill.id) {
        lookup.set(skill.id, skill);
      }
    });
  } catch (error) {
    logger.error("Failed to enrich skills data in bulk:", error);
    await Promise.all(challengesWithSkills.map((challenge) => enrichSkillsData(challenge)));
    return;
  }

  await Promise.all(
    challengesWithSkills.map((challenge) => enrichSkillsData(challenge, { skillLookup: lookup }))
  );
}

// define return field for challenge model. Used in prisma.
const includeReturnFields = {
  legacyRecord: true,
  billingRecord: true,
  metadata: true,
  phases: {
    // sort by start/end date
    orderBy: [
      {
        scheduledEndDate: "asc",
      },
      {
        scheduledStartDate: "asc",
      },
    ],
    include: { constraints: true },
  },
  discussions: {
    include: { options: true },
  },
  events: true,
  prizeSets: {
    include: { 
      prizes: {
        orderBy: { value: "desc" },
      },
    } 
  },
  reviewers: {
    orderBy: { createdAt: "asc" },
  },
  terms: true,
  skills: true,
  winners: {
    orderBy: { placement: "asc" },
  },
  attachments: true,
  track: true,
  type: true,
};

/**
 * Build the Prisma include payload for challenges, optionally projecting the
 * memberAccesses relation when we need to know whether the current user can
 * see private fields.
 * @param {string|null} memberId
 * @returns {Object} prisma include payload
 */
function buildChallengeInclude(memberId) {
  if (!memberId) {
    return includeReturnFields;
  }
  return {
    ...includeReturnFields,
    memberAccesses: {
      where: { memberId },
      select: { memberId: true },
    },
  };
}

/**
 * Get default reviewers for a given typeId and trackId
 * @param {Object} currentUser
 * @param {Object} criteria { typeId, trackId }
 */
async function getDefaultReviewers(currentUser, criteria) {
  const schema = Joi.object()
    .keys({
      typeId: Joi.id(),
      trackId: Joi.id(),
      timelineTemplateId: Joi.optionalId(),
    })
    .required();
  const { error, value } = schema.validate(criteria);
  if (error) throw error;

  const baseWhere = { typeId: value.typeId, trackId: value.trackId };
  let rows = [];

  if (value.timelineTemplateId) {
    rows = await prisma.defaultChallengeReviewer.findMany({
      where: { ...baseWhere, timelineTemplateId: value.timelineTemplateId },
      orderBy: { createdAt: "asc" },
    });
  }

  if (!rows || rows.length === 0) {
    rows = await prisma.defaultChallengeReviewer.findMany({
      where: { ...baseWhere, timelineTemplateId: null },
      orderBy: { createdAt: "asc" },
    });
  }

  return rows.map((r) => ({
    scorecardId: r.scorecardId,
    isMemberReview: r.isMemberReview,
    memberReviewerCount: r.memberReviewerCount,
    phaseName: r.phaseName,
    phaseId: r.phaseId,
    fixedAmount: r.fixedAmount,
    baseCoefficient: r.baseCoefficient,
    incrementalCoefficient: r.incrementalCoefficient,
    type: r.opportunityType,
    aiWorkflowId: r.aiWorkflowId,
    shouldOpenOpportunity: _.isBoolean(r.shouldOpenOpportunity) ? r.shouldOpenOpportunity : true,
  }));
}
getDefaultReviewers.schema = { currentUser: Joi.any(), criteria: Joi.any() };

/**
 * Set default reviewers for a given typeId and trackId
 * @param {Object} currentUser
 * @param {Object} data { typeId, trackId, reviewers }
 */
async function setDefaultReviewers(currentUser, data) {
  const schema = Joi.object()
    .keys({
      typeId: Joi.id().required(),
      trackId: Joi.id().required(),
      timelineTemplateId: Joi.optionalId(),
      reviewers: Joi.array()
        .items(
          Joi.object().keys({
            scorecardId: Joi.string().required(),
            isMemberReview: Joi.boolean().required(),
            shouldOpenOpportunity: Joi.boolean().default(true),
            memberReviewerCount: Joi.when("isMemberReview", {
              is: true,
              then: Joi.number().integer().min(1).required(),
              otherwise: Joi.forbidden(),
            }),
            phaseName: Joi.string().required(),
            fixedAmount: Joi.number().min(0).optional().allow(null),
            baseCoefficient: Joi.number().min(0).max(1).optional().allow(null),
            incrementalCoefficient: Joi.number().min(0).max(1).optional().allow(null),
            type: Joi.when("isMemberReview", {
              is: true,
              then: Joi.string().valid(..._.values(ReviewOpportunityTypeEnum)).insensitive(),
              otherwise: Joi.forbidden(),
            }),
            aiWorkflowId: Joi.when("isMemberReview", {
              is: false,
              then: Joi.string().required(),
              otherwise: Joi.forbidden(),
            }),
          })
        )
        .default([]),
    })
    .required();

  const { error, value } = schema.validate(data);
  if (error) throw error;

  // validate referenced type and track
  const [type, track] = await Promise.all([
    prisma.challengeType.findUnique({ where: { id: value.typeId } }),
    prisma.challengeTrack.findUnique({ where: { id: value.trackId } }),
  ]);
  if (!type) throw new errors.NotFoundError(`ChallengeType with id: ${value.typeId} doesn't exist`);
  if (!track)
    throw new errors.NotFoundError(`ChallengeTrack with id: ${value.trackId} doesn't exist`);

  if (value.timelineTemplateId) {
    const timelineTemplate = await prisma.timelineTemplate.findUnique({
      where: { id: value.timelineTemplateId },
    });
    if (!timelineTemplate) {
      throw new errors.NotFoundError(
        `TimelineTemplate with id: ${value.timelineTemplateId} doesn't exist`
      );
    }
  }

  const userId = _.toString(currentUser && currentUser.userId ? currentUser.userId : "system");
  const auditFields = { createdBy: userId, updatedBy: userId };

  // Validate phase names exist
  const uniquePhaseNames = _.uniq(value.reviewers.map((r) => r.phaseName));
  if (uniquePhaseNames.length > 0) {
    const phases = await prisma.phase.findMany({ where: { name: { in: uniquePhaseNames } } });
    const existing = new Set(phases.map((p) => p.name));
    const missing = uniquePhaseNames.filter((n) => !existing.has(n));
    if (missing.length > 0) {
      throw new errors.BadRequestError(`Invalid phaseName(s): ${missing.join(", ")}`);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.defaultChallengeReviewer.deleteMany({
      where: {
        typeId: value.typeId,
        trackId: value.trackId,
        timelineTemplateId: _.isNil(value.timelineTemplateId) ? null : value.timelineTemplateId,
      },
    });
    if (value.reviewers.length > 0) {
      await tx.defaultChallengeReviewer.createMany({
        data: value.reviewers.map((r) => ({
          ...auditFields,
          typeId: value.typeId,
          trackId: value.trackId,
          timelineTemplateId: _.isNil(value.timelineTemplateId) ? null : value.timelineTemplateId,
          scorecardId: String(r.scorecardId),
          isMemberReview: !!r.isMemberReview,
          aiWorkflowId:_.isNil(r.aiWorkflowId) ? null : r.aiWorkflowId,
          memberReviewerCount: _.isNil(r.memberReviewerCount)
            ? null
            : Number(r.memberReviewerCount),
          phaseName: r.phaseName,
          fixedAmount: _.isNil(r.fixedAmount) ? null : Number(r.fixedAmount),
          baseCoefficient: _.isNil(r.baseCoefficient) ? null : Number(r.baseCoefficient),
          incrementalCoefficient: _.isNil(r.incrementalCoefficient)
            ? null
            : Number(r.incrementalCoefficient),
          opportunityType: r.type ? _.toUpper(r.type) : null,
          shouldOpenOpportunity: _.isNil(r.shouldOpenOpportunity)
            ? true
            : !!r.shouldOpenOpportunity,
        })),
      });
    }
  });

  return await getDefaultReviewers(currentUser, {
    typeId: value.typeId,
    trackId: value.trackId,
    timelineTemplateId: value.timelineTemplateId,
  });
}
setDefaultReviewers.schema = { currentUser: Joi.any(), data: Joi.any() };

/**
 * Search challenges by legacyId
 * @param {Object} currentUser the user who perform operation
 * @param {Number} legacyId the legacyId
 * @param {Number} page the page
 * @param {Number} perPage the perPage
 * @returns {Array} the search result
 */
async function searchByLegacyId(currentUser, legacyId, page, perPage) {
  // Do not take nested objects, query will be faster
  const challenges = await prisma.challenge.findMany({
    take: perPage,
    skip: (page - 1) * perPage,
    where: { legacyId },
    include: includeReturnFields,
  });

  _.forEach(challenges, (c) => {
    prismaHelper.convertModelToResponse(c);
    enrichChallengeForResponse(c, c.track, c.type);
  });
  return challenges;
}

/**
 * Specialized search path when filtering by a specific memberId. We pivot through the
 * Resource table to load the member's challenge ids, then apply the remaining filters in
 * manageable chunks so the database never has to process thousands of correlated joins.
 * @param {Object} options
 * @param {string} options.requestedMemberId
 * @param {Object} options.challengeWhere Prisma where clause ({ AND: [...] })
 * @param {Object} options.sortFilter e.g. { startDate: "desc" }
 * @param {string} options.sortByProp normalized challenge column name
 * @param {string} options.sortOrderProp "asc" | "desc"
 * @param {number} options.page
 * @param {number} options.perPage
 * @param {Object} options.challengeInclude include payload
 * @param {Function} options.markTiming timing logger
 * @returns {Promise<{ total: number, challenges: Array<Object> }>}
 */
async function searchChallengesViaMemberAccess({
  requestedMemberId,
  challengeWhere,
  sortFilter,
  sortByProp,
  sortOrderProp,
  page,
  perPage,
  challengeInclude,
  markTiming,
}) {
  const chunkSize = Number(process.env.SEARCH_MEMBER_CHUNK_SIZE || 500);
  const memberChallengeIdStart = Date.now();
  const memberChallengeIdRows =
    await prisma.$queryRaw`SELECT DISTINCT r."challengeId" FROM resources."Resource" r WHERE r."memberId" = ${requestedMemberId} AND r."challengeId" IS NOT NULL`;
  const memberChallengeIds = memberChallengeIdRows
    .map((row) => row.challengeId)
    .filter((id) => !_.isNil(id));
  markTiming("memberResourceChallengeIds", {
    durationMs: Date.now() - memberChallengeIdStart,
    count: memberChallengeIds.length,
  });
  if (memberChallengeIds.length === 0) {
    return { total: 0, challenges: [] };
  }

  const summarySelect = { id: true };
  summarySelect[sortByProp] = true;

  const baseWhere = _.cloneDeep(challengeWhere);
  const summaryStart = Date.now();
  const summaryRecords = [];
  const idChunks = _.chunk(memberChallengeIds, chunkSize);

  for (const chunk of idChunks) {
    const chunkWhere = _.cloneDeep(baseWhere);
    chunkWhere.AND = [...(chunkWhere.AND || []), { id: { in: chunk } }];
    const rows = await prisma.challenge.findMany({
      where: chunkWhere,
      select: summarySelect,
    });
    summaryRecords.push(...rows);
  }

  markTiming("memberChunkScan", {
    durationMs: Date.now() - summaryStart,
    chunkCount: idChunks.length,
    candidateCount: summaryRecords.length,
  });

  if (summaryRecords.length === 0) {
    return { total: 0, challenges: [] };
  }

  const compareValues = (aValue, bValue) => {
    if (aValue === bValue) {
      return 0;
    }
    if (_.isNil(aValue)) {
      return 1;
    }
    if (_.isNil(bValue)) {
      return -1;
    }
    if (_.isNumber(aValue) && _.isNumber(bValue)) {
      return aValue - bValue;
    }
    if (aValue instanceof Date && bValue instanceof Date) {
      return aValue - bValue;
    }
    const aStr = `${aValue}`;
    const bStr = `${bValue}`;
    return aStr.localeCompare(bStr);
  };

  const sortDirection = sortOrderProp === "asc" ? 1 : -1;
  summaryRecords.sort((a, b) => compareValues(a[sortByProp], b[sortByProp]) * sortDirection);

  const total = summaryRecords.length;
  const offset = (page - 1) * perPage;
  const pageSummaries = summaryRecords.slice(offset, offset + perPage);
  const pageIds = pageSummaries.map((summary) => summary.id);

  if (pageIds.length === 0) {
    return { total, challenges: [] };
  }

  const fetchWhere = _.cloneDeep(baseWhere);
  fetchWhere.AND = [...(fetchWhere.AND || []), { id: { in: pageIds } }];

  const fetchStart = Date.now();
  const challenges = await prisma.challenge.findMany({
    where: fetchWhere,
    include: challengeInclude,
  });
  markTiming("memberChunkFetch", {
    durationMs: Date.now() - fetchStart,
    fetched: challenges.length,
  });

  const challengesById = new Map();
  challenges.forEach((challenge) => {
    challengesById.set(challenge.id, challenge);
  });

  const orderedChallenges = pageIds.map((id) => challengesById.get(id)).filter((c) => !!c);

  return {
    total,
    challenges: orderedChallenges,
  };
}

/**
 * Search challenges
 * @param {Object} currentUser the user who perform operation
 * @param {Object} criteria the search criteria
 * @returns {Object} the search result
 */
async function searchChallenges(currentUser, criteria) {
  const page = criteria.page || 1;
  const perPage = criteria.perPage || 20;
  const searchTimingEnabled =
    process.env.SEARCH_CHALLENGE_TIMING === "true" ||
    (typeof config.has === "function" &&
      config.has("challengeSearch.debugTimings") &&
      config.get("challengeSearch.debugTimings"));
  const searchTimingStart = Date.now();
  const searchTimingMarks = [];
  const markTiming = (label, extra = {}) => {
    if (!searchTimingEnabled) {
      return;
    }
    searchTimingMarks.push({
      label,
      elapsedMs: Date.now() - searchTimingStart,
      ...extra,
    });
  };

  if (criteria.sortBy && sortByAliases[criteria.sortBy]) {
    criteria.sortBy = sortByAliases[criteria.sortBy];
  }

  // Log the requested search filter (omit pagination for brevity)
  try {
    const filterToLog = _.omit(criteria, ["page", "perPage"]);
    logger.info(`SearchChallenges filter: ${JSON.stringify(filterToLog)}`);
  } catch (e) {
    // best-effort logging; don't block on serialization issues
    logger.info("SearchChallenges filter: <unable to serialize criteria>");
  }
  if (!_.isUndefined(criteria.legacyId)) {
    const result = await searchByLegacyId(currentUser, criteria.legacyId, page, perPage);
    return { total: result.length, page, perPage, result };
  }

  const prismaFilter = {
    where: {
      AND: [],
    },
  };

  const matchPhraseKeys = [
    "id",
    "timelineTemplateId",
    "projectId",
    "legacyId",
    "createdBy",
    "updatedBy",
  ];

  const _hasAdminRole = hasAdminRole(currentUser);

  const normalizeGroupIdValue = (value) => {
    if (_.isNil(value)) {
      return null;
    }
    const normalized = _.toString(value).trim();
    if (!normalized) {
      return null;
    }
    const lowered = normalized.toLowerCase();
    if (lowered === "null" || lowered === "undefined") {
      return null;
    }
    return normalized;
  };

  const normalizeGroupIdList = (list) => {
    if (_.isNil(list)) {
      return [];
    }
    const arrayValue = Array.isArray(list) ? list : [list];
    return _.uniq(
      arrayValue.map((value) => normalizeGroupIdValue(value)).filter((value) => !_.isNil(value))
    );
  };

  let includedTrackIds = _.isArray(criteria.trackIds) ? criteria.trackIds : [];
  let includedTypeIds = _.isArray(criteria.typeIds) ? criteria.typeIds : [];

  if (criteria.type) {
    const typeSearchRes = await prisma.challengeType.findFirst({
      where: { abbreviation: criteria.type },
    });
    if (typeSearchRes && _.get(typeSearchRes, "id")) {
      criteria.typeId = _.get(typeSearchRes, "id");
    }
  }
  if (criteria.track) {
    const trackSearchRes = await prisma.challengeTrack.findFirst({
      where: { abbreviation: criteria.track },
    });
    if (trackSearchRes && _.get(trackSearchRes, "id")) {
      criteria.trackId = _.get(trackSearchRes, "id");
    }
  }
  if (criteria.types) {
    const typeIds = await prisma.challengeType.findMany({
      where: { abbreviation: { in: criteria.types } },
      select: { id: true },
    });
    if (typeIds.length > 0) {
      includedTypeIds = _.concat(
        includedTypeIds,
        typeIds.map((t) => t.id)
      );
    }
  }
  if (criteria.tracks) {
    const trackIds = await prisma.challengeTrack.findMany({
      select: { id: true },
      where: { abbreviation: { in: criteria.tracks } },
    });
    if (trackIds.length > 0) {
      includedTrackIds = _.concat(
        includedTrackIds,
        trackIds.map((t) => t.id)
      );
    }
  }
  if (criteria.typeId) {
    includedTypeIds.push(criteria.typeId);
  }
  if (criteria.trackId) {
    includedTrackIds.push(criteria.trackId);
  }

  _.forIn(_.pick(criteria, matchPhraseKeys), (value, key) => {
    if (!_.isUndefined(value)) {
      const f = {};
      f[key] = value;
      prismaFilter.where.AND.push(f);
    }
  });

  // handle status
  if (!_.isNil(criteria.status)) {
    prismaFilter.where.AND.push({
      status: criteria.status.toUpperCase(),
    });
  }

  _.forEach(_.keys(criteria), (key) => {
    if (_.toString(key).indexOf("meta.") > -1) {
      // Parse and use metadata key
      if (!_.isUndefined(criteria[key])) {
        const metaKey = key.split("meta.")[1];
        prismaFilter.where.AND.push({
          metadata: {
            some: {
              name: { contains: metaKey },
              value: { contains: _.toString(criteria[key]) },
            },
          },
        });
      }
    }
  });

  if (includedTypeIds.length > 0) {
    prismaFilter.where.AND.push({
      typeId: { in: includedTypeIds },
    });
  }

  if (includedTrackIds.length > 0) {
    prismaFilter.where.AND.push({
      trackId: { in: includedTrackIds },
    });
  }

  if (criteria.search) {
    prismaFilter.where.AND.push({
      OR: [
        {
          name: { contains: criteria.search },
        },
        {
          description: { contains: criteria.search },
          // TODO: Skills doesn't have name field in db.
          /*
      }, {
        skills: { some: { name: { contains: criteria.search } } }
      */
        },
        {
          tags: { has: criteria.search },
        },
      ],
    });
  } else {
    if (criteria.name) {
      prismaFilter.where.AND.push({
        name: { contains: criteria.name },
      });
    }

    if (criteria.description) {
      prismaFilter.where.AND.push({
        description: { contains: criteria.description },
      });
    }
  }

  if (criteria.tag) {
    prismaFilter.where.AND.push({
      tags: {
        has: criteria.tag,
      },
    });
  }

  if (criteria.tags) {
    if (criteria.includeAllTags) {
      prismaFilter.where.AND.push({
        tags: { hasEvery: criteria.tags },
      });
    } else {
      prismaFilter.where.AND.push({
        tags: { hasSome: criteria.tags },
      });
    }
  }

  if (criteria.totalPrizesFrom || criteria.totalPrizesTo) {
    if (criteria.totalPrizesFrom) {
      prismaFilter.where.AND.push({
        overviewTotalPrizes: { gte: criteria.totalPrizesFrom },
      });
    }
    if (criteria.totalPrizesTo) {
      prismaFilter.where.AND.push({
        overviewTotalPrizes: { lte: criteria.totalPrizesTo },
      });
    }
  }
  if (criteria.selfService) {
    prismaFilter.where.AND.push({
      legacyRecord: {
        is: { selfService: criteria.selfService },
      },
    });
  }
  if (criteria.selfServiceCopilot) {
    prismaFilter.where.AND.push({
      legacyRecord: {
        is: { selfServiceCopilot: criteria.selfServiceCopilot },
      },
    });
  }
  if (criteria.forumId) {
    prismaFilter.where.AND.push({
      legacyRecord: {
        is: { forumId: criteria.forumId },
      },
    });
  }
  if (criteria.reviewType) {
    prismaFilter.where.AND.push({
      legacyRecord: {
        is: { reviewType: criteria.reviewType.toUpperCase() },
      },
    });
  }
  if (criteria.confidentialityType) {
    prismaFilter.where.AND.push({
      legacyRecord: {
        is: { confidentialityType: criteria.confidentialityType },
      },
    });
  }
  if (criteria.directProjectId) {
    prismaFilter.where.AND.push({
      legacyRecord: {
        is: { directProjectId: criteria.directProjectId },
      },
    });
  }
  if (criteria.currentPhaseName) {
    const phaseNamesToMatch =
      criteria.currentPhaseName === "Registration"
        ? ["Registration", "Open"]
        : [criteria.currentPhaseName];

    prismaFilter.where.AND.push({
      OR: [
        { currentPhaseNames: { hasSome: phaseNamesToMatch } },
        {
          phases: {
            some: {
              name: { in: phaseNamesToMatch },
              isOpen: true,
            },
          },
        },
      ],
    });
  }
  if (criteria.createdDateStart) {
    prismaFilter.where.AND.push({
      createdAt: { gte: criteria.createdDateStart },
    });
  }
  if (criteria.createdDateEnd) {
    prismaFilter.where.AND.push({
      createdAt: { lte: criteria.createdDateEnd },
    });
  }
  if (criteria.registrationStartDateStart) {
    prismaFilter.where.AND.push({
      registrationStartDate: { gte: criteria.registrationStartDateStart },
    });
  }
  if (criteria.registrationStartDateEnd) {
    prismaFilter.where.AND.push({
      registrationStartDate: { lte: criteria.registrationStartDateEnd },
    });
  }
  if (criteria.registrationEndDateStart) {
    prismaFilter.where.AND.push({
      registrationEndDate: { gte: criteria.registrationEndDateStart },
    });
  }
  if (criteria.registrationEndDateEnd) {
    prismaFilter.where.AND.push({
      registrationEndDate: { lte: criteria.registrationEndDateEnd },
    });
  }
  if (criteria.submissionStartDateStart) {
    prismaFilter.where.AND.push({
      submissionStartDate: { gte: criteria.submissionStartDateStart },
    });
  }
  if (criteria.submissionStartDateEnd) {
    prismaFilter.where.AND.push({
      submissionStartDate: { lte: criteria.submissionStartDateEnd },
    });
  }
  if (criteria.submissionEndDateStart) {
    prismaFilter.where.AND.push({
      submissionEndDate: { gte: criteria.submissionEndDateStart },
    });
  }
  if (criteria.submissionEndDateEnd) {
    prismaFilter.where.AND.push({
      submissionEndDate: { lte: criteria.submissionEndDateEnd },
    });
  }
  if (criteria.updatedDateStart) {
    prismaFilter.where.AND.push({
      updatedAt: { gte: criteria.updatedDateStart },
    });
  }
  if (criteria.updatedDateEnd) {
    prismaFilter.where.AND.push({
      updatedAt: { lte: criteria.updatedDateEnd },
    });
  }
  if (criteria.startDateStart) {
    prismaFilter.where.AND.push({
      startDate: { gte: criteria.startDateStart },
    });
  }
  if (criteria.startDateEnd) {
    prismaFilter.where.AND.push({
      startDate: { lte: criteria.startDateEnd },
    });
  }
  if (criteria.endDateStart) {
    prismaFilter.where.AND.push({
      endDate: { gte: criteria.endDateStart },
    });
  }
  if (criteria.endDateEnd) {
    prismaFilter.where.AND.push({
      endDate: { lte: criteria.endDateEnd },
    });
  }

  let sortByProp = criteria.sortBy ? criteria.sortBy : "createdAt";

  const sortOrderProp = criteria.sortOrder ? criteria.sortOrder : "desc";

  if (sortByProp === "overview.totalPrizes") {
    sortByProp = "overviewTotalPrizes";
  }

  if (criteria.tco) {
    prismaFilter.where.AND.push({
      events: {
        some: { key: { contains: "tco" } },
      },
    });
  }

  if (criteria.events) {
    const eventQuery = _.map(criteria.events, (e) => ({
      events: {
        some: { key: { contains: e } },
      },
    }));
    if (criteria.includeAllEvents) {
      prismaFilter.where.AND = _.concat(prismaFilter.where.AND, eventQuery);
    } else {
      prismaFilter.where.AND.push({
        OR: eventQuery,
      });
    }
  }

  const requestedMemberId = !_.isNil(criteria.memberId)
    ? _.toString(criteria.memberId)
    : null;
  const currentUserMemberId =
    currentUser && !_hasAdminRole && !_.get(currentUser, "isMachine", false)
      ? _.toString(currentUser.userId)
      : null;
  const memberIdForTaskFilter = requestedMemberId || currentUserMemberId;
  const isSelfMemberSearch =
    Boolean(requestedMemberId && currentUserMemberId && requestedMemberId === currentUserMemberId);
  const shouldApplyGroupVisibilityFilter =
    Boolean(currentUser && !currentUser.isMachine && !_hasAdminRole && !isSelfMemberSearch);

  let groupsToFilter = [];
  let accessibleGroups = [];
  let accessibleGroupsSet = new Set();

  if (shouldApplyGroupVisibilityFilter) {
    const accessibleGroupsStart = Date.now();
    const rawAccessibleGroups = await helper.getCompleteUserGroupTreeIds(currentUser.userId);
    accessibleGroups = normalizeGroupIdList(rawAccessibleGroups);
    accessibleGroupsSet = new Set(accessibleGroups);
    markTiming("loaded-accessible-groups", {
      durationMs: Date.now() - accessibleGroupsStart,
      groupCount: accessibleGroups.length,
    });
  }

  // Filter all groups from the criteria to make sure the user can access those
  if (!_.isUndefined(criteria.group) || !_.isUndefined(criteria.groups)) {
    const criteriaGroupsList = _.isNil(criteria.groups) ? [] : [].concat(criteria.groups);

    // check group access
    if (_.isUndefined(currentUser)) {
      const normalizedGroup = normalizeGroupIdValue(criteria.group);
      if (normalizedGroup) {
        const group = await helper.getGroupById(normalizedGroup);
        if (group && !group.privateGroup) {
          groupsToFilter.push(normalizedGroup);
        }
      }

      if (criteriaGroupsList.length > 0) {
        const promises = criteriaGroupsList.map(async (groupValue) => {
          const normalized = normalizeGroupIdValue(groupValue);
          if (!normalized) {
            return;
          }
          const group = await helper.getGroupById(normalized);
          if (group && !group.privateGroup) {
            groupsToFilter.push(normalized);
          }
        });
        await Promise.all(promises);
      }
    } else if (shouldApplyGroupVisibilityFilter) {
      const normalizedGroup = normalizeGroupIdValue(criteria.group);
      if (normalizedGroup && accessibleGroupsSet.has(normalizedGroup)) {
        groupsToFilter.push(normalizedGroup);
      }

      if (criteriaGroupsList.length > 0) {
        criteriaGroupsList.forEach((groupValue) => {
          const normalized = normalizeGroupIdValue(groupValue);
          if (normalized && accessibleGroupsSet.has(normalized)) {
            groupsToFilter.push(normalized);
          }
        });
      }
    } else {
      groupsToFilter = normalizeGroupIdList(criteriaGroupsList);
      const normalizedGroup = normalizeGroupIdValue(criteria.group);
      if (normalizedGroup) {
        groupsToFilter.push(normalizedGroup);
      }
    }

    groupsToFilter = _.uniq(groupsToFilter);

    if (groupsToFilter.length === 0) {
      // User can't access any of the groups from the filters
      // We return an empty array as the result
      return { total: 0, page, perPage, result: [] };
    }
  }

  if (groupsToFilter.length === 0) {
    // Return public challenges + challenges from groups that the user has access to
    if (_.isUndefined(currentUser)) {
      // If the user is not authenticated, only query challenges that don't have a group
      prismaFilter.where.AND.push({
        groups: { isEmpty: true },
      });
    } else if (shouldApplyGroupVisibilityFilter) {
      prismaFilter.where.AND.push({
        OR: [
          {
            // include public challenges
            groups: { isEmpty: true },
          },
          {
            // If the user is not M2M and is not an admin, return public + challenges from groups the user can access
            groups: { hasSome: accessibleGroups },
          },
        ],
      });
    }
  } else {
    prismaFilter.where.AND.push({
      groups: { hasSome: groupsToFilter },
    });
  }

  if (criteria.ids) {
    prismaFilter.where.AND.push({
      id: { in: criteria.ids },
    });
  }

  // FIXME: Tech Debt
  let excludeTasks = true;
  if (requestedMemberId) {
    // When we already restrict the result set to a specific member,
    // rerunning the generic task visibility filter is redundant.
    excludeTasks = false;
  } else if (currentUser && (_hasAdminRole || _.get(currentUser, "isMachine", false))) {
    // if you're an admin or m2m, security rules wont be applied
    excludeTasks = false;
  }

  /**
   * For non-authenticated users:
   * - Only unassigned tasks will be returned
   * For authenticated users (non-admin):
   * - Only unassigned tasks and tasks assigned to the logged in user will be returned
   * For admins/m2m:
   * - All tasks will be returned
   */
  if (currentUser && (_hasAdminRole || _.get(currentUser, "isMachine", false))) {
    // For admins/m2m, allow filtering based on task properties
    if (!_.isNil(criteria.isTask)) {
      prismaFilter.where.AND.push({
        taskIsTask: criteria.isTask,
      });
    }
    if (!_.isNil(criteria.taskIsAssigned)) {
      prismaFilter.where.AND.push({
        taskIsAssigned: criteria.taskIsAssigned,
      });
    }
    if (!_.isNil(criteria.taskMemberId)) {
      prismaFilter.where.AND.push({
        taskMemberId: criteria.taskMemberId,
      });
    }
  } else if (excludeTasks) {
    const taskFilter = [];
    if (memberIdForTaskFilter) {
      taskFilter.push({
        memberAccesses: {
          some: { memberId: memberIdForTaskFilter },
        },
      });
    }
    taskFilter.push({
      taskIsTask: false,
    });
    taskFilter.push({
      taskIsTask: true,
      taskIsAssigned: false,
    });
    if (currentUser && !_hasAdminRole && !_.get(currentUser, "isMachine", false)) {
      taskFilter.push({
        taskMemberId: currentUser.userId,
      });
    }
    prismaFilter.where.AND.push({
      OR: taskFilter,
    });
  }

  const sortFilter = {};
  sortFilter[sortByProp] = sortOrderProp;

  const challengeInclude = buildChallengeInclude(currentUserMemberId);

  const prismaQuery = {
    ...prismaFilter,
    take: perPage,
    skip: (page - 1) * perPage,
    orderBy: [sortFilter],
    include: challengeInclude,
  };

  try {
    const logContext = requestedMemberId
      ? {
          memberAccessWhere: {
            memberId: requestedMemberId,
            challenge: prismaFilter.where,
          },
          orderBy: [
            {
              challenge: sortFilter,
            },
          ],
          pagination: {
            page,
            perPage,
            take: perPage,
            skip: (page - 1) * perPage,
          },
        }
      : {
          where: prismaFilter.where,
          orderBy: prismaQuery.orderBy,
          pagination: {
            page,
            perPage,
            take: perPage,
            skip: (page - 1) * perPage,
          },
          groupsToFilterCount: groupsToFilter.length,
          accessibleGroupsCount: accessibleGroups.length,
          shouldApplyGroupVisibilityFilter,
        };
    const logPayload = JSON.stringify(logContext, (_key, value) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    });
    logger.info(`SearchChallenges prisma query: ${logPayload}`);
  } catch (logError) {
    logger.warn(`SearchChallenges prisma logging failed: ${logError.message}`);
  }

  let challenges = [];
  let total = 0;
  try {
    if (requestedMemberId) {
      ({ total, challenges } = await searchChallengesViaMemberAccess({
        requestedMemberId,
        challengeWhere: prismaFilter.where,
        sortFilter,
        sortByProp,
        sortOrderProp,
        page,
        perPage,
        challengeInclude,
        markTiming,
      }));
    } else {
      const countStart = Date.now();
      total = await prisma.challenge.count({ ...prismaFilter });
      markTiming("count", { durationMs: Date.now() - countStart, total });
      const findManyStart = Date.now();
      challenges = await prisma.challenge.findMany(prismaQuery);
      markTiming("findMany", {
        durationMs: Date.now() - findManyStart,
        resultCount: challenges.length,
      });
    }

    challenges.forEach((challenge) => {
      prismaHelper.convertModelToResponse(challenge);
    });

    const enrichStart = Date.now();
    await enrichSkillsDataBulk(challenges);
    markTiming("enrichSkillsDataBulk", { durationMs: Date.now() - enrichStart });

    challenges.forEach((challenge) => {
      enrichChallengeForResponse(challenge, challenge.track, challenge.type);
    });

    // Note: numOfRegistrants and numOfSubmissions are no longer calculated here.
  } catch (e) {
    // logger.error(JSON.stringify(e));
    console.log(e);
  }

  let result = challenges;

  if (currentUser) {
    if (!currentUser.isMachine && !_hasAdminRole) {
      result.forEach((challenge) => {
        _.unset(challenge, "billing");
        const hasCurrentUserAccess =
          _.get(challenge, "memberAccesses.length", 0) > 0;
        if (!hasCurrentUserAccess) {
          _.unset(challenge, "privateDescription");
        }
        _.unset(challenge, "memberAccesses");
      });
    } else {
      result.forEach((challenge) => _.unset(challenge, "memberAccesses"));
    }
  } else {
    result.forEach((challenge) => {
      _.unset(challenge, "billing");
      _.unset(challenge, "privateDescription");
      _.unset(challenge, "memberAccesses");
    });
  }

  if (criteria.isLightweight === "true") {
    result.forEach((challenge) => {
      _.unset(challenge, "description");
      _.unset(challenge, "privateDescription");
    });
  }

  result.forEach((challenge) => {
    if (challenge.status !== ChallengeStatusEnum.COMPLETED) {
      _.unset(challenge, "winners");
      _.unset(challenge, "checkpointWinners");
    }
    if (!_hasAdminRole && !_.get(currentUser, "isMachine", false)) {
      _.unset(challenge, "payments");
    }
  });

  const sanitizedResult = result.map((challenge) => helper.removeNullProperties(challenge));

  if (searchTimingEnabled) {
    logger.info(
      `SearchChallenges timings (page=${page}, perPage=${perPage}): ${JSON.stringify({
        totalElapsedMs: Date.now() - searchTimingStart,
        marks: searchTimingMarks,
      })}`
    );
  }

  return { total, page, perPage, result: sanitizedResult };
}
searchChallenges.schema = {
  currentUser: Joi.any(),
  criteria: Joi.object()
    .keys({
      page: Joi.page(),
      perPage: Joi.perPage(),
      id: Joi.optionalId(),
      selfService: Joi.boolean(),
      selfServiceCopilot: Joi.string(),
      confidentialityType: Joi.string(),
      directProjectId: Joi.number(),
      typeIds: Joi.array().items(Joi.optionalId()),
      trackIds: Joi.array().items(Joi.optionalId()),
      types: Joi.array().items(Joi.string()),
      tracks: Joi.array().items(Joi.string()),
      typeId: Joi.optionalId(),
      trackId: Joi.optionalId(),
      type: Joi.string(),
      track: Joi.string(),
      name: Joi.string(),
      search: Joi.string(),
      description: Joi.string(),
      timelineTemplateId: Joi.string(), // Joi.optionalId(),
      reviewType: Joi.string(),
      tag: Joi.string(),
      tags: Joi.array().items(Joi.string()),
      includeAllTags: Joi.boolean().default(true),
      projectId: Joi.number().integer().positive(),
      forumId: Joi.number().integer(),
      legacyId: Joi.number().integer().positive(),
      status: Joi.string().valid(..._.values(ChallengeStatusEnum)).insensitive(),
      group: Joi.string(),
      startDateStart: Joi.date(),
      startDateEnd: Joi.date(),
      endDateStart: Joi.date(),
      endDateEnd: Joi.date(),
      currentPhaseName: Joi.string(),
      createdDateStart: Joi.date(),
      createdDateEnd: Joi.date(),
      updatedDateStart: Joi.date(),
      updatedDateEnd: Joi.date(),
      registrationStartDateStart: Joi.date(),
      registrationStartDateEnd: Joi.date(),
      registrationEndDateStart: Joi.date(),
      registrationEndDateEnd: Joi.date(),
      submissionStartDateStart: Joi.date(),
      submissionStartDateEnd: Joi.date(),
      submissionEndDateStart: Joi.date(),
      submissionEndDateEnd: Joi.date(),
      createdBy: Joi.string(),
      updatedBy: Joi.string(),
      isLightweight: Joi.boolean().default(false),
      memberId: Joi.string(),
      sortBy: Joi.string().valid(...allowedSortByValues),
      sortOrder: Joi.string().valid("asc", "desc"),
      groups: Joi.array().items(Joi.optionalId()).unique(),
      ids: Joi.array().items(Joi.optionalId()).unique().min(1),
      isTask: Joi.boolean(),
      taskIsAssigned: Joi.boolean(),
      taskMemberId: Joi.string(),
      events: Joi.array().items(Joi.string()),
      includeAllEvents: Joi.boolean().default(true),
      useSchedulingAPI: Joi.boolean(),
      totalPrizesFrom: Joi.number().min(0),
      totalPrizesTo: Joi.number().min(0),
      tco: Joi.boolean().default(false),
    })
    .unknown(true),
};

/**
 * Create challenge.
 * @param {Object} currentUser the user who perform operation
 * @param {Object} challenge the challenge to created
 * @param {String} userToken the user token
 * @returns {Object} the created challenge
 */
async function createChallenge(currentUser, challenge, userToken) {
  const buildLogContext = () =>
    JSON.stringify({
      challengeName: challenge.name,
      challengeId: challenge.id,
      trackId: challenge.trackId,
      typeId: challenge.typeId,
      projectId: challenge.projectId,
      timelineTemplateId: challenge.timelineTemplateId,
      selfService: _.get(challenge, "legacy.selfService", false),
      userId: _.get(currentUser, "userId"),
      handle: _.get(currentUser, "handle"),
    });

  logger.info(`createChallenge: start ${buildLogContext()}`);
  logger.debug(`createChallenge: validating request payload ${buildLogContext()}`);
  await challengeHelper.validateCreateChallengeRequest(currentUser, challenge);
  logger.debug(`createChallenge: request payload validated ${buildLogContext()}`);
  const prizeTypeTmp = challengeHelper.validatePrizeSetsAndGetPrizeType(challenge.prizeSets);
  logger.debug(
    `createChallenge: initial prize validation complete (prizeType=${prizeTypeTmp}) ${buildLogContext()}`
  );
  if (challenge.legacy && challenge.legacy.selfService) {
    // if self-service, create a new project (what about if projectId is provided in the payload? confirm with business!)
    if (!challenge.projectId && challengeHelper.isProjectIdRequired(challenge.timelineTemplateId)) {
      const selfServiceProjectName = `Self service - ${currentUser.handle} - ${challenge.name}`;
      logger.info(
        `createChallenge: creating self-service project (name=${selfServiceProjectName}) ${buildLogContext()}`
      );
      challenge.projectId = await helper.createSelfServiceProject(
        selfServiceProjectName,
        "N/A",
        config.NEW_SELF_SERVICE_PROJECT_TYPE,
        userToken
      );
      logger.info(
        `createChallenge: self-service project created (projectId=${
          challenge.projectId
        }) ${buildLogContext()}`
      );
    }

    if (challenge.metadata && challenge.metadata.length > 0) {
      for (const entry of challenge.metadata) {
        if (challenge.description.includes(`{{${entry.name}}}`)) {
          challenge.description = challenge.description
            .split(`{{${entry.name}}}`)
            .join(entry.value);
        }
      }
    }
  }

  /** Ensure project exists, and set direct project id, billing account id & markup */
  if (challengeHelper.isProjectIdRequired(challenge.timelineTemplateId) || challenge.projectId) {
    const { projectId } = challenge;

    if (!projectId) {
      // fix of projectId undefined
      throw new errors.BadRequestError("Project id must be provided");
    }

    logger.debug(`createChallenge: fetching project details ${buildLogContext()}`);
    const { directProjectId } = await projectHelper.getProject(projectId, currentUser);
    logger.debug(
      `createChallenge: fetched project details (directProjectId=${directProjectId}) ${buildLogContext()}`
    );
    logger.debug(`createChallenge: fetching billing information ${buildLogContext()}`);
    const { billingAccountId, markup } = await projectHelper.getProjectBillingInformation(
      projectId
    );
    logger.debug(
      `createChallenge: billing information retrieved (hasAccount=${
        billingAccountId !== null && billingAccountId !== undefined
      }, markup=${markup}) ${buildLogContext()}`
    );

    _.set(challenge, "legacy.directProjectId", directProjectId);
    // Ensure billingAccountId is a string or null to match Prisma schema
    if (billingAccountId !== null && billingAccountId !== undefined) {
      _.set(challenge, "billing.billingAccountId", String(billingAccountId));
    } else {
      _.set(challenge, "billing.billingAccountId", null);
    }
    _.set(challenge, "billing.markup", markup || 0);
  }

  if (!_.isUndefined(_.get(challenge, "legacy.reviewType"))) {
    _.set(challenge, "legacy.reviewType", _.toUpper(_.get(challenge, "legacy.reviewType")));
  }

  if (!challenge.status) {
    challenge.status = ChallengeStatusEnum.NEW;
  }

  if (!challenge.startDate) {
    challenge.startDate = new Date().toISOString();
  } else {
    challenge.startDate = convertToISOString(challenge.startDate);
  }

  logger.debug(`createChallenge: resolving challenge track/type ${buildLogContext()}`);
  const { track, type } = await challengeHelper.validateAndGetChallengeTypeAndTrack(challenge);
  logger.debug(
    `createChallenge: resolved challenge track/type (trackId=${_.get(track, "id")}, typeId=${_.get(
      type,
      "id"
    )}) ${buildLogContext()}`
  );

  if (_.get(type, "isTask")) {
    _.set(challenge, "task.isTask", true);
    // this is only applicable for WorkType: Gig, i.e., Tasks created from Salesforce
    if (challenge.billing != null && challenge.billing.clientBillingRate != null) {
      _.set(challenge, "billing.clientBillingRate", challenge.billing.clientBillingRate);
    }

    if (_.isUndefined(_.get(challenge, "task.isAssigned"))) {
      _.set(challenge, "task.isAssigned", false);
    }
    if (_.isUndefined(_.get(challenge, "task.memberId"))) {
      _.set(challenge, "task.memberId", null);
    } else {
      throw new errors.BadRequestError(`Cannot assign a member before the challenge gets created.`);
    }
  }

  if (challenge.phases && challenge.phases.length > 0) {
    logger.debug(
      `createChallenge: validating provided phases (count=${
        challenge.phases.length
      }) ${buildLogContext()}`
    );
    await phaseHelper.validatePhases(challenge.phases);
    logger.debug(`createChallenge: provided phases validated ${buildLogContext()}`);
  }

  // populate phases
  if (!challenge.timelineTemplateId) {
    if (challenge.typeId && challenge.trackId) {
      logger.debug(
        `createChallenge: fetching default timeline template (trackId=${
          challenge.trackId
        }, typeId=${challenge.typeId}) ${buildLogContext()}`
      );
      const supportedTemplates =
        await ChallengeTimelineTemplateService.searchChallengeTimelineTemplates({
          typeId: challenge.typeId,
          trackId: challenge.trackId,
          isDefault: true,
        });
      logger.debug(
        `createChallenge: retrieved ${
          supportedTemplates.result.length
        } supported templates ${buildLogContext()}`
      );
      const challengeTimelineTemplate = supportedTemplates.result[0];
      if (!challengeTimelineTemplate) {
        throw new errors.BadRequestError(
          `The selected trackId ${challenge.trackId} and typeId: ${challenge.typeId} does not have a default timeline template. Please provide a timelineTemplateId`
        );
      }
      challenge.timelineTemplateId = challengeTimelineTemplate.timelineTemplateId;
      logger.debug(
        `createChallenge: using timelineTemplateId=${
          challenge.timelineTemplateId
        } ${buildLogContext()}`
      );
    } else {
      throw new errors.BadRequestError(`trackId and typeId are required to create a challenge`);
    }
  }
  logger.debug(
    `createChallenge: populating phases for challenge creation (templateId=${
      challenge.timelineTemplateId
    }) ${buildLogContext()}`
  );
  challenge.phases = await phaseHelper.populatePhasesForChallengeCreation(
    challenge.phases,
    challenge.startDate,
    challenge.timelineTemplateId
  );
  logger.debug(
    `createChallenge: phases populated (count=${challenge.phases.length}) ${buildLogContext()}`
  );

  // populate challenge terms
  // const projectTerms = await helper.getProjectDefaultTerms(challenge.projectId)
  // challenge.terms = await helper.validateChallengeTerms(_.union(projectTerms, challenge.terms))
  // TODO - challenge terms returned from projects api don't have a role associated
  // this will need to be updated to associate project terms with a roleId
  logger.debug(
    `createChallenge: validating challenge terms (count=${_.get(
      challenge.terms,
      "length",
      0
    )}) ${buildLogContext()}`
  );
  challenge.terms = await helper.validateChallengeTerms(challenge.terms || []);
  logger.debug(`createChallenge: challenge terms validated ${buildLogContext()}`);

  // default the descriptionFormat
  if (!challenge.descriptionFormat) {
    challenge.descriptionFormat = "markdown";
  }

  if (challenge.phases && challenge.phases.length > 0) {
    challenge.endDate = helper.calculateChallengeEndDate(challenge);
  }

  if (challenge.events == null) challenge.events = [];
  if (challenge.attachments == null) challenge.attachments = [];
  if (challenge.prizeSets == null) challenge.prizeSets = [];
  if (challenge.reviewers == null) challenge.reviewers = [];
  if (challenge.metadata == null) challenge.metadata = [];
  if (challenge.groups == null) challenge.groups = [];
  if (challenge.tags == null) challenge.tags = [];
  if (challenge.startDate != null) challenge.startDate = challenge.startDate;
  if (challenge.endDate != null) challenge.endDate = challenge.endDate;
  if (challenge.discussions == null) challenge.discussions = [];
  if (challenge.skills == null) challenge.skills = [];

  challenge.metadata = challenge.metadata.map((m) => ({
    name: m.name,
    value: typeof m.value === "string" ? m.value : JSON.stringify(m.value),
  }));

  // No conversion needed - database stores values in dollars directly
  // The amountInCents field doesn't exist in the database schema
  const prizeType = challengeHelper.validatePrizeSetsAndGetPrizeType(challenge.prizeSets);
  logger.debug(
    `createChallenge: final prize validation complete (prizeType=${prizeType}) ${buildLogContext()}`
  );

  // If reviewers not provided, apply defaults for this (typeId, trackId)
  if (!challenge.reviewers || challenge.reviewers.length === 0) {
    if (challenge.typeId && challenge.trackId) {
      logger.debug(
        `createChallenge: loading default reviewers (trackId=${challenge.trackId}, typeId=${
          challenge.typeId
        }) ${buildLogContext()}`
      );
      const defaultReviewerWhere = {
        typeId: challenge.typeId,
        trackId: challenge.trackId,
      };
      let defaultReviewers = [];
      if (challenge.timelineTemplateId) {
        defaultReviewers = await prisma.defaultChallengeReviewer.findMany({
          where: {
            ...defaultReviewerWhere,
            timelineTemplateId: challenge.timelineTemplateId,
          },
          orderBy: { createdAt: "asc" },
        });
      }
      if (_.isEmpty(defaultReviewers)) {
        defaultReviewers = await prisma.defaultChallengeReviewer.findMany({
          where: {
            ...defaultReviewerWhere,
            timelineTemplateId: null,
          },
          orderBy: { createdAt: "asc" },
        });
      }
      logger.debug(
        `createChallenge: loaded ${defaultReviewers.length} default reviewers ${buildLogContext()}`
      );
      if (defaultReviewers && defaultReviewers.length > 0) {
        // Resolve phaseId by name
        const phaseNames = _.uniq(defaultReviewers.map((r) => r.phaseName));
        // Map phase name -> Phase definition id (Phase.id), NOT ChallengePhase.id
        const phaseMap = new Map(challenge.phases.map((p) => [p.name, p.phaseId]));

        // ensure all required names exist
        const missing = phaseNames.filter((n) => !phaseMap.has(n));
        if (missing.length > 0) {
          throw new BadRequestError(
            `Default reviewers reference unknown phaseName(s): ${missing.join(", ")}`
          );
        }

        challenge.reviewers = defaultReviewers.map((r) => ({
          scorecardId: r.scorecardId,
          isMemberReview: r.isMemberReview,
          memberReviewerCount: r.memberReviewerCount,
          // connect reviewers to the Phase model via its id
          phaseId: phaseMap.get(r.phaseName),
          fixedAmount: r.fixedAmount,
          baseCoefficient: r.baseCoefficient,
          incrementalCoefficient: r.incrementalCoefficient,
          type: r.opportunityType,
          aiWorkflowId: r.aiWorkflowId,
          shouldOpenOpportunity: _.isBoolean(r.shouldOpenOpportunity)
            ? r.shouldOpenOpportunity
            : true,
        }));
      }
    }
  }

  const prismaModel = prismaHelper.convertChallengeSchemaToPrisma(currentUser, challenge);
  logger.info(
    `createChallenge: creating challenge record via prisma ${buildLogContext()} phaseCount=${_.get(
      challenge,
      "phases.length",
      0
    )} prizeSetCount=${_.get(challenge, "prizeSets.length", 0)}`
  );
  const ret = await prisma.challenge.create({
    data: prismaModel,
    include: includeReturnFields,
  });
  logger.info(`createChallenge: challenge record created (id=${ret.id}) ${buildLogContext()}`);

  ret.overview = { totalPrizes: ret.overviewTotalPrizes };
  // No conversion needed - values are already in dollars in the database

  prismaHelper.convertModelToResponse(ret);
  await enrichSkillsData(ret);
  enrichChallengeForResponse(ret, track, type);

  // If the challenge is self-service, add the creating user as the "client manager", *not* the manager
  // This is necessary for proper handling of the vanilla embed on the self-service work item dashboard

  if (challenge.legacy.selfService) {
    if (currentUser.handle) {
      logger.debug(
        `createChallenge: assigning CLIENT_MANAGER role to creator (challengeId=${
          ret.id
        }) ${buildLogContext()}`
      );
      await helper.createResource(ret.id, ret.createdBy, config.CLIENT_MANAGER_ROLE_ID);
      logger.debug(
        `createChallenge: CLIENT_MANAGER role assignment complete (challengeId=${
          ret.id
        }) ${buildLogContext()}`
      );
    }
  } else {
    if (currentUser.handle) {
      logger.debug(
        `createChallenge: assigning MANAGER role to creator (challengeId=${
          ret.id
        }) ${buildLogContext()}`
      );
      await helper.createResource(ret.id, ret.createdBy, config.MANAGER_ROLE_ID);
      logger.debug(
        `createChallenge: MANAGER role assignment complete (challengeId=${
          ret.id
        }) ${buildLogContext()}`
      );
    }
  }

  // post bus event
  logger.info(
    `createChallenge: posting bus event ${constants.Topics.ChallengeCreated} (challengeId=${
      ret.id
    }) ${buildLogContext()}`
  );
  await helper.postBusEvent(constants.Topics.ChallengeCreated, ret);
  logger.info(
    `createChallenge: bus event posted ${constants.Topics.ChallengeCreated} (challengeId=${
      ret.id
    }) ${buildLogContext()}`
  );

  return helper.removeNullProperties(ret);
}
createChallenge.schema = {
  currentUser: Joi.any(),
  challenge: Joi.object()
    .keys({
      typeId: Joi.id(),
      trackId: Joi.id(),
      legacy: Joi.object().keys({
        reviewType: Joi.string()
          .valid(..._.values(ReviewTypeEnum))
          .insensitive()
          .default(ReviewTypeEnum.INTERNAL),
        confidentialityType: Joi.string().default(config.DEFAULT_CONFIDENTIALITY_TYPE),
        forumId: Joi.number().integer(),
        directProjectId: Joi.number().integer(),
        screeningScorecardId: Joi.number().integer(),
        reviewScorecardId: Joi.number().integer(),
        isTask: Joi.boolean(),
        useSchedulingAPI: Joi.boolean(),
        pureV5Task: Joi.boolean(),
        pureV5: Joi.boolean(),
        selfService: Joi.boolean(),
        selfServiceCopilot: Joi.string(),
      }),
      billing: Joi.object()
        .keys({
          billingAccountId: Joi.string(),
          markup: Joi.number().min(0).max(100),
          clientBillingRate: Joi.number().min(0).max(100),
        })
        .unknown(true),
      task: Joi.object().keys({
        isTask: Joi.boolean().default(false),
        isAssigned: Joi.boolean().default(false),
        memberId: Joi.string().allow(null),
      }),
      name: Joi.string().required(),
      description: Joi.string(),
      privateDescription: Joi.string(),
      descriptionFormat: Joi.string(),
      wiproAllowed: Joi.boolean().optional(),
      challengeSource: Joi.string(),
      numOfRegistrants: Joi.number().integer().min(0).optional(),
      numOfSubmissions: Joi.number().integer().min(0).optional(),
      numOfCheckpointSubmissions: Joi.number().integer().min(0).optional(),
      metadata: Joi.array()
        .items(
          Joi.object().keys({
            name: Joi.string().required(),
            value: Joi.required(),
          })
        )
        .unique((a, b) => a.name === b.name),
      timelineTemplateId: Joi.string(), // Joi.optionalId(),
      phases: Joi.array().items(
        Joi.object().keys({
          phaseId: Joi.id(),
          duration: Joi.number().integer().min(0),
          constraints: Joi.array()
            .items(
              Joi.object()
                .keys({
                  name: Joi.string(),
                  value: Joi.number().integer().min(0),
                })
                .optional()
            )
            .optional(),
        })
      ),
      events: Joi.array().items(
        Joi.object().keys({
          id: Joi.number().required(),
          name: Joi.string(),
          key: Joi.string(),
        })
      ),
      discussions: Joi.array().items(
        Joi.object().keys({
          id: Joi.optionalId(),
          name: Joi.string().required(),
          type: Joi.string().required().valid(..._.values(DiscussionTypeEnum)),
          provider: Joi.string().required(),
          url: Joi.string(),
          options: Joi.array().items(Joi.object()),
        })
      ),
      reviewers: Joi.array().items(
        Joi.object().keys({
          scorecardId: Joi.string().required(),
          isMemberReview: Joi.boolean().required(),
          shouldOpenOpportunity: Joi.boolean().default(true),
          memberReviewerCount: Joi.when("isMemberReview", {
            is: true,
            then: Joi.number().integer().min(1).required(),
            otherwise: Joi.forbidden(),
          }),
          phaseId: Joi.id().required(),
          type: Joi.when("isMemberReview", {
            is: true,
            then: Joi.string().valid(..._.values(ReviewOpportunityTypeEnum)).insensitive(),
            otherwise: Joi.forbidden(),
          }),
          aiWorkflowId: Joi.when("isMemberReview", {
            is: false,
            then: Joi.string().required(),
            otherwise: Joi.forbidden(),
          }),
          fixedAmount: Joi.number().min(0).optional().allow(null),
          baseCoefficient: Joi.number().min(0).max(1).optional().allow(null),
          incrementalCoefficient: Joi.number().min(0).max(1).optional().allow(null),
        })
      ),
      prizeSets: Joi.array().items(
        Joi.object().keys({
          type: Joi.string().valid(..._.values(PrizeSetTypeEnum)).required(),
          description: Joi.string(),
          prizes: Joi.array()
            .items(
              Joi.object().keys({
                description: Joi.string(),
                type: Joi.string().required(),
                value: Joi.number().min(0).required(),
              })
            )
            .min(1)
            .required(),
        })
      ),
      tags: Joi.array().items(Joi.string()), // tag names
      projectId: Joi.number().integer().positive(),
      legacyId: Joi.number().integer().positive(),
      constraints: Joi.object()
        .keys({
          allowedRegistrants: Joi.array().items(Joi.string().trim().lowercase()).optional(),
        })
        .optional(),
      startDate: Joi.date().iso(),
      status: Joi.string().valid(
        ChallengeStatusEnum.ACTIVE,
        ChallengeStatusEnum.NEW,
        ChallengeStatusEnum.DRAFT,
        ChallengeStatusEnum.APPROVED
      ),
      groups: Joi.array().items(Joi.optionalId()).unique(),
      // gitRepoURLs: Joi.array().items(Joi.string().uri()),
      terms: Joi.array().items(
        Joi.object().keys({
          id: Joi.id(),
          roleId: Joi.id(),
        })
      ),
      skills: Joi.array()
        .items(
          Joi.object()
            .keys({
              id: Joi.id(),
            })
            .unknown(true)
        )
        .optional(),
    })
    .required(),
  userToken: Joi.string().required(),
};

/**
 * Get challenge.
 * @param {Object} currentUser the user who perform operation
 * @param {String} id the challenge id
 * @param {Boolean} checkIfExists flag to check if challenge exists
 * @returns {Object} the challenge with given id
 */
async function getChallenge(currentUser, id, checkIfExists) {
  // Log the ID of the challenge being requested
  logger.info(`Requesting challenge by id: ${id}`);
  const challenge = await prisma.challenge.findUnique({
    where: { id },
    include: includeReturnFields,
  });
  if (_.isNil(challenge) || _.isNil(challenge.id)) {
    throw new errors.NotFoundError(`Challenge of id ${id} is not found.`);
  }
  if (checkIfExists) {
    return _.pick(challenge, ["id", "legacyId"]);
  }
  await helper.ensureUserCanViewChallenge(currentUser, challenge);

  // Remove privateDescription for unregistered users
  if (currentUser) {
    if (!currentUser.isMachine && !hasAdminRole(currentUser)) {
      _.unset(challenge, "billing");
      if (_.isEmpty(challenge.privateDescription)) {
        _.unset(challenge, "privateDescription");
      } else if (
        !_.get(challenge, "task.isTask", false) ||
        !_.get(challenge, "task.isAssigned", false)
      ) {
        const memberResources = await helper.listResourcesByMemberAndChallenge(
          currentUser.userId,
          challenge.id
        );
        if (_.isEmpty(memberResources)) {
          _.unset(challenge, "privateDescription");
        }
      }
    }
  } else {
    _.unset(challenge, "billing");
    _.unset(challenge, "privateDescription");
  }

  if (challenge.status !== ChallengeStatusEnum.COMPLETED) {
    _.unset(challenge, "winners");
    _.unset(challenge, "checkpointWinners");
  }

  // TODO: in the long run we wanna do a finer grained filtering of the payments
  if (!hasAdminRole(currentUser) && !_.get(currentUser, "isMachine", false)) {
    _.unset(challenge, "payments");
  }

  prismaHelper.convertModelToResponse(challenge);

  // Enrich skills data with full details from standardized skills API
  await enrichSkillsData(challenge);

  enrichChallengeForResponse(challenge, challenge.track, challenge.type);

  // Note: numOfRegistrants and numOfSubmissions are no longer calculated here.

  return helper.removeNullProperties(challenge);
}
getChallenge.schema = {
  currentUser: Joi.any(),
  id: Joi.id(),
  checkIfExists: Joi.boolean(),
};

/**
 * Get challenge statistics
 * @param {Object} currentUser the user who perform operation
 * @param {String} id the challenge id
 * @returns {Object} the challenge with given id
 */
async function getChallengeStatistics(currentUser, id) {
  // get submissions
  console.log("Getting challenge submissions for challenge ID: " + id);
  const submissions = await helper.getChallengeSubmissions(id);
  console.log(`Found ${submissions.length} submissions`);
  if (submissions.length === 0) {
    return [];
  }
  // for each submission, load member profile
  const map = {};
  for (const submission of submissions) {
    if (!map[submission.memberId]) {
      console.log("Finding member ID: " + submission.memberId);
      // Load member profile and cache
      const member = await helper.getMemberById(submission.memberId);
      map[submission.memberId] = {
        photoUrl: member.photoURL,
        rating: _.get(member, "maxRating.rating", 0),
        ratingColor: _.get(member, "maxRating.ratingColor", "#9D9FA0"),
        homeCountryCode: member.homeCountryCode,
        handle: member.handle,
        submissions: [],
      };
    }
    // add submission
    map[submission.memberId].submissions.push({
      created: submission.createdAt,
      score: _.get(
        _.find(submission.review || [], (r) => r.metadata),
        "score",
        0
      ),
    });
  }
  return _.map(_.keys(map), (userId) => map[userId]);
}
getChallengeStatistics.schema = {
  currentUser: Joi.any(),
  id: Joi.id(),
};

/**
 * Check whether given two PrizeSet Array are different.
 * @param {Array} prizeSets the first PrizeSet Array
 * @param {Array} otherPrizeSets the second PrizeSet Array
 * @returns {Boolean} true if different, false otherwise
 */
function isDifferentPrizeSets(prizeSets = [], otherPrizeSets = []) {
  return !_.isEqual(_.sortBy(prizeSets, "type"), _.sortBy(otherPrizeSets, "type"));
}

/**
 * Validate the winners array.
 * @param {Array} winners the Winner Array
 * @param {Array} challengeResources the challenge resources
 */
function buildCombinedWinnerPayload(data = {}) {
  const combined = [];
  if (Array.isArray(data.winners)) {
    combined.push(
      ...data.winners.map((winner) => ({
        ...winner,
        type: _.toUpper(winner.type || PrizeSetTypeEnum.PLACEMENT),
      }))
    );
  }
  if (Array.isArray(data.checkpointWinners)) {
    combined.push(
      ...data.checkpointWinners.map((winner) => ({
        ...winner,
        type: _.toUpper(winner.type || PrizeSetTypeEnum.CHECKPOINT),
      }))
    );
  }
  return combined;
}

async function validateWinners(winners, challengeResources) {
  const registrants = _.filter(challengeResources, (r) => r.roleId === config.SUBMITTER_ROLE_ID);
  for (const prizeType of _.values(PrizeSetTypeEnum)) {
    const filteredWinners = _.filter(winners, (w) => w.type === prizeType);
    for (const winner of filteredWinners) {
      if (!_.find(registrants, (r) => _.toString(r.memberId) === _.toString(winner.userId))) {
        throw new errors.BadRequestError(
          `Member with userId: ${winner.userId} is not registered on the challenge`
        );
      }
      const diffWinners = _.differenceWith(filteredWinners, [winner], _.isEqual);
      if (diffWinners.length + 1 !== filteredWinners.length) {
        throw new errors.BadRequestError(
          `Duplicate member with placement: ${helper.toString(winner)}`
        );
      }

      // find another member with the placement
      const placementExists = _.find(diffWinners, function (w) {
        return w.placement === winner.placement;
      });
      if (
        placementExists &&
        (placementExists.userId !== winner.userId || placementExists.handle !== winner.handle)
      ) {
        throw new errors.BadRequestError(
          `Only one member can have a placement: ${winner.placement}`
        );
      }

      // find another placement for a member
      const memberExists = _.find(diffWinners, function (w) {
        return w.userId === winner.userId && w.type === winner.type;
      });
      if (memberExists && memberExists.placement !== winner.placement) {
        throw new errors.BadRequestError(
          `The same member ${winner.userId} cannot have multiple placements`
        );
      }
    }
  }
}

/**
 * Task shouldn't be launched/completed when it is assigned to the current user self.
 * E.g: stop copilots from paying themselves, thus copilots will need to contact manager to launch/complete the task.
 * @param {Object} currentUser the user who perform operation
 * @param {Object} challenge the existing challenge
 * @param {Object} data the new input challenge data
 * @param {Array} challengeResources the challenge resources
 */
function validateTask(currentUser, challenge, data, challengeResources) {
  if (!_.get(challenge, "legacy.pureV5Task")) {
    // Not a Task
    return;
  }

  // Status changed to Active, indicating launch a Task
  const isLaunchTask =
    data.status === ChallengeStatusEnum.ACTIVE && challenge.status !== ChallengeStatusEnum.ACTIVE;

  // Status changed to Completed, indicating complete a Task
  const isCompleteTask =
    data.status === ChallengeStatusEnum.COMPLETED &&
    challenge.status !== ChallengeStatusEnum.COMPLETED;

  // When complete a Task, input data should have winners
  if (isCompleteTask && (!data.winners || !data.winners.length)) {
    throw new errors.BadRequestError("The winners is required to complete a Task");
  }

  if (!currentUser.isMachine && (isLaunchTask || isCompleteTask)) {
    // Whether task is assigned to current user
    const assignedToCurrentUser =
      _.filter(
        challengeResources,
        (r) =>
          r.roleId === config.SUBMITTER_ROLE_ID &&
          _.toString(r.memberId) === _.toString(currentUser.userId)
      ).length > 0;

    if (assignedToCurrentUser) {
      throw new errors.ForbiddenError(
        `You are not allowed to ${
          data.status === ChallengeStatusEnum.ACTIVE ? "lanuch" : "complete"
        } task assigned to yourself. Please contact manager to operate.`
      );
    }
  }
}

function prepareTaskCompletionData(challenge, challengeResources, data) {
  const isTask = _.get(challenge, "legacy.pureV5Task");
  const isCompleteTask =
    data.status === ChallengeStatusEnum.COMPLETED &&
    challenge.status !== ChallengeStatusEnum.COMPLETED;

  if (!isTask || !isCompleteTask) {
    return null;
  }

  const submitters = _.filter(
    challengeResources,
    (resource) => resource.roleId === config.SUBMITTER_ROLE_ID
  );

  if (!submitters || submitters.length === 0) {
    throw new errors.BadRequestError("Task has no submitter resource");
  }

  if (!data.winners || data.winners.length === 0) {
    const submitter = submitters[0];
    data.winners = [
      {
        userId: parseInt(submitter.memberId, 10),
        handle: submitter.memberHandle,
        placement: 1,
        type: PrizeSetTypeEnum.PLACEMENT,
      },
    ];
  }

  const completionTime = new Date().toISOString();
  const startTime = challenge.startDate || completionTime;

  const updatedPhases = _.map(challenge.phases || [], (phase) => ({
    id: phase.id,
    phaseId: phase.phaseId,
    name: phase.name,
    description: phase.description,
    duration: phase.duration,
    scheduledStartDate: phase.scheduledStartDate,
    scheduledEndDate: phase.scheduledEndDate,
    predecessor: phase.predecessor,
    constraints: _.cloneDeep(phase.constraints),
    actualStartDate: startTime,
    actualEndDate: completionTime,
    isOpen: false,
  }));

  data.phases = updatedPhases;

  return {
    shouldTriggerPayments: true,
    completionTime,
  };
}

/**
 * Update challenge.
 * @param {Object} currentUser the user who perform operation
 * @param {String} challengeId the challenge id
 * @param {Object} data the challenge data to be updated
 * @returns {Object} the updated challenge
 */
// Note: `options` may be a boolean for backward compatibility (emitEvent flag),
// or an object { emitEvent?: boolean }.
async function updateChallenge(currentUser, challengeId, data, options = {}) {
  // Backward compatibility for callers passing a boolean as the 4th arg
  let emitEvent = true;
  if (typeof options === "boolean") {
    emitEvent = options;
  } else if (options && Object.prototype.hasOwnProperty.call(options, "emitEvent")) {
    emitEvent = options.emitEvent !== false;
  }
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: includeReturnFields,
  });
  if (!challenge || !challenge.id) {
    throw new errors.NotFoundError(`Challenge with id: ${challengeId} doesn't exist`);
  }
  enrichChallengeForResponse(challenge);
  prismaHelper.convertModelToResponse(challenge);
  const originalChallengePhases = _.cloneDeep(challenge.phases || []);
  const auditUserId = _.toString(currentUser.userId);
  const existingPrizeType = challengeHelper.validatePrizeSetsAndGetPrizeType(challenge.prizeSets);
  const payloadIncludesTerms =
    !_.isNil(data) && Object.prototype.hasOwnProperty.call(data, "terms");
  const originalTermsValue = payloadIncludesTerms ? data.terms : undefined;

  // No conversion needed - values are already in dollars in the database

  let projectId, billingAccountId, markup;
  if (challengeHelper.isProjectIdRequired(challenge.timelineTemplateId)) {
    projectId = _.get(challenge, "projectId");

    logger.debug(
      `updateChallenge(${challengeId}): requesting billing information for project ${projectId}`
    );
    ({ billingAccountId, markup } = await projectHelper.getProjectBillingInformation(projectId));
    logger.debug(
      `updateChallenge(${challengeId}): billing lookup complete (hasAccount=${
        billingAccountId != null
      })`
    );

    if (billingAccountId && _.isUndefined(_.get(challenge, "billing.billingAccountId"))) {
      // Ensure billingAccountId is a string or null to match Prisma schema
      if (billingAccountId !== null && billingAccountId !== undefined) {
        _.set(data, "billing.billingAccountId", String(billingAccountId));
      } else {
        _.set(data, "billing.billingAccountId", null);
      }
      _.set(data, "billing.markup", markup || 0);
    }

    // Make sure the user cannot change the direct project ID
    if (data.legacy) {
      data.legacy = _.assign({}, challenge.legacy, data.legacy);
      _.set(data, "legacy.directProjectId", challenge.legacy.directProjectId);
    }
  }

  // Treat incoming `reviews` payloads as an alias for `reviewers`
  if (!_.isNil(data.reviews)) {
    if (!Array.isArray(data.reviews)) {
      throw new BadRequestError("reviews must be an array");
    }
    if (_.isNil(data.reviewers)) {
      data.reviewers = _.cloneDeep(data.reviews);
    }
    delete data.reviews;
  }

  // Remove fields from data that are not allowed to be updated and that match the existing challenge
  data = sanitizeData(sanitizeChallenge(data), challenge);
  const sanitizedIncludesTerms = Object.prototype.hasOwnProperty.call(data, "terms");
  const shouldReplaceTerms =
    sanitizedIncludesTerms || (payloadIncludesTerms && originalTermsValue === null);
  logger.debug(`Sanitized Data: ${JSON.stringify(data)}`);

  logger.debug(`updateChallenge(${challengeId}): fetching challenge resources`);
  const challengeResources = await helper.getChallengeResources(challengeId);
  logger.debug(
    `updateChallenge(${challengeId}): fetched ${challengeResources.length} challenge resources`
  );

  logger.debug(`updateChallenge(${challengeId}): validating update payload`);
  await challengeHelper.validateChallengeUpdateRequest(
    currentUser,
    challenge,
    data,
    challengeResources
  );
  logger.debug(`updateChallenge(${challengeId}): payload validation complete`);
  validateTask(currentUser, challenge, data, challengeResources);
  const taskCompletionInfo = prepareTaskCompletionData(challenge, challengeResources, data);

  const isStatusChangingToActive =
    data.status === ChallengeStatusEnum.ACTIVE && challenge.status !== ChallengeStatusEnum.ACTIVE;
  let sendActivationEmail = false;
  let sendSubmittedEmail = false;
  let sendCompletedEmail = false;
  let sendRejectedEmail = false;

  /* BEGIN self-service stuffs */

  // TODO: At some point in the future this should be moved to a Self-Service Challenge Helper

  if (challenge.legacy.selfService) {
    // prettier-ignore
    sendSubmittedEmail = data.status === ChallengeStatusEnum.DRAFT && challenge.status !== ChallengeStatusEnum.DRAFT;

    if (data.metadata && data.metadata.length > 0) {
      let dynamicDescription = _.cloneDeep(data.description || challenge.description);
      for (const entry of data.metadata) {
        const regexp = new RegExp(`{{${entry.name}}}`, "g");
        dynamicDescription = dynamicDescription.replace(regexp, entry.value);
      }
      data.description = dynamicDescription;
    }

    // check if it's a self service challenge and project needs to be activated first
    if (
      (data.status === ChallengeStatusEnum.APPROVED ||
        data.status === ChallengeStatusEnum.ACTIVE) &&
      challenge.status !== ChallengeStatusEnum.ACTIVE &&
      challengeHelper.isProjectIdRequired(challenge.timelineTemplateId)
    ) {
      try {
        const selfServiceProjectName = `Self service - ${challenge.createdBy} - ${challenge.name}`;
        const workItemSummary = _.get(
          _.find(_.get(challenge, "metadata", []), (m) => m.name === "websitePurpose.description"),
          "value",
          "N/A"
        );
        logger.debug(
          `updateChallenge(${challengeId}): activating self-service project ${projectId}`
        );
        await helper.activateProject(
          projectId,
          currentUser,
          selfServiceProjectName,
          workItemSummary
        );

        sendActivationEmail = data.status === ChallengeStatusEnum.ACTIVE;
      } catch (e) {
        await updateChallenge(
          currentUser,
          challengeId,
          {
            ...data,
            status: ChallengeStatusEnum.CANCELLED_PAYMENT_FAILED,
            cancelReason: `Failed to activate project. Error: ${e.message}. JSON: ${JSON.stringify(
              e
            )}`,
          },
          false
        );
        throw new errors.BadRequestError(
          "Failed to activate the challenge! The challenge has been canceled!"
        );
      }
    }

    if (
      data.status === ChallengeStatusEnum.DRAFT &&
      challengeHelper.isProjectIdRequired(challenge.timelineTemplateId)
    ) {
      try {
        logger.debug(
          `updateChallenge(${challengeId}): updating self-service project info for project ${projectId}`
        );
        await helper.updateSelfServiceProjectInfo(
          projectId,
          data.endDate || challenge.endDate,
          currentUser
        );
      } catch (e) {
        logger.debug(`There was an error trying to update the project: ${e.message}`);
      }
    }

    if (
      (data.status === ChallengeStatusEnum.CANCELLED_REQUIREMENTS_INFEASIBLE ||
        data.status === ChallengeStatusEnum.CANCELLED_PAYMENT_FAILED) &&
      challengeHelper.isProjectIdRequired(challenge.timelineTemplateId)
    ) {
      try {
        logger.debug(
          `updateChallenge(${challengeId}): cancelling self-service project ${challenge.projectId}`
        );
        await helper.cancelProject(challenge.projectId, data.cancelReason, currentUser);
      } catch (e) {
        logger.debug(`There was an error trying to cancel the project: ${e.message}`);
      }
      sendRejectedEmail = true;
    }
  }

  /* END self-service stuffs */

  let isChallengeBeingActivated = isStatusChangingToActive;
  let isChallengeBeingCancelled = false;
  if (data.status) {
    if (data.status === ChallengeStatusEnum.ACTIVE) {
      // if activating a challenge, the challenge must have a billing account id
      if (
        (!billingAccountId || billingAccountId === null) &&
        challenge.status === ChallengeStatusEnum.DRAFT &&
        challengeHelper.isProjectIdRequired(challenge.timelineTemplateId)
      ) {
        throw new errors.BadRequestError(
          "Cannot Activate this project, it has no active billing account."
        );
      }
    }

    if (
      _.includes(
        [
          ChallengeStatusEnum.CANCELLED,
          ChallengeStatusEnum.CANCELLED_REQUIREMENTS_INFEASIBLE,
          ChallengeStatusEnum.CANCELLED_PAYMENT_FAILED,
          ChallengeStatusEnum.CANCELLED_FAILED_REVIEW,
          ChallengeStatusEnum.CANCELLED_FAILED_SCREENING,
          ChallengeStatusEnum.CANCELLED_ZERO_SUBMISSIONS,
          ChallengeStatusEnum.CANCELLED_WINNER_UNRESPONSIVE,
          ChallengeStatusEnum.CANCELLED_CLIENT_REQUEST,
          ChallengeStatusEnum.CANCELLED_ZERO_REGISTRATIONS,
        ],
        data.status
      )
    ) {
      isChallengeBeingCancelled = true;
    }

    if (data.status === ChallengeStatusEnum.COMPLETED) {
      if (
        !_.get(challenge, "legacy.pureV5Task") &&
        !_.get(challenge, "legacy.pureV5") &&
        challenge.status !== ChallengeStatusEnum.ACTIVE
      ) {
        throw new errors.BadRequestError("You cannot mark a Draft challenge as Completed");
      }
      sendCompletedEmail = true;
    }
  }

  // Only M2M can update url and options of discussions
  if (data.discussions && data.discussions.length > 0) {
    if (challenge.discussions && challenge.discussions.length > 0) {
      for (let i = 0; i < data.discussions.length; i += 1) {
        if (_.isUndefined(data.discussions[i].id)) {
          data.discussions[i].id = uuid();
          if (!currentUser.isMachine) {
            _.unset(data.discussions, "url");
            _.unset(data.discussions, "options");
          }
        } else if (!currentUser.isMachine) {
          const existingDiscussion = _.find(
            _.get(challenge, "discussions", []),
            (d) => d.id === data.discussions[i].id
          );
          if (existingDiscussion) {
            _.assign(data.discussions[i], _.pick(existingDiscussion, ["url", "options"]));
          } else {
            _.unset(data.discussions, "url");
            _.unset(data.discussions, "options");
          }
        }
      }
    } else {
      for (let i = 0; i < data.discussions.length; i += 1) {
        data.discussions[i].id = uuid();
        data.discussions[i].name = data.discussions[i].name.substring(
          0,
          config.FORUM_TITLE_LENGTH_LIMIT
        );
      }
    }
  }

  // TODO: Fix this Tech Debt once legacy is turned off
  const finalStatus = data.status || challenge.status;
  const finalTimelineTemplateId = data.timelineTemplateId || challenge.timelineTemplateId;
  let timelineTemplateChanged = false;
  if (
    !currentUser.isMachine &&
    !hasAdminRole(currentUser) &&
    !_.get(data, "legacy.pureV5") &&
    !_.get(challenge, "legacy.pureV5")
  ) {
    if (
      finalStatus !== ChallengeStatusEnum.NEW &&
      finalTimelineTemplateId !== challenge.timelineTemplateId
    ) {
      throw new errors.BadRequestError(
        `Cannot change the timelineTemplateId for challenges with status: ${finalStatus}`
      );
    }
  } else if (finalTimelineTemplateId !== challenge.timelineTemplateId) {
    // make sure there are no previous phases if the timeline template has changed
    challenge.phases = [];
    timelineTemplateChanged = true;
  }

  if (data.prizeSets) {
    if (
      isDifferentPrizeSets(data.prizeSets, challenge.prizeSets) &&
      finalStatus === ChallengeStatusEnum.COMPLETED
    ) {
      // Allow only M2M to update prizeSets for completed challenges
      if (!currentUser.isMachine || (challenge.task != null && challenge.task.isTask !== true)) {
        throw new errors.BadRequestError(
          `Cannot update prizeSets for challenges with status: ${finalStatus}!`
        );
      }
    }

    const prizeSetsGroup = _.groupBy(data.prizeSets, "type");
    if (prizeSetsGroup[PrizeSetTypeEnum.PLACEMENT]) {
      const totalPrizes = helper.sumOfPrizes(prizeSetsGroup[PrizeSetTypeEnum.PLACEMENT][0].prizes);
      _.assign(data, { overview: { totalPrizes } });
    }
  }

  let phasesUpdated = false;
  let phasesForUpdate = null;
  if (
    ((data.phases && data.phases.length > 0) ||
      isChallengeBeingActivated ||
      timelineTemplateChanged) &&
    !isChallengeBeingCancelled
  ) {
    if (
      challenge.status === ChallengeStatusEnum.COMPLETED ||
      challenge.status.indexOf(ChallengeStatusEnum.CANCELLED) > -1
    ) {
      throw new BadRequestError(
        `Challenge phase/start date can not be modified for Completed or Cancelled challenges.`
      );
    }
    const newStartDate = data.startDate || challenge.startDate;
    let newPhases;
    if (timelineTemplateChanged) {
      newPhases = await phaseHelper.populatePhasesForChallengeCreation(
        data.phases,
        newStartDate,
        finalTimelineTemplateId
      );
    } else {
      newPhases = await phaseHelper.populatePhasesForChallengeUpdate(
        challenge.phases,
        data.phases,
        challenge.timelineTemplateId,
        isChallengeBeingActivated
      );
    }
    phasesUpdated = true;
    data.phases = newPhases;
    phasesForUpdate = _.cloneDeep(newPhases);
  }
  if (isChallengeBeingCancelled && challenge.phases && challenge.phases.length > 0) {
    data.phases = phaseHelper.handlePhasesAfterCancelling(challenge.phases);
    phasesUpdated = true;
    phasesForUpdate = _.cloneDeep(data.phases);
  }
  const phasesForDates = phasesUpdated ? data.phases : challenge.phases;

  if (phasesUpdated || data.startDate) {
    const startSource =
      phasesForDates && phasesForDates.length > 0
        ? _.min(_.map(phasesForDates, "scheduledStartDate"))
        : data.startDate || challenge.startDate;

    if (!_.isNil(startSource)) {
      data.startDate = convertToISOString(startSource);
    }
  }
  if (phasesUpdated || data.endDate) {
    const endSource =
      phasesForDates && phasesForDates.length > 0
        ? _.max(_.map(phasesForDates, "scheduledEndDate"))
        : data.endDate || challenge.endDate;

    if (!_.isNil(endSource)) {
      data.endDate = convertToISOString(endSource);
    }
  }

  const combinedWinnerPayload = buildCombinedWinnerPayload(data);
  if (combinedWinnerPayload.length > 0) {
    await validateWinners(combinedWinnerPayload, challengeResources);
  }

  if (_.get(challenge, "legacy.pureV5Task", false) && !_.isUndefined(data.winners)) {
    _.each(data.winners, (w) => {
      w.type = PrizeSetTypeEnum.PLACEMENT;
    });
  }

  // Only m2m tokens are allowed to modify the `task.*` information on a challenge
  if (!_.isUndefined(_.get(data, "task")) && !currentUser.isMachine) {
    if (!_.isUndefined(_.get(challenge, "task"))) {
      logger.info(
        `User ${
          currentUser.handle || currentUser.sub
        } is not allowed to modify the task information on challenge ${challengeId}`
      );
      data.task = challenge.task;
      logger.info(
        `Task information on challenge ${challengeId} is reset to ${JSON.stringify(
          challenge.task
        )}. Original data: ${JSON.stringify(data.task)}`
      );
    } else {
      delete data.task;
    }
  }

  // task.memberId goes out of sync due to another processor setting "task.memberId" but subsequent immediate update to the task
  // will not have the memberId set. So we need to set it using winners to ensure it is always in sync. The proper fix is to correct
  // the sync issue in the processor. However this is quick fix that works since winner.userId is task.memberId.
  if (_.get(challenge, "legacy.pureV5Task") && !_.isUndefined(data.winners)) {
    const winnerMemberId = _.get(data.winners, "[0].userId");
    logger.info(
      `Setting task.memberId to ${winnerMemberId} for challenge ${challengeId}. Task ${_.get(
        data,
        "task"
      )} - ${_.get(challenge, "task")}`
    );

    if (winnerMemberId != null && _.get(data, "task.memberId") !== winnerMemberId) {
      logger.info(`Task ${challengeId} has a winner ${winnerMemberId}`);
      data.task = {
        isTask: true,
        isAssigned: true,
        memberId: winnerMemberId,
      };
      logger.warn(
        `task.memberId mismatched with winner memberId. task.memberId is updated to ${winnerMemberId}`
      );
    } else {
      logger.info(`task ${challengeId} has no winner set yet.`);
    }
  } else {
    logger.info(`${challengeId} is not a pureV5 challenge or has no winners set yet.`);
  }

  const { track, type } = await challengeHelper.validateAndGetChallengeTypeAndTrack({
    typeId: challenge.typeId,
    trackId: challenge.trackId,
    timelineTemplateId: timelineTemplateChanged
      ? finalTimelineTemplateId
      : challenge.timelineTemplateId,
  });

  if (_.get(type, "isTask")) {
    if (!_.isEmpty(_.get(data, "task.memberId"))) {
      const registrants = _.filter(
        challengeResources,
        (r) => r.roleId === config.SUBMITTER_ROLE_ID
      );
      if (
        !_.find(
          registrants,
          (r) => _.toString(r.memberId) === _.toString(_.get(data, "task.memberId"))
        )
      ) {
        throw new errors.BadRequestError(
          `Member ${_.get(
            data,
            "task.memberId"
          )} is not a submitter resource of challenge ${challengeId}`
        );
      }
    }
  }

  if (!_.isUndefined(data.terms)) {
    data.terms = await helper.validateChallengeTerms(data.terms);
  }

  if (data.phases && data.phases.length > 0) {
    if (deepEqual(data.phases, challenge.phases)) {
      delete data.phases;
    }
  }
  if (_.isNil(data.phases)) {
    phasesForUpdate = null;
  }

  // Normalize and validate reviewers' phase references before converting to Prisma input
  if (!_.isNil(data.reviewers)) {
    try {
      // Build maps from the existing challenge phases
      const challengePhaseIdToPhaseId = new Map(); // ChallengePhase.id -> Phase.id
      const phaseIdsOnChallenge = new Set(); // Phase.id present on this challenge
      if (challenge && Array.isArray(challenge.phases)) {
        for (const p of challenge.phases) {
          if (p && p.id && p.phaseId) {
            challengePhaseIdToPhaseId.set(p.id, p.phaseId);
            phaseIdsOnChallenge.add(p.phaseId);
          }
        }
      }

      // First pass: map any reviewer.phaseId that actually points to a ChallengePhase.id
      for (const r of data.reviewers) {
        if (r && r.phaseId && challengePhaseIdToPhaseId.has(r.phaseId)) {
          r.phaseId = challengePhaseIdToPhaseId.get(r.phaseId);
        }
      }

      // Validate all referenced Phase ids exist
      const uniquePhaseIds = _.uniq(
        data.reviewers.filter((r) => r && r.phaseId).map((r) => r.phaseId)
      );
      if (uniquePhaseIds.length > 0) {
        const foundPhases = await prisma.phase.findMany({ where: { id: { in: uniquePhaseIds } } });
        const foundIds = new Set(foundPhases.map((p) => p.id));
        const missing = uniquePhaseIds.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
          throw new errors.BadRequestError(
            `Invalid reviewer.phaseId value(s); Phase not found: ${missing.join(", ")}`
          );
        }
      }
    } catch (e) {
      // Re-throw as BadRequest to avoid nested Prisma errors later
      if (!(e instanceof errors.BadRequestError)) {
        throw new errors.BadRequestError(e.message || "Invalid reviewer phase reference");
      }
      throw e;
    }
  }

  if (!_.isNil(data.reviewers)) {
    await ensureScorecardChangeDoesNotConflict({
      challengeId,
      originalReviewers: challenge.reviewers || [],
      updatedReviewers: data.reviewers,
      originalChallengePhases,
    });
  }

  if (
    isStatusChangingToActive &&
    (challenge.status === ChallengeStatusEnum.NEW || challenge.status === ChallengeStatusEnum.DRAFT)
  ) {
    const effectiveReviewers = Array.isArray(data.reviewers)
      ? data.reviewers
      : Array.isArray(challenge.reviewers)
      ? challenge.reviewers
      : [];

    const reviewersMissingFields = [];
    effectiveReviewers.forEach((reviewer, index) => {
      const hasScorecardId =
        reviewer && !_.isNil(reviewer.scorecardId) && String(reviewer.scorecardId).trim() !== "";
      const hasPhaseId =
        reviewer && !_.isNil(reviewer.phaseId) && String(reviewer.phaseId).trim() !== "";

      if (!hasScorecardId || !hasPhaseId) {
        const missing = [];
        if (!hasScorecardId) missing.push("scorecardId");
        if (!hasPhaseId) missing.push("phaseId");
        reviewersMissingFields.push(`reviewer[${index}] missing ${missing.join(" and ")}`);
      }
    });

    if (reviewersMissingFields.length > 0) {
      throw new errors.BadRequestError(
        `Cannot activate challenge; reviewers are missing required fields: ${reviewersMissingFields.join(
          "; "
        )}`
      );
    }

    const reviewerPhaseIds = new Set(
      effectiveReviewers
        .filter((reviewer) => reviewer && reviewer.phaseId)
        .map((reviewer) => String(reviewer.phaseId))
    );

    if (reviewerPhaseIds.size === 0) {
      throw new errors.BadRequestError(
        "Cannot activate a challenge without at least one reviewer configured"
      );
    }

    const normalizePhaseName = (name) => String(name || "").trim().toLowerCase();
    const effectivePhases =
      (Array.isArray(phasesForUpdate) && phasesForUpdate.length > 0
        ? phasesForUpdate
        : challenge.phases) || [];

    const missingPhaseNames = new Set();
    for (const phase of effectivePhases) {
      if (!phase) {
        continue;
      }
      const normalizedName = normalizePhaseName(phase.name);
      if (!REQUIRED_REVIEW_PHASE_NAME_SET.has(normalizedName)) {
        continue;
      }
      const phaseId = _.get(phase, "phaseId");
      if (!phaseId || !reviewerPhaseIds.has(String(phaseId))) {
        missingPhaseNames.add(phase.name || "Unknown phase");
      }
    }

    if (missingPhaseNames.size > 0) {
      throw new errors.BadRequestError(
        `Cannot activate challenge; missing reviewers for phase(s): ${Array.from(
          missingPhaseNames
        ).join(", ")}`
      );
    }
  }

  // convert data to prisma models
  const updateData = prismaHelper.convertChallengeSchemaToPrisma(
    currentUser,
    _.omit(data, ["cancelReason"])
  );
  updateData.updatedBy = _.toString(currentUser.userId);
  // reset createdBy
  delete updateData.createdBy;
  if (!_.isNil(updateData.phases)) {
    delete updateData.phases;
  }

  const newPrizeType = challengeHelper.validatePrizeSetsAndGetPrizeType(updateData.prizeSets);
  if (newPrizeType != null && existingPrizeType != null && newPrizeType !== existingPrizeType) {
    throw new errors.BadRequestError(
      `Cannot change prize type from ${existingPrizeType} to ${newPrizeType}`
    );
  }
  const updatedChallenge = await prisma.$transaction(async (tx) => {
    if (Array.isArray(phasesForUpdate)) {
      await syncChallengePhases(
        tx,
        challengeId,
        phasesForUpdate,
        auditUserId,
        originalChallengePhases
      );
    }
    // drop nested data if updated
    if (!_.isNil(updateData.legacyRecord)) {
      await tx.challengeLegacy.deleteMany({ where: { challengeId } });
    }
    if (!_.isNil(updateData.billingRecord)) {
      await tx.challengeBilling.deleteMany({ where: { challengeId } });
    }
    if (!_.isNil(updateData.constraintRecord)) {
      await tx.challengeConstraint.deleteMany({ where: { challengeId } });
    }
    if (!_.isNil(updateData.events)) {
      await tx.challengeEvent.deleteMany({ where: { challengeId } });
    }
    if (!_.isNil(updateData.discussions)) {
      await tx.challengeDiscussion.deleteMany({ where: { challengeId } });
    }
    if (!_.isNil(updateData.metadata)) {
      await tx.challengeMetadata.deleteMany({ where: { challengeId } });
    }
    if (!_.isNil(updateData.prizeSets)) {
      await tx.challengePrizeSet.deleteMany({ where: { challengeId } });
    }
    if (!_.isNil(updateData.reviewers)) {
      await tx.challengeReviewer.deleteMany({ where: { challengeId } });
    }
    if (_.isNil(updateData.winners)) {
      await tx.challengeWinner.deleteMany({ where: { challengeId } });
    }
    if (_.isNil(updateData.attachment)) {
      await tx.attachment.deleteMany({ where: { challengeId } });
    }
    if (shouldReplaceTerms) {
      await tx.challengeTerm.deleteMany({ where: { challengeId } });
    }
    // if (_.isNil(updateData.skills)) {
    //   await tx.challengeSkill.deleteMany({ where: { challengeId } });
    // }

    return await tx.challenge.update({
      data: updateData,
      where: { id: challengeId },
      include: includeReturnFields,
    });
  });
  if (taskCompletionInfo && taskCompletionInfo.shouldTriggerPayments) {
    logger.info(`Triggering payment generation for Task challenge ${challengeId}`);
    try {
      const paymentSuccess = await helper.generateChallengePayments(challengeId);
      if (!paymentSuccess) {
        logger.warn(`Failed to generate payments for Task challenge ${challengeId}`);
      }
    } catch (err) {
      logger.error(
        `Error generating payments for Task challenge ${challengeId}: ${err.message}`
      );
    }
  }
  // Re-fetch the challenge outside the transaction to ensure we publish
  // only after the commit succeeds and using the committed snapshot.
  if (emitEvent) {
    const committed = await prisma.challenge.findUnique({
      where: { id: challengeId },
      include: includeReturnFields,
    });
    await indexChallengeAndPostToKafka(committed, track, type);
  }

  // Convert to response shape before any business-logic checks that expect it
  prismaHelper.convertModelToResponse(updatedChallenge);
  await enrichSkillsData(updatedChallenge);
  enrichChallengeForResponse(updatedChallenge);

  if (_.get(updatedChallenge, "legacy.selfService")) {
    const creator = await helper.getMemberByHandle(updatedChallenge.createdBy);
    if (sendSubmittedEmail) {
      await helper.sendSelfServiceNotification(
        constants.SelfServiceNotificationTypes.WORK_REQUEST_SUBMITTED,
        [{ email: creator.email }],
        {
          handle: creator.handle,
          workItemName: updatedChallenge.name,
        }
      );
    }
    if (sendActivationEmail) {
      await helper.sendSelfServiceNotification(
        constants.SelfServiceNotificationTypes.WORK_REQUEST_STARTED,
        [{ email: creator.email }],
        {
          handle: creator.handle,
          workItemName: updatedChallenge.name,
          workItemUrl: `${config.SELF_SERVICE_APP_URL}/work-items/${updatedChallenge.id}`,
        }
      );
    }
    if (sendCompletedEmail) {
      await helper.sendSelfServiceNotification(
        constants.SelfServiceNotificationTypes.WORK_COMPLETED,
        [{ email: creator.email }],
        {
          handle: creator.handle,
          workItemName: updatedChallenge.name,
          workItemUrl: `${config.SELF_SERVICE_APP_URL}/work-items/${updatedChallenge.id}?tab=solutions`,
        }
      );
    }
    if (sendRejectedEmail || data.cancelReason) {
      logger.debug("Should send redirected email");
      await helper.sendSelfServiceNotification(
        constants.SelfServiceNotificationTypes.WORK_REQUEST_REDIRECTED,
        [{ email: creator.email }],
        {
          handle: creator.handle,
          workItemName: updatedChallenge.name,
        }
      );
    }
  }

  return helper.removeNullProperties(updatedChallenge);
}

updateChallenge.schema = {
  currentUser: Joi.any(),
  challengeId: Joi.id(),
  data: Joi.object()
    .keys({
      legacy: Joi.object()
        .keys({
          track: Joi.string(),
          subTrack: Joi.string(),
          reviewType: Joi.string()
            .valid(..._.values(ReviewTypeEnum))
            .insensitive()
            .default(ReviewTypeEnum.INTERNAL),
          confidentialityType: Joi.string()
            .allow(null, "")
            .empty(null, "")
            .default(config.DEFAULT_CONFIDENTIALITY_TYPE),
          directProjectId: Joi.number(),
          forumId: Joi.number().integer(),
          isTask: Joi.boolean(),
          useSchedulingAPI: Joi.boolean(),
          pureV5Task: Joi.boolean(),
          pureV5: Joi.boolean(),
          selfService: Joi.boolean(),
          selfServiceCopilot: Joi.string().allow(null),
        })
        .unknown(true),
      cancelReason: Joi.string().optional(),
      task: Joi.object()
        .keys({
          isTask: Joi.boolean().default(false),
          isAssigned: Joi.boolean().default(false),
          memberId: Joi.alternatives().try(Joi.string().allow(null), Joi.number().allow(null)),
        })
        .optional(),
      billing: Joi.object()
        .keys({
          billingAccountId: Joi.string(),
          markup: Joi.number().min(0).max(100),
        })
        .unknown(true),
      trackId: Joi.optionalId(),
      typeId: Joi.optionalId(),
      name: Joi.string().optional(),
      description: Joi.string().optional(),
      privateDescription: Joi.string().allow("").optional(),
      descriptionFormat: Joi.string().optional(),
      wiproAllowed: Joi.boolean().optional(),
      challengeSource: Joi.string().optional(),
      numOfRegistrants: Joi.number().integer().min(0).optional(),
      numOfSubmissions: Joi.number().integer().min(0).optional(),
      numOfCheckpointSubmissions: Joi.number().integer().min(0).optional(),
      metadata: Joi.array()
        .items(
          Joi.object()
            .keys({
              name: Joi.string().required(),
              value: Joi.required(),
            })
            .unknown(true)
        )
        .unique((a, b) => a.name === b.name),
      timelineTemplateId: Joi.string().optional(), // changing this to update migrated challenges
      phases: Joi.array()
        .items(
          Joi.object()
            .keys({
              phaseId: Joi.id(),
              duration: Joi.number().integer().min(0),
              isOpen: Joi.boolean(),
              actualEndDate: Joi.date().allow(null),
              scheduledStartDate: Joi.date().allow(null),
              constraints: Joi.array()
                .items(
                  Joi.object()
                    .keys({
                      name: Joi.string(),
                      value: Joi.number().integer().min(0),
                    })
                    .optional()
                )
                .optional(),
            })
            .unknown(true)
        )
        .min(1)
        .optional(),
      events: Joi.array().items(
        Joi.object()
          .keys({
            id: Joi.number().required(),
            name: Joi.string(),
            key: Joi.string(),
          })
          .unknown(true)
          .optional()
      ),
      discussions: Joi.array()
        .items(
          Joi.object().keys({
            id: Joi.optionalId(),
            name: Joi.string().required(),
            type: Joi.string().required().valid(..._.values(DiscussionTypeEnum)),
            provider: Joi.string().required(),
            url: Joi.string(),
            options: Joi.array().items(Joi.object()),
          })
        )
        .optional(),
      reviewers: Joi.array()
        .items(
          Joi.object().keys({
            scorecardId: Joi.string().required(),
            isMemberReview: Joi.boolean().required(),
            shouldOpenOpportunity: Joi.boolean().default(true),
            memberReviewerCount: Joi.when("isMemberReview", {
              is: true,
              then: Joi.number().integer().min(1).required(),
              otherwise: Joi.forbidden(),
            }),
            phaseId: Joi.id().required(),
            type: Joi.when("isMemberReview", {
              is: true,
              then: Joi.string().valid(..._.values(ReviewOpportunityTypeEnum)).insensitive(),
              otherwise: Joi.forbidden(),
            }),
            aiWorkflowId: Joi.when("isMemberReview", {
              is: false,
              then: Joi.string().required(),
              otherwise: Joi.forbidden(),
            }),
            fixedAmount: Joi.number().min(0).optional().allow(null),
            baseCoefficient: Joi.number().min(0).max(1).optional().allow(null),
            incrementalCoefficient: Joi.number().min(0).max(1).optional().allow(null),
          })
        )
        .optional(),
      startDate: Joi.date().iso(),
      prizeSets: Joi.array()
        .items(
          Joi.object()
            .keys({
              type: Joi.string().valid(..._.values(PrizeSetTypeEnum)).required(),
              description: Joi.string(),
              prizes: Joi.array()
                .items(
                  Joi.object().keys({
                    description: Joi.string(),
                    type: Joi.string().required(),
                    value: Joi.number().min(0).required(),
                  })
                )
                .min(1)
                .required(),
            })
            .unknown(true)
        )
        .min(1),
      tags: Joi.array().items(Joi.string()), // tag names
      projectId: Joi.number().integer().positive(),
      legacyId: Joi.number().integer().positive(),
      constraints: Joi.object()
        .keys({
          allowedRegistrants: Joi.array().items(Joi.string().trim().lowercase()).optional(),
        })
        .optional(),
      status: Joi.string().valid(..._.values(ChallengeStatusEnum)).insensitive(),
      attachments: Joi.array().items(
        Joi.object().keys({
          id: Joi.id(),
          challengeId: Joi.id(),
          name: Joi.string().required(),
          url: Joi.string().uri().required(),
          fileSize: Joi.fileSize(),
          description: Joi.string(),
        })
      ),
      groups: Joi.array().items(Joi.optionalId()).unique(),
      // gitRepoURLs: Joi.array().items(Joi.string().uri()),
      winners: Joi.array()
        .items(
          Joi.object()
            .keys({
              userId: Joi.number().integer().positive().required(),
              handle: Joi.string().required(),
              placement: Joi.number().integer().positive().required(),
              type: Joi.string().valid(..._.values(PrizeSetTypeEnum)),
            })
            .unknown(true)
        )
        .optional(),
      checkpointWinners: Joi.array()
        .items(
          Joi.object()
            .keys({
              userId: Joi.number().integer().positive().required(),
              handle: Joi.string().required(),
              placement: Joi.number().integer().positive().required(),
              type: Joi.string().valid(..._.values(PrizeSetTypeEnum)),
            })
            .unknown(true)
        )
        .optional(),
      terms: Joi.array().items(
        Joi.object().keys({
          id: Joi.id(),
          roleId: Joi.id(),
        })
      ),
      skills: Joi.array()
        .items(
          Joi.object()
            .keys({
              id: Joi.id(),
            })
            .unknown(true)
        )
        .optional(),
      overview: Joi.any().forbidden(),
    })
    .unknown(true)
    .required(),
};

/**
 * Send notifications
 * @param {Object} currentUser the current use
 * @param {String} challengeId the challenge id
 */
async function sendNotifications(currentUser, challengeId) {
  const challenge = await getChallenge(currentUser, challengeId);
  const creator = await helper.getMemberByHandle(challenge.createdBy);
  if (challenge.status === ChallengeStatusEnum.COMPLETED) {
    await helper.sendSelfServiceNotification(
      constants.SelfServiceNotificationTypes.WORK_COMPLETED,
      [{ email: creator.email }],
      {
        handle: creator.handle,
        workItemName: challenge.name,
        workItemUrl: `${config.SELF_SERVICE_APP_URL}/work-items/${challenge.id}?tab=solutions`,
      }
    );
    return { type: constants.SelfServiceNotificationTypes.WORK_COMPLETED };
  }
}

sendNotifications.schema = {
  currentUser: Joi.any(),
  challengeId: Joi.id(),
};

async function ensureScorecardChangeDoesNotConflict({
  challengeId,
  originalReviewers = [],
  updatedReviewers = [],
  originalChallengePhases = [],
}) {
  if (!Array.isArray(originalReviewers) || originalReviewers.length === 0) {
    return;
  }

  const originalByPhase = new Map();
  for (const reviewer of originalReviewers) {
    if (!reviewer || _.isNil(reviewer.phaseId)) {
      continue;
    }
    const phaseKey = String(reviewer.phaseId);
    if (!originalByPhase.has(phaseKey)) {
      originalByPhase.set(phaseKey, []);
    }
    originalByPhase.get(phaseKey).push(reviewer);
  }

  if (originalByPhase.size === 0) {
    return;
  }

  const updatedByPhase = new Map();
  if (Array.isArray(updatedReviewers)) {
    for (const reviewer of updatedReviewers) {
      if (!reviewer || _.isNil(reviewer.phaseId)) {
        continue;
      }
      const phaseKey = String(reviewer.phaseId);
      if (!updatedByPhase.has(phaseKey)) {
        updatedByPhase.set(phaseKey, []);
      }
      updatedByPhase.get(phaseKey).push(reviewer);
    }
  }

  const removedScorecardsByPhase = new Map();
  for (const [phaseKey, originalList] of originalByPhase.entries()) {
    const updatedList = updatedByPhase.get(phaseKey) || [];

    const originalScorecards = Array.from(
      new Set(
        originalList
          .map((r) => (!_.isNil(r) && !_.isNil(r.scorecardId) ? String(r.scorecardId) : null))
          .filter((scorecardId) => !_.isNil(scorecardId))
      )
    );

    if (originalScorecards.length === 0) {
      continue;
    }

    const updatedScorecards = Array.from(
      new Set(
        updatedList
          .map((r) => (!_.isNil(r) && !_.isNil(r.scorecardId) ? String(r.scorecardId) : null))
          .filter((scorecardId) => !_.isNil(scorecardId))
      )
    );

    const removedScorecards = originalScorecards.filter(
      (scorecardId) => !updatedScorecards.includes(scorecardId)
    );

    if (removedScorecards.length > 0) {
      removedScorecardsByPhase.set(phaseKey, Array.from(new Set(removedScorecards)));
    }
  }

  if (removedScorecardsByPhase.size === 0) {
    return;
  }

  const phaseIdToChallengePhaseIds = new Map();
  for (const phase of originalChallengePhases || []) {
    if (!phase || _.isNil(phase.phaseId) || _.isNil(phase.id)) {
      continue;
    }
    const phaseKey = String(phase.phaseId);
    if (!phaseIdToChallengePhaseIds.has(phaseKey)) {
      phaseIdToChallengePhaseIds.set(phaseKey, new Set());
    }
    phaseIdToChallengePhaseIds.get(phaseKey).add(String(phase.id));
  }

  if (!config.REVIEW_DB_URL) {
    logger.debug(
      `Skipping scorecard change guard for challenge ${challengeId} because REVIEW_DB_URL is not configured`
    );
    return;
  }

  let reviewClient;
  try {
    reviewClient = getReviewClient();
  } catch (error) {
    logger.warn(
      `Unable to initialize review Prisma client for challenge ${challengeId}: ${error.message}`
    );
    throw new errors.ServiceUnavailableError(
      "Cannot change the scorecard because review status could not be verified. Please try again later."
    );
  }

  if (!reviewClient || typeof reviewClient.$queryRaw !== "function") {
    logger.warn(
      `Prisma review client does not support raw queries for challenge ${challengeId}`
    );
    throw new errors.ServiceUnavailableError(
      "Cannot change the scorecard because review status could not be verified. Please try again later."
    );
  }

  const openReviewPhaseNameByKey = new Map();
  for (const phase of originalChallengePhases || []) {
    if (!phase || !phase.isOpen) {
      continue;
    }
    const phaseName = String(phase.name || "").trim();
    if (!phaseName) {
      continue;
    }
    const normalizedName = phaseName.toLowerCase();
    if (!REVIEW_PHASE_NAME_SET.has(normalizedName)) {
      continue;
    }
    const phaseKey = phase.phaseId ? String(phase.phaseId) : null;
    if (!phaseKey) {
      continue;
    }
    openReviewPhaseNameByKey.set(phaseKey, phaseName);
  }

  const reviewPhaseKeysToCheck = Array.from(removedScorecardsByPhase.keys()).filter((phaseKey) =>
    openReviewPhaseNameByKey.has(phaseKey)
  );

  const reviewPhaseKeysSet = new Set(removedScorecardsByPhase.keys());
  const challengePhaseIdsToInspect = new Set();
  for (const phaseKey of reviewPhaseKeysSet) {
    const challengePhaseIds = phaseIdToChallengePhaseIds.get(phaseKey);
    if (!challengePhaseIds) {
      continue;
    }
    for (const challengePhaseId of challengePhaseIds) {
      if (!_.isNil(challengePhaseId)) {
        challengePhaseIdsToInspect.add(String(challengePhaseId));
      }
    }
  }

  const blockingCountByPhase = new Map();
  const blockingCountByPhaseAndScorecard = new Map();

  const challengePhaseIdList = Array.from(challengePhaseIdsToInspect);
  if (challengePhaseIdList.length > 0) {
    const reviewSchema = String(config.REVIEW_DB_SCHEMA || "").trim();
    const reviewTableIdentifier = Prisma.raw(
      reviewSchema
        ? `"${reviewSchema.replace(/"/g, '""')}"."review"`
        : '"review"'
    );

    let blockingReviewRows = [];
    try {
      blockingReviewRows = await reviewClient.$queryRaw`
        SELECT "phaseId", "scorecardId", COUNT(*)::int AS "count"
        FROM ${reviewTableIdentifier}
        WHERE "phaseId" IN (${Prisma.join(challengePhaseIdList)})
          AND "status"::text IN (${Prisma.join(REVIEW_STATUS_BLOCKING)})
        GROUP BY "phaseId", "scorecardId"
      `;
    } catch (error) {
      logger.warn(
        `Failed to query the review database for challenge ${challengeId}: ${error.message}`
      );
      throw new errors.ServiceUnavailableError(
        "Cannot change the scorecard because review status could not be verified. Please try again later."
      );
    }

    for (const row of blockingReviewRows || []) {
      const phaseId = _.isNil(row?.phaseId) ? null : String(row.phaseId);
      if (!phaseId) {
        continue;
      }
      const countValue = Number(_.get(row, "count", 0));
      if (!Number.isFinite(countValue) || countValue <= 0) {
        continue;
      }

      blockingCountByPhase.set(phaseId, (blockingCountByPhase.get(phaseId) || 0) + countValue);

      const scorecardId = _.isNil(row?.scorecardId) ? null : String(row.scorecardId);
      if (scorecardId) {
        const scorecardKey = `${phaseId}|${scorecardId}`;
        blockingCountByPhaseAndScorecard.set(
          scorecardKey,
          (blockingCountByPhaseAndScorecard.get(scorecardKey) || 0) + countValue
        );
      }
    }
  }

  if (reviewPhaseKeysToCheck.length > 0) {
    for (const phaseKey of reviewPhaseKeysToCheck) {
      const challengePhaseIds = Array.from(phaseIdToChallengePhaseIds.get(phaseKey) || []);
      if (challengePhaseIds.length === 0) {
        logger.debug(
          `Skipping active phase scorecard guard for challenge ${challengeId} phase ${phaseKey} because no matching challenge phases were found`
        );
        continue;
      }

      let activePhaseReviewCount = 0;
      for (const challengePhaseId of challengePhaseIds) {
        activePhaseReviewCount += blockingCountByPhase.get(challengePhaseId) || 0;
      }

      if (activePhaseReviewCount > 0) {
        const phaseName = openReviewPhaseNameByKey.get(phaseKey) || "phase";
        throw new BadRequestError(
          `Cannot change the scorecard for phase '${phaseName}' because reviews are already in progress or completed`
        );
      }
    }
  }

  for (const [phaseKey, scorecardIds] of removedScorecardsByPhase.entries()) {
    const challengePhaseIds = Array.from(phaseIdToChallengePhaseIds.get(phaseKey) || []);

    if (challengePhaseIds.length === 0) {
      logger.debug(
        `Skipping scorecard change guard for challenge ${challengeId} phase ${phaseKey} because no matching challenge phases were found`
      );
      continue;
    }

    for (const scorecardId of scorecardIds) {
      if (!scorecardId) {
        continue;
      }

      const normalizedScorecardId = String(scorecardId);
      let conflictingReviews = 0;
      for (const challengePhaseId of challengePhaseIds) {
        const scorecardKey = `${challengePhaseId}|${normalizedScorecardId}`;
        conflictingReviews += blockingCountByPhaseAndScorecard.get(scorecardKey) || 0;
      }

      if (conflictingReviews > 0) {
        throw new BadRequestError(
          "Can't change the scorecard at this time because at least one review has already started with the old scorecard"
        );
      }
    }
  }
}

/**
 * Remove unwanted properties from the challenge object
 * @param {Object} challenge the challenge object
 */
function sanitizeChallenge(challenge) {
  const sanitized = _.pick(challenge, [
    "trackId",
    "typeId",
    "name",
    "description",
    "privateDescription",
    "descriptionFormat",
    "challengeSource",
    "timelineTemplateId",
    "tags",
    "projectId",
    "legacyId",
    "startDate",
    "status",
    "task",
    "groups",
    "cancelReason",
    "constraints",
    "skills",
    "reviewers",
    "wiproAllowed",
    "numOfRegistrants",
    "numOfSubmissions",
    "numOfCheckpointSubmissions",
  ]);
  if (!_.isUndefined(sanitized.name)) {
    sanitized.name = xss(sanitized.name);
  }
  // Only Sanitize description if it is in HTML format
  // Otherwise, it is in Markdown format and we don't want to sanitize it - a future enhancement can be
  // using a markdown sanitizer
  if (challenge.descriptionFormat === "html" && !_.isUndefined(sanitized.description)) {
    sanitized.description = xss(sanitized.description);
  }
  if (challenge.legacy) {
    sanitized.legacy = _.pick(challenge.legacy, [
      "track",
      "subTrack",
      "reviewType",
      "confidentialityType",
      "forumId",
      "directProjectId",
      "screeningScorecardId",
      "reviewScorecardId",
      "isTask",
      "useSchedulingAPI",
      "pureV5Task",
      "pureV5",
      "selfService",
      "selfServiceCopilot",
    ]);
  }
  if (challenge.billing) {
    sanitized.billing = _.pick(challenge.billing, ["billingAccountId", "markup"]);
  }
  if (challenge.metadata) {
    sanitized.metadata = _.map(challenge.metadata, (meta) => _.pick(meta, ["name", "value"]));
  }
  if (challenge.phases) {
    sanitized.phases = _.map(challenge.phases, (phase) =>
      _.pick(phase, ["phaseId", "duration", "scheduledStartDate", "constraints"])
    );
  }
  if (challenge.prizeSets) {
    sanitized.prizeSets = _.map(challenge.prizeSets, (prizeSet) => ({
      ..._.pick(prizeSet, ["type", "description"]),
      prizes: _.map(prizeSet.prizes, (prize) => _.pick(prize, ["description", "type", "value"])),
    }));
  }
  if (challenge.reviewers) {
    sanitized.reviewers = _.map(challenge.reviewers, (rv) =>
      _.pick(rv, [
        "scorecardId",
        "isMemberReview",
        "memberReviewerCount",
        "phaseId",
        "fixedAmount",
        "baseCoefficient",
        "incrementalCoefficient",
        "shouldOpenOpportunity",
        "type",
        "aiWorkflowId",
      ])
    );
  }
  if (challenge.events) {
    sanitized.events = _.map(challenge.events, (event) => _.pick(event, ["id", "name", "key"]));
  }
  if (challenge.winners) {
    sanitized.winners = _.map(challenge.winners, (winner) =>
      _.pick(winner, ["userId", "handle", "placement", "type"])
    );
  }
  if (challenge.checkpointWinners) {
    sanitized.checkpointWinners = _.map(challenge.checkpointWinners, (winner) =>
      _.pick(winner, ["userId", "handle", "placement", "type"])
    );
  }
  if (challenge.discussions) {
    sanitized.discussions = _.map(challenge.discussions, (discussion) => ({
      ..._.pick(discussion, ["id", "provider", "name", "type", "url", "options"]),
      name: _.get(discussion, "name", "").substring(0, config.FORUM_TITLE_LENGTH_LIMIT),
    }));
  }
  if (challenge.terms) {
    const uniqueTerms = helper.dedupeChallengeTerms(challenge.terms || []);
    sanitized.terms = _.map(uniqueTerms, (term) => _.pick(term, ["id", "roleId"]));
  }
  if (challenge.attachments) {
    sanitized.attachments = _.map(challenge.attachments, (attachment) =>
      _.pick(attachment, ["id", "name", "url", "fileSize", "description", "challengeId"])
    );
  }

  return sanitized;
}

async function syncChallengePhases(tx, challengeId, updatedPhases, auditUserId, originalPhases = []) {
  if (!Array.isArray(updatedPhases)) {
    return;
  }

  const originalById = new Map((originalPhases || []).map((phase) => [phase.id, phase]));
  const originalByPhaseId = new Map();
  for (const original of originalPhases || []) {
    if (!_.isNil(original.phaseId)) {
      originalByPhaseId.set(original.phaseId, original);
    }
  }
  const retainedIds = new Set();

  for (const phase of updatedPhases) {
    if (!phase) continue;

    let recordId = !_.isNil(phase.id) ? phase.id : undefined;
    let phaseDefinitionId = !_.isNil(phase.phaseId) ? phase.phaseId : undefined;

    if (!phaseDefinitionId && recordId && originalById.has(recordId)) {
      phaseDefinitionId = originalById.get(recordId).phaseId;
    }
    if (!recordId && phaseDefinitionId && originalByPhaseId.has(phaseDefinitionId)) {
      recordId = originalByPhaseId.get(phaseDefinitionId).id;
    }
    if (!phaseDefinitionId && recordId && originalById.has(recordId)) {
      phaseDefinitionId = originalById.get(recordId).phaseId;
    }
    if (!phaseDefinitionId) {
      throw new BadRequestError("Cannot update challenge phases without phaseId");
    }
    if (!recordId) {
      recordId = uuid();
    }

    const existing = originalById.get(recordId);
    retainedIds.add(recordId);

    const scalarKeys = [
      "name",
      "description",
      "isOpen",
      "duration",
      "scheduledStartDate",
      "scheduledEndDate",
      "actualStartDate",
      "actualEndDate",
      "challengeSource",
    ];
    const phaseData = {};
    for (const key of scalarKeys) {
      if (!_.isUndefined(phase[key])) {
        phaseData[key] = phase[key];
      }
    }
    phaseData.predecessor = _.isNil(phase.predecessor) ? null : phase.predecessor;

    phaseData.phaseId = phaseDefinitionId;

    if (existing) {
      await tx.challengePhase.update({
        where: { id: recordId },
        data: {
          ...phaseData,
          updatedBy: auditUserId,
        },
      });
      await tx.challengePhaseConstraint.deleteMany({ where: { challengePhaseId: recordId } });
    } else {
      await tx.challengePhase.create({
        data: {
          id: recordId,
          challengeId,
          ...phaseData,
          createdBy: auditUserId,
          updatedBy: auditUserId,
        },
      });
    }

    if (Array.isArray(phase.constraints) && phase.constraints.length > 0) {
      for (const constraint of phase.constraints) {
        if (_.isNil(constraint.name) || _.isNil(constraint.value)) {
          continue;
        }

        const constraintData = {
          challengePhaseId: recordId,
          name: constraint.name,
          value: constraint.value,
          createdBy: auditUserId,
          updatedBy: auditUserId,
        };

        if (!_.isNil(constraint.id)) {
          constraintData.id = constraint.id;
        }

        await tx.challengePhaseConstraint.create({ data: constraintData });
      }
    }
  }

  for (const phase of originalPhases || []) {
    if (!retainedIds.has(phase.id)) {
      await tx.challengePhase.delete({ where: { id: phase.id } });
    }
  }
}

function sanitizeData(data, challenge) {
  for (const key in data) {
    if (key === "phases") continue;

    if (challenge.hasOwnProperty(key)) {
      if (key === "skills" && deepEqual(_.map(data.skills, "id"), _.map(challenge.skills, "id"))) {
        delete data[key];
        continue;
      }

      if (
        (typeof data[key] === "object" || Array.isArray(data[key])) &&
        deepEqual(data[key], challenge[key])
      ) {
        delete data[key];
      } else if (
        typeof data[key] !== "object" &&
        !Array.isArray(data[key]) &&
        data[key] === challenge[key]
      ) {
        delete data[key];
      }
    }
  }
  return data;
}

/**
 * Delete challenge.
 * @param {Object} currentUser the user who perform operation
 * @param {String} challengeId the challenge id
 * @returns {Object} the deleted challenge
 */
async function deleteChallenge(currentUser, challengeId) {
  // Use findFirst for compound filters; findUnique only supports unique fields
  const challenge = await prisma.challenge.findFirst({
    where: { id: challengeId, status: ChallengeStatusEnum.NEW },
  });
  if (_.isNil(challenge) || _.isNil(challenge.id)) {
    throw new errors.NotFoundError(
      `Challenge with id: ${challengeId} doesn't exist or is not in New status`
    );
  }
  // ensure user can modify challenge
  await helper.ensureUserCanModifyChallenge(currentUser, challenge);
  // delete DB record
  await prisma.challenge.delete({ where: { id: challengeId } });

  await helper.postBusEvent(constants.Topics.ChallengeDeleted, {
    id: challengeId,
  });
  prismaHelper.convertModelToResponse(challenge);
  return helper.removeNullProperties(challenge);
}

deleteChallenge.schema = {
  currentUser: Joi.any(),
  challengeId: Joi.id(),
};

async function advancePhase(currentUser, challengeId, data) {
  logger.info(`Advance Phase Request - ${challengeId} - ${JSON.stringify(data)}`);
  const machineOrAdmin = currentUser && (currentUser.isMachine || hasAdminRole(currentUser));
  if (!machineOrAdmin) {
    throw new errors.ForbiddenError(
      `Admin role or an M2M token is required to advance the challenge phase.`
    );
  }
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: includeReturnFields,
  });

  if (_.isNil(challenge) || _.isNil(challenge.id)) {
    throw new errors.NotFoundError(`Challenge with id: ${challengeId} doesn't exist.`);
  }
  if (challenge.status !== ChallengeStatusEnum.ACTIVE) {
    throw new errors.BadRequestError(`Challenge with id: ${challengeId} is not in Active status.`);
  }

  const phaseAdvancerResult = await phaseAdvancer.advancePhase(
    challenge.id,
    challenge.legacyId,
    challenge.phases,
    data.operation,
    data.phase
  );

  const auditFields = {
    createdBy: _.toString(currentUser.userId),
    updatedBy: _.toString(currentUser.userId),
  };
  if (!phaseAdvancerResult.success) {
    return phaseAdvancerResult;
  }
  // update phase if result is successful
  const challengeData = {};
  // Reuse converter only to compute derived fields (currentPhaseNames, start/end dates)
  prismaHelper.convertChallengePhaseSchema(
    { phases: phaseAdvancerResult.updatedPhases },
    challengeData,
    auditFields
  );
  // Persist phases based on the raw updated phases array from PhaseAdvancer
  const newPhases = phaseAdvancerResult.updatedPhases;
  const newChallengeData = _.pick(challengeData, [
    "currentPhaseNames",
    "registrationStartDate",
    "registrationEndDate",
    "submissionStartDate",
    "submissionEndDate",
  ]);

  // TODO: This is a temporary solution to update the challenge status to Completed; We currently do not have a way to get winner list using v5 data
  // TODO: With the implementation of v5 review API we'll develop a mechanism to maintain the winner list in v5 data that challenge-api can use to create the winners list
  if (phaseAdvancerResult.hasWinningSubmission === true) {
    newChallengeData.status = ChallengeStatusEnum.COMPLETED;
  }
  await prisma.$transaction(async (tx) => {
    // upsert phases one by one (by id when present)
    for (const p of newPhases || []) {
      const phaseData = _.pick(p, [
        "name",
        "description",
        "isOpen",
        "predecessor",
        "duration",
        "scheduledStartDate",
        "scheduledEndDate",
        "actualStartDate",
        "actualEndDate",
      ]);
      // Ensure dates are either Date or null; assume incoming are ISO strings, Prisma accepts JS Date or string
      try {
        const existing = p.id ? await tx.challengePhase.findUnique({ where: { id: p.id } }) : null;
        if (existing) {
          await tx.challengePhase.update({
            where: { id: p.id },
            data: {
              ...phaseData,
              updatedBy: auditFields.updatedBy,
            },
          });
          // For simplicity, do not modify constraints on update here
        } else {
          await tx.challengePhase.create({
            data: {
              id: p.id || uuid(),
              challengeId,
              phaseId: p.phaseId,
              ...phaseData,
              createdBy: auditFields.createdBy,
              updatedBy: auditFields.updatedBy,
            },
          });
          if (Array.isArray(p.constraints) && p.constraints.length > 0) {
            for (const c of p.constraints) {
              await tx.challengePhaseConstraint.create({
                data: {
                  challengePhaseId: p.id,
                  name: c.name,
                  value: c.value,
                  createdBy: auditFields.createdBy,
                  updatedBy: auditFields.updatedBy,
                },
              });
            }
          }
        }
      } catch (e) {
        logger.error(
          `Failed to upsert phase ${p.name} (${p.phaseId}) for ${challengeId}: ${e.message}`
        );
        throw e;
      }
    }
    await tx.challenge.update({
      where: { id: challengeId },
      data: newChallengeData,
    });
  });
  const updatedChallenge = await prisma.challenge.findUnique({ where: { id: challengeId } });
  await indexChallengeAndPostToKafka(updatedChallenge);

  return {
    success: true,
    message: phaseAdvancerResult.message,
    next: phaseAdvancerResult.next,
  };
}

async function closeMarathonMatch(currentUser, challengeId) {
  logger.info(`Close Marathon Match Request - ${challengeId}`);
  const machineOrAdmin = currentUser && (currentUser.isMachine || hasAdminRole(currentUser));
  if (!machineOrAdmin) {
    throw new errors.ForbiddenError(
      `Admin role or an M2M token is required to close the marathon match.`
    );
  }

  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: includeReturnFields,
  });

  if (_.isNil(challenge) || _.isNil(challenge.id)) {
    throw new errors.NotFoundError(`Challenge with id: ${challengeId} doesn't exist.`);
  }

  if (!challenge.type || challenge.type.name !== "Marathon Match") {
    throw new errors.BadRequestError(
      `Challenge with id: ${challengeId} is not a Marathon Match challenge.`
    );
  }

  const reviewSummations = await helper.getReviewSummations(challengeId);
  const finalSummations = (reviewSummations || []).filter((summation) => summation.isFinal === true);

  const orderedSummations = _.orderBy(
    finalSummations,
    ["aggregateScore", "createdAt"],
    ["desc", "asc"]
  );

  const winners = orderedSummations.map((summation, index) => {
    const parsedUserId = Number(summation.submitterId);
    if (!Number.isFinite(parsedUserId) || !Number.isInteger(parsedUserId)) {
      throw new errors.BadRequestError(
        `Invalid submitterId ${summation.submitterId} for review summation winner`
      );
    }

    return {
      userId: parsedUserId,
      handle: summation.submitterHandle,
      placement: index + 1,
      type: PrizeSetTypeEnum.PLACEMENT,
    };
  });

  if (winners.length > 0) {
    const challengeResources = await helper.getChallengeResources(challengeId);
    const submitterResources = challengeResources.filter(
      (resource) => resource.roleId === config.SUBMITTER_ROLE_ID
    );
    const missingResources = winners.filter(
      (winner) =>
        !submitterResources.some(
          (resource) => _.toString(resource.memberId) === _.toString(winner.userId)
        )
    );
    if (missingResources.length > 0) {
      throw new errors.BadRequestError(
        `Submitter resources are required to close Marathon Match challenge ${challengeId}. Missing submitter resources for userIds: ${missingResources
          .map((winner) => winner.userId)
          .join(", ")}`
      );
    }
  }

  const closedAt = new Date().toISOString();
  const updatedPhases = (challenge.phases || []).map((phase) => ({
    ...phase,
    isOpen: false,
    actualEndDate: closedAt,
  }));

  const updatedChallenge = await updateChallenge(
    currentUser,
    challengeId,
    {
      winners,
      phases: updatedPhases,
      status: ChallengeStatusEnum.COMPLETED,
    },
    { emitEvent: true }
  );

  return updatedChallenge;
}

advancePhase.schema = {
  currentUser: Joi.any(),
  challengeId: Joi.id(),
  data: Joi.object()
    .keys({
      phase: Joi.string().required(),
      operation: Joi.string().lowercase().valid("open", "close").required(),
    })
    .required(),
};

closeMarathonMatch.schema = {
  currentUser: Joi.any(),
  challengeId: Joi.id(),
};

async function indexChallengeAndPostToKafka(updatedChallenge, track, type) {
  const prizeType = challengeHelper.validatePrizeSetsAndGetPrizeType(updatedChallenge.prizeSets);

  // No conversion needed - values are already in dollars in the database

  if (track == null || type == null) {
    const trackAndTypeData = await challengeHelper.validateAndGetChallengeTypeAndTrack({
      typeId: updatedChallenge.typeId,
      trackId: updatedChallenge.trackId,
      timelineTemplateId: updatedChallenge.timelineTemplateId,
    });

    if (trackAndTypeData != null) {
      track = trackAndTypeData.track;
      type = trackAndTypeData.type;
    }
  }

  // post bus event
  logger.debug(
    `Post Bus Event: ${constants.Topics.ChallengeUpdated} ${JSON.stringify(updatedChallenge)}`
  );

  prismaHelper.convertModelToResponse(updatedChallenge);
  // Keep legacy string values for bus event payload to avoid breaking consumers
  enrichChallengeForResponse(updatedChallenge, track, type, { asString: true });

  await helper.postBusEvent(constants.Topics.ChallengeUpdated, updatedChallenge, {
    key:
      updatedChallenge.status === "Completed"
        ? `${updatedChallenge.id}:${updatedChallenge.status}`
        : undefined,
  });
}

module.exports = {
  searchChallenges,
  createChallenge,
  getChallenge,
  updateChallenge,
  deleteChallenge,
  getChallengeStatistics,
  sendNotifications,
  advancePhase,
  closeMarathonMatch,
  getDefaultReviewers,
  setDefaultReviewers,
  indexChallengeAndPostToKafka,
};

logger.buildService(module.exports);
