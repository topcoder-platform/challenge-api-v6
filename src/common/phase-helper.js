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
  options = {}
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
function validateRecalculatedPhaseSchedules(originalPhases, updatedPhases, options = {}) {
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

class ChallengePhaseHelper {
  phaseDefinitionMap = {};
  timelineTemplateMap = {};

  async populatePhasesForChallengeCreation(phases, startDate, timelineTemplateId) {
    if (_.isUndefined(timelineTemplateId)) {
      throw new errors.BadRequestError(`Invalid timeline template ID: ${timelineTemplateId}`);
    }
    const { timelineTempate } = await this.getTemplateAndTemplateMap(timelineTemplateId);
    console.log("Selected timeline template", JSON.stringify(timelineTempate));
    const { phaseDefinitionMap } = await this.getPhaseDefinitionsAndMap();
    let fixedStartDate = undefined;
    const finalPhases = _.map(timelineTempate, (phaseFromTemplate) => {
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
    for (let phase of finalPhases) {
      if (_.isUndefined(phase.predecessor)) {
        continue;
      }
      const precedecessorPhase = _.find(finalPhases, {
        phaseId: phase.predecessor,
      });
      if (!_.isNil(precedecessorPhase)) {
        if (phase.name === "Iterative Review") {
          phase.scheduledStartDate = precedecessorPhase.scheduledStartDate;
        } else {
          phase.scheduledStartDate = precedecessorPhase.scheduledEndDate;
        }
        phase.scheduledEndDate = moment(phase.scheduledStartDate)
          .add(phase.duration, "seconds")
          .toDate()
          .toISOString();
      }
    }
    return finalPhases;
  }

  async populatePhasesForChallengeUpdate(
    challengePhases,
    newPhases,
    timelineTemplateId,
    isBeingActivated,
    options = {}
  ) {
    const { timelineTemplateMap, timelineTempate } = await this.getTemplateAndTemplateMap(
      timelineTemplateId
    );
    const { phaseDefinitionMap } = await this.getPhaseDefinitionsAndMap();
    const challengePhaseIds = new Set(_.map(challengePhases, "phaseId"));

    // Ensure deterministic processing order based on the timeline template sequence
    // DB returns phases ordered by dates, which can cause "fixedStartDate" logic below
    // to incorrectly push earlier phases forward. Sorting by template order prevents that.
    const orderIndex = new Map();
    _.each(timelineTempate, (tplPhase, idx) => orderIndex.set(tplPhase.phaseId, idx));
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
        requestedScheduledEndDate: _.get(newPhase, "scheduledEndDate"),
      };
      if (updatedPhase.name === "Post-Mortem") {
        updatedPhase.predecessor = "a93544bc-c165-4af4-b55e-18f3593b457a";
      }
      if (_.isNil(updatedPhase.actualEndDate)) {
        updatedPhase.duration = _.defaultTo(_.get(newPhase, "duration"), updatedPhase.duration);
      }
      if (_.isNil(updatedPhase.predecessor)) {
        let scheduledStartDate = _.defaultTo(
          _.get(newPhase, "scheduledStartDate"),
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
    for (let phase of updatedPhases) {
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
    return _.map(updatedPhases, (phase) => _.omit(phase, "requestedScheduledEndDate"));
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
        `The following phases are invalid: ${toString(invalidPhases)}`
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

      const map = new Map();
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
      const map = new Map();
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
  validateActivePhaseScheduledEndDateChange(phase, requestedScheduledEndDate, options = {}) {
    validateActivePhaseScheduledEndDateChange(phase, requestedScheduledEndDate, options);
  }
}

module.exports = new ChallengePhaseHelper();
