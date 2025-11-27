/**
 * This file defines common helper methods used for tests
 */
const _ = require('lodash')
const { v4: uuid } = require('uuid');
const { ChallengeStatusEnum } = require('../src/common/prisma')
const prisma = require('../src/common/prisma').getClient()
const jwt = require('jsonwebtoken')
const config = require('config')

let challengeTrack
let challengeType
let marathonMatchType
let phase
let phase2
let timelineTemplate
let challenge
let taskChallenge
let marathonMatchChallenge
let adminToken
let userToken

/**
 * function to deeply compare arrays  regardeless of the order
 *
 * @param {Array} arr1 The first array to compare
 * @param {Array} arr2 The second array to compare
 * @returns {Boolean} The flag indicating whether the arrays have the same content regardless of the order
 */
const deepCompareArrays = (arr1, arr2) => {
  return _(arr1).xorWith(arr2, _.isEqual).isEmpty()
}

const challengeTrackId = uuid()
const challengeTypeId = uuid()
const phase1Id = uuid()
const phase2Id = uuid()
const timelineTemplateId = uuid()
const challengeId = uuid()
const taskChallengeId = uuid()
const marathonMatchTypeId = uuid()
const marathonMatchChallengeId = uuid()
const challengePhase1Id = uuid()
const challengePhase2Id = uuid()
const marathonMatchChallengePhase1Id = uuid()
const marathonMatchChallengePhase2Id = uuid()
const challengePhaseConstrain1Id = uuid()
const challengePhaseConstrain2Id = uuid()

/**
 * Create test data
 */
