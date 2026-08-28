const _ = require("lodash");

const { v4: uuid } = require('uuid');
const moment = require("moment");

const errors = require("./errors");

const timelineTemplateService = require("../services/TimelineTemplateService");
const prisma = require("../common/prisma").getClient();

const SUBMISSION_PHASE_PRIORITY = ["Topgear Submission", "Topcoder Submission", "Submission"];
const DESIGN_TRACK = "DESIGN";

/**
 * Resolve a track object or token to the canonical track value used in challenge metadata.
 *
 * @param {Object|String|null|undefined} track challenge track relation, display value, or token
 * @returns {String} normalized uppercase track token
 */
function normalizeTrackToken(track) {
  if (_.isNil(track)) {
    return "";
  }

  if (_.isString(track)) {
    return _.toUpper(_.trim(track));
  }

  return _.toUpper(
    _.trim(
      _.get(track, "track") ||
        _.get(track, "name") ||
        _.get(track, "abbreviation") ||
        ""
    )
  );
}

/**
 * Check whether a challenge track represents Design.
 *
 * @param {Object|String|null|undefined} track challenge track relation, display value, or token
 * @returns {Boolean} true when the track is Design
 */
function isDesignTrack(track) {
  return normalizeTrackToken(track) === DESIGN_TRACK;
}

/**
 * Check whether a requested schedule reduces the phase duration.
 *
 * @param {Object} phase existing challenge phase
 * @param {Date|String|null|undefined} requestedScheduledStartDate requested phase start date
 * @param {Date|String} requestedScheduledEndDate requested phase end date
 * @returns {Boolean} true when requested duration is shorter than persisted duration
 */
function isPhaseDurationShortened(phase, requestedScheduledStartDate, requestedScheduledEndDate) {
  const currentStart = moment(phase.scheduledStartDate);
  const currentEnd = moment(phase.scheduledEndDate);
  const requestedStart = moment(
    _.defaultTo(requestedScheduledStartDate, phase.scheduledStartDate)
  );
  const requestedEnd = moment(requestedScheduledEndDate);

  if (
    !currentStart.isValid() ||
    !currentEnd.isValid() ||
    !requestedStart.isValid() ||
    !requestedEnd.isValid()
  ) {
    return requestedEnd.isBefore(currentEnd);
  }

  return requestedEnd.diff(requestedStart, "seconds") < currentEnd.diff(currentStart, "seconds");
}

/**
 * Validate a phase scheduled end date change against PM-5378 rules.
 *
 * @param {Object} phase existing challenge phase
 * @param {Date|String|null|undefined} requestedScheduledEndDate requested scheduled end date
 * @param {Object} options validation options
 * @param {Boolean} options.allowActivePhaseShortening whether Design track phase shortening is allowed
 * @param {Boolean} options.preventPhaseShortening whether shortening is guarded for all incomplete phases
 * @param {Date|String|null|undefined} options.requestedScheduledStartDate requested scheduled start date
 * @returns {undefined} validates only
 * @throws {BadRequestError} when phase shortening is disallowed or would end in the past
 */
function validateActivePhaseScheduledEndDateChange(
  phase,
  requestedScheduledEndDate,
  options: any = {}
) {
  if (!_.isNil(phase?.actualEndDate)) {
    return;
  }

  if (_.isNil(phase) || _.isNil(requestedScheduledEndDate)) {
    return;
  }

  const requestedEnd = moment(requestedScheduledEndDate);
  if (!requestedEnd.isValid()) {
    return;
  }

  const currentEnd = moment(phase.scheduledEndDate);
  const hasCurrentEnd = currentEnd.isValid();
  const hasChangedEndDate = !hasCurrentEnd || requestedEnd.valueOf() !== currentEnd.valueOf();

  if (!hasChangedEndDate) {
    return;
  }

  const shouldValidatePhaseEnd =
    phase.isOpen === true ||
    options.allowActivePhaseShortening === true ||
    options.preventPhaseShortening === true;
  const isShortened =
    hasCurrentEnd &&
    requestedEnd.isBefore(currentEnd) &&
    isPhaseDurationShortened(
      phase,
      options.requestedScheduledStartDate,
      requestedScheduledEndDate
    );

  if (shouldValidatePhaseEnd && requestedEnd.isBefore(moment())) {
    throw new errors.BadRequestError(
      "Phase scheduledEndDate cannot be set before the current date/time."
    );
  }

  if (
    isShortened &&
    options.allowActivePhaseShortening !== true &&
    (phase.isOpen === true || options.preventPhaseShortening === true)
  ) {
    throw new errors.BadRequestError(
      "Challenge phase schedules can only be shortened for Design track challenges."
    );
  }
}

