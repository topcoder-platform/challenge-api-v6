const path = require('path');
require('dotenv').config();

// Default configuration with fallbacks
module.exports = {
  // Database connection
  DATABASE_URL: process.env.DATABASE_URL,
  
  // Migration settings
  DATA_DIRECTORY: process.env.DATA_DIRECTORY || path.join(__dirname, '..', 'data'),
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE || '100', 10),
  CONCURRENCY_LIMIT: parseInt(process.env.CONCURRENCY_LIMIT || '10', 10),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  
  // Migration behavior
  SKIP_MISSING_REQUIRED: process.env.SKIP_MISSING_REQUIRED === 'true',
  USE_TRANSACTIONS: process.env.USE_TRANSACTIONS !== 'false',
  
  // Migration attribution
  CREATED_BY: process.env.CREATED_BY || 'migration',
  UPDATED_BY: process.env.UPDATED_BY || 'migration',

  // Logfile path
  LOG_FILE: process.env.LOG_FILE || path.join(__dirname, '..', 'logs', 'migration.log'),

  // Specialized challenge migration toggles
  CHALLENGE_COUNTERS_ONLY: process.env.CHALLENGE_COUNTERS_ONLY === 'true',

  migrator: {
    ChallengeType: {
      idField: 'id',
      priority: 1,
      requiredFields: ['id', 'name', 'isActive', 'isTask', 'abbreviation', 'createdAt', 'createdBy', 'updatedAt','updatedBy'],
      optionalFields: ['description'],
      hasDefaults: ['id', 'isActive', 'isTask', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_TYPE_FILE || 'ChallengeType_dynamo_data.json'
    },

    ChallengeTrack: {
      idField: 'id',
      priority: 1,
      requiredFields: ['id', 'name', 'isActive', 'abbreviation', 'createdAt', 'createdBy', 'updatedAt','updatedBy'],
      optionalFields: ['description', 'legacyId', 'track'],
      hasDefaults: ['id', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_TRACK_FILE || 'ChallengeTrack_dynamo_data.json'
    },

    TimelineTemplate: {
      idField: 'id',
      priority: 1,
      requiredFields: ['id', 'name', 'isActive', 'createdAt', 'createdBy', 'updatedAt','updatedBy'],
      optionalFields: ['description'],
      hasDefaults: ['id', 'isActive', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      uniqueConstraints: [
        {name: 'name', fields: ['name']},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.TIMELINE_TEMPLATE_FILE || 'TimelineTemplate_dynamo_data.json'
    },

    Phase: {
      idField: 'id',
      priority: 1,
      requiredFields: ['id', 'name', 'isOpen', 'duration', 'createdAt', 'createdBy', 'updatedAt','updatedBy'],
      optionalFields: ['description'],
      hasDefaults: ['id', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      uniqueConstraints: [
        {name: 'name', fields: ['name']},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.PHASE_FILE || 'Phase_dynamo_data.json'
    },

    TimelineTemplatePhase: {
      idField: 'id',
      priority: 2,
      requiredFields: ['id', 'timelineTemplateId', 'phaseId', 'defaultDuration', 'createdAt', 'createdBy', 'updatedAt','updatedBy'],
      optionalFields: ['predecessor'],
      hasDefaults: ['id', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.TIMELINE_TEMPLATE_FILE || 'TimelineTemplate_dynamo_data.json'
    },

    ChallengeTimelineTemplate: {
      idField: 'id',
      priority: 2,
      requiredFields: ['id', 'typeId', 'trackId', 'timelineTemplateId', 'isDefault', 'createdAt', 'createdBy', 'updatedAt','updatedBy'],
      hasDefaults: ['id', 'isDefault', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'ChallengeType', fkey: 'typeId'},
        {name: 'ChallengeTrack', fkey: 'trackId'},
        {name: 'TimelineTemplate', fkey: 'timelineTemplateId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_TIMELINE_TEMPLATE_FILE || 'ChallengeTimelineTemplate_dynamo_data.json'
    },

    Challenge: {
      idField: 'id',
      priority: 2,
      requiredFields: ['id', 'name', 'typeId', 'trackId', 'currentPhaseNames', 'tags', 'groups', 'taskIsTask', 'taskIsAssigned', 'status', 'createdAt',
         'createdBy', 'updatedAt','updatedBy'],
      optionalFields: ['description', 'privateDescription', 'descriptionFormat', 'challengeSource', 'projectId', 'timelineTemplateId', 'overviewTotalPrizes', 'taskMemberId',
         'submissionStartDate', 'submissionEndDate', 'registrationStartDate', 'registrationEndDate', 'startDate', 'endDate', 'legacyId',
         // migration of counters
         'numOfRegistrants', 'numOfSubmissions', 'numOfCheckpointSubmissions'
      ],
      hasDefaults: ['id', 'taskIsTask', 'taskIsAssigned', 'status', 'createdAt', 'updatedAt', 'wiproAllowed'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'ChallengeType', fkey: 'typeId'},
        {name: 'ChallengeTrack', fkey: 'trackId'},
        {name: 'TimelineTemplate', fkey: 'timelineTemplateId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      countersOnly: process.env.CHALLENGE_COUNTERS_ONLY === 'true',
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    AuditLog: {
      idField: 'id',
      priority: 3,
      requiredFields: ['id', 'fieldName', 'createdAt', 'createdBy'],
      optionalFields: ['challengeId', 'oldValue', 'newValue', 'memberId'],
      hasDefaults: ['id','createdAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'Challenge', fkey: 'challengeId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.AUDIT_LOG_FILE || 'AuditLog_dynamo_data.json'
    },
  
    Attachment: {
      idField: 'id',
      priority: 3,
      requiredFields: ['id', 'challengeId', 'name', 'fileSize', 'url', 'createdAt', 'createdBy', 'updatedAt','updatedBy'],
      optionalFields: ['description'],
      hasDefaults: ['id','createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'Challenge', fkey: 'challengeId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.ATTACHMENT_FILE || 'Attachment_dynamo_data.json'
    },

    ChallengeBilling: {
      idField: 'id',
      priority: 3,
      requiredFields: ['id', 'challengeId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      optionalFields: ['billingAccountId', 'markup', 'clientBillingRate'],
      hasDefaults: ['id','createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'Challenge', fkey: 'challengeId'},
      ],
      uniqueConstraints: [
        {name: 'challengeId', fields: ['challengeId']},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    ChallengeConstraint: {
      idField: 'id',
      priority: 3,
      requiredFields: ['id', 'challengeId', 'allowedRegistrants', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      hasDefaults: ['id', 'allowedRegistrants', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'Challenge', fkey: 'challengeId'},
      ],
      uniqueConstraints: [
        {name: 'challengeId', fields: ['challengeId']},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    ChallengeLegacy: {
      idField: 'id',
      priority: 3,
      requiredFields: ['id', 'reviewType', 'confidentialityType', 'isTask', 'useSchedulingAPI', 'pureV5Task', 'pureV5', 'selfService',
          'challengeId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      optionalFields: ['forumId', 'directProjectId', 'screeningScorecardId', 'reviewScorecardId', 'selfServiceCopilot', 'track', 'subTrack',
          'legacySystemId', 
      ],
      hasDefaults: ['id', 'confidentialityType', 'isTask', 'useSchedulingAPI', 'pureV5Task', 'pureV5', 'selfService', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'Challenge', fkey: 'challengeId'},
      ],
      uniqueConstraints: [
        {name: 'challengeId', fields: ['challengeId']},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    ChallengeEvent: {
      idField: 'id',
      priority: 3,
      requiredFields: ['id', 'challengeId', 'eventId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      optionalFields: ['name', 'key'],
      hasDefaults: ['id','createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'Challenge', fkey: 'challengeId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    ChallengeDiscussion: {
      idField: 'id',
      priority: 3,
      requiredFields: ['id', 'challengeId', 'name', 'type', 'provider', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      optionalFields: ['discussionId', 'url'],
      hasDefaults: ['id','createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'Challenge', fkey: 'challengeId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    ChallengeMetadata: {
      idField: 'id',
      priority: 3,
      requiredFields: ['id', 'challengeId', 'name', 'value', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      hasDefaults: ['id','createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'Challenge', fkey: 'challengeId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    ChallengePrizeSet: {
      idField: 'id',
      priority: 3,
      requiredFields: ['id', 'challengeId', 'type', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      optionalFields: ['description'],
      hasDefaults: ['id','createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'Challenge', fkey: 'challengeId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    ChallengePhase: {
      idField: 'id',
      priority: 3,
      requiredFields: ['id', 'challengeId', 'phaseId', 'name', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      optionalFields: ['description', 'isOpen', 'predecessor', 'duration', 'scheduledStartDate', 'scheduledEndDate', 'actualStartDate', 'actualEndDate'],
      hasDefaults: ['id', 'isOpen', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'Challenge', fkey: 'challengeId'},
        {name: 'Phase', fkey: 'phaseId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    ChallengeWinner: {
      idField: 'id',
      priority: 3,
      requiredFields: ['id', 'challengeId', 'userId', 'handle', 'placement', 'type', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      hasDefaults: ['id', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'Challenge', fkey: 'challengeId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    ChallengeTerm: {
      idField: 'id',
      priority: 3,
      requiredFields: ['id', 'challengeId', 'termId', 'roleId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      hasDefaults: ['id', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'Challenge', fkey: 'challengeId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    ChallengeSkill: {
      idField: 'id',
      priority: 3,
      requiredFields: ['id', 'challengeId', 'skillId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      hasDefaults: ['id', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'Challenge', fkey: 'challengeId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    ChallengePhaseConstraint: {
      idField: 'id',
      priority: 4,
      requiredFields: ['id', 'challengePhaseId', 'name', 'value', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      hasDefaults: ['id', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'ChallengePhase', fkey: 'challengePhaseId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    Prize: {
      idField: 'id',
      priority: 4,
      requiredFields: ['id', 'prizeSetId', 'type', 'value', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      optionalFields: ['description'],
      hasDefaults: ['id', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'ChallengePrizeSet', fkey: 'prizeSetId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },

    ChallengeDiscussionOption: {
      idField: 'id',
      priority: 4,
      requiredFields: ['id', 'discussionId', 'optionKey', 'optionValue', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
      hasDefaults: ['id', 'createdAt', 'updatedAt'], // Defaults in the Prisma Schema
      dependencies: [
        {name: 'ChallengeDiscussion', fkey: 'discussionId'},
      ],
      defaultValues: {
        createdBy: process.env.CREATED_BY || 'migration',
        updatedBy: process.env.UPDATED_BY || 'migration'
      },
      filename: process.env.CHALLENGE_FILE || 'challenge-api.challenge.json'
    },
  }, 
};
