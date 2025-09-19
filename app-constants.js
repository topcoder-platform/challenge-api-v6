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
  ChallengeTypeCreated: "test.new.bus.events", // 'challenge.action.type.created',
  ChallengeTypeUpdated: "test.new.bus.events", // 'challenge.action.type.updated',
  ChallengeTypeDeleted: "test.new.bus.events", // 'challenge.action.type.deleted',
  ChallengeTrackCreated: "test.new.bus.events", // 'challenge.action.track.created',
  ChallengeTrackUpdated: "test.new.bus.events", // 'challenge.action.track.updated',
  ChallengeTrackDeleted: "test.new.bus.events", // 'challenge.action.track.deleted',
  PhaseCreated: "test.new.bus.events", // 'phase.action.created',
  PhaseUpdated: "test.new.bus.events", // 'phase.action.updated',
  PhaseDeleted: "test.new.bus.events", // 'phase.action.deleted',
  TimelineTemplateCreated: "test.new.bus.events", // 'challenge.action.timeline.template.created',
  TimelineTemplateUpdated: "test.new.bus.events", // 'challenge.action.timeline.template.updated',
  TimelineTemplateDeleted: "test.new.bus.events", // 'challenge.action.timeline.template.deleted',
  ChallengeTypeTimelineTemplateCreated: "test.new.bus.events", // 'challenge.action.type.timeline.template.created',
  ChallengeTypeTimelineTemplateUpdated: "test.new.bus.events", // 'challenge.action.type.timeline.template.updated',
  ChallengeTypeTimelineTemplateDeleted: "test.new.bus.events", // 'challenge.action.type.timeline.template.deleted'
  ChallengeAttachmentCreated: "test.new.bus.events", // 'challenge.action.attachment.created',
  ChallengeAttachmentUpdated: "test.new.bus.events", // 'challenge.action.attachment.updated',
  ChallengeAttachmentDeleted: "test.new.bus.events", // 'challenge.action.attachment.deleted',
  ChallengeTimelineTemplateCreated: "challenge.action.challenge.timeline.created",
  ChallengeTimelineTemplateUpdated: "challenge.action.challenge.timeline.updated",
  ChallengeTimelineTemplateDeleted: "challenge.action.challenge.timeline.deleted",
  ChallengePhaseUpdated: "test.new.bus.events", // 'challenge.action.phase.updated',
  ChallengePhaseDeleted: "test.new.bus.events", // 'challenge.action.phase.deleted',
  // Self Service topics
  Notifications: "notifications.action.create",
};

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
  challengeTextSortField,
  SelfServiceNotificationTypes,
  SelfServiceNotificationSettings,
  PhaseFact,
  auditFields,
};