/**
 * Validate recalculated schedules against persisted phase schedules.
 *
 * @param {Array<Object>} originalPhases persisted challenge phases before the update
 * @param {Array<Object>} updatedPhases recalculated challenge phases that will be persisted
 * @param {Object} options validation options forwarded to the phase schedule validator
 * @returns {undefined} validates only
 * @throws {BadRequestError} when a recalculated schedule violates shortening rules
 */
function validateRecalculatedPhaseSchedules(originalPhases, updatedPhases, options: any = {}) {
  const originalById = new Map();
  const originalByPhaseId = new Map();

  _.each(originalPhases, (phase) => {
    if (_.isNil(phase)) {
      return;
    }

    if (!_.isNil(phase.id)) {
      originalById.set(phase.id, phase);
    }
    if (!_.isNil(phase.phaseId)) {
      originalByPhaseId.set(phase.phaseId, phase);
    }
  });

  _.each(updatedPhases, (updatedPhase) => {
    if (_.isNil(updatedPhase)) {
      return;
    }

    const originalPhase = (
      !_.isNil(updatedPhase.id)
        ? originalById.get(updatedPhase.id)
        : undefined
    ) || originalByPhaseId.get(updatedPhase.phaseId);

    if (_.isNil(originalPhase)) {
      return;
    }

    validateActivePhaseScheduledEndDateChange(
      originalPhase,
      updatedPhase.scheduledEndDate,
      {
        ...options,
        requestedScheduledStartDate: updatedPhase.scheduledStartDate,
      }
    );
  });
}

/**
 * Apply an explicit scheduled end date to a phase and update its duration.
 *
 * @param {Object} phase challenge phase being recalculated
 * @param {Date|String} scheduledEndDate scheduled end date supplied by the update payload
 * @returns {Boolean} true when the scheduled end date was applied
 * @throws {BadRequestError} when the supplied end date is invalid or not after the phase start
 */
function applyScheduledEndDate(phase, scheduledEndDate) {
  if (_.isNil(scheduledEndDate)) {
    return false;
  }

  const scheduledStart = moment(phase.scheduledStartDate);
  const scheduledEnd = moment(scheduledEndDate);

  if (!scheduledEnd.isValid()) {
    throw new errors.BadRequestError(
      `scheduledEndDate: ${scheduledEndDate} should be a valid date`
    );
  }

  if (!scheduledEnd.isAfter(scheduledStart)) {
    throw new errors.BadRequestError(
      `scheduledEndDate: ${scheduledEndDate} should be after scheduledStartDate: ${phase.scheduledStartDate}`
    );
  }

  phase.scheduledEndDate = scheduledEnd.toDate().toISOString();
  phase.duration = scheduledEnd.diff(scheduledStart, "seconds");
  return true;
}

/**
 * Recalculate a phase's scheduled end date from either explicit input or duration.
 *
 * @param {Object} phase challenge phase being recalculated
 * @returns {undefined} mutates the provided phase
 * @throws {BadRequestError} when an explicit scheduled end date is invalid
 */
function recalculateScheduledEndDate(phase) {
  if (!_.isNil(phase.actualEndDate)) {
    return;
  }

  if (applyScheduledEndDate(phase, phase.requestedScheduledEndDate)) {
    return;
  }

  phase.scheduledEndDate = moment(phase.scheduledStartDate)
    .add(phase.duration, "seconds")
    .toDate()
    .toISOString();
}

