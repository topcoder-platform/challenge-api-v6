/*
 * Unit tests for ChallengePhaseService
 */
if (!process.env.REVIEW_DB_URL && process.env.DATABASE_URL) {
  process.env.REVIEW_DB_URL = process.env.DATABASE_URL
}

require('../../app-bootstrap')
const chai = require('chai')
const config = require('config')
const { Prisma } = require('@prisma/client')
const uuid = require('uuid/v4')
const { getReviewClient } = require('../../src/common/review-prisma')
const prisma = require('../../src/common/prisma').getClient()
const service = require('../../src/services/ChallengePhaseService')
const testHelper = require('../testHelper')

const should = chai.should()

describe('challenge phase service unit tests', () => {
  let data
  const authUser = { userId: 'testuser' }
  const reviewSchema = config.get('REVIEW_DB_SCHEMA')
  const reviewTable = Prisma.raw(`"${reviewSchema}"."review"`)
  let reviewClient
  before(async () => {
    await testHelper.createData()
    data = testHelper.getData()
    reviewClient = getReviewClient()
    await reviewClient.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${reviewSchema}"`)
    await reviewClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${reviewSchema}"."review" (
        "id" varchar(36) PRIMARY KEY,
        "phaseId" varchar(255) NOT NULL,
        "status" varchar(32),
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now()
      )
    `)
  })

  after(async () => {
    if (reviewClient) {
      await reviewClient.$executeRawUnsafe(`TRUNCATE TABLE "${reviewSchema}"."review"`)
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
      const result = await service.getAllChallengePhases(challengeId)
      should.equal(result.length, 0)
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
        await service.getChallengePhase(data.taskChallenge.id, data.challengePhase2Id)
      } catch (e) {
        should.equal(e.message, `ChallengePhase with challengeId: ${data.taskChallenge.id},  phaseId: ${data.challengePhase2Id} doesn't exist`)
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
    it('partially update challenge phase successfully', async function () {
      this.timeout(50000)
      const scheduledStartDate = '2025-01-01T00:00:00.000Z'
      const expectedScheduledEndDate = new Date(new Date(scheduledStartDate).getTime() + 7200 * 1000).toISOString()
      const challengePhase = await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, {
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
      })
      should.equal(challengePhase.name, 'updated-Registration')
      should.equal(challengePhase.duration, 7200)
      should.equal(challengePhase.isOpen, true)
      should.equal(new Date(challengePhase.scheduledStartDate).toISOString(), scheduledStartDate)
      should.equal(new Date(challengePhase.scheduledEndDate).toISOString(), expectedScheduledEndDate)
    })

    it('partially update challenge phase - reopening clears actual end date', async () => {
      const previousEndDate = new Date()
      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: { isOpen: false, actualEndDate: previousEndDate }
      })

      const challengePhase = await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, {
        isOpen: true
      })
      should.equal(challengePhase.isOpen, true)
      should.equal(challengePhase.actualEndDate, null)
    })

    it('partially update challenge phase - not found', async () => {
      try {
        await service.partiallyUpdateChallengePhase(authUser, data.taskChallenge.id, data.challengePhase2Id, { name: 'updated', duration: 7200 })
      } catch (e) {
        should.equal(e.message, `ChallengePhase with challengeId: ${data.taskChallenge.id},  phaseId: ${data.challengePhase2Id} doesn't exist`)
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - phaseId does not exist', async () => {
      try {
        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, { name: 'updated', phaseId: data.challenge.id, isOpen: null })
      } catch (e) {
        should.equal(e.message, 'phaseId should be a valid phase')
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - predecessor does not exist', async () => {
      try {
        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, { name: 'updated', predecessor: data.challenge.id })
      } catch (e) {
        should.equal(e.message, `predecessor should be a valid phase in the same challenge: ${data.challenge.id}`)
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - scheduledStartDate should not be after scheduledEndDate', async () => {
      const startDate = '2025-04-04T04:38:00.000Z'
      const endDate = '2025-04-03T04:38:00.000Z'
      try {
        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, { name: 'updated', scheduledStartDate: startDate, scheduledEndDate: endDate })
      } catch (e) {
        should.equal(e.message, `scheduledStartDate: ${startDate} should not be after scheduledEndDate: ${endDate}`)
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - actualStartDate should not be after scheduledEndDate', async () => {
      const startDate = '2025-04-04T04:38:00.000Z'
      const endDate = '2025-04-03T04:38:00.000Z'
      try {
        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, { name: 'updated', actualStartDate: startDate, actualEndDate: endDate })
      } catch (e) {
        should.equal(e.message, `actualStartDate: ${startDate} should not be after actualEndDate: ${endDate}`)
        return
      }
      throw new Error('should not reach here')
    })

    it('partially update challenge phase - constraint is not exists for the ChallengePhase', async () => {
      try {
        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, {
          name: 'updated',
          constraints: [{
            id: data.challenge.id,
            name: 't1',
            value: 100
          }]
        })
      } catch (e) {
        should.equal(e.message, `constraint: ${data.challenge.id} is not exists for the ChallengePhase`)
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

        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, {
          isOpen: false
        })
      } catch (e) {
        caughtError = e
      } finally {
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${reviewTable} WHERE "id" = ${reviewId}`
        )
      }

      should.exist(caughtError)
      should.equal(caughtError.httpStatus || caughtError.statusCode, 403)
      should.equal(caughtError.message, 'Cannot close Registration because there are still pending scorecards')
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

        const challengePhase = await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, {
          isOpen: false
        })
        should.equal(challengePhase.isOpen, false)
      } finally {
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${reviewTable} WHERE "id" = ${reviewId}`
        )
      }
    })

    it('partially update challenge phase - unexpected field', async () => {
      try {
        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, { name: 'xx', other: 'xx' })
      } catch (e) {
        should.equal(e.message.indexOf('"other" is not allowed') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })
  })

  describe('delete challenge phase tests', () => {
    it('delete challenge phase successfully', async () => {
      const phases = await service.getAllChallengePhases(data.challenge.id)
      await service.deleteChallengePhase(authUser, data.challenge.id, data.challengePhase1Id)
      const remainingPhases = await service.getAllChallengePhases(data.challenge.id)
      should.equal(phases.length - remainingPhases.length, 1)
    })

    it('delete challenge phase - not found', async () => {
      try {
        await service.deleteChallengePhase(authUser, data.taskChallenge.id, data.challengePhase1Id)
      } catch (e) {
        should.equal(e.message, `ChallengePhase with challengeId: ${data.taskChallenge.id},  phaseId: ${data.challengePhase1Id} doesn't exist`)
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
