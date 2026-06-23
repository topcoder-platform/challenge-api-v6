/*
 * Unit tests for ChallengePhaseService
 */
if (!process.env.REVIEW_DB_URL && process.env.DATABASE_URL) {
  process.env.REVIEW_DB_URL = process.env.DATABASE_URL
}

require('../../app-bootstrap')
const _ = require('lodash')
const axios = require('axios')
const chai = require('chai')
const config = require('config')
const { Prisma } = require('@prisma/client')
const { v4: uuid } = require('uuid')
const challengeService = require('../../src/services/ChallengeService')
const { getReviewClient } = require('../../src/common/review-prisma')
const prisma = require('../../src/common/prisma').getClient()
const m2mHelper = require('../../src/common/m2m-helper')
const originalIndexChallengeAndPostToKafka = challengeService.indexChallengeAndPostToKafka
challengeService.indexChallengeAndPostToKafka = async () => {}
const service = require('../../src/services/ChallengePhaseService')
const helper = require('../../src/common/helper')
const testHelper = require('../testHelper')

const should = chai.should()

describe('challenge phase service unit tests', () => {
  let data
  const authUser = { userId: 'testuser', roles: ['administrator'] }
  const reviewSchema = config.get('REVIEW_DB_SCHEMA')
  const reviewTable = Prisma.raw(`"${reviewSchema}"."review"`)
  const submissionTable = Prisma.raw(`"${reviewSchema}"."submission"`)
  const reviewItemTable = Prisma.raw(`"${reviewSchema}"."reviewItem"`)
  const reviewItemCommentTable = Prisma.raw(`"${reviewSchema}"."reviewItemComment"`)
  const appealTable = Prisma.raw(`"${reviewSchema}"."appeal"`)
  let reviewClient
  let originalAxiosGet
  let originalGetM2MToken
  const shortId = () => uuid().replace(/-/g, '').slice(0, 14)
  const resetPrimaryChallengePhases = async () => {
    await prisma.challengePhaseConstraint.update({
      where: { id: data.challengePhaseConstrain1Id },
      data: {
        name: 'constraint-name-1',
        value: 100,
        updatedBy: 'admin'
      }
    })
    await prisma.challengePhaseConstraint.updateMany({
      where: { challengePhaseId: data.challengePhase2Id },
      data: {
        name: 'constraint-name-2',
        value: 200,
        updatedBy: 'admin'
      }
    })
    await prisma.challengePhase.update({
      where: { id: data.challengePhase1Id },
      data: {
        phaseId: data.phase.id,
        name: 'Registration',
        duration: 1000,
        predecessor: null,
        isOpen: false,
        scheduledStartDate: null,
        scheduledEndDate: null,
        actualStartDate: null,
        actualEndDate: null,
        updatedBy: 'admin'
      }
    })
    await prisma.challengePhase.update({
      where: { id: data.challengePhase2Id },
      data: {
        phaseId: data.phase2.id,
        name: 'Submission',
        duration: 2000,
        predecessor: data.challengePhase1Id,
        isOpen: false,
        scheduledStartDate: null,
        scheduledEndDate: null,
        actualStartDate: null,
        actualEndDate: null,
        updatedBy: 'admin'
      }
    })
    await prisma.challenge.update({
      where: { id: data.challenge.id },
      data: {
        currentPhaseNames: [],
        updatedBy: 'admin'
      }
    })
    await reviewClient.$executeRawUnsafe(`TRUNCATE TABLE "${reviewSchema}"."appealResponse"`)
    await reviewClient.$executeRawUnsafe(`TRUNCATE TABLE "${reviewSchema}"."appeal"`)
    await reviewClient.$executeRawUnsafe(`TRUNCATE TABLE "${reviewSchema}"."reviewItemComment"`)
    await reviewClient.$executeRawUnsafe(`TRUNCATE TABLE "${reviewSchema}"."reviewItem"`)
    await reviewClient.$executeRawUnsafe(`TRUNCATE TABLE "${reviewSchema}"."review"`)
    await reviewClient.$executeRawUnsafe(`TRUNCATE TABLE "${reviewSchema}"."submission"`)
  }
  before(async () => {
    originalAxiosGet = axios.get
    originalGetM2MToken = m2mHelper.getM2MToken
    m2mHelper.getM2MToken = async () => 'test-token'
    axios.get = async (url, options) => {
      const requestUrl = _.toString(url)
      if (
        requestUrl === config.RESOURCE_ROLES_API_URL ||
        requestUrl.startsWith(config.RESOURCES_API_URL) ||
        requestUrl.startsWith(`${config.PROJECTS_API_URL}/`) ||
        requestUrl.includes('/memberGroups/')
      ) {
        return { data: [], status: 200, headers: {} }
      }
      return originalAxiosGet(url, options)
    }

    await testHelper.createData()
    data = testHelper.getData()
    reviewClient = getReviewClient()
    await reviewClient.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${reviewSchema}"`)
    await reviewClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${reviewSchema}"."review" (
        "id" varchar(36) PRIMARY KEY,
        "phaseId" varchar(255) NOT NULL,
        "scorecardId" varchar(255),
        "status" varchar(32),
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now()
      )
    `)
    await reviewClient.$executeRawUnsafe(`
      ALTER TABLE "${reviewSchema}"."review"
      ADD COLUMN IF NOT EXISTS "scorecardId" varchar(255)
    `)
    await reviewClient.$executeRawUnsafe(`
      ALTER TABLE "${reviewSchema}"."review"
      ADD COLUMN IF NOT EXISTS "submissionId" varchar(14)
    `)
    await reviewClient.$executeRawUnsafe(`
      ALTER TABLE "${reviewSchema}"."review"
      ADD COLUMN IF NOT EXISTS "legacySubmissionId" varchar(14)
    `)
    await reviewClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${reviewSchema}"."submission" (
        "id" varchar(14) PRIMARY KEY,
        "legacySubmissionId" varchar(14),
        "challengeId" varchar(36)
      )
    `)
    await reviewClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${reviewSchema}"."reviewItem" (
        "id" varchar(14) PRIMARY KEY,
        "reviewId" varchar(36) NOT NULL
      )
    `)
    await reviewClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${reviewSchema}"."reviewItemComment" (
        "id" varchar(14) PRIMARY KEY,
        "reviewItemId" varchar(14) NOT NULL
      )
    `)
    await reviewClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${reviewSchema}"."appeal" (
        "id" varchar(14) PRIMARY KEY,
        "reviewItemCommentId" varchar(14) NOT NULL
      )
    `)
    await reviewClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${reviewSchema}"."appealResponse" (
        "id" varchar(14) PRIMARY KEY,
        "appealId" varchar(14) UNIQUE NOT NULL
      )
    `)
  })

  after(async () => {
    challengeService.indexChallengeAndPostToKafka = originalIndexChallengeAndPostToKafka
    axios.get = originalAxiosGet
    m2mHelper.getM2MToken = originalGetM2MToken

    if (reviewClient) {
      await reviewClient.$executeRawUnsafe(`TRUNCATE TABLE "${reviewSchema}"."appealResponse"`)
      await reviewClient.$executeRawUnsafe(`TRUNCATE TABLE "${reviewSchema}"."appeal"`)
      await reviewClient.$executeRawUnsafe(`TRUNCATE TABLE "${reviewSchema}"."reviewItemComment"`)
      await reviewClient.$executeRawUnsafe(`TRUNCATE TABLE "${reviewSchema}"."reviewItem"`)
      await reviewClient.$executeRawUnsafe(`TRUNCATE TABLE "${reviewSchema}"."review"`)
      await reviewClient.$executeRawUnsafe(`TRUNCATE TABLE "${reviewSchema}"."submission"`)
    }
    await testHelper.clearData()
  })

  describe('get all challenge phases tests', () => {
    it('get all challenge phases successfully 1', async () => {
      const challengeId = data.challenge.id
      const result = await service.getAllChallengePhases(challengeId)
      should.equal(result.length, 2)
      should.equal(result[0].challengeId, challengeId)
      should.equal(result[0].name, 'Registration')
      should.equal(result[0].duration, 1000)
      should.equal(result[0].phase.id, data.phase.id)
      should.equal(result[0].constraints[0].name, 'constraint-name-1')
      should.equal(result[0].constraints[0].value, 100)
      should.equal(result[1].challengeId, challengeId)
      should.equal(result[1].name, 'Submission')
      should.equal(result[1].duration, 2000)
      should.equal(result[1].phase.id, data.phase2.id)
      should.equal(result[1].constraints[0].name, 'constraint-name-2')
      should.equal(result[1].constraints[0].value, 200)
    })

    it('get all challenge phases successfully 2', async () => {
      const challengeId = data.taskChallenge.id
      const result = await service.getAllChallengePhases(challengeId, { isMachine: true })
      should.equal(result.length, 0)
    })

    it('get challenge phases enforces challenge user whitelist for interactive users', async () => {
      await prisma.challengeUserWhitelist.create({
        data: {
          challengeId: data.challenge.id,
          userId: 'allowed-user'
        }
      })

      try {
        try {
          await service.getAllChallengePhases(data.challenge.id, {
            roles: ['administrator'],
            userId: 'blocked-user'
          })
        } catch (e) {
          should.equal(e.name, 'ForbiddenError')

          const allowedPhases = await service.getAllChallengePhases(data.challenge.id, {
            roles: ['administrator'],
            userId: 'allowed-user'
          })
          should.equal(allowedPhases.length, 2)

          const machinePhases = await service.getAllChallengePhases(data.challenge.id, {
            isMachine: true,
            userId: 'machine-user'
          })
          should.equal(machinePhases.length, 2)
          return
        }
        throw new Error('should not reach here')
      } finally {
        await prisma.challengeUserWhitelist.deleteMany({
          where: { challengeId: data.challenge.id }
        })
      }
    })

    it('get all challenge phases enforces challenge group view rules', async () => {
      await prisma.challenge.update({
        where: { id: data.challenge.id },
        data: { groups: [uuid()] }
      })

      try {
        await service.getAllChallengePhases(data.challenge.id, {
          roles: ['Topcoder User'],
          userId: 'blocked-group-user'
        })
      } catch (e) {
        should.equal(e.name, 'ForbiddenError')
        return
      } finally {
        await prisma.challenge.update({
          where: { id: data.challenge.id },
          data: { groups: [] }
        })
      }
      throw new Error('should not reach here')
    })

    it('get all challenge phases - invalid challengeId', async () => {
      try {
        await service.getAllChallengePhases('invalid id')
      } catch (e) {
        should.equal(e.message.indexOf('"challengeId" must be a valid GUID') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })
  })

  describe('get challenge phase tests', () => {
    it('get challenge phase successfully', async () => {
      const result = await service.getChallengePhase(data.challenge.id, data.challengePhase1Id)
      should.equal(result.challengeId, data.challenge.id)
      should.equal(result.name, 'Registration')
      should.equal(result.duration, 1000)
      should.equal(result.phase.id, data.phase.id)
      should.equal(result.constraints[0].name, 'constraint-name-1')
      should.equal(result.constraints[0].value, 100)
    })

    it('get challenge phase - not found', async () => {
      try {
        await service.getChallengePhase(data.taskChallenge.id, data.challengePhase2Id, {
          isMachine: true
        })
      } catch (e) {
        should.equal(
          e.message,
          `ChallengePhase with challengeId: ${data.taskChallenge.id},  phaseId: ${data.challengePhase2Id} doesn't exist`
        )
        return
      }
      throw new Error('should not reach here')
    })

    it('get challenge phase enforces task view rules before loading phase data', async () => {
      try {
        await service.getChallengePhase(data.taskChallenge.id, data.challengePhase1Id, {
          roles: ['Topcoder User'],
          userId: 'blocked-task-user'
        })
      } catch (e) {
        should.equal(e.name, 'ForbiddenError')
        should.equal(e.message, "You don't have access to view this challenge")
        return
      }
      throw new Error('should not reach here')
    })

    it('get challenge phase - invalid challenge id', async () => {
      try {
        await service.getChallengePhase('invalid', data.phase.id)
      } catch (e) {
        should.equal(e.message.indexOf('"challengeId" must be a valid GUID') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('get challenge phase - invalid phase id', async () => {
      try {
        await service.getChallengePhase(data.challenge.id, 'invalid')
      } catch (e) {
        should.equal(e.message.indexOf('"id" must be a valid GUID') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })
  })

  describe('partially update challenge phase tests', () => {
    beforeEach(async () => {
      await resetPrimaryChallengePhases()
    })

    it('partially update challenge phase successfully', async function () {
      this.timeout(50000)
      const scheduledStartDate = '2025-01-01T00:00:00.000Z'
      const expectedScheduledEndDate = new Date(
        new Date(scheduledStartDate).getTime() + 7200 * 1000
      ).toISOString()
      const challengePhase = await service.partiallyUpdateChallengePhase(
        authUser,
        data.challenge.id,
        data.challengePhase1Id,
        {
          name: 'updated-Registration',
          isOpen: true,
          duration: 7200,
          scheduledStartDate,
          constraints: [
            {
              id: data.challengePhaseConstrain1Id,
              name: 'u1',
              value: 10
            },
            {
              name: 'i1',
              value: 20
            }
          ]
        }
      )
      should.equal(challengePhase.name, 'updated-Registration')
      should.equal(challengePhase.duration, 7200)
      should.equal(challengePhase.isOpen, true)
      should.equal(new Date(challengePhase.scheduledStartDate).toISOString(), scheduledStartDate)
      should.equal(
        new Date(challengePhase.scheduledEndDate).toISOString(),
        expectedScheduledEndDate
      )
    })

    it('partially update challenge phase - explicit scheduledEndDate wins over stale duration', async function () {
      this.timeout(50000)
      const scheduledStartDate = '2025-01-01T00:00:00.000Z'
      const scheduledEndDate = new Date(
        new Date(scheduledStartDate).getTime() + 7200 * 1000
      ).toISOString()
      const challengePhase = await service.partiallyUpdateChallengePhase(
        authUser,
        data.challenge.id,
        data.challengePhase1Id,
        {
          duration: 3600,
          scheduledEndDate,
          scheduledStartDate
        }
      )

      should.equal(new Date(challengePhase.scheduledStartDate).toISOString(), scheduledStartDate)
      should.equal(new Date(challengePhase.scheduledEndDate).toISOString(), scheduledEndDate)
      should.equal(challengePhase.duration, 7200)
    })

    it('partially update challenge phase - closing sets actual end date', async () => {
      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: { isOpen: true, actualStartDate: new Date(), actualEndDate: null }
      })

      const before = new Date()
      const challengePhase = await service.partiallyUpdateChallengePhase(
        authUser,
        data.challenge.id,
        data.challengePhase1Id,
        {
          isOpen: false
        }
      )
      const after = new Date()

      should.equal(challengePhase.isOpen, false)
      should.exist(challengePhase.actualEndDate)
      const actualEndMs = new Date(challengePhase.actualEndDate).getTime()
      actualEndMs.should.be.at.least(before.getTime())
      actualEndMs.should.be.at.most(after.getTime())
    })

    it('partially update challenge phase - closing shifts successor schedules to actual end date', async () => {
      const aiScreeningTemplateId = uuid()
      const aiScreeningPhaseId = uuid()
      const submissionStartDate = new Date('2025-03-01T00:00:00.000Z')
      const submissionScheduledEndDate = new Date('2025-03-03T00:00:00.000Z')
      const aiScreeningScheduledStartDate = new Date('2025-03-03T00:00:00.000Z')
      const aiScreeningScheduledEndDate = new Date('2025-03-04T00:00:00.000Z')

      await prisma.phase.create({
        data: {
          id: aiScreeningTemplateId,
          name: `AI Screening ${Date.now()}`,
          description: 'ai screening test phase',
          isOpen: true,
          duration: 86400,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })

      await prisma.challengePhase.update({
        where: { id: data.challengePhase2Id },
        data: {
          isOpen: true,
          actualStartDate: submissionStartDate,
          actualEndDate: null,
          scheduledStartDate: submissionStartDate,
          scheduledEndDate: submissionScheduledEndDate
        }
      })

      await prisma.challengePhase.create({
        data: {
          id: aiScreeningPhaseId,
          challengeId: data.challenge.id,
          phaseId: aiScreeningTemplateId,
          name: 'AI Screening',
          duration: 86400,
          predecessor: data.challengePhase2Id,
          scheduledStartDate: aiScreeningScheduledStartDate,
          scheduledEndDate: aiScreeningScheduledEndDate,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })

      try {
        const before = new Date()
        const challengePhase = await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase2Id,
          {
            isOpen: false
          }
        )
        const after = new Date()

        const successorPhase = await prisma.challengePhase.findUnique({
          where: { id: aiScreeningPhaseId }
        })

        should.equal(challengePhase.isOpen, false)
        should.exist(successorPhase)

        const actualEndMs = new Date(challengePhase.actualEndDate).getTime()
        const successorStartMs = new Date(successorPhase.scheduledStartDate).getTime()
        const successorEndMs = new Date(successorPhase.scheduledEndDate).getTime()
        const aiScreeningDurationMs =
          aiScreeningScheduledEndDate.getTime() - aiScreeningScheduledStartDate.getTime()

        actualEndMs.should.be.at.least(before.getTime())
        actualEndMs.should.be.at.most(after.getTime())
        successorStartMs.should.equal(actualEndMs)
        successorEndMs.should.equal(actualEndMs + aiScreeningDurationMs)
      } finally {
        await prisma.challengePhase.delete({
          where: { id: aiScreeningPhaseId }
        })
        await prisma.phase.delete({
          where: { id: aiScreeningTemplateId }
        })
      }
    })

    it('partially update challenge phase - reopening clears actual end date and sets start date', async () => {
      const previousEndDate = new Date()
      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: { isOpen: false, actualEndDate: previousEndDate }
      })

      const before = new Date()
      const challengePhase = await service.partiallyUpdateChallengePhase(
        authUser,
        data.challenge.id,
        data.challengePhase1Id,
        {
          isOpen: true
        }
      )
      const after = new Date()

      should.equal(challengePhase.isOpen, true)
      should.equal(challengePhase.actualEndDate, null)
      should.exist(challengePhase.actualStartDate)
      const actualStartMs = new Date(challengePhase.actualStartDate).getTime()
      actualStartMs.should.be.at.least(before.getTime())
      actualStartMs.should.be.at.most(after.getTime())
    })

    it('partially update challenge phase - allows reopening when successor phase depends on it', async () => {
      const startDate = new Date('2025-05-01T00:00:00.000Z')
      const endDate = new Date('2025-05-02T00:00:00.000Z')

      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: {
          isOpen: false,
          actualStartDate: startDate,
          actualEndDate: endDate
        }
      })
      await prisma.challengePhase.update({
        where: { id: data.challengePhase2Id },
        data: {
          isOpen: true,
          predecessor: data.challengePhase1Id
        }
      })

      const challengePhase = await service.partiallyUpdateChallengePhase(
        authUser,
        data.challenge.id,
        data.challengePhase1Id,
        {
          isOpen: true
        }
      )

      should.equal(challengePhase.isOpen, true)
      should.equal(challengePhase.actualEndDate, null)

      await prisma.challengePhase.update({
        where: { id: data.challengePhase2Id },
        data: {
          isOpen: false
        }
      })
    })

    it('partially update challenge phase - reopening succeeds when predecessor matches phaseId', async () => {
      const startDate = new Date('2025-07-01T00:00:00.000Z')
      const endDate = new Date('2025-07-02T00:00:00.000Z')
      const originalData = await prisma.challengePhase.findUnique({
        where: { id: data.challengePhase2Id },
        select: { predecessor: true }
      })

      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: {
          isOpen: false,
          actualStartDate: startDate,
          actualEndDate: endDate
        }
      })

      await prisma.challengePhase.update({
        where: { id: data.challengePhase2Id },
        data: {
          isOpen: false,
          predecessor: data.phase.id
        }
      })

      try {
        const challengePhase = await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase2Id,
          {
            isOpen: true
          }
        )

        should.equal(challengePhase.isOpen, true)
      } finally {
        await prisma.challengePhase.update({
          where: { id: data.challengePhase2Id },
          data: {
            predecessor: originalData.predecessor,
            isOpen: false
          }
        })
      }
    })

    it('partially update challenge phase - cannot reopen registration when open submission depends on checkpoint review', async () => {
      const startDate = new Date('2025-06-01T00:00:00.000Z')
      const endDate = new Date('2025-06-02T00:00:00.000Z')
      const checkpointReviewPhase = await prisma.phase.create({
        data: {
          id: uuid(),
          name: 'Checkpoint Review',
          description: 'desc',
          isOpen: false,
          duration: 3600,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })
      const checkpointReviewChallengePhaseId = uuid()
      const checkpointReviewStartDate = new Date('2025-06-02T00:00:00.000Z')
      const checkpointReviewEndDate = new Date('2025-06-03T00:00:00.000Z')
      const registrationOriginalData = await prisma.challengePhase.findUnique({
        where: { id: data.challengePhase1Id },
        select: {
          actualEndDate: true,
          actualStartDate: true,
          isOpen: true,
          name: true,
          predecessor: true
        }
      })
      const submissionOriginalData = await prisma.challengePhase.findUnique({
        where: { id: data.challengePhase2Id },
        select: {
          actualEndDate: true,
          actualStartDate: true,
          isOpen: true,
          name: true,
          predecessor: true
        }
      })

      await prisma.challengePhase.create({
        data: {
          id: checkpointReviewChallengePhaseId,
          challengeId: data.challenge.id,
          phaseId: checkpointReviewPhase.id,
          name: 'Checkpoint Review',
          duration: 1000,
          isOpen: false,
          predecessor: data.phase.id,
          actualStartDate: checkpointReviewStartDate,
          actualEndDate: checkpointReviewEndDate,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })

      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: {
          isOpen: false,
          actualStartDate: startDate,
          actualEndDate: endDate
        }
      })
      await prisma.challengePhase.update({
        where: { id: data.challengePhase2Id },
        data: {
          isOpen: true,
          actualStartDate: checkpointReviewEndDate,
          actualEndDate: null,
          predecessor: checkpointReviewPhase.id
        }
      })

      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase1Id,
          {
            isOpen: true
          }
        )
      } catch (e) {
        should.equal(e.httpStatus || e.statusCode, 403)
        should.equal(
          e.message,
          'Cannot reopen Registration because no currently open phase depends on it'
        )
        return
      } finally {
        await prisma.challengePhase.update({
          where: { id: data.challengePhase2Id },
          data: submissionOriginalData
        })
        await prisma.challengePhase.update({
          where: { id: data.challengePhase1Id },
          data: registrationOriginalData
        })
        await prisma.challengePhase.delete({ where: { id: checkpointReviewChallengePhaseId } })
        await prisma.phase.delete({ where: { id: checkpointReviewPhase.id } })
      }

      throw new Error('should not reach here')
    })

    it('partially update challenge phase - cannot reopen when open phase is not a successor', async () => {
      const startDate = new Date('2025-06-01T00:00:00.000Z')
      const endDate = new Date('2025-06-02T00:00:00.000Z')

      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: {
          isOpen: false,
          actualStartDate: startDate,
          actualEndDate: endDate
        }
      })
      await prisma.challengePhase.update({
        where: { id: data.challengePhase2Id },
        data: {
          isOpen: true,
          predecessor: null,
          name: 'Review'
        }
      })

      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase1Id,
          {
            isOpen: true
          }
        )
      } catch (e) {
        should.equal(e.httpStatus || e.statusCode, 403)
        should.equal(
          e.message,
          'Cannot reopen Registration because no currently open phase depends on it'
        )
        return
      } finally {
        await prisma.challengePhase.update({
          where: { id: data.challengePhase2Id },
          data: {
            isOpen: false,
            predecessor: data.challengePhase1Id,
            name: 'Submission'
          }
        })
        await prisma.challengePhase.update({
          where: { id: data.challengePhase1Id },
          data: {
            isOpen: false,
            actualStartDate: startDate,
            actualEndDate: endDate
          }
        })
      }

      throw new Error('should not reach here')
    })

    it('partially update challenge phase - cannot reopen when review phase has active scorecards', async () => {
      const reviewPhase = await prisma.phase.create({
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

      const reviewChallengePhaseId = uuid()
      const registrationStart = new Date('2025-08-01T00:00:00.000Z')
      const registrationEnd = new Date('2025-08-02T00:00:00.000Z')

      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: {
          isOpen: false,
          actualStartDate: registrationStart,
          actualEndDate: registrationEnd
        }
      })

      await prisma.challengePhase.create({
        data: {
          id: reviewChallengePhaseId,
          challengeId: data.challenge.id,
          phaseId: reviewPhase.id,
          name: 'Review',
          isOpen: true,
          predecessor: data.challengePhase1Id,
          actualStartDate: new Date('2025-08-02T06:00:00.000Z'),
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })

      const reviewId = uuid()
      await reviewClient.$executeRaw(
        Prisma.sql`
          INSERT INTO ${reviewTable} ("id", "phaseId", "status")
          VALUES (${reviewId}, ${reviewChallengePhaseId}, ${'IN_PROGRESS'})
        `
      )

      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase1Id,
          {
            isOpen: true
          }
        )
      } catch (e) {
        should.equal(e.httpStatus || e.statusCode, 400)
        should.equal(
          e.message,
          "Cannot reopen Registration because the currently open phase 'Review' has reviews in progress or completed"
        )
        return
      } finally {
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${reviewTable} WHERE "id" = ${reviewId}`
        )
        await prisma.challengePhase.delete({ where: { id: reviewChallengePhaseId } })
        await prisma.phase.delete({ where: { id: reviewPhase.id } })
        await prisma.challengePhase.update({
          where: { id: data.challengePhase1Id },
          data: {
            isOpen: false,
            actualStartDate: null,
            actualEndDate: null
          }
        })
      }

      throw new Error('should not reach here')
    })

    it('partially update challenge phase - cannot reopen predecessor when appeals have submitted appeals', async () => {
      const reviewPhase = await prisma.phase.create({
        data: {
          id: uuid(),
          name: 'Review',
          description: 'desc',
          isOpen: false,
          duration: 86400,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })
      const appealsPhase = await prisma.phase.create({
        data: {
          id: uuid(),
          name: 'Appeals',
          description: 'desc',
          isOpen: true,
          duration: 86400,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })

      const reviewChallengePhaseId = uuid()
      const appealsChallengePhaseId = uuid()
      const reviewStart = new Date('2025-07-01T00:00:00.000Z')
      const reviewEnd = new Date('2025-07-02T00:00:00.000Z')
      await prisma.challengePhase.create({
        data: {
          id: reviewChallengePhaseId,
          challengeId: data.challenge.id,
          phaseId: reviewPhase.id,
          name: 'Review',
          isOpen: false,
          actualStartDate: reviewStart,
          actualEndDate: reviewEnd,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })
      await prisma.challengePhase.create({
        data: {
          id: appealsChallengePhaseId,
          challengeId: data.challenge.id,
          phaseId: appealsPhase.id,
          name: 'Appeals',
          isOpen: true,
          predecessor: reviewChallengePhaseId,
          actualStartDate: new Date('2025-07-02T12:00:00.000Z'),
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })

      const submissionId = shortId()
      const reviewId = uuid()
      const reviewItemId = shortId()
      const reviewItemCommentId = shortId()
      const appealId = shortId()

      await reviewClient.$executeRaw(
        Prisma.sql`INSERT INTO ${submissionTable} ("id", "challengeId") VALUES (${submissionId}, ${data.challenge.id})`
      )
      await reviewClient.$executeRaw(
        Prisma.sql`
          INSERT INTO ${reviewTable} ("id", "phaseId", "submissionId", "status")
          VALUES (${reviewId}, ${reviewChallengePhaseId}, ${submissionId}, ${'COMPLETED'})
        `
      )
      await reviewClient.$executeRaw(
        Prisma.sql`
          INSERT INTO ${reviewItemTable} ("id", "reviewId")
          VALUES (${reviewItemId}, ${reviewId})
        `
      )
      await reviewClient.$executeRaw(
        Prisma.sql`
          INSERT INTO ${reviewItemCommentTable} ("id", "reviewItemId")
          VALUES (${reviewItemCommentId}, ${reviewItemId})
        `
      )
      await reviewClient.$executeRaw(
        Prisma.sql`
          INSERT INTO ${appealTable} ("id", "reviewItemCommentId")
          VALUES (${appealId}, ${reviewItemCommentId})
        `
      )
      const originalGetChallengeResources = helper.getChallengeResources
      const originalGetResourceRoles = helper.getResourceRoles
      helper.getChallengeResources = async () => [
        {
          roleId: 'reviewer-role-id',
          resourceRole: { name: 'Reviewer' }
        }
      ]
      helper.getResourceRoles = async () => [{ id: 'reviewer-role-id', name: 'Reviewer' }]

      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          reviewChallengePhaseId,
          {
            isOpen: true
          }
        )
      } catch (e) {
        should.equal(e.httpStatus || e.statusCode, 403)
        should.equal(
          e.message,
          'Cannot reopen Review because submitted appeals already exist in the Appeals phase'
        )
        return
      } finally {
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${appealTable} WHERE "id" = ${appealId}`
        )
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${reviewItemCommentTable} WHERE "id" = ${reviewItemCommentId}`
        )
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${reviewItemTable} WHERE "id" = ${reviewItemId}`
        )
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${reviewTable} WHERE "id" = ${reviewId}`
        )
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${submissionTable} WHERE "id" = ${submissionId}`
        )
        helper.getChallengeResources = originalGetChallengeResources
        helper.getResourceRoles = originalGetResourceRoles
        await prisma.challengePhase.deleteMany({
          where: { id: { in: [appealsChallengePhaseId, reviewChallengePhaseId] } }
        })
        await prisma.phase.deleteMany({ where: { id: { in: [appealsPhase.id, reviewPhase.id] } } })
      }

      throw new Error('should not reach here')
    })

    it('partially update challenge phase - not found', async () => {
      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.taskChallenge.id,
          data.challengePhase2Id,
          { name: 'updated', duration: 7200 }
        )
      } catch (e) {
        should.equal(
          e.message,
          `ChallengePhase with challengeId: ${data.taskChallenge.id},  phaseId: ${data.challengePhase2Id} doesn't exist`
        )
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase blocks editor without challenge modify access', async () => {
      try {
        await service.partiallyUpdateChallengePhase(
          { handle: 'blocked-editor', roles: ['Connect Manager'], userId: 'blocked-editor' },
          data.challenge.id,
          data.challengePhase1Id,
          { name: 'blocked update' }
        )
      } catch (e) {
        should.equal(e.name, 'ForbiddenError')
        const challengePhase = await prisma.challengePhase.findUnique({
          where: { id: data.challengePhase1Id }
        })
        should.equal(challengePhase.name, 'Registration')
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - phaseId does not exist', async () => {
      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase1Id,
          { name: 'updated', phaseId: data.challenge.id, isOpen: null }
        )
      } catch (e) {
        should.equal(e.message, 'phaseId should be a valid phase')
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - predecessor does not exist', async () => {
      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase1Id,
          { name: 'updated', predecessor: data.challenge.id }
        )
      } catch (e) {
        should.equal(
          e.message,
          `predecessor should be a valid challenge phase in the same challenge: ${data.challenge.id}`
        )
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - scheduledStartDate should not be after scheduledEndDate', async () => {
      const startDate = '2025-04-04T04:38:00.000Z'
      const endDate = '2025-04-03T04:38:00.000Z'
      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase1Id,
          { name: 'updated', scheduledStartDate: startDate, scheduledEndDate: endDate }
        )
      } catch (e) {
        should.equal(
          e.message,
          `scheduledStartDate: ${startDate} should not be after scheduledEndDate: ${endDate}`
        )
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - actualStartDate should not be after scheduledEndDate', async () => {
      const startDate = '2025-04-04T04:38:00.000Z'
      const endDate = '2025-04-03T04:38:00.000Z'
      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase1Id,
          { name: 'updated', actualStartDate: startDate, actualEndDate: endDate }
        )
      } catch (e) {
        should.equal(
          e.message,
          `actualStartDate: ${startDate} should not be after actualEndDate: ${endDate}`
        )
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - constraint is not exists for the ChallengePhase', async () => {
      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase1Id,
          {
            name: 'updated',
            constraints: [
              {
                id: data.challenge.id,
                name: 't1',
                value: 100
              }
            ]
          }
        )
      } catch (e) {
        should.equal(
          e.message,
          `constraint: ${data.challenge.id} is not exists for the ChallengePhase`
        )
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - forbidden when pending scorecards exist', async function () {
      this.timeout(50000)
      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: { isOpen: true }
      })

      const reviewId = uuid()
      let caughtError
      try {
        await reviewClient.$executeRaw(
          Prisma.sql`
            INSERT INTO ${reviewTable} ("id", "phaseId", "status")
            VALUES (${reviewId}, ${data.challengePhase1Id}, ${'PENDING'})
            ON CONFLICT ("id") DO NOTHING
          `
        )

        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase1Id,
          {
            isOpen: false
          }
        )
      } catch (e) {
        caughtError = e
      } finally {
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${reviewTable} WHERE "id" = ${reviewId}`
        )
      }

      should.exist(caughtError)
      should.equal(caughtError.httpStatus || caughtError.statusCode, 403)
      should.equal(
        caughtError.message,
        'Cannot close Registration because there are still pending scorecards'
      )
    })

    it('partially update challenge phase - allows closing when scorecards are completed', async function () {
      this.timeout(50000)
      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: { isOpen: true }
      })

      const reviewId = uuid()
      try {
        await reviewClient.$executeRaw(
          Prisma.sql`
            INSERT INTO ${reviewTable} ("id", "phaseId", "status")
            VALUES (${reviewId}, ${data.challengePhase1Id}, ${'COMPLETED'})
            ON CONFLICT ("id") DO NOTHING
          `
        )

        const challengePhase = await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase1Id,
          {
            isOpen: false
          }
        )
        should.equal(challengePhase.isOpen, false)
      } finally {
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${reviewTable} WHERE "id" = ${reviewId}`
        )
      }
    })

    it('partially update challenge phase - recalculates successor schedules when review is extended', async function () {
      this.timeout(50000)
      const reviewPhase = await prisma.phase.create({
        data: {
          id: uuid(),
          name: 'Review',
          description: 'desc',
          isOpen: false,
          duration: 86400,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })
      const appealsPhase = await prisma.phase.create({
        data: {
          id: uuid(),
          name: 'Appeals',
          description: 'desc',
          isOpen: false,
          duration: 43200,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })
      const appealsResponsePhase = await prisma.phase.create({
        data: {
          id: uuid(),
          name: 'Appeals Response',
          description: 'desc',
          isOpen: false,
          duration: 21600,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })
      const approvalPhase = await prisma.phase.create({
        data: {
          id: uuid(),
          name: 'Approval',
          description: 'desc',
          isOpen: false,
          duration: 10800,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })

      const reviewChallengePhaseId = uuid()
      const appealsChallengePhaseId = uuid()
      const appealsResponseChallengePhaseId = uuid()
      const approvalChallengePhaseId = uuid()

      const reviewStartDate = new Date('2025-08-01T00:00:00.000Z')
      const reviewDuration = 86400
      const appealsDuration = 43200
      const appealsResponseDuration = 21600
      const approvalDuration = 10800

      const reviewEndDate = new Date(reviewStartDate.getTime() + reviewDuration * 1000)
      const appealsEndDate = new Date(reviewEndDate.getTime() + appealsDuration * 1000)
      const appealsResponseEndDate = new Date(
        appealsEndDate.getTime() + appealsResponseDuration * 1000
      )
      const approvalEndDate = new Date(appealsResponseEndDate.getTime() + approvalDuration * 1000)

      await prisma.challengePhase.createMany({
        data: [
          {
            id: reviewChallengePhaseId,
            challengeId: data.challenge.id,
            phaseId: reviewPhase.id,
            name: 'Review',
            duration: reviewDuration,
            scheduledStartDate: reviewStartDate,
            scheduledEndDate: reviewEndDate,
            createdBy: 'admin',
            updatedBy: 'admin'
          },
          {
            id: appealsChallengePhaseId,
            challengeId: data.challenge.id,
            phaseId: appealsPhase.id,
            predecessor: reviewPhase.id,
            name: 'Appeals',
            duration: appealsDuration,
            scheduledStartDate: reviewEndDate,
            scheduledEndDate: appealsEndDate,
            createdBy: 'admin',
            updatedBy: 'admin'
          },
          {
            id: appealsResponseChallengePhaseId,
            challengeId: data.challenge.id,
            phaseId: appealsResponsePhase.id,
            predecessor: appealsPhase.id,
            name: 'Appeals Response',
            duration: appealsResponseDuration,
            scheduledStartDate: appealsEndDate,
            scheduledEndDate: appealsResponseEndDate,
            createdBy: 'admin',
            updatedBy: 'admin'
          },
          {
            id: approvalChallengePhaseId,
            challengeId: data.challenge.id,
            phaseId: approvalPhase.id,
            predecessor: appealsResponsePhase.id,
            name: 'Approval',
            duration: approvalDuration,
            scheduledStartDate: appealsResponseEndDate,
            scheduledEndDate: approvalEndDate,
            createdBy: 'admin',
            updatedBy: 'admin'
          }
        ]
      })

      try {
        const extendedDuration = reviewDuration * 2
        const updatedReview = await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          reviewChallengePhaseId,
          { duration: extendedDuration }
        )

        const expectedReviewEnd = new Date(
          reviewStartDate.getTime() + extendedDuration * 1000
        ).toISOString()
        should.equal(new Date(updatedReview.scheduledEndDate).toISOString(), expectedReviewEnd)

        const updatedAppeals = await prisma.challengePhase.findUnique({
          where: { id: appealsChallengePhaseId }
        })
        should.equal(new Date(updatedAppeals.scheduledStartDate).toISOString(), expectedReviewEnd)
        const expectedAppealsEnd = new Date(
          new Date(expectedReviewEnd).getTime() + appealsDuration * 1000
        ).toISOString()
        should.equal(new Date(updatedAppeals.scheduledEndDate).toISOString(), expectedAppealsEnd)

        const updatedAppealsResponse = await prisma.challengePhase.findUnique({
          where: { id: appealsResponseChallengePhaseId }
        })
        should.equal(
          new Date(updatedAppealsResponse.scheduledStartDate).toISOString(),
          expectedAppealsEnd
        )
        const expectedAppealsResponseEnd = new Date(
          new Date(expectedAppealsEnd).getTime() + appealsResponseDuration * 1000
        ).toISOString()
        should.equal(
          new Date(updatedAppealsResponse.scheduledEndDate).toISOString(),
          expectedAppealsResponseEnd
        )

        const updatedApproval = await prisma.challengePhase.findUnique({
          where: { id: approvalChallengePhaseId }
        })
        should.equal(
          new Date(updatedApproval.scheduledStartDate).toISOString(),
          expectedAppealsResponseEnd
        )
        const expectedApprovalEnd = new Date(
          new Date(expectedAppealsResponseEnd).getTime() + approvalDuration * 1000
        ).toISOString()
        should.equal(new Date(updatedApproval.scheduledEndDate).toISOString(), expectedApprovalEnd)
      } finally {
        await prisma.challengePhase.deleteMany({
          where: {
            id: {
              in: [
                reviewChallengePhaseId,
                appealsChallengePhaseId,
                appealsResponseChallengePhaseId,
                approvalChallengePhaseId
              ]
            }
          }
        })
        await prisma.phase.deleteMany({
          where: {
            id: {
              in: [reviewPhase.id, appealsPhase.id, appealsResponsePhase.id, approvalPhase.id]
            }
          }
        })
      }
    })

    it('partially update challenge phase - allows Design active phase shortening and recalculates successor schedules', async function () {
      this.timeout(50000)
      const originalChallenge = await prisma.challenge.findUnique({
        where: { id: data.challenge.id },
        select: { trackId: true }
      })
      let designTrack
      let reviewPhase
      let appealsPhase
      const reviewChallengePhaseId = uuid()
      const appealsChallengePhaseId = uuid()
      const now = Date.now()
      const reviewStartDate = new Date(now - 60 * 60 * 1000)
      const reviewEndDate = new Date(now + 4 * 24 * 60 * 60 * 1000)
      const shortenedReviewEndDate = new Date(now + 2 * 24 * 60 * 60 * 1000)
      const reviewDuration = Math.round(
        (reviewEndDate.getTime() - reviewStartDate.getTime()) / 1000
      )
      const appealsDuration = 43200

      try {
        designTrack = await prisma.challengeTrack.create({
          data: {
            id: uuid(),
            name: `Design ${shortId()}`,
            description: 'Design track for active phase shortening tests',
            isActive: true,
            abbreviation: `D${shortId()}`,
            track: 'DESIGN',
            createdBy: 'admin',
            updatedBy: 'admin'
          }
        })
        await prisma.challenge.update({
          where: { id: data.challenge.id },
          data: { trackId: designTrack.id }
        })

        reviewPhase = await prisma.phase.create({
          data: {
            id: uuid(),
            name: 'Review',
            description: 'desc',
            isOpen: false,
            duration: 86400,
            createdBy: 'admin',
            updatedBy: 'admin'
          }
        })
        appealsPhase = await prisma.phase.create({
          data: {
            id: uuid(),
            name: 'Appeals',
            description: 'desc',
            isOpen: false,
            duration: appealsDuration,
            createdBy: 'admin',
            updatedBy: 'admin'
          }
        })

        await prisma.challengePhase.createMany({
          data: [
            {
              id: reviewChallengePhaseId,
              challengeId: data.challenge.id,
              phaseId: reviewPhase.id,
              name: 'Review',
              duration: reviewDuration,
              isOpen: true,
              actualStartDate: reviewStartDate,
              scheduledStartDate: reviewStartDate,
              scheduledEndDate: reviewEndDate,
              createdBy: 'admin',
              updatedBy: 'admin'
            },
            {
              id: appealsChallengePhaseId,
              challengeId: data.challenge.id,
              phaseId: appealsPhase.id,
              predecessor: reviewPhase.id,
              name: 'Appeals',
              duration: appealsDuration,
              scheduledStartDate: reviewEndDate,
              scheduledEndDate: new Date(reviewEndDate.getTime() + appealsDuration * 1000),
              createdBy: 'admin',
              updatedBy: 'admin'
            }
          ]
        })

        const updatedReview = await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          reviewChallengePhaseId,
          { scheduledEndDate: shortenedReviewEndDate }
        )

        should.equal(
          new Date(updatedReview.scheduledEndDate).toISOString(),
          shortenedReviewEndDate.toISOString()
        )

        const updatedAppeals = await prisma.challengePhase.findUnique({
          where: { id: appealsChallengePhaseId }
        })
        should.equal(
          new Date(updatedAppeals.scheduledStartDate).toISOString(),
          shortenedReviewEndDate.toISOString()
        )
        should.equal(
          new Date(updatedAppeals.scheduledEndDate).toISOString(),
          new Date(shortenedReviewEndDate.getTime() + appealsDuration * 1000).toISOString()
        )
      } finally {
        await prisma.challengePhase.deleteMany({
          where: { id: { in: [reviewChallengePhaseId, appealsChallengePhaseId] } }
        })
        if (reviewPhase || appealsPhase) {
          await prisma.phase.deleteMany({
            where: { id: { in: _.compact([reviewPhase?.id, appealsPhase?.id]) } }
          })
        }
        if (originalChallenge) {
          await prisma.challenge.update({
            where: { id: data.challenge.id },
            data: { trackId: originalChallenge.trackId }
          })
        }
        if (designTrack) {
          await prisma.challengeTrack.delete({ where: { id: designTrack.id } })
        }
      }
    })

    it('partially update challenge phase - cannot close Appeals Response when appeals lack responses', async function () {
      this.timeout(50000)
      const appealsPhaseId = uuid()
      const appealsChallengePhaseId = uuid()
      const submissionId = shortId()
      const reviewId = uuid()
      const reviewItemId = shortId()
      const reviewItemCommentId = shortId()
      const appealId = shortId()

      await prisma.phase.create({
        data: {
          id: appealsPhaseId,
          name: 'Appeals Response',
          description: 'Appeals Response phase',
          isOpen: true,
          duration: 123,
          createdBy: 'testuser',
          updatedBy: 'testuser'
        }
      })

      await prisma.challengePhase.create({
        data: {
          id: appealsChallengePhaseId,
          challengeId: data.challenge.id,
          phaseId: appealsPhaseId,
          name: 'Appeals Response',
          isOpen: true,
          duration: 1000,
          actualStartDate: new Date(),
          createdBy: 'testuser',
          updatedBy: 'testuser'
        }
      })

      try {
        await reviewClient.$executeRaw(
          Prisma.sql`
            INSERT INTO ${submissionTable} ("id", "challengeId")
            VALUES (${submissionId}, ${data.challenge.id})
            ON CONFLICT ("id") DO NOTHING
          `
        )

        await reviewClient.$executeRaw(
          Prisma.sql`
            INSERT INTO ${reviewTable} ("id", "phaseId", "submissionId", "status")
            VALUES (${reviewId}, ${appealsChallengePhaseId}, ${submissionId}, ${'COMPLETED'})
            ON CONFLICT ("id") DO NOTHING
          `
        )

        await reviewClient.$executeRaw(
          Prisma.sql`
            INSERT INTO ${reviewItemTable} ("id", "reviewId")
            VALUES (${reviewItemId}, ${reviewId})
            ON CONFLICT ("id") DO NOTHING
          `
        )

        await reviewClient.$executeRaw(
          Prisma.sql`
            INSERT INTO ${reviewItemCommentTable} ("id", "reviewItemId")
            VALUES (${reviewItemCommentId}, ${reviewItemId})
            ON CONFLICT ("id") DO NOTHING
          `
        )

        await reviewClient.$executeRaw(
          Prisma.sql`
            INSERT INTO ${appealTable} ("id", "reviewItemCommentId")
            VALUES (${appealId}, ${reviewItemCommentId})
            ON CONFLICT ("id") DO NOTHING
          `
        )

        let caughtError
        try {
          await service.partiallyUpdateChallengePhase(
            authUser,
            data.challenge.id,
            appealsChallengePhaseId,
            { isOpen: false }
          )
        } catch (e) {
          caughtError = e
        }

        should.exist(caughtError)
        should.equal(caughtError.httpStatus || caughtError.statusCode, 400)
        should.equal(
          caughtError.message,
          "Appeals Response phase can't be closed because there are still appeals that haven't been responded to"
        )
      } finally {
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${appealTable} WHERE "id" = ${appealId}`
        )
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${reviewItemCommentTable} WHERE "id" = ${reviewItemCommentId}`
        )
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${reviewItemTable} WHERE "id" = ${reviewItemId}`
        )
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${reviewTable} WHERE "id" = ${reviewId}`
        )
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${submissionTable} WHERE "id" = ${submissionId}`
        )
        await prisma.challengePhase.delete({
          where: { id: appealsChallengePhaseId }
        })
        await prisma.phase.delete({
          where: { id: appealsPhaseId }
        })
      }
    })

    it('partially update challenge phase - unexpected field', async () => {
      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase1Id,
          { name: 'xx', other: 'xx' }
        )
      } catch (e) {
        should.equal(e.message.indexOf('"data.other" is not allowed') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - cannot open phase when predecessor is not closed', async () => {
      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: { isOpen: true }
      })

      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase2Id,
          { isOpen: true }
        )
      } catch (e) {
        should.equal(
          e.message,
          'Cannot open phase because predecessor phase must be closed with both actualStartDate and actualEndDate set'
        )
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - cannot open phase when predecessor has no actualEndDate', async () => {
      const startDate = new Date('2025-01-01T00:00:00.000Z')
      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: {
          isOpen: false,
          actualStartDate: startDate,
          actualEndDate: null
        }
      })

      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase2Id,
          { isOpen: true }
        )
      } catch (e) {
        should.equal(
          e.message,
          'Cannot open phase because predecessor phase must be closed with both actualStartDate and actualEndDate set'
        )
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - cannot open phase when predecessor has no actualStartDate', async () => {
      const endDate = new Date('2025-01-02T00:00:00.000Z')
      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: {
          isOpen: false,
          actualStartDate: null,
          actualEndDate: endDate
        }
      })

      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          data.challengePhase2Id,
          { isOpen: true }
        )
      } catch (e) {
        should.equal(
          e.message,
          'Cannot open phase because predecessor phase must be closed with both actualStartDate and actualEndDate set'
        )
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - can open phase when predecessor is properly closed', async () => {
      const startDate = new Date('2025-02-01T00:00:00.000Z')
      const endDate = new Date('2025-02-02T00:00:00.000Z')
      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: {
          isOpen: false,
          actualStartDate: startDate,
          actualEndDate: endDate
        }
      })
      await prisma.challengePhase.update({
        where: { id: data.challengePhase2Id },
        data: { isOpen: false }
      })

      const challengePhase = await service.partiallyUpdateChallengePhase(
        authUser,
        data.challenge.id,
        data.challengePhase2Id,
        { isOpen: true }
      )
      should.equal(challengePhase.isOpen, true)
    })

    it('partially update challenge phase - can open phase without predecessor', async () => {
      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: {
          isOpen: false,
          actualStartDate: null,
          actualEndDate: null
        }
      })

      const challengePhase = await service.partiallyUpdateChallengePhase(
        authUser,
        data.challenge.id,
        data.challengePhase1Id,
        { isOpen: true }
      )
      should.equal(challengePhase.isOpen, true)
    })

    it('partially update challenge phase - cannot open review phase without reviewer resource', async () => {
      const reviewPhase = await prisma.phase.create({
        data: {
          id: uuid(),
          name: 'Review',
          description: 'desc',
          isOpen: false,
          duration: 86400,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })
      const reviewChallengePhaseId = uuid()
      await prisma.challengePhase.create({
        data: {
          id: reviewChallengePhaseId,
          challengeId: data.challenge.id,
          phaseId: reviewPhase.id,
          name: 'Review',
          isOpen: false,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })

      const originalGetChallengeResources = helper.getChallengeResources
      const originalGetResourceRoles = helper.getResourceRoles
      helper.getChallengeResources = async () => [{ roleId: 'some-other-role-id' }]
      helper.getResourceRoles = async () => [{ id: 'reviewer-role-id', name: 'Reviewer' }]

      try {
        await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          reviewChallengePhaseId,
          { isOpen: true }
        )
      } catch (e) {
        should.equal(e.httpStatus || e.statusCode, 400)
        should.equal(
          e.message,
          'Cannot open Review phase because the challenge does not have any resource with the Reviewer role'
        )
        return
      } finally {
        helper.getChallengeResources = originalGetChallengeResources
        helper.getResourceRoles = originalGetResourceRoles
        await prisma.challengePhase.delete({ where: { id: reviewChallengePhaseId } })
        await prisma.phase.delete({ where: { id: reviewPhase.id } })
      }

      throw new Error('should not reach here')
    })

    it('partially update challenge phase - opens approval phase without approver resource for AI_ONLY challenges', async () => {
      const approvalPhase = await prisma.phase.create({
        data: {
          id: uuid(),
          name: 'Approval',
          description: 'desc',
          isOpen: false,
          duration: 86400,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })
      const approvalChallengePhaseId = uuid()
      await prisma.challengePhase.create({
        data: {
          id: approvalChallengePhaseId,
          challengeId: data.challenge.id,
          phaseId: approvalPhase.id,
          name: 'Approval',
          isOpen: false,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })

      const originalGetAIReviewConfigByChallengeId = helper.getAIReviewConfigByChallengeId
      const originalGetChallengeResources = helper.getChallengeResources
      const originalGetResourceRoles = helper.getResourceRoles
      helper.getAIReviewConfigByChallengeId = async () => ({ mode: 'AI_ONLY' })
      helper.getChallengeResources = async () => []
      helper.getResourceRoles = async () => [{ id: 'approver-role-id', name: 'Approver' }]

      try {
        const challengePhase = await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          approvalChallengePhaseId,
          { isOpen: true }
        )
        should.equal(challengePhase.isOpen, true)
      } finally {
        helper.getAIReviewConfigByChallengeId = originalGetAIReviewConfigByChallengeId
        helper.getChallengeResources = originalGetChallengeResources
        helper.getResourceRoles = originalGetResourceRoles
        await prisma.challengePhase.delete({ where: { id: approvalChallengePhaseId } })
        await prisma.phase.delete({ where: { id: approvalPhase.id } })
      }
    })

    it('partially update challenge phase - opens marathon match review phase without reviewer resource', async () => {
      const reviewPhase = await prisma.phase.create({
        data: {
          id: uuid(),
          name: 'Review',
          description: 'desc',
          isOpen: false,
          duration: 86400,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })
      const reviewChallengePhaseId = uuid()
      await prisma.challengePhase.create({
        data: {
          id: reviewChallengePhaseId,
          challengeId: data.marathonMatchChallenge.id,
          phaseId: reviewPhase.id,
          name: 'Review',
          isOpen: false,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })

      const originalGetChallengeResources = helper.getChallengeResources
      const originalGetResourceRoles = helper.getResourceRoles
      helper.getChallengeResources = async () => [{ roleId: 'some-other-role-id' }]
      helper.getResourceRoles = async () => {
        throw new Error('resource role lookup should not be required for Marathon Match Review')
      }

      try {
        const challengePhase = await service.partiallyUpdateChallengePhase(
          authUser,
          data.marathonMatchChallenge.id,
          reviewChallengePhaseId,
          { isOpen: true }
        )
        should.equal(challengePhase.isOpen, true)
      } finally {
        helper.getChallengeResources = originalGetChallengeResources
        helper.getResourceRoles = originalGetResourceRoles
        await prisma.challengePhase.delete({ where: { id: reviewChallengePhaseId } })
        await prisma.phase.delete({ where: { id: reviewPhase.id } })
      }
    })

    it('partially update challenge phase - opens review phase when reviewer resource exists', async () => {
      const reviewPhase = await prisma.phase.create({
        data: {
          id: uuid(),
          name: 'Review',
          description: 'desc',
          isOpen: false,
          duration: 86400,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })
      const reviewChallengePhaseId = uuid()
      await prisma.challengePhase.create({
        data: {
          id: reviewChallengePhaseId,
          challengeId: data.challenge.id,
          phaseId: reviewPhase.id,
          name: 'Review',
          isOpen: false,
          createdBy: 'admin',
          updatedBy: 'admin'
        }
      })

      const originalGetChallengeResources = helper.getChallengeResources
      const originalGetResourceRoles = helper.getResourceRoles
      helper.getChallengeResources = async () => [
        {
          roleId: 'reviewer-role-id',
          resourceRole: { name: 'Reviewer' }
        }
      ]
      helper.getResourceRoles = async () => [{ id: 'reviewer-role-id', name: 'Reviewer' }]

      try {
        const challengePhase = await service.partiallyUpdateChallengePhase(
          authUser,
          data.challenge.id,
          reviewChallengePhaseId,
          { isOpen: true }
        )
        should.equal(challengePhase.isOpen, true)
      } finally {
        helper.getChallengeResources = originalGetChallengeResources
        helper.getResourceRoles = originalGetResourceRoles
        await prisma.challengePhase.delete({ where: { id: reviewChallengePhaseId } })
        await prisma.phase.delete({ where: { id: reviewPhase.id } })
      }
    })
  })

  describe('delete challenge phase tests', () => {
    it('delete challenge phase blocks editor without challenge modify access', async () => {
      await resetPrimaryChallengePhases()

      try {
        await service.deleteChallengePhase(
          { handle: 'blocked-editor', roles: ['Connect Manager'], userId: 'blocked-editor' },
          data.challenge.id,
          data.challengePhase1Id
        )
      } catch (e) {
        should.equal(e.name, 'ForbiddenError')
        const challengePhase = await prisma.challengePhase.findUnique({
          where: { id: data.challengePhase1Id }
        })
        should.exist(challengePhase)
        return
      }
      throw new Error('should not reach here')
    })

    it('delete challenge phase successfully', async () => {
      await resetPrimaryChallengePhases()

      const phases = await service.getAllChallengePhases(data.challenge.id)
      await service.deleteChallengePhase(authUser, data.challenge.id, data.challengePhase1Id)
      const remainingPhases = await service.getAllChallengePhases(data.challenge.id)
      should.equal(phases.length - remainingPhases.length, 1)
    })

    it('delete challenge phase - not found', async () => {
      try {
        await service.deleteChallengePhase(authUser, data.taskChallenge.id, data.challengePhase1Id)
      } catch (e) {
        should.equal(
          e.message,
          `ChallengePhase with challengeId: ${data.taskChallenge.id},  phaseId: ${data.challengePhase1Id} doesn't exist`
        )
        return
      }
      throw new Error('should not reach here')
    })

    it('delete challenge phase - invalid challenge id', async () => {
      try {
        await service.deleteChallengePhase(authUser, 'invalid', data.challengePhase1Id)
      } catch (e) {
        should.equal(e.message.indexOf('"challengeId" must be a valid GUID') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('delete challenge phase - invalid phase id', async () => {
      try {
        await service.deleteChallengePhase(authUser, data.taskChallenge.id, 'invalid')
      } catch (e) {
        should.equal(e.message.indexOf('"id" must be a valid GUID') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })
  })
})
