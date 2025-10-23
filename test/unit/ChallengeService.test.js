/*
 * Unit tests of challenge service
 */

if (!process.env.REVIEW_DB_URL && process.env.DATABASE_URL) {
  process.env.REVIEW_DB_URL = process.env.DATABASE_URL
}

require('../../app-bootstrap')
const _ = require('lodash')
const config = require('config')
const uuid = require('uuid/v4')
const chai = require('chai')
const constants = require('../../app-constants')
const service = require('../../src/services/ChallengeService')
const helper = require('../../src/common/helper')
const testHelper = require('../testHelper')
const { getClient, ChallengeStatusEnum, PrizeSetTypeEnum }  = require('../../src/common/prisma')
const { getReviewClient } = require('../../src/common/review-prisma')
const prisma = getClient()
const reviewSchema = config.get('REVIEW_DB_SCHEMA')
const reviewTableName = `"${reviewSchema}"."review"`
const should = chai.should()
let reviewClient

describe('challenge service unit tests', () => {
  // created entity id
  let id
  let id2
  let attachment
  const winners = [
    {
      userId: 12345678,
      handle: 'thomaskranitsas',
      placement: 1
    },
    {
      userId: 3456789,
      handle: 'tonyj',
      placement: 2
    }
  ]
  // generated data
  let data
  let testChallengeData
  let createdChallengeData
  const notFoundId = uuid()
  const authUser = {
    userId: 'testuser'
  }

  before(async () => {
    await testHelper.clearData()
    await testHelper.createData()
    data = testHelper.getData()

    reviewClient = getReviewClient()
    await reviewClient.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${reviewSchema}"`)
    await reviewClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${reviewTableName} (
        "id" varchar(36) PRIMARY KEY,
        "phaseId" varchar(255) NOT NULL,
        "scorecardId" varchar(255),
        "status" varchar(32),
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now()
      )
    `)
    await reviewClient.$executeRawUnsafe(`
      ALTER TABLE ${reviewTableName}
      ADD COLUMN IF NOT EXISTS "scorecardId" varchar(255)
    `)
    await reviewClient.$executeRawUnsafe(`DELETE FROM ${reviewTableName}`)

    testChallengeData = {
      typeId: data.challenge.typeId,
      trackId: data.challenge.trackId,
      legacy: {
        reviewType: 'COMMUNITY',
        confidentialityType: 'public',
        useSchedulingAPI: true,
        pureV5Task: false,
        selfService: false,
        selfServiceCopilot: 'aaa'
      },
      billing: {
        billingAccountId: 'billing-account',
        markup: 100
      },
      task: {
        isTask: false,
        isAssigned: false,
        memberId: null
      },
      name: 'Prisma Test Challenge',
      description: 'Prisma Test Challenge',
      privateDescription: 'Prisma Test Challenge',
      descriptionFormat: 'html',
      metadata: [
        {
          name: 'meta-name',
          value: 'meta-value'
        }
      ],
      timelineTemplateId: data.timelineTemplate.id,
      events: [
        {
          id: 1,
          name: 'event-name',
          key: 'event-key'
        }
      ],
      phases: [{
        phaseId: data.phase.id,
        duration: 120
      }, {
        phaseId: data.phase2.id,
        duration: 200
      }],
      discussions: [{
        id: 'ad985cff-ad3e-44de-b54e-3992505ba0ae',
        name: 'discussion name',
        type: 'challenge',
        provider: 'vanilla',
        options: [
          { 'discussion-opt': 'discussion-value' }
        ]
      }],
      prizeSets: [
        {
          type: 'placement',
          description: 'placement prizes',
          prizes: [
            {
              description: 'placement 1',
              type: 'USD',
              value: 1000
            }
          ]
        }
      ],
      tags: [
        'tag-1', 'tag-2'
      ],
      legacyId: 1,
      projectId: 123,
      startDate: '2025-03-13T06:56:50.701Z',
      status: 'New',
      groups: [],
      terms: [],
      skills: []
    }
  })

  after(async () => {
    await prisma.challenge.deleteMany({
      where: {id}
    })
    await testHelper.clearData()
  })

  describe('create challenge tests', () => {
    it('create challenge successfully', async () => {
      const challengeData = _.cloneDeep(testChallengeData)
      const result = await service.createChallenge({ isMachine: true, sub: 'sub', userId: 'testuser' }, challengeData, config.M2M_FULL_ACCESS_TOKEN)
      createdChallengeData = result
      should.exist(result.id)
      id = result.id
      should.equal(result.typeId, data.challenge.typeId)
      should.equal(result.trackId, data.challenge.trackId)
      should.equal(result.name, testChallengeData.name)
      should.equal(result.description, testChallengeData.description)
      should.equal(result.timelineTemplateId, testChallengeData.timelineTemplateId)
      should.equal(result.phases.length, 2)
      should.exist(result.phases[0].id)
      should.equal(result.phases[0].phaseId, data.phase.id)
      should.equal(result.phases[0].duration, challengeData.phases[0].duration)
      should.equal(testHelper.getDatesDiff(result.phases[0].scheduledStartDate, challengeData.startDate), 0)
      should.equal(testHelper.getDatesDiff(result.phases[0].scheduledEndDate, challengeData.startDate),
        challengeData.phases[0].duration * 1000)
      should.exist(result.phases[1].id)
      should.equal(result.phases[1].phaseId, data.phase2.id)
      should.equal(result.phases[1].predecessor, result.phases[0].phaseId)
      should.equal(result.phases[1].duration, challengeData.phases[1].duration)
      should.equal(testHelper.getDatesDiff(result.phases[1].scheduledStartDate, challengeData.startDate),
        challengeData.phases[0].duration * 1000)
      should.equal(testHelper.getDatesDiff(result.phases[1].scheduledEndDate, challengeData.startDate),
        challengeData.phases[0].duration * 1000 + challengeData.phases[1].duration * 1000)
      should.equal(result.prizeSets.length, 1)
      should.equal(result.prizeSets[0].type, testChallengeData.prizeSets[0].type)
      should.equal(result.prizeSets[0].description, testChallengeData.prizeSets[0].description)
      should.equal(result.prizeSets[0].prizes.length, 1)
      should.equal(result.prizeSets[0].prizes[0].description, testChallengeData.prizeSets[0].prizes[0].description)
      should.equal(result.prizeSets[0].prizes[0].type, testChallengeData.prizeSets[0].prizes[0].type)
      should.equal(result.prizeSets[0].prizes[0].value, testChallengeData.prizeSets[0].prizes[0].value)
      should.equal(result.reviewType, testChallengeData.reviewType)
      should.equal(result.tags.length, 2)
      should.equal(result.tags[0], testChallengeData.tags[0])
      should.equal(_.isNil(result.projectId), _.isNil(testChallengeData.projectId))
      should.equal(result.legacyId, testChallengeData.legacyId)
      should.equal(result.forumId, testChallengeData.forumId)
      should.equal(result.status, testChallengeData.status)
      should.equal(result.createdBy, 'testuser')
      should.exist(result.startDate)
      should.exist(result.created)
      should.equal(result.numOfSubmissions, 0)
      should.equal(result.numOfRegistrants, 0)
    })

    it('create challenge - type not found', async () => {
      const challengeData = _.clone(testChallengeData)
      challengeData.typeId = notFoundId
      try {
        await service.createChallenge({ isMachine: true, sub: 'sub', userId: 'testuser' }, challengeData, config.M2M_FULL_ACCESS_TOKEN)
      } catch (e) {
        should.equal(e.message, `ChallengeType with id: ${notFoundId} doesn't exist`)
        return
      }
      throw new Error('should not reach here')
    })

    it('create challenge - invalid projectId', async () => {
      const challengeData = _.clone(testChallengeData)
      challengeData.projectId = -1
      try {
        await service.createChallenge({ isMachine: true, sub: 'sub', userId: 'testuser' }, challengeData, config.M2M_FULL_ACCESS_TOKEN)
      } catch (e) {
        should.equal(e.message.indexOf('"projectId" must be a positive number') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('create challenge - missing name', async () => {
      const challengeData = _.clone(testChallengeData)
      delete challengeData.name
      try {
        await service.createChallenge({ isMachine: true, sub: 'sub', userId: 'testuser' }, challengeData, config.M2M_FULL_ACCESS_TOKEN)
      } catch (e) {
        should.equal(e.message.indexOf('"name" is required') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('create challenge - invalid date', async () => {
      const challengeData = _.clone(testChallengeData)
      challengeData.startDate = 'abc'
      try {
        await service.createChallenge({ isMachine: true, sub: 'sub', userId: 'testuser' }, challengeData, config.M2M_FULL_ACCESS_TOKEN)
      } catch (e) {
        should.equal(e.message.indexOf('"startDate" must be a valid ISO 8601 date') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('create challenge - invalid status', async () => {
      const challengeData = _.clone(testChallengeData)
      challengeData.status = ['Active']
      try {
        await service.createChallenge({ isMachine: true, sub: 'sub', userId: 'testuser' }, challengeData, config.M2M_FULL_ACCESS_TOKEN)
      } catch (e) {
        should.equal(e.message.indexOf('"status" must be a string') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('create challenge - unexpected field', async () => {
      const challengeData = _.clone(testChallengeData)
      challengeData.other = 123
      try {
        await service.createChallenge({ isMachine: true, sub: 'sub', userId: 'testuser' }, challengeData, config.M2M_FULL_ACCESS_TOKEN)
      } catch (e) {
        should.equal(e.message.indexOf('"other" is not allowed') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })
  })

  describe('get challenge tests', () => {
    it('get challenge successfully', async () => {
      const result = await service.getChallenge({ isMachine: true }, createdChallengeData.id)
      should.equal(result.id, createdChallengeData.id)
      should.equal(result.typeId, testChallengeData.typeId)
      should.equal(result.trackId, testChallengeData.trackId)
      should.equal(result.name, testChallengeData.name)
      should.equal(result.description, testChallengeData.description)
      should.equal(result.timelineTemplateId, testChallengeData.timelineTemplateId)
      should.equal(result.phases.length, 2)
      should.equal(result.phases[0].phaseId, data.phase.id)
      should.equal(result.phases[0].name, data.phase.name)
      should.equal(result.phases[0].description, data.phase.description)
      should.equal(result.phases[0].isOpen, false)
      should.equal(result.phases[0].duration, testChallengeData.phases[0].duration)
      should.equal(result.phases[1].phaseId, data.phase2.id)
      should.equal(result.phases[1].name, data.phase2.name)
      should.equal(result.phases[1].predecessor, data.phase.id)
      should.equal(result.phases[1].description, data.phase2.description)
      should.equal(result.phases[1].isOpen, false)
      should.equal(result.phases[1].duration, testChallengeData.phases[1].duration)
      should.equal(result.prizeSets.length, 1)
      should.equal(result.prizeSets[0].type, testChallengeData.prizeSets[0].type)
      should.equal(result.prizeSets[0].description, testChallengeData.prizeSets[0].description)
      should.equal(result.prizeSets[0].prizes.length, 1)
      should.equal(result.prizeSets[0].prizes[0].description, testChallengeData.prizeSets[0].prizes[0].description)
      should.equal(result.prizeSets[0].prizes[0].type, testChallengeData.prizeSets[0].prizes[0].type)
      should.equal(result.prizeSets[0].prizes[0].value, testChallengeData.prizeSets[0].prizes[0].value)
      should.equal(result.reviewType, testChallengeData.reviewType)
      should.equal(result.tags.length, 2)
      should.equal(result.tags[0], testChallengeData.tags[0])
      should.equal(result.tags[1], testChallengeData.tags[1])
      should.equal(result.projectId, testChallengeData.projectId)
      should.equal(result.legacyId, testChallengeData.legacyId)
      should.equal(result.forumId, testChallengeData.forumId)
      should.equal(result.status, testChallengeData.status)
      should.equal(result.createdBy, 'testuser')
      should.exist(result.startDate)
      should.exist(result.created)
      should.equal(result.numOfSubmissions, 0)
      should.equal(result.numOfRegistrants, 0)
    })

    it('get challenge - not found', async () => {
      try {
        await service.getChallenge({ isMachine: true }, notFoundId)
      } catch (e) {
        should.equal(e.message, `Challenge of id ${notFoundId} is not found.`)
        return
      }
      throw new Error('should not reach here')
    })

    it('get challenge - invalid id', async () => {
      try {
        await service.getChallenge({ isMachine: true }, 'invalid')
      } catch (e) {
        should.equal(e.message.indexOf('"id" must be a valid GUID') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })
  })

  describe('search challenges tests', () => {
    it('search challenges successfully by legacyId', async() => {
      const res = await service.searchChallenges({ isMachine: true }, {
        page: 1,
        perPage: 10,
        legacyId: testChallengeData.legacyId
      })
      should.equal(res.total, 1)
      should.equal(res.page, 1)
      should.equal(res.perPage, 10)
      should.equal(res.result.length, 1)
      const result = res.result[0]
      should.equal(result.id, id)
      should.equal(result.type, data.challengeType.name)
      should.equal(result.track, data.challengeTrack.name)
      should.equal(result.name, testChallengeData.name)
      should.equal(result.description, testChallengeData.description)
      should.equal(result.timelineTemplateId, testChallengeData.timelineTemplateId)
      should.equal(result.phases.length, 2)
      should.equal(result.phases[0].phaseId, data.phase.id)
      should.equal(result.phases[0].name, data.phase.name)
      should.equal(result.phases[0].description, data.phase.description)
      should.equal(result.phases[0].isOpen, false)
      should.equal(result.phases[0].duration, testChallengeData.phases[0].duration)
      should.equal(result.phases[1].phaseId, data.phase2.id)
      should.equal(result.phases[1].name, data.phase2.name)
      should.equal(result.phases[1].predecessor, data.phase.id)
      should.equal(result.phases[1].description, data.phase2.description)
      should.equal(result.phases[1].isOpen, false)
      should.equal(result.phases[1].duration, testChallengeData.phases[1].duration)
      should.equal(result.prizeSets.length, 1)
      should.equal(result.prizeSets[0].type, testChallengeData.prizeSets[0].type)
      should.equal(result.prizeSets[0].description, testChallengeData.prizeSets[0].description)
      should.equal(result.prizeSets[0].prizes.length, 1)
      should.equal(result.prizeSets[0].prizes[0].description, testChallengeData.prizeSets[0].prizes[0].description)
      should.equal(result.prizeSets[0].prizes[0].type, testChallengeData.prizeSets[0].prizes[0].type)
      should.equal(result.prizeSets[0].prizes[0].value, testChallengeData.prizeSets[0].prizes[0].value)
      should.equal(result.reviewType, testChallengeData.reviewType)
      should.equal(result.tags.length, 2)
      should.equal(result.tags[0], testChallengeData.tags[0])
      should.equal(result.tags[1], testChallengeData.tags[1])
      should.equal(result.projectId, testChallengeData.projectId)
      should.equal(result.legacyId, testChallengeData.legacyId)
      should.equal(result.forumId, testChallengeData.forumId)
      should.equal(result.status, testChallengeData.status)
      should.equal(result.createdBy, 'testuser')
      should.exist(result.startDate)
      should.exist(result.created)
      should.equal(result.numOfSubmissions, 0)
      should.equal(result.numOfRegistrants, 0)
    })
    it('search challenges successfully 1', async () => {
      const res = await service.searchChallenges({ isMachine: true }, {
        page: 1,
        perPage: 10,
        id: id,

        typeId: testChallengeData.typeId,
        name: testChallengeData.name.substring(2).trim(),
        description: testChallengeData.description,
        timelineTemplateId: testChallengeData.timelineTemplateId,
        tag: testChallengeData.tags[0],
        projectId: testChallengeData.projectId,
        status: testChallengeData.status,
        createdDateStart: '1992-01-02',
        createdDateEnd: '2032-01-02',
        createdBy: testChallengeData.createdBy
      })
      should.equal(res.total, 1)
      should.equal(res.page, 1)
      should.equal(res.perPage, 10)
      should.equal(res.result.length, 1)
      const result = res.result[0]
      should.equal(result.id, id)
      should.equal(result.type, data.challengeType.name)
      should.equal(result.track, data.challengeTrack.name)
      should.equal(result.name, testChallengeData.name)
      should.equal(result.description, testChallengeData.description)
      should.equal(result.timelineTemplateId, testChallengeData.timelineTemplateId)
      should.equal(result.phases.length, 2)
      should.equal(result.phases[0].phaseId, data.phase.id)
      should.equal(result.phases[0].name, data.phase.name)
      should.equal(result.phases[0].description, data.phase.description)
      should.equal(result.phases[0].isOpen, false)
      should.equal(result.phases[0].duration, testChallengeData.phases[0].duration)
      should.equal(result.phases[1].phaseId, data.phase2.id)
      should.equal(result.phases[1].name, data.phase2.name)
      should.equal(result.phases[1].predecessor, data.phase.id)
      should.equal(result.phases[1].description, data.phase2.description)
      should.equal(result.phases[1].isOpen, false)
      should.equal(result.phases[1].duration, testChallengeData.phases[1].duration)
      should.equal(result.prizeSets.length, 1)
      should.equal(result.prizeSets[0].type, testChallengeData.prizeSets[0].type)
      should.equal(result.prizeSets[0].description, testChallengeData.prizeSets[0].description)
      should.equal(result.prizeSets[0].prizes.length, 1)
      should.equal(result.prizeSets[0].prizes[0].description, testChallengeData.prizeSets[0].prizes[0].description)
      should.equal(result.prizeSets[0].prizes[0].type, testChallengeData.prizeSets[0].prizes[0].type)
      should.equal(result.prizeSets[0].prizes[0].value, testChallengeData.prizeSets[0].prizes[0].value)
      should.equal(result.reviewType, testChallengeData.reviewType)
      should.equal(result.tags.length, 2)
      should.equal(result.tags[0], testChallengeData.tags[0])
      should.equal(result.tags[1], testChallengeData.tags[1])
      should.equal(result.projectId, testChallengeData.projectId)
      should.equal(result.legacyId, testChallengeData.legacyId)
      should.equal(result.forumId, testChallengeData.forumId)
      should.equal(result.status, testChallengeData.status)
      should.equal(result.createdBy, 'testuser')
      should.exist(result.startDate)
      should.exist(result.created)
      should.equal(result.numOfSubmissions, 0)
      should.equal(result.numOfRegistrants, 0)
    })

    it('search challenges successfully 2', async () => {
      const result = await service.searchChallenges({ isMachine: true }, { name: 'aaa bbb ccc' })
      should.equal(result.total, 0)
      should.equal(result.page, 1)
      should.equal(result.perPage, 20)
      should.equal(result.result.length, 0)
    })

    it('search challenges successfully 3', async () => {
      const res = await service.searchChallenges({ isMachine: true }, {
        page: 1,
        perPage: 10,
        id: data.challenge.id,
        typeId: data.challenge.typeId,
        track: data.challenge.track,
        name: data.challenge.name.substring(2).trim().toUpperCase(),
        description: data.challenge.description,
        timelineTemplateId: data.challenge.timelineTemplateId,
        reviewType: data.challenge.reviewType,
        tag: data.challenge.tags[0],
        projectId: data.challenge.projectId,
        forumId: data.challenge.forumId,
        status: _.capitalize(data.challenge.status.toLowerCase()),
        createdDateStart: '1992-01-02',
        createdDateEnd: '2022-01-02',
        createdBy: data.challenge.createdBy,
        memberId: '23124329'
      })
      should.equal(res.total, 0)
      should.equal(res.page, 1)
      should.equal(res.perPage, 10)
      should.equal(res.result.length, 0)
    })

    it('search challenges successfully 4 - with terms', async () => {
      const res = await service.searchChallenges({ isMachine: true }, {
        page: 1,
        perPage: 10,
        id
      })
      const challengeData = _.cloneDeep(testChallengeData)
      should.equal(res.total, 1)
      should.equal(res.page, 1)
      should.equal(res.perPage, 10)
      should.equal(res.result.length, 1)
      const result = res.result[0]

      should.equal(result.type, data.challengeType.name)
      should.equal(result.track, data.challengeTrack.name)
      should.equal(result.name, challengeData.name)
      should.equal(result.description, challengeData.description)
      should.equal(result.timelineTemplateId, challengeData.timelineTemplateId)
      should.equal(result.phases.length, 2)
      should.equal(result.phases[0].phaseId, data.phase.id)
      should.equal(result.phases[0].name, data.phase.name)
      should.equal(result.phases[0].description, data.phase.description)
      should.equal(result.phases[0].isOpen, false)
      should.equal(result.phases[0].duration, challengeData.phases[0].duration)
      should.equal(result.phases[1].phaseId, data.phase2.id)
      should.equal(result.phases[1].name, data.phase2.name)
      should.equal(result.phases[1].predecessor, data.phase.id)
      should.equal(result.phases[1].description, data.phase2.description)
      should.equal(result.phases[1].isOpen, false)
      should.equal(result.phases[1].duration, challengeData.phases[1].duration)
      should.equal(result.prizeSets.length, 1)
      should.equal(result.prizeSets[0].type, challengeData.prizeSets[0].type)
      should.equal(result.prizeSets[0].description, challengeData.prizeSets[0].description)
      should.equal(result.prizeSets[0].prizes.length, 1)
      should.equal(result.prizeSets[0].prizes[0].description, challengeData.prizeSets[0].prizes[0].description)
      should.equal(result.prizeSets[0].prizes[0].type, challengeData.prizeSets[0].prizes[0].type)
      should.equal(result.prizeSets[0].prizes[0].value, challengeData.prizeSets[0].prizes[0].value)
      should.equal(result.reviewType, challengeData.reviewType)
      should.equal(result.tags.length, 2)
      should.equal(result.tags[0], challengeData.tags[0])
      should.equal(result.projectId, challengeData.projectId)
      should.equal(result.legacyId, challengeData.legacyId)
      should.equal(result.forumId, challengeData.forumId)
      should.equal(result.status, challengeData.status)
      should.equal(result.createdBy, 'testuser')
      should.exist(result.startDate)
      should.exist(result.created)
      should.equal(result.numOfSubmissions, 0)
      should.equal(result.numOfRegistrants, 0)
    })

    it('search challenges successfully 5 - with tco eligible events', async () => {
      const result = await service.searchChallenges({ isMachine: true }, { tco: true })
      should.equal(result.total, 0)
      should.equal(result.page, 1)
      should.equal(result.perPage, 20)
      should.equal(result.result.length, 0)
    })

    it('search challenges - invalid name', async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { name: ['invalid'] })
      } catch (e) {
        should.equal(e.message.indexOf('"name" must be a string') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('search challenges - invalid forumId', async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { forumId: 'invalid' })
      } catch (e) {
        should.equal(e.message.indexOf('"forumId" must be a number') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('search challenges - invalid page', async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { page: -1 })
      } catch (e) {
        should.equal(e.message.indexOf('"page" must be larger than or equal to 1') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('search challenges - invalid perPage', async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { perPage: -1 })
      } catch (e) {
        should.equal(e.message.indexOf('"perPage" must be larger than or equal to 1') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('search challenges - invalid name', async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { name: ['abc'] })
      } catch (e) {
        should.equal(e.message.indexOf('"name" must be a string') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('search challenges - invalid track', async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { track: ['abc'] })
      } catch (e) {
        should.equal(e.message.indexOf('"track" must be a string') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('search challenges - invalid description', async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { description: ['abc'] })
      } catch (e) {
        should.equal(e.message.indexOf('"description" must be a string') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('search challenges - invalid reviewType', async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { reviewType: ['abc'] })
      } catch (e) {
        should.equal(e.message.indexOf('"reviewType" must be a string') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('search challenges - invalid tag', async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { tag: ['abc'] })
      } catch (e) {
        should.equal(e.message.indexOf('"tag" must be a string') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('search challenges - invalid group', async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { group: ['abc'] })
      } catch (e) {
        should.equal(e.message.indexOf('"group" must be a string') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('search challenges - invalid createdBy', async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { createdBy: ['abc'] })
      } catch (e) {
        should.equal(e.message.indexOf('"createdBy" must be a string') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('search challenges - invalid updatedBy', async () => {
      try {
        await service.searchChallenges({ isMachine: true }, { updatedBy: ['abc'] })
      } catch (e) {
        should.equal(e.message.indexOf('"updatedBy" must be a string') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })
  })

  describe('update challenge tests', () => {
    it('update challenge successfully 1', async () => {
      const challengeData = testChallengeData
      const result = await service.updateChallenge({ isMachine: true, sub: 'sub3', userId: 22838965 }, id, {
        privateDescription: 'track 333',
        description: 'updated desc',
        attachments: [] // this will delete attachments
      })
      should.equal(result.id, id)
      should.equal(result.typeId, data.challenge.typeId)
      should.equal(result.privateDescription, 'track 333')
      should.equal(result.name, challengeData.name)
      should.equal(result.description, 'updated desc')
      should.equal(result.timelineTemplateId, challengeData.timelineTemplateId)
      should.equal(result.phases.length, 2)
      should.exist(result.phases[0].id)
      should.equal(result.phases[0].phaseId, data.phase.id)
      should.equal(result.phases[0].duration, challengeData.phases[0].duration)
      should.equal(testHelper.getDatesDiff(result.phases[0].scheduledStartDate, challengeData.startDate), 0)
      should.equal(testHelper.getDatesDiff(result.phases[0].scheduledEndDate, challengeData.startDate),
        challengeData.phases[0].duration * 1000)
      should.exist(result.phases[1].id)
      should.equal(result.phases[1].phaseId, data.phase2.id)
      should.equal(result.phases[1].predecessor, result.phases[0].phaseId)
      should.equal(result.phases[1].duration, challengeData.phases[1].duration)
      should.equal(testHelper.getDatesDiff(result.phases[1].scheduledStartDate, challengeData.startDate),
        challengeData.phases[0].duration * 1000)
      should.equal(testHelper.getDatesDiff(result.phases[1].scheduledEndDate, challengeData.startDate),
        challengeData.phases[0].duration * 1000 + challengeData.phases[1].duration * 1000)
      should.equal(result.prizeSets.length, 1)
      should.equal(result.prizeSets[0].type, challengeData.prizeSets[0].type)
      should.equal(result.prizeSets[0].description, challengeData.prizeSets[0].description)
      should.equal(result.prizeSets[0].prizes.length, 1)
      should.equal(result.prizeSets[0].prizes[0].description, challengeData.prizeSets[0].prizes[0].description)
      should.equal(result.prizeSets[0].prizes[0].type, challengeData.prizeSets[0].prizes[0].type)
      should.equal(result.prizeSets[0].prizes[0].value, challengeData.prizeSets[0].prizes[0].value)
      should.equal(result.reviewType, challengeData.reviewType)
      should.equal(result.tags.length, 2)
      should.equal(result.tags[0], challengeData.tags[0])
      should.equal(result.tags[1], challengeData.tags[1])
      should.equal(result.projectId, challengeData.projectId)
      should.equal(result.legacyId, challengeData.legacyId)
      should.equal(result.forumId, challengeData.forumId)
      should.equal(result.status, challengeData.status)
      should.equal(!result.attachments || result.attachments.length === 0, true)
      should.equal(result.createdBy, 'testuser')
      should.equal(result.updatedBy, '22838965')
      should.exist(result.startDate)
      should.exist(result.created)
      should.exist(result.updated)
    }).timeout(3000)

    it('update challenge with startDate only keeps derived dates stable', async () => {
      const result = await service.updateChallenge(
        { isMachine: true, sub: 'sub3', userId: 22838965 },
        id,
        {
          startDate: testChallengeData.startDate
        }
      )

      should.equal(result.id, id)
      should.exist(result.startDate)
      should.equal(testHelper.getDatesDiff(result.startDate, testChallengeData.startDate), 0)
    })

    it('update challenge successfully with winners', async () => {
      const result = await service.updateChallenge({ isMachine: true, sub: 'sub3', userId: 22838965 }, data.challenge.id, {
        winners: [{
          userId: 12345678,
          handle: 'thomaskranitsas',
          placement: 1,
          type: PrizeSetTypeEnum.PLACEMENT
        }]
      })
      should.equal(result.id, data.challenge.id)
      should.equal(result.typeId, data.challenge.typeId)
      should.equal(result.trackId, data.challenge.trackId)
      should.equal(result.name, data.challenge.name)
      should.equal(result.description, data.challenge.description)
      should.equal(result.timelineTemplateId, data.challenge.timelineTemplateId)
      should.equal(result.phases.length, 0)
      should.equal(result.prizeSets.length, 0)
      should.equal(result.reviewType, data.challenge.reviewType)
      should.equal(result.tags.length, 1)
      should.equal(result.tags[0], data.challenge.tags[0])
      should.equal(result.projectId, data.challenge.projectId)
      should.equal(result.legacyId, data.challenge.legacyId)
      should.equal(result.forumId, data.challenge.forumId)
      should.equal(result.status.toUpperCase(), data.challenge.status.toUpperCase())
      should.equal(result.winners.length, 1)
      should.equal(result.winners[0].userId, winners[0].userId)
      should.equal(result.winners[0].handle, winners[0].handle)
      should.equal(result.winners[0].placement, winners[0].placement)
      should.equal(result.winners[0].type, PrizeSetTypeEnum.PLACEMENT)
      should.equal(result.createdBy, 'admin')
      should.equal(result.updatedBy, '22838965')
      should.exist(result.startDate)
      should.exist(result.created)
      should.exist(result.updated)
    })

    describe('reviewer scorecard changes', () => {
      const originalScorecardId = 'sc-original'
      const newScorecardId = 'sc-updated'

      beforeEach(async () => {
        await prisma.challengeReviewer.deleteMany({ where: { challengeId: data.challenge.id } })
        await prisma.challengeReviewer.create({
          data: {
            challengeId: data.challenge.id,
            scorecardId: originalScorecardId,
            isMemberReview: false,
            phaseId: data.phase.id,
            createdBy: 'admin',
            updatedBy: 'admin'
          }
        })
        if (reviewClient) {
          await reviewClient.$executeRawUnsafe(`DELETE FROM ${reviewTableName}`)
        }
      })

      afterEach(async () => {
        await prisma.challengeReviewer.deleteMany({ where: { challengeId: data.challenge.id } })
        if (reviewClient) {
          await reviewClient.$executeRawUnsafe(`DELETE FROM ${reviewTableName}`)
        }
      })

      it('allows scorecard change when no reviews exist', async () => {
        const payload = {
          reviewers: [
            {
              phaseId: data.phase.id,
              scorecardId: newScorecardId,
              isMemberReview: false
            }
          ]
        }

        const updated = await service.updateChallenge(
          { isMachine: true, sub: 'sub3', userId: 22838965 },
          data.challenge.id,
          payload
        )

        should.exist(updated.reviewers)
        should.equal(updated.reviewers.length, 1)
        should.equal(updated.reviewers[0].scorecardId, newScorecardId)
      })

      it('blocks scorecard change when reviews already started', async () => {
        if (reviewClient) {
          await reviewClient.$executeRawUnsafe(`INSERT INTO ${reviewTableName} ("id", "phaseId", "scorecardId", "status") VALUES ('${uuid()}', '${data.challengePhase1Id}', '${originalScorecardId}', 'IN_PROGRESS')`)
        }

        try {
          await service.updateChallenge({ isMachine: true, sub: 'sub3', userId: 22838965 }, data.challenge.id, {
            reviewers: [
              {
                phaseId: data.phase.id,
                scorecardId: newScorecardId,
                isMemberReview: false
              }
            ]
          })
        } catch (e) {
          should.equal(
            e.message,
            "Can't change the scorecard at this time because at least one review has already started with the old scorecard"
          )
          return
        }

        throw new Error('should not reach here')
      })

      it('allows scorecard change via reviews alias when no reviews exist', async () => {
        const payload = {
          reviews: [
            {
              phaseId: data.phase.id,
              scorecardId: newScorecardId,
              isMemberReview: false
            }
          ]
        }

        const updated = await service.updateChallenge(
          { isMachine: true, sub: 'sub3', userId: 22838965 },
          data.challenge.id,
          payload
        )

        should.exist(updated.reviewers)
        should.equal(updated.reviewers.length, 1)
        should.equal(updated.reviewers[0].scorecardId, newScorecardId)
      })

      it('blocks scorecard change via reviews alias when reviews already started', async () => {
        if (reviewClient) {
          await reviewClient.$executeRawUnsafe(`INSERT INTO ${reviewTableName} ("id", "phaseId", "scorecardId", "status") VALUES ('${uuid()}', '${data.challengePhase1Id}', '${originalScorecardId}', 'IN_PROGRESS')`)
        }

        try {
          await service.updateChallenge({ isMachine: true, sub: 'sub3', userId: 22838965 }, data.challenge.id, {
            reviews: [
              {
                phaseId: data.phase.id,
                scorecardId: newScorecardId,
                isMemberReview: false
              }
            ]
          })
        } catch (e) {
          should.equal(
            e.message,
            "Can't change the scorecard at this time because at least one review has already started with the old scorecard"
          )
          return
        }

        throw new Error('should not reach here')
      })

      it('blocks scorecard change when an active review phase has started reviews', async () => {
        if (!reviewClient) {
          return
        }

        let reviewPhase
        let reviewChallengePhaseId

        const insertedReviewId = uuid()

        try {
          reviewPhase = await prisma.phase.create({
            data: {
              id: uuid(),
              name: 'Review',
              description: 'desc',
              isOpen: true,
              duration: 86400,
              createdBy: 'admin',
              updatedBy: 'admin'
            }
          })

          reviewChallengePhaseId = uuid()
          const now = new Date()

          await prisma.challengePhase.create({
            data: {
              id: reviewChallengePhaseId,
              challengeId: data.challenge.id,
              phaseId: reviewPhase.id,
              name: 'Review',
              isOpen: true,
              actualStartDate: now,
              createdBy: 'admin',
              updatedBy: 'admin'
            }
          })

          await prisma.challengeReviewer.updateMany({
            where: { challengeId: data.challenge.id },
            data: { phaseId: reviewPhase.id }
          })

          await reviewClient.$executeRawUnsafe(
            `INSERT INTO ${reviewTableName} ("id", "phaseId", "scorecardId", "status") VALUES ('${insertedReviewId}', '${reviewChallengePhaseId}', '${originalScorecardId}', 'COMPLETED')`
          )

          await service.updateChallenge({ isMachine: true, sub: 'sub3', userId: 22838965 }, data.challenge.id, {
            reviewers: [
              {
                phaseId: reviewPhase.id,
                scorecardId: newScorecardId,
                isMemberReview: false
              }
            ]
          })
        } catch (e) {
          should.equal(
            e.message,
            "Cannot change the scorecard for phase 'Review' because reviews are already in progress or completed"
          )
          return
        } finally {
          await reviewClient.$executeRawUnsafe(
            `DELETE FROM ${reviewTableName} WHERE "id" = '${insertedReviewId}'`
          )
          if (reviewChallengePhaseId) {
            await prisma.challengePhase.delete({ where: { id: reviewChallengePhaseId } })
          }
          if (reviewPhase) {
            await prisma.phase.delete({ where: { id: reviewPhase.id } })
          }
        }

        throw new Error('should not reach here')
      })
    })

    it('update challenge - creator memberId can modify without matching handle', async () => {
      const updatePayload = { privateDescription: 'Creator update via memberId' }
      const result = await service.updateChallenge({ userId: 'testuser', handle: 'different-handle' }, id, updatePayload)
      should.equal(result.id, id)
      should.equal(result.privateDescription, updatePayload.privateDescription)
    })

    it('update challenge - project not found', async () => {
      try {
        await service.updateChallenge(
          { userId: '16096823', handle: '', roles: [constants.UserRoles.Admin] },
          id,
          { projectId: 100000 })
      } catch (e) {
        should.equal(e.message, 'Project with id: 100000 doesn\'t exist')
        return
      }
      throw new Error('should not reach here')
    })

    it('update challenge - user doesn\'t have permission to update challenge under specific project', async () => {
      try {
        await service.updateChallenge({ userId: '16096823', handle: '' }, id, { projectId: 200 })
      } catch (e) {
        should.equal(e.message, 'Only M2M, admin, challenge\'s copilot or users with full access can perform modification.')
        return
      }
      throw new Error('should not reach here')
    })

    it('update challenge - timeline template not found', async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: 'sub3' }, id, {
          timelineTemplateId: notFoundId
        })
      } catch (e) {
        should.equal(e.message, `TimelineTemplate with id: ${notFoundId} doesn't exist`)
        return
      }
      throw new Error('should not reach here')
    })

    it('update challenge - challenge not found', async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: 'sub3' }, notFoundId, {
          privateDescription: 'track 333'
        })
      } catch (e) {
        should.equal(e.message, `Challenge with id: ${notFoundId} doesn't exist`)
        return
      }
      throw new Error('should not reach here')
    })

    it('update challenge - invalid type id', async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: 'sub3' }, id, {
          typeId: 'invalid'
        })
      } catch (e) {
        should.equal(e.message.indexOf('"typeId" must be a valid GUID') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('update challenge - invalid start date', async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: 'sub3' }, id, {
          startDate: 'abc'
        })
      } catch (e) {
        should.equal(e.message.indexOf('"startDate" must be a valid ISO 8601 date') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('update challenge - empty name', async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: 'sub3' }, id, {
          name: ''
        })
      } catch (e) {
        should.equal(e.message.indexOf('"name" is not allowed to be empty') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('update challenge - Completed to Active status', async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: 'sub3' }, data.challenge.id, {
          status: ChallengeStatusEnum.ACTIVE
        })
      } catch (e) {
        should.equal(e.message.indexOf('Cannot change Completed challenge status to Active status') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('update challenge - set winners with non-completed Active status', async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: 'sub3' }, id, {
          winners
        })
      } catch (e) {
        should.equal(e.message.indexOf('Cannot set winners for challenge with non-completed') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('update challenge - Duplicate member with placement 1', async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: 'sub3' }, data.challenge.id, {
          winners: [{
            userId: 12345678,
            handle: 'thomaskranitsas',
            placement: 1,
            type: PrizeSetTypeEnum.PLACEMENT
          },
          {
            userId: 12345678,
            handle: 'thomaskranitsas',
            placement: 1,
            type: PrizeSetTypeEnum.PLACEMENT
          }]
        })
      } catch (e) {
        should.equal(e.message.indexOf('Duplicate member with placement') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('update challenge - Only one member can have placement 1', async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: 'sub3' }, data.challenge.id, {
          winners: [
            {
              userId: 12345678,
              handle: 'thomaskranitsas',
              placement: 1,
              type: PrizeSetTypeEnum.PLACEMENT
            },
            {
              userId: 3456789,
              handle: 'tonyj',
              placement: 1,
              type: PrizeSetTypeEnum.PLACEMENT
            }
          ]
        })
      } catch (e) {
        should.equal(e.message.indexOf('Only one member can have a placement') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('update challenge - The same member 12345678 cannot have multiple placements', async () => {
      try {
        await service.updateChallenge({ isMachine: true, sub: 'sub3' }, data.challenge.id, {
          winners: [
            {
              userId: 12345678,
              handle: 'thomaskranitsas',
              placement: 1,
              type: PrizeSetTypeEnum.PLACEMENT
            },
            {
              userId: 12345678,
              handle: 'thomaskranitsas',
              placement: 2,
              type: PrizeSetTypeEnum.PLACEMENT
            }
          ]
        })
      } catch (e) {
        should.equal(e.message.indexOf('The same member 12345678 cannot have multiple placements') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })
  })

  describe('close marathon match tests', () => {
    const adminUser = { isMachine: false, roles: [constants.UserRoles.Admin], userId: 'admin' }
    const m2mUser = { isMachine: true }
    const nonAdminUser = { isMachine: false, userId: 'user123', roles: [constants.UserRoles.User] }

    let originalReviewSummations
    let originalChallengeResources

    beforeEach(async () => {
      originalReviewSummations = helper.getReviewSummations
      originalChallengeResources = helper.getChallengeResources

      if (data && data.marathonMatchChallenge) {
        await prisma.challengeWinner.deleteMany({ where: { challengeId: data.marathonMatchChallenge.id } })
        await prisma.challenge.update({
          where: { id: data.marathonMatchChallenge.id },
          data: {
            status: ChallengeStatusEnum.ACTIVE,
            updatedBy: 'admin'
          }
        })
        await prisma.challengePhase.updateMany({
          where: { challengeId: data.marathonMatchChallenge.id },
          data: {
            isOpen: true,
            actualEndDate: null,
            updatedBy: 'admin'
          }
        })
      }
    })

    afterEach(() => {
      helper.getReviewSummations = originalReviewSummations
      helper.getChallengeResources = originalChallengeResources
    })

    it('close marathon match successfully with multiple final review summations', async () => {
      const originalGetReviewSummations = helper.getReviewSummations
      helper.getReviewSummations = async () => ([
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 95.5,
          submitterId: '12345678',
          submitterHandle: 'thomaskranitsas',
          createdAt: '2024-02-01T10:00:00.000Z'
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 92.1,
          submitterId: '9876543',
          submitterHandle: 'tonyj',
          createdAt: '2024-02-01T11:00:00.000Z'
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 87.3,
          submitterId: '3456789',
          submitterHandle: 'nathanael',
          createdAt: '2024-02-01T12:00:00.000Z'
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: false,
          aggregateScore: 99.9,
          submitterId: '5555555',
          submitterHandle: 'ignored',
          createdAt: '2024-02-01T13:00:00.000Z'
        }
      ])
      originalReviewSummations = originalGetReviewSummations

      const originalGetChallengeResources = helper.getChallengeResources
      helper.getChallengeResources = async () => ([
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 12345678, memberHandle: 'thomaskranitsas' },
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 9876543, memberHandle: 'tonyj' },
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 3456789, memberHandle: 'nathanael' },
        { roleId: 'some-other-role', memberId: 11111111 }
      ])
      originalChallengeResources = originalGetChallengeResources

      const result = await service.closeMarathonMatch(adminUser, data.marathonMatchChallenge.id)

      should.exist(result)
      should.equal(result.status, ChallengeStatusEnum.COMPLETED)
      should.equal(result.winners.length, 3)
      should.equal(result.winners[0].placement, 1)
      should.equal(result.winners[0].userId, 12345678)
      should.equal(result.winners[0].type, PrizeSetTypeEnum.PLACEMENT)
      should.equal(result.winners[1].placement, 2)
      should.equal(result.winners[1].userId, 9876543)
      should.equal(result.winners[2].placement, 3)
      should.equal(result.winners[2].userId, 3456789)
      result.phases.forEach(phase => {
        should.equal(phase.isOpen, false)
        should.exist(phase.actualEndDate)
      })
    })

    it('close marathon match successfully with M2M token', async () => {
      const originalGetReviewSummations = helper.getReviewSummations
      helper.getReviewSummations = async () => ([
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 88.4,
          submitterId: '12345678',
          submitterHandle: 'thomaskranitsas',
          createdAt: '2024-03-01T10:00:00.000Z'
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 84.1,
          submitterId: '9876543',
          submitterHandle: 'tonyj',
          createdAt: '2024-03-01T11:00:00.000Z'
        }
      ])
      originalReviewSummations = originalGetReviewSummations

      const originalGetChallengeResources = helper.getChallengeResources
      helper.getChallengeResources = async () => ([
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 12345678, memberHandle: 'thomaskranitsas' },
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 9876543, memberHandle: 'tonyj' }
      ])
      originalChallengeResources = originalGetChallengeResources

      const result = await service.closeMarathonMatch(m2mUser, data.marathonMatchChallenge.id)

      should.exist(result)
      should.equal(result.status, ChallengeStatusEnum.COMPLETED)
      should.equal(result.winners.length, 2)
      should.equal(result.winners[0].userId, 12345678)
      should.equal(result.winners[0].placement, 1)
      should.equal(result.winners[1].userId, 9876543)
      should.equal(result.winners[1].placement, 2)
      result.phases.forEach(phase => {
        should.equal(phase.isOpen, false)
        should.exist(phase.actualEndDate)
      })
    })

    it('close marathon match with tie-breaking logic (same aggregateScore, different createdAt)', async () => {
      const originalGetReviewSummations = helper.getReviewSummations
      helper.getReviewSummations = async () => ([
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 90.0,
          submitterId: '12345678',
          submitterHandle: 'thomaskranitsas',
          createdAt: '2024-04-01T09:00:00.000Z'
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 90.0,
          submitterId: '9876543',
          submitterHandle: 'tonyj',
          createdAt: '2024-04-01T12:00:00.000Z'
        },
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 80.5,
          submitterId: '3456789',
          submitterHandle: 'nathanael',
          createdAt: '2024-04-01T13:00:00.000Z'
        }
      ])
      originalReviewSummations = originalGetReviewSummations

      const originalGetChallengeResources = helper.getChallengeResources
      helper.getChallengeResources = async () => ([
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 12345678, memberHandle: 'thomaskranitsas' },
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 9876543, memberHandle: 'tonyj' },
        { roleId: config.SUBMITTER_ROLE_ID, memberId: 3456789, memberHandle: 'nathanael' }
      ])
      originalChallengeResources = originalGetChallengeResources

      const result = await service.closeMarathonMatch(adminUser, data.marathonMatchChallenge.id)

      should.exist(result)
      should.equal(result.winners.length, 3)
      should.equal(result.winners[0].userId, 12345678)
      should.equal(result.winners[0].placement, 1)
      should.equal(result.winners[1].userId, 9876543)
      should.equal(result.winners[1].placement, 2)
      should.equal(result.winners[2].userId, 3456789)
      should.equal(result.winners[2].placement, 3)
    })

    it('close marathon match - non-Marathon Match challenge type', async () => {
      try {
        await service.closeMarathonMatch(adminUser, data.challenge.id)
      } catch (e) {
        should.equal(e.name, 'BadRequestError')
        should.equal(e.message.indexOf('is not a Marathon Match challenge') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('close marathon match - forbidden for non-admin user', async () => {
      try {
        await service.closeMarathonMatch(nonAdminUser, data.marathonMatchChallenge.id)
      } catch (e) {
        should.equal(e.name, 'ForbiddenError')
        should.equal(e.message.indexOf('Admin role or an M2M token is required to close the marathon match.') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('close marathon match - challenge not found', async () => {
      try {
        await service.closeMarathonMatch(adminUser, notFoundId)
      } catch (e) {
        should.equal(e.name, 'NotFoundError')
        should.equal(e.message.indexOf(`Challenge with id: ${notFoundId} doesn't exist`) >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('close marathon match - missing submitter resources', async () => {
      const originalGetReviewSummations = helper.getReviewSummations
      helper.getReviewSummations = async () => ([
        {
          id: uuid(),
          challengeId: data.marathonMatchChallenge.id,
          isFinal: true,
          aggregateScore: 70.0,
          submitterId: '12345678',
          submitterHandle: 'thomaskranitsas',
          createdAt: '2024-05-01T09:00:00.000Z'
        }
      ])
      originalReviewSummations = originalGetReviewSummations

      const originalGetChallengeResources = helper.getChallengeResources
      helper.getChallengeResources = async () => ([])
      originalChallengeResources = originalGetChallengeResources

      try {
        await service.closeMarathonMatch(adminUser, data.marathonMatchChallenge.id)
      } catch (e) {
        should.equal(e.name, 'BadRequestError')
        should.equal(e.message.indexOf('Submitter resources are required to close Marathon Match challenge') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

  })
})
