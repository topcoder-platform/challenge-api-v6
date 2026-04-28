const chai = require('chai')

const axios = require('axios')
const m2mHelper = require('../../src/common/m2m-helper')
const projectHelper = require('../../src/common/project-helper')

chai.should()

describe('project helper unit tests', () => {
  let originalAxiosGet
  let originalAxiosPatch
  let originalGetM2MToken

  beforeEach(() => {
    originalAxiosGet = axios.get
    originalAxiosPatch = axios.patch
    originalGetM2MToken = m2mHelper.getM2MToken
  })

  afterEach(() => {
    axios.get = originalAxiosGet
    axios.patch = originalAxiosPatch
    m2mHelper.getM2MToken = originalGetM2MToken
  })

  it('preserves decimal billing markup returned by projects api', async () => {
    m2mHelper.getM2MToken = async () => 'test-token'
    axios.get = async () => ({
      status: 200,
      data: {
        tcBillingAccountId: '80004217',
        markup: 0.58
      }
    })

    const result = await projectHelper.getProjectBillingInformation(123)

    result.should.deep.equal({
      billingAccountId: '80004217',
      markup: 0.58
    })
  })

  it('converts legacy whole-percentage billing markup to decimal format', async () => {
    m2mHelper.getM2MToken = async () => 'test-token'
    axios.get = async () => ({
      status: 200,
      data: {
        tcBillingAccountId: '80004217',
        markup: 58
      }
    })

    const result = await projectHelper.getProjectBillingInformation(123)

    result.should.deep.equal({
      billingAccountId: '80004217',
      markup: 0.58
    })
  })

  it('locks challenge billing account budget with markup applied', async () => {
    let patchUrl
    let patchBody
    let patchHeaders

    m2mHelper.getM2MToken = async () => 'test-token'
    axios.patch = async (url, body, options) => {
      patchUrl = url
      patchBody = body
      patchHeaders = options.headers

      return {
        data: {
          externalId: body.externalId,
          amount: body.amount
        }
      }
    }

    const result = await projectHelper.lockChallengeBillingAccountAmount({
      billingAccountId: '80001012',
      challengeId: 'challenge-id',
      memberPaymentAmount: 1000,
      markup: 0.1
    })

    patchUrl.should.equal('http://localhost:4000/v6/billing-accounts/80001012/lock-amount')
    patchBody.should.deep.equal({
      amount: 1100,
      challengeId: 'challenge-id',
      externalId: 'challenge-id',
      externalType: 'CHALLENGE'
    })
    patchHeaders.should.deep.equal({ Authorization: 'Bearer test-token' })
    result.should.deep.equal({
      externalId: 'challenge-id',
      amount: 1100
    })
  })
})
