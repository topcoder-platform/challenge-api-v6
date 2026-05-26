const chai = require('chai')

const challengeHelper = require('../../src/common/challenge-helper')

chai.should()

describe('challenge response helper', () => {
  it('enriches submission dates from the standard Submission phase', () => {
    const submissionStartDate = '2026-05-22T08:00:00.000Z'
    const submissionEndDate = '2026-05-27T08:00:00.000Z'
    const challenge = {
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
    }

    challengeHelper.enrichChallengeForResponse(challenge)

    challenge.submissionStartDate.should.equal(submissionStartDate)
    challenge.submissionEndDate.should.equal(submissionEndDate)
  })
})
