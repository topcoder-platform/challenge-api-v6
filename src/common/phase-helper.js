const _ = require("lodash");

const { v4: uuid } = require('uuid');
const moment = require("moment");

const errors = require("./errors");

const timelineTemplateService = require("../services/TimelineTemplateService");
const prisma = require("../common/prisma").getClient();

const SUBMISSION_PHASE_PRIORITY = ["Topgear Submission", "Topcoder Submission", "Submission"];

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
    isBeingActivated
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
      const newPhase = _.find(newPhases, (p) => p.phaseId === phase.phaseId);
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
}

module.exports = new ChallengePhaseHelper();
