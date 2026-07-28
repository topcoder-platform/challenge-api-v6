const chai = require('chai')

const prismaHelper = require('../../src/common/prisma-helper')

chai.should()

describe('prisma helper unit tests', () => {
  it('preserves the registered-member winning download flag for metadata persistence', () => {
    const result = prismaHelper.convertChallengeSchemaToPrisma(
      { userId: 'test-user' },
      {
        metadata: [
          {
            name: 'allowAllRegistrantsToDownloadWinningSubmissions',
            value: 'true'
          }
        ]
      }
    )

    result.metadata.create.should.deep.equal([
      {
        name: 'allowAllRegistrantsToDownloadWinningSubmissions',
        value: 'true',
        createdBy: 'test-user',
        updatedBy: 'test-user'
      }
    ])
  })

  it('derives submission dates from the standard Submission phase', () => {
    const result = {}
    const submissionStartDate = '2026-05-22T08:00:00.000Z'
    const submissionEndDate = '2026-05-27T08:00:00.000Z'

    prismaHelper.convertChallengePhaseSchema(
      {
        phases: [
          {
            name: 'Registration',
            phaseId: 'registration-phase',
            scheduledEndDate: '2026-05-27T08:00:00.000Z',
            scheduledStartDate: '2026-05-22T08:00:00.000Z'
          },
          {
            name: 'Submission',
            phaseId: 'submission-phase',
            scheduledEndDate: submissionEndDate,
            scheduledStartDate: submissionStartDate
          }
        ]
      },
      result,
      {
        createdBy: 'test-user',
        updatedBy: 'test-user'
      }
    )

    result.submissionStartDate.should.equal(submissionStartDate)
    result.submissionEndDate.should.equal(submissionEndDate)
  })
})