async function createData () {
  const testUserId = 'testuser'
  challengeTrack = await prisma.challengeTrack.create({
    data: {
      id: challengeTrackId,
      name: `type-${new Date().getTime()}`,
      description: 'desc',
      isActive: true,
      track: 'DEVELOP',
      abbreviation: 'abbr',
      createdBy: testUserId,
      updatedBy: testUserId
    }
  })
  challengeType = await prisma.challengeType.create({
    data: {
      id: challengeTypeId,
      name: `type-${new Date().getTime()}`,
      description: 'desc',
      isActive: true,
      abbreviation: 'abbr',
      createdBy: testUserId,
      updatedBy: testUserId
    }
  })
  marathonMatchType = await prisma.challengeType.create({
    data: {
      id: marathonMatchTypeId,
      name: 'Marathon Match',
      description: 'Marathon Match challenge type',
      isActive: true,
      abbreviation: 'MM',
      createdBy: testUserId,
      updatedBy: testUserId
    }
  })
  phase = await prisma.phase.create({
    data: {
      id: phase1Id,
      name: `phase-${new Date().getTime()}`,
      description: 'desc',
      isOpen: true,
      duration: 123,
      createdBy: testUserId,
      updatedBy: testUserId
    }
  })
  phase2 = await prisma.phase.create({
    data: {
      id: phase2Id,
      name: `phase2-${new Date().getTime()}`,
      description: 'desc',
      isOpen: true,
      duration: 432,
      createdBy: testUserId,
      updatedBy: testUserId
    }
  })
  timelineTemplate = {
    id: timelineTemplateId,
    name: `tt-${new Date().getTime()}`,
    description: 'desc',
    isActive: true,
    createdBy: testUserId,
    updatedBy: testUserId,
    phases: [
      {
        phaseId: phase.id,
        defaultDuration: 10000,
        createdBy: testUserId,
        updatedBy: testUserId
      },
      {
        phaseId: phase2.id,
        predecessor: phase.id,
        defaultDuration: 20000,
        createdBy: testUserId,
        updatedBy: testUserId
      }
    ]
  }
  const templateModel = timelineTemplate
  templateModel.phases = { create: templateModel.phases }
  await prisma.timelineTemplate.create({
    data: templateModel
  })
  const nm = `a B c challenge${new Date().getTime()}`
  const challengeData = {
    id: challengeId,
    name: nm,
    description: 'desc',
    privateDescription: 'private description',
    challengeSource: 'Topcoder',
    descriptionFormat: 'html',
    timelineTemplate: { connect: { id: timelineTemplate.id } },
    type: { connect: { id: challengeTypeId } },
    track: { connect: { id: challengeTrackId } },
    tags: ['tag1'],
    projectId: 111,
    legacyId: 222,
    startDate: new Date(),
    status: ChallengeStatusEnum.COMPLETED,
    createdAt: new Date(),
    createdBy: 'admin',
    updatedBy: 'admin'
  }
  challenge = await prisma.challenge.create({ data: challengeData })
  await prisma.challengePhase.createMany({
    data: [
      {
        id: challengePhase1Id,
        challengeId: challenge.id,
        phaseId: phase.id,
        name: 'Registration',
        duration: 1000,
        createdBy: 'admin',
        updatedBy: 'admin'
      },
      {
        id: challengePhase2Id,
        challengeId: challenge.id,
        phaseId: phase2.id,
        name: 'Submission',
        duration: 2000,
        predecessor:challengePhase1Id,
        createdBy: 'admin',
        updatedBy: 'admin'
      }
    ]
  })
  await prisma.challengePhaseConstraint.createMany({
    data: [
      {
        id: challengePhaseConstrain1Id,
        challengePhaseId: challengePhase1Id,
        name: `constraint-name-1`,
        value: 100,
        createdBy: 'admin',
        updatedBy: 'admin'
      },
      {
        id: challengePhaseConstrain2Id,
        challengePhaseId: challengePhase2Id,
        name: `constraint-name-2`,
        value: 200,
        createdBy: 'admin',
        updatedBy: 'admin'
      }
    ]
  })

  taskChallenge = await prisma.challenge.create({ data: {
    id: taskChallengeId,
    taskIsTask: true,
    taskIsAssigned: true,
    name: 'Task',
    description: 'desc',
    privateDescription: 'private description',
    challengeSource: 'Topcoder',
    descriptionFormat: 'html',
    timelineTemplate: { connect: { id: timelineTemplate.id } },
    type: { connect: { id: challengeTypeId } },
    track: { connect: { id: challengeTrackId } },
    tags: ['tag1'],
    projectId: 111,
    legacyId: 222,
    startDate: new Date(),
    status: ChallengeStatusEnum.COMPLETED,
    createdAt: new Date(),
    createdBy: 'admin',
    updatedBy: 'admin'
  }})

  marathonMatchChallenge = await prisma.challenge.create({ data: {
    id: marathonMatchChallengeId,
    name: 'Marathon Match Challenge',
    description: 'Marathon Match challenge description',
    privateDescription: 'private description',
    challengeSource: 'Topcoder',
    descriptionFormat: 'html',
    timelineTemplate: { connect: { id: timelineTemplate.id } },
    type: { connect: { id: marathonMatchTypeId } },
    track: { connect: { id: challengeTrackId } },
    tags: ['mm-tag'],
    projectId: 333,
    legacyId: 444,
    startDate: new Date(),
    status: ChallengeStatusEnum.ACTIVE,
    createdAt: new Date(),
    createdBy: 'admin',
    updatedBy: 'admin'
  } })

  await prisma.challengePhase.createMany({
    data: [
      {
        id: marathonMatchChallengePhase1Id,
        challengeId: marathonMatchChallenge.id,
        phaseId: phase.id,
        name: 'MM Registration',
        duration: 3000,
        isOpen: true,
        createdBy: 'admin',
        updatedBy: 'admin'
      },
      {
        id: marathonMatchChallengePhase2Id,
        challengeId: marathonMatchChallenge.id,
        phaseId: phase2.id,
        name: 'MM Submission',
        duration: 4000,
        predecessor: marathonMatchChallengePhase1Id,
        isOpen: true,
        createdBy: 'admin',
        updatedBy: 'admin'
      }
    ]
  })

  adminToken = jwt.sign({
    roles: [
      'Topcoder User',
      'Connect Support',
      'administrator',
      'testRole',
      'aaa',
      'tony_test_1',
      'Connect Manager',
      'Connect Admin',
      'copilot',
      'Connect Copilot Manager'
    ],
    iss: 'https://api.topcoder-dev.com',
    handle: 'TonyJ',
    exp: 1980992788,
    userId: '8547899',
    iat: 1549791611,
    email: 'email@domain.com.z',
    jti: 'f94d1e26-3d0e-46ca-8115-8754544a08f1'
  }, config.get('AUTH_SECRET')) 
  // adminToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlcyI6WyJUb3Bjb2RlciBVc2VyIiwiQ29ubmVjdCBTdXBwb3J0IiwiYWRtaW5pc3RyYXRvciIsInRlc3RSb2xlIiwiYWFhIiwidG9ueV90ZXN0XzEiLCJDb25uZWN0IE1hbmFnZXIiLCJDb25uZWN0IEFkbWluIiwiY29waWxvdCIsIkNvbm5lY3QgQ29waWxvdCBNYW5hZ2VyIl0sImlzcyI6Imh0dHBzOi8vYXBpLnRvcGNvZGVyLWRldi5jb20iLCJoYW5kbGUiOiJUb255SiIsImV4cCI6MTc4OTAwODYyMywidXNlcklkIjoiODU0Nzg5OSIsImlhdCI6MTU0OTc5MTYxMSwiZW1haWwiOiJ0amVmdHMrZml4QHRvcGNvZGVyLmNvbSIsImp0aSI6ImY5NGQxZTI2LTNkMGUtNDZjYS04MTE1LTg3NTQ1NDRhMDhmMSJ9.bMzIZ7YlDVhIauGtYTcL4bwW1eyYnOvqZUMb_ZNcX0E'
  userToken = jwt.sign({
    roles: [
      'Topcoder User'
    ],
    iss: 'https://api.topcoder-dev.com',
    handle: 'phead',
    exp: 1980992788,
    userId: '22742764',
    iat: 1549791611,
    email: 'email@domain.com.z',
    jti: '9c4511c5-c165-4a1b-899e-b65ad0e02b55'
  }, config.get('AUTH_SECRET')) 
}

