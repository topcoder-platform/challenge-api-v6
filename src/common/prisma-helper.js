const _ = require("lodash");
const Decimal = require("decimal.js");
const constants = require("../../app-constants");
const { PrizeSetTypeEnum } = require("@prisma/client");
const { dedupeChallengeTerms } = require("./helper");

const SUBMISSION_PHASE_PRIORITY = ["Topcoder Submission", "Submission"];
/**
 * Convert phases data to prisma model.
 *
 * @param {Object} challenge challenge data
 * @param {Object} result result
 * @param {Object} auditFields createdBy and updatedBy
 */
function convertChallengePhaseSchema(challenge, result, auditFields) {
  const phases = _.isArray(challenge.phases) ? challenge.phases : [];
  // keep phase data
  const phaseFields = [
    "name",
    "description",
    "isOpen",
    "predecessor",
    "duration",
    "scheduledStartDate",
    "scheduledEndDate",
    "actualStartDate",
    "actualEndDate",
    "challengeSource",
  ];
  // current phase names
  result.currentPhaseNames = _.map(_.filter(phases, (p) => p.isOpen === true), "name");

  const registrationPhase = _.find(phases, (p) => p.name === "Registration");
  const submissionPhase =
    _.find(phases, (p) => p.name === SUBMISSION_PHASE_PRIORITY[0]) ||
    _.find(phases, (p) => p.name === SUBMISSION_PHASE_PRIORITY[1]);

  if (registrationPhase) {
    result.registrationStartDate =
      registrationPhase.actualStartDate || registrationPhase.scheduledStartDate;
    result.registrationEndDate =
      registrationPhase.actualEndDate || registrationPhase.scheduledEndDate;
  }
  if (submissionPhase) {
    result.submissionStartDate =
      submissionPhase.actualStartDate || submissionPhase.scheduledStartDate;
    result.submissionEndDate =
      submissionPhase.actualEndDate || submissionPhase.scheduledEndDate;
  }
  // set phases array data
  if (!_.isEmpty(phases)) {
    result.phases = {
      create: _.map(phases, (p) => {
        const phaseData = {
          phase: { connect: { id: p.phaseId } },
          ..._.pick(p, phaseFields),
          ...auditFields,
        };
        if (!_.isEmpty(p.constraints)) {
          phaseData.constraints = {
            create: _.map(p.constraints, (c) => ({ ...c, ...auditFields })),
          };
        }
        return phaseData;
      }),
    };
  }
}

/**
 * Convert challenge data to prisma model.
 *
 * @param {Object} currentUser current user
 * @param {Object} challenge challenge schema
 * @returns prisma model data to create/update challenge
 */