/**
 * Find the incoming update payload for a persisted challenge phase.
 * This helper does not raise exceptions.
 *
 * @param {Array<Object>} newPhases phase updates from the challenge update request
 * @param {Object} phase persisted challenge phase being updated
 * @returns {Object|undefined} the matching phase update, preferring challenge phase row id
 */
function findPhaseUpdate(newPhases, phase) {
  if (!Array.isArray(newPhases)) {
    return undefined;
  }

  if (!_.isNil(phase.id)) {
    const phaseUpdate = _.find(newPhases, (p) => p.id === phase.id);
    if (!_.isNil(phaseUpdate)) {
      return phaseUpdate;
    }
  }

  return _.find(newPhases, (p) => p.phaseId === phase.phaseId);
}

/**
 * Order timeline template phases so every phase follows its predecessor.
 *
 * TimelineTemplatePhase rows carry no ordering column, so the database returns them
 * in unspecified physical order. Scheduling resolves predecessor dates in a single
 * pass, which is only correct when a predecessor is processed before its dependents.
 *
 * @param {Array<Object>} phases template phases, each with phaseId and optional predecessor
 * @returns {Array<Object>} phases in dependency order; phases unreachable from a root
 *   (dangling predecessor or cycle) are appended last, keeping their relative order
 */
function orderPhasesByPredecessorChain(phases) {
  if (!Array.isArray(phases)) {
    return [];
  }

  const knownPhaseIds = new Set(_.map(phases, "phaseId"));
  const childrenOf = new Map();
  _.each(phases, (phase) => {
    if (_.isNil(phase.predecessor) || !knownPhaseIds.has(phase.predecessor)) {
      return;
    }
    const siblings = childrenOf.get(phase.predecessor) || [];
    siblings.push(phase);
    childrenOf.set(phase.predecessor, siblings);
  });

  const ordered = [];
  const visited = new Set();
  const queue = _.filter(phases, (phase) => _.isNil(phase.predecessor));
  while (queue.length > 0) {
    const phase = queue.shift();
    if (visited.has(phase)) {
      continue;
    }
    visited.add(phase);
    ordered.push(phase);
    queue.push(...(childrenOf.get(phase.phaseId) || []));
  }

  // Phases with a dangling predecessor, or caught in a cycle, are never reachable from
  // a root. Keep them so the caller still emits them, unscheduled, as it did before.
  _.each(phases, (phase) => {
    if (!visited.has(phase)) {
      ordered.push(phase);
    }
  });

  return ordered;
}

class ChallengePhaseHelper {
  phaseDefinitionMap: any = {};
  timelineTemplateMap: any = {};