const defaultProjectTerms = [
  {
    id: '0fcb41d1-ec7c-44bb-8f3b-f017a61cd708',
    title: 'Competition Non-Disclosure Agreement',
    url: '',
    text: 'docusign NDA',
    docusignTemplateId: '0c5b7081-1fff-4484-a20f-824c97a03b9b',
    agreeabilityType: 'DocuSignable'
  },
  {
    id: 'be0652ae-8b28-4e91-9b42-8ad00b31e9cb',
    title: 'Subcontractor Services Agreement 2009-09-02',
    url: 'http://www.topcoder.com/i/terms/Subcontractor+Services+Agreement+2009-09-02.pdf',
    text: 'Subcontractor Services Agreement 2009-09-02. This agreement is unavailable in text format.  Please download the PDF to read its contents',
    agreeabilityType: 'Non-electronically-agreeable'
  }
]

const mockTerms = ['8a0207fc-ac9b-47e7-af1b-81d1ccaf0afc', '453c7c5c-c872-4672-9e78-5162d70903d3']

const additionalTerm = {
  id: '28841de8-2f42-486f-beac-21d46a832ab6',
  agreeabilityType: 'Electronically-agreeable',
  title: '2008 TCO Marathon Match Competition Official Rules',
  url: 'http://topcoder.com/mm-terms'
}

/**
 * Clear test data
 */
async function clearData () {
  await prisma.challengePhaseConstraint.deleteMany({ where: { id: { in: [challengePhaseConstrain1Id, challengePhaseConstrain2Id] } } })
  await prisma.challengePhase.deleteMany({ where: { challengeId: { in: [challengeId, taskChallengeId, marathonMatchChallengeId] } } })
  await prisma.challenge.deleteMany({
    where: { id: { in: [challengeId, taskChallengeId, marathonMatchChallengeId] } }
  })
  await prisma.timelineTemplate.deleteMany({ where: { id: timelineTemplateId } })
  await prisma.phase.deleteMany({ where: { id: { in: [phase1Id, phase2Id] } } })
  await prisma.challengeType.deleteMany({ where: { id: { in: [challengeTypeId, marathonMatchTypeId] } } })
  await prisma.challengeTrack.deleteMany({ where: { id: challengeTrackId } })
}

/**
 * Get created test data.
 */
function getData () {
  return {
    challengeTrack,
    challengeType,
    phase,
    phase2,
    timelineTemplate,
    challenge,
    taskChallenge,
    marathonMatchType,
    marathonMatchChallenge,
    defaultProjectTerms,
    additionalTerm,
    mockTerms,
    challengePhase1Id,
    challengePhase2Id,
    challengePhaseConstrain1Id,
    adminToken,
    userToken
  }
}

/**
 * Get dates difference in milliseconds
 */
function getDatesDiff (d1, d2) {
  return new Date(d1).getTime() - new Date(d2).getTime()
}

module.exports = {
  createData,
  clearData,
  getData,
  getDatesDiff,
  deepCompareArrays
}
