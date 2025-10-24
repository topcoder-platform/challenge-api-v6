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
const helper = require('../../src/common/helper')
const testHelper = require('../testHelper')

const should = chai.should()

describe('challenge phase service unit tests', () => {
  let data
  const authUser = { userId: 'testuser' }
  const reviewSchema = config.get('REVIEW_DB_SCHEMA')
  const reviewTable = Prisma.raw(`"${reviewSchema}"."review"`)
  const submissionTable = Prisma.raw(`"${reviewSchema}"."submission"`)
  const reviewItemTable = Prisma.raw(`"${reviewSchema}"."reviewItem"`)
  const reviewItemCommentTable = Prisma.raw(`"${reviewSchema}"."reviewItemComment"`)
  const appealTable = Prisma.raw(`"${reviewSchema}"."appeal"`)
  let reviewClient
  const shortId = () => uuid().replace(/-/g, '').slice(0, 14)
  before(async () => {
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
  })

  after(async () => {
    if (reviewClient) {
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

    it('partially update challenge phase - closing sets actual end date', async () => {
      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: { isOpen: true, actualStartDate: new Date(), actualEndDate: null }
      })

      const before = new Date()
      const challengePhase = await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, {
        isOpen: false
      })
      const after = new Date()

      should.equal(challengePhase.isOpen, false)
      should.exist(challengePhase.actualEndDate)
      const actualEndMs = new Date(challengePhase.actualEndDate).getTime()
      actualEndMs.should.be.at.least(before.getTime())
      actualEndMs.should.be.at.most(after.getTime())
    })

    it('partially update challenge phase - reopening clears actual end date and sets start date', async () => {
      const previousEndDate = new Date()
      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: { isOpen: false, actualEndDate: previousEndDate }
      })

      const before = new Date()
      const challengePhase = await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, {
        isOpen: true
      })
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

      const challengePhase = await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, {
        isOpen: true
      })

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
          predecessor: null
        }
      })

      try {
        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, {
          isOpen: true
        })
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
            predecessor: data.challengePhase1Id
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
        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, {
          isOpen: true
        })
      } catch (e) {
        should.equal(e.httpStatus || e.statusCode, 400)
        should.equal(
          e.message,
          "Cannot reopen Registration because the currently open phase 'Review' has reviews in progress or completed"
        )
        return
      } finally {
        await reviewClient.$executeRaw(Prisma.sql`DELETE FROM ${reviewTable} WHERE "id" = ${reviewId}`)
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

      try {
        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, reviewChallengePhaseId, {
          isOpen: true
        })
      } catch (e) {
        should.equal(e.httpStatus || e.statusCode, 403)
        should.equal(
          e.message,
          'Cannot reopen Review because submitted appeals already exist in the Appeals phase'
        )
        return
      } finally {
        await reviewClient.$executeRaw(Prisma.sql`DELETE FROM ${appealTable} WHERE "id" = ${appealId}`)
        await reviewClient.$executeRaw(
          Prisma.sql`DELETE FROM ${reviewItemCommentTable} WHERE "id" = ${reviewItemCommentId}`
        )
        await reviewClient.$executeRaw(Prisma.sql`DELETE FROM ${reviewItemTable} WHERE "id" = ${reviewItemId}`)
        await reviewClient.$executeRaw(Prisma.sql`DELETE FROM ${reviewTable} WHERE "id" = ${reviewId}`)
        await reviewClient.$executeRaw(Prisma.sql`DELETE FROM ${submissionTable} WHERE "id" = ${submissionId}`)
        await prisma.challengePhase.deleteMany({
          where: { id: { in: [appealsChallengePhaseId, reviewChallengePhaseId] } }
        })
        await prisma.phase.deleteMany({ where: { id: { in: [appealsPhase.id, reviewPhase.id] } } })
      }

      throw new Error('should not reach here')
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

    it('partially update challenge phase - cannot open phase when predecessor is not closed', async () => {
      await prisma.challengePhase.update({
        where: { id: data.challengePhase1Id },
        data: { isOpen: true }
      })

      try {
        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase2Id, { isOpen: true })
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
        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase2Id, { isOpen: true })
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
        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase2Id, { isOpen: true })
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

      const challengePhase = await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase2Id, { isOpen: true })
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

      const challengePhase = await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, data.challengePhase1Id, { isOpen: true })
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
      helper.getChallengeResources = async () => ([
        { roleId: 'some-other-role-id' }
      ])
      helper.getResourceRoles = async () => ([
        { id: 'reviewer-role-id', name: 'Reviewer' }
      ])

      try {
        await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, reviewChallengePhaseId, { isOpen: true })
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
      helper.getChallengeResources = async () => ([
        {
          roleId: 'reviewer-role-id',
          resourceRole: { name: 'Reviewer' }
        }
      ])
      helper.getResourceRoles = async () => ([
        { id: 'reviewer-role-id', name: 'Reviewer' }
      ])

      try {
        const challengePhase = await service.partiallyUpdateChallengePhase(authUser, data.challenge.id, reviewChallengePhaseId, { isOpen: true })
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
