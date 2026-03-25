const chai = require('chai')

const axios = require('axios')
const m2mHelper = require('../../src/common/m2m-helper')
const projectHelper = require('../../src/common/project-helper')

chai.should()

describe('project helper unit tests', () => {
  let originalAxiosGet
  let originalGetM2MToken

  beforeEach(() => {
    originalAxiosGet = axios.get
    originalGetM2MToken = m2mHelper.getM2MToken
  })

  afterEach(() => {
    axios.get = originalAxiosGet
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
})
