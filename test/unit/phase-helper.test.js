const chai = require('chai')

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
})