function convertChallengeSchemaToPrisma(currentUser, challenge) {
  // used id used in createdBy and updatedBy
  const userId = _.toString(currentUser.userId);
  const auditFields = {
    createdBy: userId,
    updatedBy: userId,
  };
  // keep primitive data
  const result = _.pick(challenge, [
    "name",
    "description",
    "privateDescription",
    "challengeSource",
    "descriptionFormat",
    "tags",
    "projectId",
    "startDate",
    "groups",
    "legacyId",
    "wiproAllowed",
    "numOfRegistrants",
    "numOfSubmissions",
    "numOfCheckpointSubmissions",
  ]);
  // set legacy data
  if (!_.isNil(challenge.legacy)) {
    result.legacyRecord = {
      create: {
        ...challenge.legacy,
        ...auditFields,
      },
    };
  }
  // set billing
  if (!_.isNil(challenge.billing)) {
    result.billingRecord = {
      create: {
        ...challenge.billing,
        ...auditFields,
      },
    };
  }
  // set task
  if (!_.isNil(challenge.task)) {
    result.taskIsTask = _.get(challenge, "task.isTask");
    result.taskIsAssigned = _.get(challenge, "task.isAssigned");
    const taskMemberId = _.get(challenge, "task.memberId", null);
    if (!_.isNil(taskMemberId)) {
      result.taskMemberId = String(taskMemberId);
    }
  }
  // set metadata
  if (!_.isNil(challenge.metadata)) {
    result.metadata = { create: _.map(challenge.metadata, (m) => ({ ...m, ...auditFields })) };
  }
  convertChallengePhaseSchema(challenge, result, auditFields);
  // set events
  if (!_.isNil(challenge.events)) {
    result.events = {
      create: _.map(challenge.events, (e) => {
        const ret = _.pick(e, ["name", "key"]);
        _.assignIn(ret, auditFields);
        ret.eventId = e.id;
        return ret;
      }),
    };
  }
  // discussions
  if (!_.isNil(challenge.discussions)) {
    result.discussions = {
      create: _.map(challenge.discussions, (d) => {
        const dissData = _.pick(d, ["name", "provider", "url"]);
        dissData.discussionId = d.id;
        dissData.type = d.type.toUpperCase();
        _.assignIn(dissData, auditFields);
        if (!_.isEmpty(d.options)) {
          dissData.options = { create: [] };
          _.forEach(d.options, (o) => {
            _.forIn(o, (v, k) => {
              dissData.options.create.push({
                optionKey: k,
                optionValue: v,
                ...auditFields,
              });
            });
          });
        }
        return dissData;
      }),
    };
  }
  let totalPrizes = 0;
  // prize sets
  if (!_.isNil(challenge.prizeSets)) {
    result.prizeSets = {
      create: _.map(challenge.prizeSets, (s) => {
        const setData = _.pick(s, "description");
        setData.type = s.type.toUpperCase();
        _.assignIn(setData, auditFields);
        setData.prizes = {
          create: _.map(s.prizes, (p) => {
            const prizeData = _.pick(p, "type", "description");
            _.assignIn(prizeData, auditFields);
            // Database stores values in dollars directly, no amountInCents field exists
            prizeData.value = p.value;
            // calculate only placement and checkpoint prizes
            if (s.type === PrizeSetTypeEnum.PLACEMENT && p.type === constants.prizeTypes.USD) {
              // Values are already in dollars, no conversion needed
              totalPrizes += p.value;
            }
            return prizeData;
          }),
        };
        return setData;
      }),
    };
    // Total prizes are already in dollars, no conversion needed
    result.overviewTotalPrizes = parseFloat(totalPrizes.toFixed(2));
  }
  // constraints
  if (!_.isNil(_.get(challenge, "constraints.allowedRegistrants"))) {
    result.constraintRecord = {
      create: {
        allowedRegistrants: _.get(challenge, "constraints.allowedRegistrants"),
        ...auditFields,
      },
    };
  }
  // status
  if (challenge.status) {
    result.status = challenge.status.toUpperCase();
  }
  // terms
  if (!_.isNil(challenge.terms)) {
    result.terms = {
      create: _.map(challenge.terms, (t) => ({
        ...auditFields,
        roleId: t.roleId,
        termId: t.id,
      })),
    };
  }
  // skills
  if (!_.isNil(challenge.skills)) {
    result.skills = {
      create: _.map(challenge.skills, (s) => ({
        ...auditFields,
        skillId: s.id,
      })),
    };
  }
  // reviewers
  if (!_.isNil(challenge.reviewers)) {
    result.reviewers = {
      create: _.map(challenge.reviewers, (r, index) => {
        const reviewer = {
          ...auditFields,
          scorecardId: String(r.scorecardId),
          isMemberReview: !!r.isMemberReview,
          memberReviewerCount: _.isNil(r.memberReviewerCount)
            ? null
            : Number(r.memberReviewerCount),
          fixedAmount: _.isNil(r.fixedAmount) ? null : Number(r.fixedAmount),
          baseCoefficient: _.isNil(r.baseCoefficient) ? null : Number(r.baseCoefficient),
          incrementalCoefficient: _.isNil(r.incrementalCoefficient)
            ? null
            : Number(r.incrementalCoefficient),
          aiWorkflowId: r.aiWorkflowId,
          shouldOpenOpportunity: _.isNil(r.shouldOpenOpportunity)
            ? true
            : !!r.shouldOpenOpportunity,
          createdAt: new Date(Date.now() + index),
        };
        if (r.type) reviewer.type = _.toUpper(r.type);
        if (r.phaseId) reviewer.phase = { connect: { id: r.phaseId } };
        return reviewer;
      }),
    };
  }
  const allWinnerEntries = [];
  if (!_.isNil(challenge.winners)) {
    _.forEach(challenge.winners, (winner) => {
      const entry = {
        ...auditFields,
        ..._.pick(winner, ["userId", "handle", "placement", "type"]),
      };
      if (_.isNil(entry.type)) {
        entry.type = PrizeSetTypeEnum.PLACEMENT;
      } else {
        entry.type = entry.type.toUpperCase();
      }
      allWinnerEntries.push(entry);
    });
  }
  if (!_.isNil(challenge.checkpointWinners)) {
    _.forEach(challenge.checkpointWinners, (winner) => {
      const entry = {
        ...auditFields,
        ..._.pick(winner, ["userId", "handle", "placement", "type"]),
      };
      entry.type = _.isNil(entry.type)
        ? PrizeSetTypeEnum.CHECKPOINT
        : entry.type.toUpperCase();
      allWinnerEntries.push(entry);
    });
  }
  if (allWinnerEntries.length > 0) {
    result.winners = {
      create: allWinnerEntries,
    };
  }
  // relations
  if (challenge.typeId) {
    result.type = { connect: { id: challenge.typeId } };
  }
  if (challenge.trackId) {
    result.track = { connect: { id: challenge.trackId } };
  }
  if (challenge.timelineTemplateId) {
    result.timelineTemplate = { connect: { id: challenge.timelineTemplateId } };
  }
  _.assignIn(result, auditFields);
  // keep createdAt to allow test data
  if (challenge.created) {
    result.createdAt = challenge.created || new Date();
  }
  result.updatedAt = new Date();
  return result;
}

