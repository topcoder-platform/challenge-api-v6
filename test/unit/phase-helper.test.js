const chai = require('chai')

require('../../app-bootstrap')
const phaseHelper = require('../../src/common/phase-helper')

chai.should()

describe('phase helper unit tests', () => {
  const originalGetTemplateAndTemplateMap = phaseHelper.getTemplateAndTemplateMap
  const originalGetPhaseDefinitionsAndMap = phaseHelper.getPhaseDefinitionsAndMap

  afterEach(() => {
    phaseHelper.getTemplateAndTemplateMap = originalGetTemplateAndTemplateMap
    phaseHelper.getPhaseDefinitionsAndMap = originalGetPhaseDefinitionsAndMap
  })

  /**
   * Install phase/template lookup stubs for schedule recalculation tests.
   *
   * @param {Array<Object>} phaseDefinitions phase records returned by phase lookup.
   * @param {Array<Object>} templatePhases template phase records returned by timeline lookup.
   * @returns {undefined} mutates the shared helper singleton for the current test.
   */
  function stubPhaseLookups (phaseDefinitions, templatePhases) {
    const phaseDefinitionMap = new Map(phaseDefinitions.map((phase) => [phase.id, phase]))
    const timelineTemplateMap = new Map(templatePhases.map((phase) => [phase.phaseId, phase]))

    phaseHelper.getPhaseDefinitionsAndMap = async () => ({
      phaseDefinitionMap,
      phaseDefinitions
    })
    phaseHelper.getTemplateAndTemplateMap = async () => ({
      timelineTemplateMap,
      timelineTempate: templatePhases
    })
  }

  it('uses scheduled end dates from update payload when recalculating phases', async () => {
    const registrationPhaseId = 'registration-phase'
    const submissionPhaseId = 'submission-phase'
    const staleDuration = 24 * 60 * 60
    const registrationStartDate = '2026-05-26T05:14:00.000Z'
    const registrationEndDate = '2026-05-29T05:14:00.000Z'
    const submissionEndDate = '2026-06-02T05:14:00.000Z'

    stubPhaseLookups(
      [
        { id: registrationPhaseId, name: 'Registration', description: 'Registration phase' },
        { id: submissionPhaseId, name: 'Submission', description: 'Submission phase' }
      ],
      [
        { phaseId: registrationPhaseId, defaultDuration: staleDuration },
        {
          phaseId: submissionPhaseId,
          predecessor: registrationPhaseId,
          defaultDuration: staleDuration
        }
      ]
    )

    const updatedPhases = await phaseHelper.populatePhasesForChallengeUpdate(
      [
        {
          duration: staleDuration,
          name: 'Registration',
          phaseId: registrationPhaseId,
          scheduledStartDate: registrationStartDate,
          scheduledEndDate: '2026-05-27T05:14:00.000Z'
        },
        {
          duration: staleDuration,
          name: 'Submission',
          phaseId: submissionPhaseId,
          predecessor: registrationPhaseId,
          scheduledStartDate: '2026-05-27T05:14:00.000Z',
          scheduledEndDate: '2026-05-28T05:14:00.000Z'
        }
      ],
      [
        {
          duration: staleDuration,
          phaseId: registrationPhaseId,
          scheduledEndDate: registrationEndDate,
          scheduledStartDate: registrationStartDate
        },
        {
          duration: staleDuration,
          phaseId: submissionPhaseId,
          scheduledEndDate: submissionEndDate
        }
      ],
      'timeline-template-id',
      false
    )

    updatedPhases[0].scheduledEndDate.should.equal(registrationEndDate)
    updatedPhases[0].duration.should.equal(3 * 24 * 60 * 60)
    updatedPhases[1].scheduledStartDate.should.equal(registrationEndDate)
    updatedPhases[1].scheduledEndDate.should.equal(submissionEndDate)
    updatedPhases[1].duration.should.equal(4 * 24 * 60 * 60)
  })

  it('matches launched phase updates by challenge phase id before phase definition id', async () => {
    const sharedPhaseId = 'shared-registration-phase'
    const staleDuration = 120 * 60 * 60
    const firstPhaseStartDate = '2099-06-15T09:29:45.575Z'
    const secondPhaseStartDate = '2099-06-15T09:29:45.576Z'
    const firstPhaseEndDate = '2099-06-20T10:14:45.575Z'
    const secondPhaseEndDate = '2099-06-20T11:44:45.576Z'

    stubPhaseLookups(
      [{ id: sharedPhaseId, name: 'Registration', description: 'Registration phase' }],
      [{ phaseId: sharedPhaseId, defaultDuration: staleDuration }]
    )

    const updatedPhases = await phaseHelper.populatePhasesForChallengeUpdate(
      [
        {
          id: 'first-challenge-phase',
          duration: staleDuration,
          name: 'Registration',
          phaseId: sharedPhaseId,
          isOpen: true,
          scheduledStartDate: firstPhaseStartDate,
          scheduledEndDate: '2099-06-20T09:29:45.575Z',
          actualStartDate: firstPhaseStartDate,
          actualEndDate: null
        },
        {
          id: 'second-challenge-phase',
          duration: staleDuration,
          name: 'Registration',
          phaseId: sharedPhaseId,
          isOpen: true,
          scheduledStartDate: secondPhaseStartDate,
          scheduledEndDate: '2099-06-20T09:29:45.576Z',
          actualStartDate: secondPhaseStartDate,
          actualEndDate: null
        }
      ],
      [
        {
          id: 'first-challenge-phase',
          duration: staleDuration,
          phaseId: sharedPhaseId,
          scheduledEndDate: firstPhaseEndDate,
          scheduledStartDate: firstPhaseStartDate
        },
        {
          id: 'second-challenge-phase',
          duration: staleDuration,
          phaseId: sharedPhaseId,
          scheduledEndDate: secondPhaseEndDate,
          scheduledStartDate: secondPhaseStartDate
        }
      ],
      'timeline-template-id',
      false
    )

    const firstUpdatedPhase = updatedPhases.find((phase) => phase.id === 'first-challenge-phase')
    const secondUpdatedPhase = updatedPhases.find((phase) => phase.id === 'second-challenge-phase')

    firstUpdatedPhase.scheduledEndDate.should.equal(firstPhaseEndDate)
    firstUpdatedPhase.duration.should.equal(120 * 60 * 60 + 45 * 60)
    secondUpdatedPhase.scheduledEndDate.should.equal(secondPhaseEndDate)
    secondUpdatedPhase.duration.should.equal(122 * 60 * 60 + 15 * 60)
  })

  it('uses scheduled end dates from update payload for MM phases', async () => {
    const registrationPhaseId = 'mm-registration-phase'
    const submissionPhaseId = 'mm-submission-phase'
    const staleDuration = 12 * 60 * 60
    const registrationStartDate = '2026-06-01T00:00:00.000Z'
    const registrationEndDate = '2026-06-03T00:00:00.000Z'
    const submissionEndDate = '2026-06-06T00:00:00.000Z'

    stubPhaseLookups(
      [
        { id: registrationPhaseId, name: 'MM Registration', description: 'MM Registration phase' },
        { id: submissionPhaseId, name: 'MM Submission', description: 'MM Submission phase' }
      ],
      [
        { phaseId: registrationPhaseId, defaultDuration: staleDuration },
        {
          phaseId: submissionPhaseId,
          predecessor: registrationPhaseId,
          defaultDuration: staleDuration
        }
      ]
    )

    const updatedPhases = await phaseHelper.populatePhasesForChallengeUpdate(
      [
        {
          duration: staleDuration,
          name: 'MM Registration',
          phaseId: registrationPhaseId,
          scheduledStartDate: registrationStartDate,
          scheduledEndDate: '2026-06-01T12:00:00.000Z'
        },
        {
          duration: staleDuration,
          name: 'MM Submission',
          phaseId: submissionPhaseId,
          predecessor: registrationPhaseId,
          scheduledStartDate: '2026-06-01T12:00:00.000Z',
          scheduledEndDate: '2026-06-02T00:00:00.000Z'
        }
      ],
      [
        {
          duration: staleDuration,
          phaseId: registrationPhaseId,
          scheduledEndDate: registrationEndDate,
          scheduledStartDate: registrationStartDate
        },
        {
          duration: staleDuration,
          phaseId: submissionPhaseId,
          scheduledEndDate: submissionEndDate
        }
      ],
      'timeline-template-id',
      false
    )

    updatedPhases[0].scheduledEndDate.should.equal(registrationEndDate)
    updatedPhases[0].duration.should.equal(2 * 24 * 60 * 60)
    updatedPhases[1].scheduledStartDate.should.equal(registrationEndDate)
    updatedPhases[1].scheduledEndDate.should.equal(submissionEndDate)
    updatedPhases[1].duration.should.equal(3 * 24 * 60 * 60)
  })

  it('allows active Design phases to be shortened to a future end date', async () => {
    const registrationPhaseId = 'design-registration-phase'
    const submissionPhaseId = 'design-submission-phase'
    const staleDuration = 5 * 24 * 60 * 60
    const registrationStartDate = '2099-05-26T05:14:00.000Z'
    const currentRegistrationEndDate = '2099-05-31T05:14:00.000Z'
    const shortenedRegistrationEndDate = '2099-05-29T05:14:00.000Z'

    stubPhaseLookups(
      [
        { id: registrationPhaseId, name: 'Registration', description: 'Registration phase' },
        { id: submissionPhaseId, name: 'Submission', description: 'Submission phase' }
      ],
      [
        { phaseId: registrationPhaseId, defaultDuration: staleDuration },
        {
          phaseId: submissionPhaseId,
          predecessor: registrationPhaseId,
          defaultDuration: staleDuration
        }
      ]
    )

    const updatedPhases = await phaseHelper.populatePhasesForChallengeUpdate(
      [
        {
          duration: staleDuration,
          isOpen: true,
          name: 'Registration',
          phaseId: registrationPhaseId,
          scheduledStartDate: registrationStartDate,
          scheduledEndDate: currentRegistrationEndDate
        },
        {
          duration: staleDuration,
          name: 'Submission',
          phaseId: submissionPhaseId,
          predecessor: registrationPhaseId,
          scheduledStartDate: currentRegistrationEndDate,
          scheduledEndDate: '2099-06-05T05:14:00.000Z'
        }
      ],
      [
        {
          phaseId: registrationPhaseId,
          scheduledEndDate: shortenedRegistrationEndDate
        }
      ],
      'timeline-template-id',
      false,
      { allowActivePhaseShortening: true }
    )

    updatedPhases[0].scheduledEndDate.should.equal(shortenedRegistrationEndDate)
    updatedPhases[0].duration.should.equal(3 * 24 * 60 * 60)
    updatedPhases[1].scheduledStartDate.should.equal(shortenedRegistrationEndDate)
  })

  it('allows future Design phases to be shortened to a future end date', async () => {
    const registrationPhaseId = 'design-registration-phase'
    const reviewPhaseId = 'design-review-phase'
    const registrationDuration = 2 * 24 * 60 * 60
    const reviewDuration = 5 * 24 * 60 * 60
    const registrationStartDate = '2099-05-26T05:14:00.000Z'
    const registrationEndDate = '2099-05-28T05:14:00.000Z'
    const currentReviewEndDate = '2099-06-02T05:14:00.000Z'
    const shortenedReviewEndDate = '2099-05-30T05:14:00.000Z'

    stubPhaseLookups(
      [
        { id: registrationPhaseId, name: 'Registration', description: 'Registration phase' },
        { id: reviewPhaseId, name: 'Review', description: 'Review phase' }
      ],
      [
        { phaseId: registrationPhaseId, defaultDuration: registrationDuration },
        {
          phaseId: reviewPhaseId,
          predecessor: registrationPhaseId,
          defaultDuration: reviewDuration
        }
      ]
    )

    const updatedPhases = await phaseHelper.populatePhasesForChallengeUpdate(
      [
        {
          duration: registrationDuration,
          isOpen: true,
          name: 'Registration',
          phaseId: registrationPhaseId,
          scheduledStartDate: registrationStartDate,
          scheduledEndDate: registrationEndDate
        },
        {
          duration: reviewDuration,
          name: 'Review',
          phaseId: reviewPhaseId,
          predecessor: registrationPhaseId,
          scheduledStartDate: registrationEndDate,
          scheduledEndDate: currentReviewEndDate
        }
      ],
      [
        {
          phaseId: reviewPhaseId,
          scheduledEndDate: shortenedReviewEndDate
        }
      ],
      'timeline-template-id',
      false,
      { allowActivePhaseShortening: true }
    )

    updatedPhases[1].scheduledStartDate.should.equal(registrationEndDate)
    updatedPhases[1].scheduledEndDate.should.equal(shortenedReviewEndDate)
    updatedPhases[1].duration.should.equal(2 * 24 * 60 * 60)
  })

  it('keeps a persisted end date when a stale duration would imply active non-Design shortening', async () => {
    const registrationPhaseId = 'development-registration-phase'
    const registrationStartDate = '2099-05-26T05:14:00.000Z'
    const currentRegistrationEndDate = '2099-05-27T05:14:00.000Z'
    const staleShortDuration = 23 * 60 * 60

    stubPhaseLookups(
      [{ id: registrationPhaseId, name: 'Registration', description: 'Registration phase' }],
      [{ phaseId: registrationPhaseId, defaultDuration: 6 * 24 * 60 * 60 }]
    )

    const updatedPhases = await phaseHelper.populatePhasesForChallengeUpdate(
      [
        {
          duration: 24 * 60 * 60,
          isOpen: true,
          name: 'Registration',
          phaseId: registrationPhaseId,
          scheduledStartDate: registrationStartDate,
          scheduledEndDate: currentRegistrationEndDate
        }
      ],
      [
        {
          duration: staleShortDuration,
          phaseId: registrationPhaseId,
          scheduledEndDate: currentRegistrationEndDate
        }
      ],
      'timeline-template-id',
      false,
      {
        allowActivePhaseShortening: false,
        preventPhaseShortening: true
      }
    )

    updatedPhases[0].scheduledEndDate.should.equal(currentRegistrationEndDate)
    updatedPhases[0].duration.should.equal(24 * 60 * 60)
  })

  it('allows active non-Design phase start to move earlier when duration is unchanged', async () => {
    const registrationPhaseId = 'development-registration-phase'
    const currentRegistrationStartDate = '2099-05-26T05:14:00.000Z'
    const currentRegistrationEndDate = '2099-05-31T05:14:00.000Z'
    const requestedRegistrationStartDate = '2099-05-25T05:14:00.000Z'
    const requestedRegistrationEndDate = '2099-05-30T05:14:00.000Z'
    const duration = 5 * 24 * 60 * 60

    stubPhaseLookups(
      [{ id: registrationPhaseId, name: 'Registration', description: 'Registration phase' }],
      [{ phaseId: registrationPhaseId, defaultDuration: duration }]
    )

    const updatedPhases = await phaseHelper.populatePhasesForChallengeUpdate(
      [
        {
          duration,
          isOpen: true,
          name: 'Registration',
          phaseId: registrationPhaseId,
          scheduledStartDate: currentRegistrationStartDate,
          scheduledEndDate: currentRegistrationEndDate
        }
      ],
      [
        {
          duration,
          phaseId: registrationPhaseId,
          scheduledStartDate: requestedRegistrationStartDate,
          scheduledEndDate: requestedRegistrationEndDate
        }
      ],
      'timeline-template-id',
      false,
      {
        allowActivePhaseShortening: false,
        preventPhaseShortening: true
      }
    )

    updatedPhases[0].scheduledStartDate.should.equal(requestedRegistrationStartDate)
    updatedPhases[0].scheduledEndDate.should.equal(requestedRegistrationEndDate)
    updatedPhases[0].duration.should.equal(duration)
  })

  it('allows started non-Design phase schedule to move earlier when duration is unchanged', async () => {
    const registrationPhaseId = 'development-registration-phase'
    const currentRegistrationStartDate = '2099-05-26T05:14:00.000Z'
    const currentRegistrationEndDate = '2099-05-31T05:14:00.000Z'
    const requestedRegistrationStartDate = '2099-05-25T05:14:00.000Z'
    const requestedRegistrationEndDate = '2099-05-30T05:14:00.000Z'
    const duration = 5 * 24 * 60 * 60

    stubPhaseLookups(
      [{ id: registrationPhaseId, name: 'Registration', description: 'Registration phase' }],
      [{ phaseId: registrationPhaseId, defaultDuration: duration }]
    )

    const updatedPhases = await phaseHelper.populatePhasesForChallengeUpdate(
      [
        {
          duration,
          isOpen: true,
          name: 'Registration',
          phaseId: registrationPhaseId,
          actualStartDate: requestedRegistrationStartDate,
          scheduledStartDate: currentRegistrationStartDate,
          scheduledEndDate: currentRegistrationEndDate
        }
      ],
      [
        {
          duration,
          phaseId: registrationPhaseId,
          scheduledStartDate: requestedRegistrationStartDate,
          scheduledEndDate: requestedRegistrationEndDate
        }
      ],
      'timeline-template-id',
      false,
      {
        allowActivePhaseShortening: false,
        preventPhaseShortening: true
      }
    )

    updatedPhases[0].actualStartDate.should.equal(requestedRegistrationStartDate)
    updatedPhases[0].scheduledStartDate.should.equal(requestedRegistrationStartDate)
    updatedPhases[0].scheduledEndDate.should.equal(requestedRegistrationEndDate)
    updatedPhases[0].duration.should.equal(duration)
  })

  it('allows active non-Design dependent phases to move earlier when duration is unchanged', async () => {
    const registrationPhaseId = 'development-registration-phase'
    const reviewPhaseId = 'development-review-phase'
    const duration = 24 * 60 * 60
    const currentRegistrationStartDate = '2099-05-26T05:14:00.000Z'
    const currentRegistrationEndDate = '2099-05-27T05:14:00.000Z'
    const currentReviewEndDate = '2099-05-28T05:14:00.000Z'
    const requestedRegistrationStartDate = '2099-05-25T05:14:00.000Z'
    const requestedRegistrationEndDate = '2099-05-26T05:14:00.000Z'
    const requestedReviewEndDate = '2099-05-27T05:14:00.000Z'

    stubPhaseLookups(
      [
        { id: registrationPhaseId, name: 'Registration', description: 'Registration phase' },
        { id: reviewPhaseId, name: 'Review', description: 'Review phase' }
      ],
      [
        { phaseId: registrationPhaseId, defaultDuration: duration },
        {
          phaseId: reviewPhaseId,
          predecessor: registrationPhaseId,
          defaultDuration: duration
        }
      ]
    )

    const updatedPhases = await phaseHelper.populatePhasesForChallengeUpdate(
      [
        {
          duration,
          isOpen: true,
          name: 'Registration',
          phaseId: registrationPhaseId,
          scheduledStartDate: currentRegistrationStartDate,
          scheduledEndDate: currentRegistrationEndDate
        },
        {
          duration,
          name: 'Review',
          phaseId: reviewPhaseId,
          predecessor: registrationPhaseId,
          scheduledStartDate: currentRegistrationEndDate,
          scheduledEndDate: currentReviewEndDate
        }
      ],
      [
        {
          duration,
          phaseId: registrationPhaseId,
          scheduledStartDate: requestedRegistrationStartDate,
          scheduledEndDate: requestedRegistrationEndDate
        },
        {
          duration,
          phaseId: reviewPhaseId,
          scheduledEndDate: requestedReviewEndDate
        }
      ],
      'timeline-template-id',
      false,
      {
        allowActivePhaseShortening: false,
        preventPhaseShortening: true
      }
    )

    updatedPhases[0].scheduledStartDate.should.equal(requestedRegistrationStartDate)
    updatedPhases[0].scheduledEndDate.should.equal(requestedRegistrationEndDate)
    updatedPhases[1].scheduledStartDate.should.equal(requestedRegistrationEndDate)
    updatedPhases[1].scheduledEndDate.should.equal(requestedReviewEndDate)
    updatedPhases[1].duration.should.equal(duration)
  })

  it('rejects active non-Design phase updates that shorten duration after moving start earlier', async () => {
    const registrationPhaseId = 'development-registration-phase'
    const currentRegistrationStartDate = '2099-05-26T05:14:00.000Z'
    const currentRegistrationEndDate = '2099-05-31T05:14:00.000Z'
    const requestedRegistrationStartDate = '2099-05-25T05:14:00.000Z'
    const requestedRegistrationEndDate = '2099-05-29T05:14:00.000Z'
    const duration = 5 * 24 * 60 * 60

    stubPhaseLookups(
      [{ id: registrationPhaseId, name: 'Registration', description: 'Registration phase' }],
      [{ phaseId: registrationPhaseId, defaultDuration: duration }]
    )

    try {
      await phaseHelper.populatePhasesForChallengeUpdate(
        [
          {
            duration,
            isOpen: true,
            name: 'Registration',
            phaseId: registrationPhaseId,
            scheduledStartDate: currentRegistrationStartDate,
            scheduledEndDate: currentRegistrationEndDate
          }
        ],
        [
          {
            phaseId: registrationPhaseId,
            scheduledStartDate: requestedRegistrationStartDate,
            scheduledEndDate: requestedRegistrationEndDate
          }
        ],
        'timeline-template-id',
        false,
        {
          allowActivePhaseShortening: false,
          preventPhaseShortening: true
        }
      )
    } catch (e) {
      e.message.should.equal(
        'Challenge phase schedules can only be shortened for Design track challenges.'
      )
      return
    }

    throw new Error('should not reach here')
  })

  it('rejects active phase shortening for non-Design tracks', async () => {
    const registrationPhaseId = 'development-registration-phase'
    const staleDuration = 5 * 24 * 60 * 60

    stubPhaseLookups(
      [{ id: registrationPhaseId, name: 'Registration', description: 'Registration phase' }],
      [{ phaseId: registrationPhaseId, defaultDuration: staleDuration }]
    )

    try {
      await phaseHelper.populatePhasesForChallengeUpdate(
        [
          {
            duration: staleDuration,
            isOpen: true,
            name: 'Registration',
            phaseId: registrationPhaseId,
            scheduledStartDate: '2099-05-26T05:14:00.000Z',
            scheduledEndDate: '2099-05-31T05:14:00.000Z'
          }
        ],
        [
          {
            phaseId: registrationPhaseId,
            scheduledEndDate: '2099-05-29T05:14:00.000Z'
          }
        ],
        'timeline-template-id',
        false,
        { allowActivePhaseShortening: false }
      )
    } catch (e) {
      e.message.should.equal(
        'Challenge phase schedules can only be shortened for Design track challenges.'
      )
      return
    }

    throw new Error('should not reach here')
  })

  it('rejects future phase shortening for active non-Design challenges', async () => {
    const registrationPhaseId = 'development-registration-phase'
    const reviewPhaseId = 'development-review-phase'
    const registrationDuration = 2 * 24 * 60 * 60
    const reviewDuration = 5 * 24 * 60 * 60
    const registrationStartDate = '2099-05-26T05:14:00.000Z'
    const registrationEndDate = '2099-05-28T05:14:00.000Z'
    const currentReviewEndDate = '2099-06-02T05:14:00.000Z'
    const shortenedReviewEndDate = '2099-05-30T05:14:00.000Z'

    stubPhaseLookups(
      [
        { id: registrationPhaseId, name: 'Registration', description: 'Registration phase' },
        { id: reviewPhaseId, name: 'Review', description: 'Review phase' }
      ],
      [
        { phaseId: registrationPhaseId, defaultDuration: registrationDuration },
        {
          phaseId: reviewPhaseId,
          predecessor: registrationPhaseId,
          defaultDuration: reviewDuration
        }
      ]
    )

    try {
      await phaseHelper.populatePhasesForChallengeUpdate(
        [
          {
            duration: registrationDuration,
            isOpen: true,
            name: 'Registration',
            phaseId: registrationPhaseId,
            scheduledStartDate: registrationStartDate,
            scheduledEndDate: registrationEndDate
          },
          {
            duration: reviewDuration,
            name: 'Review',
            phaseId: reviewPhaseId,
            predecessor: registrationPhaseId,
            scheduledStartDate: registrationEndDate,
            scheduledEndDate: currentReviewEndDate
          }
        ],
        [
          {
            phaseId: reviewPhaseId,
            scheduledEndDate: shortenedReviewEndDate
          }
        ],
        'timeline-template-id',
        false,
        {
          allowActivePhaseShortening: false,
          preventPhaseShortening: true
        }
      )
    } catch (e) {
      e.message.should.equal(
        'Challenge phase schedules can only be shortened for Design track challenges.'
      )
      return
    }

    throw new Error('should not reach here')
  })

  it('allows future non-Design phases to be shortened before launch', async () => {
    const registrationPhaseId = 'development-registration-phase'
    const reviewPhaseId = 'development-review-phase'
    const registrationDuration = 2 * 24 * 60 * 60
    const reviewDuration = 5 * 24 * 60 * 60
    const registrationStartDate = '2099-05-26T05:14:00.000Z'
    const registrationEndDate = '2099-05-28T05:14:00.000Z'
    const currentReviewEndDate = '2099-06-02T05:14:00.000Z'
    const shortenedReviewEndDate = '2099-05-30T05:14:00.000Z'

    stubPhaseLookups(
      [
        { id: registrationPhaseId, name: 'Registration', description: 'Registration phase' },
        { id: reviewPhaseId, name: 'Review', description: 'Review phase' }
      ],
      [
        { phaseId: registrationPhaseId, defaultDuration: registrationDuration },
        {
          phaseId: reviewPhaseId,
          predecessor: registrationPhaseId,
          defaultDuration: reviewDuration
        }
      ]
    )

    const updatedPhases = await phaseHelper.populatePhasesForChallengeUpdate(
      [
        {
          duration: registrationDuration,
          name: 'Registration',
          phaseId: registrationPhaseId,
          scheduledStartDate: registrationStartDate,
          scheduledEndDate: registrationEndDate
        },
        {
          duration: reviewDuration,
          name: 'Review',
          phaseId: reviewPhaseId,
          predecessor: registrationPhaseId,
          scheduledStartDate: registrationEndDate,
          scheduledEndDate: currentReviewEndDate
        }
      ],
      [
        {
          phaseId: reviewPhaseId,
          scheduledEndDate: shortenedReviewEndDate
        }
      ],
      'timeline-template-id',
      false,
      {
        allowActivePhaseShortening: false,
        preventPhaseShortening: false
      }
    )

    updatedPhases[1].scheduledEndDate.should.equal(shortenedReviewEndDate)
    updatedPhases[1].duration.should.equal(2 * 24 * 60 * 60)
  })

  it('rejects active phase end dates before the current date/time', async () => {
    const registrationPhaseId = 'past-registration-phase'
    const now = Date.now()
    const registrationStartDate = new Date(now - 2 * 60 * 60 * 1000).toISOString()
    const pastRegistrationEndDate = new Date(now - 60 * 60 * 1000).toISOString()
    const currentRegistrationEndDate = new Date(now + 24 * 60 * 60 * 1000).toISOString()
    const staleDuration = 24 * 60 * 60

    stubPhaseLookups(
      [{ id: registrationPhaseId, name: 'Registration', description: 'Registration phase' }],
      [{ phaseId: registrationPhaseId, defaultDuration: staleDuration }]
    )

    try {
      await phaseHelper.populatePhasesForChallengeUpdate(
        [
          {
            duration: staleDuration,
            isOpen: true,
            name: 'Registration',
            phaseId: registrationPhaseId,
            scheduledStartDate: registrationStartDate,
            scheduledEndDate: currentRegistrationEndDate
          }
        ],
        [
          {
            phaseId: registrationPhaseId,
            scheduledEndDate: pastRegistrationEndDate
          }
        ],
        'timeline-template-id',
        false,
        { allowActivePhaseShortening: true }
      )
    } catch (e) {
      e.message.should.equal('Phase scheduledEndDate cannot be set before the current date/time.')
      return
    }

    throw new Error('should not reach here')
  })
})