  async populatePhasesForChallengeCreation(phases, startDate, timelineTemplateId) {
    if (_.isUndefined(timelineTemplateId)) {
      throw new errors.BadRequestError(`Invalid timeline template ID: ${timelineTemplateId}`);
    }
    const { timelineTempate } = await this.getTemplateAndTemplateMap(timelineTemplateId);
    const { phaseDefinitionMap } = await this.getPhaseDefinitionsAndMap();
    // The template rows have no stored order, so walk the predecessor chain instead of
    // trusting the order the database happened to return them in.
    const orderedTemplate = orderPhasesByPredecessorChain(timelineTempate);
    console.log("Selected timeline template", JSON.stringify(orderedTemplate));
    let fixedStartDate = undefined;
    const finalPhases = _.map(orderedTemplate, (phaseFromTemplate) => {
      const phaseDefinition = phaseDefinitionMap.get(phaseFromTemplate.phaseId);
      const phaseFromInput = _.find(phases, (p) => p.phaseId === phaseFromTemplate.phaseId);
      const phase = {
        id: uuid(),
        phaseId: phaseFromTemplate.phaseId,
        name: phaseDefinition.name,
        description: phaseDefinition.description,
        duration: _.defaultTo(_.get(phaseFromInput, "duration"), phaseFromTemplate.defaultDuration),
        isOpen: false,
        predecessor: phaseFromTemplate.predecessor,
        constraints: _.defaultTo(_.get(phaseFromInput, "constraints"), []),
        scheduledStartDate: undefined,
        scheduledEndDate: undefined,
        actualStartDate: undefined,
        actualEndDate: undefined,
      };
      if (_.isNil(phase.predecessor)) {
        let scheduledStartDate = _.defaultTo(
          _.get(phaseFromInput, "scheduledStartDate"),
          startDate
        );
        if (
          !_.isUndefined(fixedStartDate) &&
          moment(scheduledStartDate).isBefore(moment(fixedStartDate))
        ) {
          scheduledStartDate = moment(fixedStartDate).toDate().toISOString();
        }
        phase.scheduledStartDate = moment(scheduledStartDate).toDate().toISOString();
        phase.scheduledEndDate = moment(phase.scheduledStartDate)
          .add(phase.duration, "seconds")
          .toDate()
          .toISOString();
      }
      if (_.isUndefined(fixedStartDate)) {
        fixedStartDate = phase.scheduledStartDate;
      }
      return phase;
    });
    for (const phase of finalPhases) {
      if (_.isNil(phase.predecessor)) {
        continue;
      }
      const precedecessorPhase = _.find(finalPhases, {
        phaseId: phase.predecessor,
      });
      if (_.isNil(precedecessorPhase)) {
        continue;
      }
      const inheritedStartDate =
        phase.name === "Iterative Review"
          ? precedecessorPhase.scheduledStartDate
          : precedecessorPhase.scheduledEndDate;
      // An unresolved predecessor would make moment() fall back to the current time,
      // scheduling this phase before the challenge even starts. Leave it unscheduled.
      if (_.isNil(inheritedStartDate)) {
        continue;
      }
      phase.scheduledStartDate = inheritedStartDate;
      phase.scheduledEndDate = moment(phase.scheduledStartDate)
        .add(phase.duration, "seconds")
        .toDate()
        .toISOString();
    }
    return finalPhases;
  }