/**
 * Convert prisma model to response data
 *
 * @param {Object} ret prisma model data
 * @returns response data
 */
function convertModelToResponse(ret) {
  ret.legacy = _.omit(ret.legacyRecord, "id", constants.auditFields);
  delete ret.legacyRecord;
  delete ret.legacy.challengeId;
  // Include billing info in response
  if (ret.billingRecord) {
    ret.billing = _.omit(ret.billingRecord, "id", "challengeId", constants.auditFields);
  }
  delete ret.billingRecord;

  ret.task = {
    isTask: ret.taskIsTask,
    isAssigned: ret.taskIsAssigned,
    memberId: ret.taskMemberId,
  };
  delete ret.taskIsTask;
  delete ret.taskIsAssigned;
  delete ret.taskMemberId;

  // use original date field
  ret.created = ret.createdAt;
  ret.updated = ret.updatedAt;
  delete ret.createdAt;
  delete ret.updatedAt;

  // convert metadata
  ret.metadata = _.map(ret.metadata, (m) => _.pick(m, ["name", "value"]));
  // convert phases
  ret.phases = _.map(ret.phases, (p) => {
    const t = _.omit(p, "challengeId", constants.auditFields);
    t.constraints = _.map(p.constraints, (c) => _.pick(c, "name", "value"));
    return t;
  });
  // convert events
  ret.events = _.map(ret.events, (e) => ({ id: e.eventId, name: e.name, key: e.key }));
  // convert discussions
  ret.discussions = _.map(ret.discussions, (d) => {
    const r = _.pick(d, ["name", "type", "provider", "url"]);
    r.id = d.discussionId;
    r.options = _.map(d.options, (o) => {
      const x = {};
      x[o.optionKey] = o.optionValue;
      return x;
    });
    return r;
  });
  // convert prize sets
  let prizeType;
  ret.prizeSets = _.map(ret.prizeSets, (s) => {
    const ss = _.pick(s, ["type", "description"]);

    ss.prizes = _.map(s.prizes, (p) => {
      prizeType = p.type;
      return _.pick(p, ["type", "description", "value"]);
    });
    return ss;
  });
  ret.overview = { totalPrizes: ret.overviewTotalPrizes };
  if (prizeType) {
    ret.overview.type = prizeType;
  }
  delete ret.overviewTotalPrizes;

  // convert terms
  const serializedTerms = _.map(ret.terms, (t) => ({ id: t.termId, roleId: t.roleId }));
  ret.terms = dedupeChallengeTerms(serializedTerms);
  // convert skills - basic transformation, enrichment happens in service layer
  ret.skills = _.map(ret.skills, (s) => ({ id: s.skillId }));
  // convert attachments
  ret.attachments = _.map(ret.attachments, (r) => _.omit(r, constants.auditFields, "challengeId"));
  // convert winners
  const winnersForResponse = ret.winners || [];
  const winnerGroups = _.groupBy(winnersForResponse, (w) => w.type);
  const placementWinners = winnerGroups[PrizeSetTypeEnum.PLACEMENT] || [];
  const checkpointWinners = winnerGroups[PrizeSetTypeEnum.CHECKPOINT] || [];
  ret.winners = _.map(placementWinners, (w) => _.pick(w, ["userId", "handle", "placement"]));
  delete ret.checkpointWinners;
  if (checkpointWinners.length > 0) {
    ret.checkpointWinners = _.map(checkpointWinners, (w) =>
      _.pick(w, ["userId", "handle", "placement"])
    );
  }
  // convert reviewers
  if (ret.reviewers) {
    ret.reviewers = _.map(ret.reviewers, (rv) =>
      _.pick(rv, [
        "scorecardId",
        "isMemberReview",
        "memberReviewerCount",
        "phaseId",
        "fixedAmount",
        "baseCoefficient",
        "incrementalCoefficient",
        "type",
        "aiWorkflowId",
        "shouldOpenOpportunity",
      ])
    );
  }
  // counters (stored on Challenge)
  ret.numOfSubmissions = _.isNil(ret.numOfSubmissions) ? 0 : ret.numOfSubmissions;
  ret.numOfCheckpointSubmissions = _.isNil(ret.numOfCheckpointSubmissions)
    ? 0
    : ret.numOfCheckpointSubmissions;
  ret.numOfRegistrants = _.isNil(ret.numOfRegistrants) ? 0 : ret.numOfRegistrants;
}

module.exports = {
  convertChallengePhaseSchema,
  convertChallengeSchemaToPrisma,
  convertModelToResponse,
};
