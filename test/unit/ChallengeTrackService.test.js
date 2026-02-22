/*
 * Unit tests of challenge track service
 */

require('../../app-bootstrap')
const { v4: uuid } = require('uuid')
const chai = require('chai')

const service = require('../../src/services/ChallengeTrackService')
const prisma = require('../../src/common/prisma').getClient()

const should = chai.should()

describe('challenge track service unit tests', () => {
  let originalFindMany
  let originalCreate
  let originalFindUnique
  let originalUpdate

  beforeEach(() => {
    originalFindMany = prisma.challengeTrack.findMany
    originalCreate = prisma.challengeTrack.create
    originalFindUnique = prisma.challengeTrack.findUnique
    originalUpdate = prisma.challengeTrack.update
  })

  afterEach(() => {
    prisma.challengeTrack.findMany = originalFindMany
    prisma.challengeTrack.create = originalCreate
    prisma.challengeTrack.findUnique = originalFindUnique
    prisma.challengeTrack.update = originalUpdate
  })

  it('create challenge track - accepts DEVELOP alias', async () => {
    let createdPayload
    prisma.challengeTrack.findMany = async () => []
    prisma.challengeTrack.create = async ({ data }) => {
      createdPayload = data
      return {
        id: uuid(),
        name: data.name,
        description: data.description || null,
        isActive: data.isActive,
        abbreviation: data.abbreviation,
        legacyId: data.legacyId || null,
        track: data.track,
        createdAt: new Date(),
        createdBy: data.createdBy,
        updatedAt: new Date(),
        updatedBy: data.updatedBy
      }
    }

    const result = await service.createChallengeTrack({ userId: 'test-user' }, {
      name: `track-${Date.now()}`,
      isActive: true,
      abbreviation: `abbr-${Date.now()}`,
      track: 'DEVELOP'
    })

    should.equal(createdPayload.track, 'DEVELOPMENT')
    should.equal(result.track, 'DEVELOPMENT')
  })

  it('search challenge tracks - accepts QA alias', async () => {
    let receivedFilter
    prisma.challengeTrack.findMany = async ({ where }) => {
      receivedFilter = where
      return []
    }

    const result = await service.searchChallengeTracks({
      page: 1,
      perPage: 10,
      track: 'QA'
    })

    should.equal(result.total, 0)
    should.equal(receivedFilter.track.equals, 'QUALITY_ASSURANCE')
  })

  it('partially update challenge track - accepts QA alias', async () => {
    let updatedPayload
    const id = uuid()
    prisma.challengeTrack.findUnique = async () => ({
      id,
      name: 'Design',
      description: null,
      isActive: true,
      abbreviation: 'DS',
      legacyId: null,
      track: 'DESIGN',
      createdAt: new Date(),
      createdBy: 'seed-user',
      updatedAt: new Date(),
      updatedBy: 'seed-user'
    })
    prisma.challengeTrack.findMany = async () => []
    prisma.challengeTrack.update = async ({ data }) => {
      updatedPayload = data
      return {
        id,
        ...data,
        createdAt: new Date(),
        createdBy: 'seed-user',
        updatedAt: new Date(),
        updatedBy: data.updatedBy
      }
    }

    const result = await service.partiallyUpdateChallengeTrack({ userId: 'test-user' }, id, {
      track: 'QA'
    })

    should.equal(updatedPayload.track, 'QUALITY_ASSURANCE')
    should.equal(result.track, 'QUALITY_ASSURANCE')
  })
})