  async populatePhasesForChallengeUpdate(
    challengePhases,
    newPhases,
    timelineTemplateId,
    isBeingActivated,
    options: any = {}
  ) {
    const { timelineTemplateMap, timelineTempate } = await this.getTemplateAndTemplateMap(
      timelineTemplateId
    );
    const { phaseDefinitionMap } = await this.getPhaseDefinitionsAndMap();
    const challengePhaseIds = new Set(_.map(challengePhases, "phaseId"));

    // Ensure deterministic processing order based on the timeline template sequence.
    // TimelineTemplatePhase rows carry no ordering column, so the database returns them
    // in unspecified physical order; walk the predecessor chain instead of trusting that
    // order, otherwise a dependent phase can be processed before its predecessor and get
    // scheduled against a stale predecessor date (same issue PM-6007 fixed for creation).
    const orderedTemplatePhases = orderPhasesByPredecessorChain(timelineTempate);
    const orderIndex = new Map();
    _.each(orderedTemplatePhases, (tplPhase, idx) => orderIndex.set(tplPhase.phaseId, idx));
    const submissionPhaseName = SUBMISSION_PHASE_PRIORITY.find((name) =>
      _.some(challengePhases, (phase) => phase.name === name)
    );
    const submissionPhase = submissionPhaseName
      ? _.find(challengePhases, (phase) => phase.name === submissionPhaseName)
      : null;
    const submissionOrderIndex = _.isNil(submissionPhase)
      ? null
      : orderIndex.get(submissionPhase.phaseId);
    const challengePhasesOrdered = _.sortBy(
      challengePhases,
      (p) => {
        const templateOrder = orderIndex.get(p.phaseId);
        if (!_.isNil(templateOrder)) {
          return templateOrder;
        }
        if (p.name === "AI Screening" && !_.isNil(submissionOrderIndex)) {
          return submissionOrderIndex + 0.5;
        }
        return Number.MAX_SAFE_INTEGER;
      }
    );

    let fixedStartDate = undefined;
    const updatedPhases = _.map(challengePhasesOrdered, (phase) => {
      const phaseFromTemplate = timelineTemplateMap.get(phase.phaseId);
      const phaseDefinition = phaseDefinitionMap.get(phase.phaseId);
      const newPhase = findPhaseUpdate(newPhases, phase);
      const templatePredecessor = _.get(phaseFromTemplate, "predecessor");
      // Prefer template predecessor only when that phase exists on the challenge, otherwise keep the stored link.
      const resolvedPredecessor = _.isNil(phaseFromTemplate)
        ? phase.predecessor
        : _.isNil(templatePredecessor)
        ? null
        : challengePhaseIds.has(templatePredecessor)
        ? templatePredecessor
        : phase.predecessor;
      const updatedPhase = {
        ...phase,
        predecessor: resolvedPredecessor,
        description: phaseDefinition.description,
        requestedScheduledStartDate: _.get(newPhase, "scheduledStartDate"),
        requestedScheduledEndDate: _.get(newPhase, "scheduledEndDate"),
      };
      if (
        _.isNil(updatedPhase.actualEndDate) &&
        !_.isNil(updatedPhase.actualStartDate) &&
        !_.isNil(updatedPhase.requestedScheduledStartDate)
      ) {
        updatedPhase.scheduledStartDate = moment(updatedPhase.requestedScheduledStartDate)
          .toDate()
          .toISOString();
      }
      if (updatedPhase.name === "Post-Mortem") {
        updatedPhase.predecessor = "a93544bc-c165-4af4-b55e-18f3593b457a";
      }
      if (_.isNil(updatedPhase.actualEndDate)) {
        updatedPhase.duration = _.defaultTo(_.get(newPhase, "duration"), updatedPhase.duration);
      }
      if (_.isNil(updatedPhase.predecessor)) {
        let scheduledStartDate = _.defaultTo(
          updatedPhase.requestedScheduledStartDate,
          updatedPhase.scheduledStartDate
        );
        if (
          !_.isNil(fixedStartDate) &&
          moment(scheduledStartDate).isBefore(moment(fixedStartDate))
        ) {
          scheduledStartDate = moment(fixedStartDate).toDate().toISOString();
        }
        if (isBeingActivated && moment(scheduledStartDate).isSameOrBefore(moment())) {
          updatedPhase.isOpen = true;
          updatedPhase.scheduledStartDate = moment().toDate().toISOString();
          updatedPhase.actualStartDate = updatedPhase.scheduledStartDate;
        } else if (_.isNil(phase.actualStartDate)) {
          updatedPhase.scheduledStartDate = moment(scheduledStartDate).toDate().toISOString();
        }
        recalculateScheduledEndDate(updatedPhase);
      }
      if (_.isNil(phase.actualEndDate) && !_.isNil(newPhase) && !_.isNil(newPhase.constraints)) {
        updatedPhase.constraints = newPhase.constraints;
      }
      if (_.isNil(fixedStartDate)) {
        fixedStartDate = updatedPhase.scheduledStartDate;
      }
      return updatedPhase;
    });

    const aiScreeningPhase = _.find(updatedPhases, (phase) => phase.name === "AI Screening");
    const updateSubmissionPhaseName = SUBMISSION_PHASE_PRIORITY.find((name) =>
      _.some(updatedPhases, (phase) => phase.name === name)
    );
    const updateSubmissionPhase = updateSubmissionPhaseName
      ? _.find(updatedPhases, (phase) => phase.name === updateSubmissionPhaseName)
      : null;
    if (!_.isNil(aiScreeningPhase) && !_.isNil(updateSubmissionPhase)) {
      aiScreeningPhase.predecessor = updateSubmissionPhase.phaseId;
      _.each(updatedPhases, (phase) => {
        if (
          phase.name &&
          phase.name.toLowerCase().includes("review") &&
          phase.predecessor === updateSubmissionPhase.phaseId
        ) {
          phase.predecessor = aiScreeningPhase.phaseId;
        }
      });
    }

    let iterativeReviewSet = false;
    for (const phase of updatedPhases) {
      if (_.isNil(phase.predecessor)) {
        continue;
      }
      const predecessorPhase = _.find(updatedPhases, {
        phaseId: phase.predecessor,
      });
      if (_.isNil(predecessorPhase)) {
        continue;
      }
      if (phase.name === "Iterative Review") {
        if (!iterativeReviewSet) {
          if (_.isNil(phase.actualStartDate)) {
            phase.scheduledStartDate = predecessorPhase.scheduledStartDate;
          }
          iterativeReviewSet = true;
        }
      } else if (_.isNil(phase.actualStartDate)) {
        phase.scheduledStartDate = predecessorPhase.scheduledEndDate;
      }
      recalculateScheduledEndDate(phase);
    }
    validateRecalculatedPhaseSchedules(challengePhasesOrdered, updatedPhases, options);
    return _.map(updatedPhases, (phase) =>
      _.omit(phase, ["requestedScheduledStartDate", "requestedScheduledEndDate"])
    );
  }

