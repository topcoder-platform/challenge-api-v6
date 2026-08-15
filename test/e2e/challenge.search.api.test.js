/*
 * Focused E2E coverage for the unified challenge opportunity search contract.
 */

require('../../app-bootstrap')
const { v4: uuid } = require('uuid')
const chai = require('chai')
const { request } = require('chai-http')
const config = require('config')
const app = require('../../app')
const helper = require('../../src/common/helper')
const testHelper = require('../testHelper')
const { getClient, ChallengeStatusEnum } = require('../../src/common/prisma')

const should = chai.should()
const prisma = getClient()
const basePath = `/${config.API_VERSION}/challenges`

describe('challenge unified search API E2E tests', () => {
  let data
  let originalGetStandSkills
  let originalSearchStandSkills

  before(async () => {
    originalGetStandSkills = helper.getStandSkills
    originalSearchStandSkills = helper.searchStandSkills
    helper.searchStandSkills = async () => []
    await testHelper.createData()
    data = testHelper.getData()
  })

  after(async () => {
    helper.getStandSkills = originalGetStandSkills
    helper.searchStandSkills = originalSearchStandSkills
    await testHelper.clearData()
  })

  it('searches tags and skill names before calculating pagination headers', async () => {
    const searchToken = `unifiede2e${Date.now()}`
    const skillId = uuid()
    const searchableChallenges = [
      {
        id: uuid(),
        name: 'A Tag Only',
        tags: [`prefix-${searchToken.toUpperCase()}-suffix`]
      },
      {
        id: uuid(),
        name: 'B Skill Only',
        tags: [],
        skillId
      },
      {
        id: uuid(),
        name: 'C No Match',
        tags: []
      }
    ]

    helper.searchStandSkills = async term => {
      should.equal(term, searchToken)
      return [{ id: skillId, name: searchToken }]
    }
    helper.getStandSkills = async ids => ids.map(id => ({ id, name: searchToken }))

    try {
      for (const challenge of searchableChallenges) {
        await prisma.challenge.create({
          data: {
            id: challenge.id,
            name: challenge.name,
            description: 'unrelated',
            privateDescription: 'unified-search-e2e',
            challengeSource: 'Topcoder',
            descriptionFormat: 'html',
            timelineTemplate: { connect: { id: data.timelineTemplate.id } },
            type: { connect: { id: data.challenge.typeId } },
            track: { connect: { id: data.challenge.trackId } },
            tags: challenge.tags,
            groups: [],
            status: ChallengeStatusEnum.ACTIVE,
            createdBy: 'unified-search-e2e',
            updatedBy: 'unified-search-e2e',
            ...(challenge.skillId
              ? {
                  skills: {
                    create: {
                      skillId: challenge.skillId,
                      createdBy: 'unified-search-e2e',
                      updatedBy: 'unified-search-e2e'
                    }
                  }
                }
              : {})
          }
        })
      }

      const response = await request.execute(app)
        .get(basePath)
        .set('Authorization', `Bearer ${config.M2M_READ_ACCESS_TOKEN}`)
        .query({
          search: searchToken,
          sortBy: 'name',
          sortOrder: 'asc',
          page: 2,
          perPage: 1
        })

      should.equal(response.status, 200)
      should.equal(response.headers['x-page'], '2')
      should.equal(response.headers['x-per-page'], '1')
      should.equal(response.headers['x-total'], '2')
      should.equal(response.headers['x-total-pages'], '2')
      should.equal(response.body.length, 1)
      should.equal(response.body[0].name, 'B Skill Only')
      response.body[0].skills.should.deep.equal([{ id: skillId, name: searchToken }])
    } finally {
      helper.searchStandSkills = async () => []
      helper.getStandSkills = originalGetStandSkills
      await prisma.challenge.deleteMany({
        where: { id: { in: searchableChallenges.map(challenge => challenge.id) } }
      })
    }
  }).timeout(20000)
})
