const config = require("config");

/**
 * App constants
 */
const UserRoles = {
  Admin: "administrator",
  Copilot: "copilot",
  Manager: "Connect Manager",
  User: "Topcoder User",
  SelfServiceCustomer: "Self-Service Customer",
};

const prizeTypes = {
  USD: "USD",
  POINT: "POINT",
};

const validChallengeParams = {
  UpdatedBy: "updatedBy",
  Updated: "updatedAt",
  CreatedBy: "createdBy",
  Created: "createdAt",
  EndDate: "endDate",
  StartDate: "startDate",
  ProjectId: "projectId",
  Name: "name",
  Type: "type",
  NumOfSubmissions: "numOfSubmissions",
  NumOfRegistrants: "numOfRegistrants",
  Status: "status",
  TypeId: "typeId",
  Prizes: "overview.totalPrizes",
};

const EVENT_ORIGINATOR = "topcoder-challenges-api";

const EVENT_MIME_TYPE = "application/json";

// using a testing topc, should be changed to use real topics in comments when they are created
const Topics = {
  ChallengeCreated: "challenge.notification.create",
  ChallengeUpdated: "challenge.notification.update",
  ChallengeDeleted: "challenge.notification.delete",
  ChallengeTypeCreated: "challenge.action.type.created",
  ChallengeTypeUpdated: "challenge.action.type.updated",
  ChallengeTypeDeleted: "challenge.action.type.deleted",
  ChallengeTrackCreated: "challenge.action.track.created",
  ChallengeTrackUpdated: "challenge.action.track.updated",
  ChallengeTrackDeleted: "challenge.action.track.deleted",
  PhaseCreated: "phase.action.created",
  PhaseUpdated: "phase.action.updated",
  PhaseDeleted: "phase.action.deleted",
  TimelineTemplateCreated: "challenge.action.timeline.template.created",
  TimelineTemplateUpdated: "challenge.action.timeline.template.updated",
  TimelineTemplateDeleted: "challenge.action.timeline.template.deleted",
  ChallengeTypeTimelineTemplateCreated: "challenge.action.type.timeline.template.created",
  ChallengeTypeTimelineTemplateUpdated: "challenge.action.type.timeline.template.updated",
  ChallengeTypeTimelineTemplateDeleted: "challenge.action.type.timeline.template.deleted",
  ChallengeAttachmentCreated: "challenge.action.attachment.created",
  ChallengeAttachmentUpdated: "challenge.action.attachment.updated",
  ChallengeAttachmentDeleted: "challenge.action.attachment.deleted",
  ChallengeTimelineTemplateCreated: "challenge.action.challenge.timeline.created",
  ChallengeTimelineTemplateUpdated: "challenge.action.challenge.timeline.updated",
  ChallengeTimelineTemplateDeleted: "challenge.action.challenge.timeline.deleted",
  ChallengePhaseUpdated: "challenge.action.phase.updated",
  ChallengePhaseDeleted: "challenge.action.phase.deleted",
  // Self Service topics
  Notifications: "notifications.action.create",
};

// Kafka topics temporarily disabled.  We probably don't need all these right now, and this just cuts
// down on overhead.
const DisabledTopics = [
  Topics.ChallengeTypeCreated,
  Topics.ChallengeTypeUpdated,
  Topics.ChallengeTypeDeleted,
  Topics.ChallengeTrackCreated,
  Topics.ChallengeTrackUpdated,
  Topics.ChallengeTrackDeleted,
  Topics.PhaseCreated,
  Topics.PhaseUpdated,
  Topics.PhaseDeleted,
  Topics.TimelineTemplateCreated,
  Topics.TimelineTemplateUpdated,
  Topics.TimelineTemplateDeleted,
  Topics.ChallengeTypeTimelineTemplateCreated,
  Topics.ChallengeTypeTimelineTemplateUpdated,
  Topics.ChallengeTypeTimelineTemplateDeleted,
  Topics.ChallengeAttachmentCreated,
  Topics.ChallengeAttachmentUpdated,
  Topics.ChallengeAttachmentDeleted,
  Topics.ChallengeTimelineTemplateCreated,
  Topics.ChallengeTimelineTemplateUpdated,
  Topics.ChallengeTimelineTemplateDeleted,
  Topics.ChallengePhaseUpdated,
  Topics.ChallengePhaseDeleted,
];

const challengeTextSortField = {
  Name: "name",
  TypeId: "typeId",
};

const SelfServiceNotificationTypes = {
  WORK_REQUEST_SUBMITTED: "self-service.notifications.work-request-submitted",
  WORK_REQUEST_STARTED: "self-service.notifications.work-request-started",
  WORK_REQUEST_REDIRECTED: "self-service.notifications.work-request-redirected",
  WORK_COMPLETED: "self-service.notifications.work-completed",
};

const SelfServiceNotificationSettings = {
  [SelfServiceNotificationTypes.WORK_REQUEST_SUBMITTED]: {
    sendgridTemplateId: config.SENDGRID_TEMPLATES.WORK_REQUEST_SUBMITTED,
    cc: [],
  },
  [SelfServiceNotificationTypes.WORK_REQUEST_STARTED]: {
    sendgridTemplateId: config.SENDGRID_TEMPLATES.WORK_REQUEST_STARTED,
    cc: [],
  },
  [SelfServiceNotificationTypes.WORK_REQUEST_REDIRECTED]: {
    sendgridTemplateId: config.SENDGRID_TEMPLATES.WORK_REQUEST_REDIRECTED,
    cc: [...config.SELF_SERVICE_EMAIL_CC_ACCOUNTS],
  },
  [SelfServiceNotificationTypes.WORK_COMPLETED]: {
    sendgridTemplateId: config.SENDGRID_TEMPLATES.WORK_COMPLETED,
    cc: [],
  },
};

const PhaseFact = {
  PHASE_FACT_UNSPECIFIED: 0,
  PHASE_FACT_REGISTRATION: 1,
  PHASE_FACT_SUBMISSION: 2,
  PHASE_FACT_REVIEW: 3,
  PHASE_FACT_ITERATIVE_REVIEW: 4,
  PHASE_FACT_CHECKPOINT_SUBMISSION: 5,
  PHASE_FACT_CHECKPOINT_SCREENING: 6,
  PHASE_FACT_CHECKPOINT_REVIEW: 7,
  PHASE_FACT_CHECKPOINT_ITERATIVE_REVIEW: 8,
  PHASE_FACT_FINAL_FIX: 9,
  PHASE_FACT_FINAL_REVIEW: 10,
  PHASE_FACT_APPEALS: 11,
  PHASE_FACT_APPEALS_RESPONSE: 12,
  UNRECOGNIZED: -1
}

const auditFields = [
  'createdAt', 'createdBy', 'updatedAt', 'updatedBy'
]

module.exports = {
  UserRoles,
  prizeTypes,
  validChallengeParams,
  EVENT_ORIGINATOR,
  EVENT_MIME_TYPE,
  Topics,
  DisabledTopics,
  challengeTextSortField,
  SelfServiceNotificationTypes,
  SelfServiceNotificationSettings,
  PhaseFact,
  auditFields,
};