  handlePhasesAfterCancelling(phases) {
    return _.map(phases, (phase) => {
      const shouldClosePhase = _.includes(
        ["Registration", "Submission", "Checkpoint Submission"],
        phase.name
      );
      return {
        ...phase,
        isOpen: shouldClosePhase ? false : phase.isOpen,
        actualEndDate: shouldClosePhase ? moment().toDate().toISOString() : phase.actualEndDate,
      };
    });
  }

  async validatePhases(phases) {
    if (!phases || phases.length === 0) {
      return;
    }
    const { phaseDefinitionMap } = await this.getPhaseDefinitionsAndMap();
    const invalidPhases = _.filter(phases, (p) => !phaseDefinitionMap.has(p.phaseId));
    if (invalidPhases.length > 0) {
      throw new errors.BadRequestError(
        `The following phases are invalid: ${(globalThis as any).toString(invalidPhases)}`
      );
    }
  }

  async getPhase(phaseId) {
    const { phaseDefinitionMap } = await this.getPhaseDefinitionsAndMap();
    return phaseDefinitionMap.get(phaseId);
  }

  async getPhaseDefinitionsAndMap() {
    if (_.isEmpty(this.phaseDefinitionMap)) {
      const records = await prisma.phase.findMany({});

      const map = new Map<any, any>();
      _.each(records, (r) => {
        map.set(r.id, r);
      });

      this.phaseDefinitionMap = { phaseDefinitions: records, phaseDefinitionMap: map };
    }
    return this.phaseDefinitionMap;
  }

  async getTemplateAndTemplateMap(timelineTemplateId) {
    if (_.isEmpty(this.timelineTemplateMap[timelineTemplateId])) {
      const records = await timelineTemplateService.getTimelineTemplate(timelineTemplateId);
      const map = new Map<any, any>();
      _.each(records.phases, (r) => {
        map.set(r.phaseId, r);
      });

      this.timelineTemplateMap[timelineTemplateId] = {
        timelineTempate: records.phases,
        timelineTemplateMap: map,
      };
    }
    return this.timelineTemplateMap[timelineTemplateId];
  }

  /**
   * Check whether a challenge track represents Design.
   *
   * @param {Object|String|null|undefined} track challenge track relation, display value, or token
   * @returns {Boolean} true when the track is Design
   */
  isDesignTrack(track) {
    return isDesignTrack(track);
  }

  /**
   * Validate a phase scheduled end date change against PM-5378 rules.
   *
   * @param {Object} phase existing challenge phase
   * @param {Date|String|null|undefined} requestedScheduledEndDate requested scheduled end date
   * @param {Object} options validation options
   * @returns {undefined} validates only
   * @throws {BadRequestError} when phase shortening is disallowed or would end in the past
   */
  validateActivePhaseScheduledEndDateChange(phase, requestedScheduledEndDate, options: any = {}) {
    validateActivePhaseScheduledEndDateChange(phase, requestedScheduledEndDate, options);
  }
}

module.exports = new ChallengePhaseHelper();
