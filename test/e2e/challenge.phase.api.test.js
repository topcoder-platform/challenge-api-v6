/*
 * E2E tests of challenge phase API
 */

require('../../app-bootstrap')
const config = require('config')
const { v4: uuid } = require('uuid');
const chai = require('chai')
const chaiHttp = require('chai-http')
const app = require('../../app')
const testHelper = require('../testHelper')

const should = chai.should()
chai.use(chaiHttp)

const basePath = `/${config.API_VERSION}/challenges`

describe('challenge phase API E2E tests', () => {
  let data
  before(async () => {
    await testHelper.createData()
    data = testHelper.getData()
  })

  after(async () => {
    await testHelper.clearData()
  })

  describe('get all challenge phases API tests', () => {
    it('get all challenge phases successfully 1', async () => {
      const response = await chai.request(app)
        .get(`${basePath}/${data.challenge.id}/phases`)
      should.equal(response.status, 200)
      const result = response.body
      should.equal(result.length, 2)
      should.equal(result[0].challengeId, data.challenge.id)
      should.equal(result[0].name, 'Registration')
      should.equal(result[0].duration, 1000)
      should.equal(result[0].phase.id, data.phase.id)
      should.equal(result[0].constraints[0].name, 'constraint-name-1')
      should.equal(result[0].constraints[0].value, 100)
      should.equal(result[1].challengeId, data.challenge.id)
      should.equal(result[1].name, 'Submission')
      should.equal(result[1].duration, 2000)
      should.equal(result[1].phase.id, data.phase2.id)
      should.equal(result[1].constraints[0].name, 'constraint-name-2')
      should.equal(result[1].constraints[0].value, 200)
    })

    it('get all challenge phases successfully 2', async () => {
      const response = await chai.request(app)
        .get(`${basePath}/${data.taskChallenge.id}/phases`)
      should.equal(response.status, 200)
      const result = response.body
      should.equal(result.length, 0)
    })

    it('get all challenge phases - invalid challengeId', async () => {
      const response = await chai.request(app)
        .get(`${basePath}/invalid/phases`)
      should.equal(response.status, 400)
      const result = response.body
      should.equal(result.message, '"challengeId" must be a valid GUID')
    })
  })

  describe('get challenge phase API tests', () => {
    it('get challenge phase successfully', async () => {
      const response = await chai.request(app)
        .get(`${basePath}/${data.challenge.id}/phases/${data.challengePhase1Id}`)
      should.equal(response.status, 200)
      const result = response.body
      should.equal(result.challengeId, data.challenge.id)
      should.equal(result.name, 'Registration')
      should.equal(result.duration, 1000)
      should.equal(result.phase.id, data.phase.id)
      should.equal(result.constraints[0].name, 'constraint-name-1')
      should.equal(result.constraints[0].value, 100)
    })

    it('get challenge phase - not found', async () => {
      const response = await chai.request(app)
        .get(`${basePath}/${data.taskChallenge.id}/phases/${data.challengePhase2Id}`)
      should.equal(response.status, 404)
      const result = response.body
      should.equal(result.message, `ChallengePhase with challengeId: ${data.taskChallenge.id},  phaseId: ${data.challengePhase2Id} doesn't exist`)
    })

    it('get challenge phase - invalid challenge id', async () => {
      const response = await chai.request(app)
        .get(`${basePath}/invalid/phases/${data.challengePhase2Id}`)
      should.equal(response.status, 400)
      const result = response.body
      should.equal(result.message, '"challengeId" must be a valid GUID')
    })

    it('get challenge phase - invalid phase id', async () => {
      const response = await chai.request(app)
        .get(`${basePath}/${data.taskChallenge.id}/phases/invalid`)
      should.equal(response.status, 400)
      const result = response.body
      should.equal(result.message, '"id" must be a valid GUID')
    })
  })

  describe('partially update challenge phase API tests', () => {
    it('partially update challenge phase successfully', async function () {
      this.timeout(50000)
      const response = await chai.request(app)
        .patch(`${basePath}/${data.challenge.id}/phases/${data.challengePhase1Id}`)
        .set('Authorization', `Bearer ${data.adminToken}`)
        .send({
          name: 'updated-Registration',
          isOpen: true,
          duration: 7200,
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
      should.equal(response.status, 200)
      const challengePhase = response.body
      should.equal(challengePhase.name, 'updated-Registration')
      should.equal(challengePhase.duration, 7200)
      should.equal(challengePhase.isOpen, true)
    })

    it('partially update challenge phase - not found', async () => {
      const response = await chai.request(app)
        .patch(`${basePath}/${data.taskChallenge.id}/phases/${data.challengePhase2Id}`)
        .set('Authorization', `Bearer ${data.adminToken}`)
        .send({ name: 'updated', duration: 7200 })
      should.equal(response.status, 404)
      const result = response.body
      should.equal(result.message, `ChallengePhase with challengeId: ${data.taskChallenge.id},  phaseId: ${data.challengePhase2Id} doesn't exist`)
    })

    it('partially update challenge phase - phaseId does not exist', async () => {
      const response = await chai.request(app)
        .patch(`${basePath}/${data.challenge.id}/phases/${data.challengePhase1Id}`)
        .set('Authorization', `Bearer ${data.adminToken}`)
        .send({ name: 'updated', phaseId: data.challenge.id, isOpen: null })
      should.equal(response.status, 400)
      const result = response.body
      should.equal(result.message, 'phaseId should be a valid phase')
    })

    it('partially update challenge phase - predecessor does not exist', async () => {
      const response = await chai.request(app)
        .patch(`${basePath}/${data.challenge.id}/phases/${data.challengePhase1Id}`)
        .set('Authorization', `Bearer ${data.adminToken}`)
        .send({ name: 'updated', predecessor: data.challenge.id })
      should.equal(response.status, 400)
      const result = response.body
      should.equal(result.message, `predecessor should be a valid phase in the same challenge: ${data.challenge.id}`)
    })

    it('partially update challenge phase - scheduledStartDate should not be after scheduledEndDate', async () => {
      const startDate = '2025-04-04T04:38:00.000Z'
      const endDate = '2025-04-03T04:38:00.000Z'
      const response = await chai.request(app)
        .patch(`${basePath}/${data.challenge.id}/phases/${data.challengePhase1Id}`)
        .set('Authorization', `Bearer ${data.adminToken}`)
        .send({ name: 'updated', scheduledStartDate: startDate, scheduledEndDate: endDate })
      should.equal(response.status, 400)
      const result = response.body
      should.equal(result.message, `scheduledStartDate: ${startDate} should not be after scheduledEndDate: ${endDate}`)
    })

    it('partially update challenge phase - actualStartDate should not be after scheduledEndDate', async () => {
      const startDate = '2025-04-04T04:38:00.000Z'
      const endDate = '2025-04-03T04:38:00.000Z'
      const response = await chai.request(app)
        .patch(`${basePath}/${data.challenge.id}/phases/${data.challengePhase1Id}`)
        .set('Authorization', `Bearer ${data.adminToken}`)
        .send({ name: 'updated', actualStartDate: startDate, actualEndDate: endDate })
      should.equal(response.status, 400)
      const result = response.body
      should.equal(result.message, `actualStartDate: ${startDate} should not be after actualEndDate: ${endDate}`)
    })

    it('partially update challenge phase - constraint is not exists for the ChallengePhase', async () => {
      const response = await chai.request(app)
        .patch(`${basePath}/${data.challenge.id}/phases/${data.challengePhase1Id}`)
        .set('Authorization', `Bearer ${data.adminToken}`)
        .send({
          name: 'updated',
          constraints: [{
            id: data.challenge.id,
            name: 't1',
            value: 100
          }]
        })
      should.equal(response.status, 400)
      const result = response.body
      should.equal(result.message, `constraint: ${data.challenge.id} is not exists for the ChallengePhase`)
    })

    it('partially update challenge phase - unexpected field', async () => {
      const response = await chai.request(app)
        .patch(`${basePath}/${data.challenge.id}/phases/${data.challengePhase1Id}`)
        .set('Authorization', `Bearer ${data.adminToken}`)
        .send({ name: 'xx', other: 'xx' })
      should.equal(response.status, 400)
      const result = response.body
      should.equal(result.message, '"other" is not allowed')
    })

    it('partially update phase - forbidden', async () => {
      const response = await chai.request(app)
        .patch(`${basePath}/${data.challenge.id}/phases/${data.challengePhase1Id}`)
        .set('Authorization', `Bearer ${data.userToken}`)
        .send({ name: 'udpated' })
      should.equal(response.status, 403)
      const result = response.body
      result.message.should.include('You are not allowed to perform this action')
    })
  })

  describe('remove challenge phase API tests', () => {
    it('delete challenge phase - forbidden', async () => {
      const response = await chai.request(app)
        .delete(`${basePath}/${data.challenge.id}/phases/${data.challengePhase1Id}`)
        .set('Authorization', `Bearer ${data.userToken}`)
      should.equal(response.status, 403)
      const result = response.body
      result.message.should.include('You are not allowed to perform this action')
    })

    it('delete challenge phase - not found', async () => {
      const response = await chai.request(app)
        .delete(`${basePath}/${data.taskChallenge.id}/phases/${data.challengePhase1Id}`)
        .set('Authorization', `Bearer ${data.adminToken}`)
      should.equal(response.status, 404)
      const result = response.body
      should.equal(result.message, `ChallengePhase with challengeId: ${data.taskChallenge.id},  phaseId: ${data.challengePhase1Id} doesn't exist`)
    })

    it('delete challenge phase - invalid challenge id', async () => {
      const response = await chai.request(app)
        .delete(`${basePath}/invalid/phases/${data.challengePhase1Id}`)
        .set('Authorization', `Bearer ${data.adminToken}`)
      should.equal(response.status, 400)
      const result = response.body
      should.equal(result.message, '"challengeId" must be a valid GUID')
    })

    it('delete challenge phase - invalid phase id', async () => {
      const response = await chai.request(app)
        .delete(`${basePath}/${data.taskChallenge.id}/phases/invalid`)
        .set('Authorization', `Bearer ${data.adminToken}`)
      should.equal(response.status, 400)
      const result = response.body
      should.equal(result.message, '"id" must be a valid GUID')
    })

    it('delete challenge phase successfully', async () => {
      const sourcePhaseRes = await chai.request(app)
        .get(`${basePath}/${data.challenge.id}/phases`)
      const sourcePhaseCount = sourcePhaseRes.body.length
      await chai.request(app)
        .delete(`${basePath}/${data.challenge.id}/phases/${data.challengePhase1Id}`)
        .set('Authorization', `Bearer ${data.adminToken}`)
      const afterDeletedRes = await chai.request(app)
        .get(`${basePath}/${data.challenge.id}/phases`)
      const afterDeletedPhaseCount = afterDeletedRes.body.length
      should.equal(sourcePhaseCount - afterDeletedPhaseCount, 1)
    })
  })
})
