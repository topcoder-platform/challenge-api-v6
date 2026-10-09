require("../../app-bootstrap");

const chai = require("chai");
const { expect } = chai;
const { ChallengeStatusEnum } = require("@prisma/client");
const challengeHelper = require("../../src/common/challenge-helper");

describe("challenge response helper", () => {
  function buildChallenge(phases) {
    return {
      status: ChallengeStatusEnum.ACTIVE,
      phases,
    };
  }

  function enrich(challenge) {
    challengeHelper.enrichChallengeForResponse(challenge);
    return challenge;
  }

  it("marks an active challenge as stalled when a due successor phase has not opened", () => {
    const challenge = buildChallenge([
      {
        id: "registration-challenge-phase",
        phaseId: "registration-phase",
        name: "Registration",
        isOpen: false,
        actualStartDate: "2000-01-01T00:00:00.000Z",
        actualEndDate: "2000-01-02T00:00:00.000Z",
      },
      {
        id: "submission-challenge-phase",
        phaseId: "submission-phase",
        name: "Submission",
        predecessor: "registration-phase",
        isOpen: false,
        actualStartDate: "2000-01-02T00:00:00.000Z",
        actualEndDate: "2000-01-03T00:00:00.000Z",
      },
      {
        id: "review-challenge-phase",
        phaseId: "review-phase",
        name: "Review",
        predecessor: "submission-phase",
        isOpen: false,
        scheduledStartDate: "2000-01-03T00:00:00.000Z",
      },
    ]);

    expect(enrich(challenge).stalled).to.equal(true);
  });

  it("does not mark a challenge as stalled while any phase is open", () => {
    const challenge = buildChallenge([
      {
        id: "registration-challenge-phase",
        phaseId: "registration-phase",
        name: "Registration",
        isOpen: false,
        actualStartDate: "2000-01-01T00:00:00.000Z",
        actualEndDate: "2000-01-02T00:00:00.000Z",
      },
      {
        id: "submission-challenge-phase",
        phaseId: "submission-phase",
        name: "Submission",
        predecessor: "registration-phase",
        isOpen: true,
        actualStartDate: "2000-01-02T00:00:00.000Z",
      },
      {
        id: "review-challenge-phase",
        phaseId: "review-phase",
        name: "Review",
        predecessor: "submission-phase",
        isOpen: false,
        scheduledStartDate: "2000-01-03T00:00:00.000Z",
      },
    ]);

    expect(enrich(challenge).stalled).to.equal(false);
  });

  it("does not mark a challenge as stalled before the successor phase is due", () => {
    const challenge = buildChallenge([
      {
        id: "submission-challenge-phase",
        phaseId: "submission-phase",
        name: "Submission",
        isOpen: false,
        actualStartDate: "2000-01-01T00:00:00.000Z",
        actualEndDate: "2000-01-02T00:00:00.000Z",
      },
      {
        id: "review-challenge-phase",
        phaseId: "review-phase",
        name: "Review",
        predecessor: "submission-challenge-phase",
        isOpen: false,
        scheduledStartDate: "2999-01-01T00:00:00.000Z",
      },
    ]);

    expect(enrich(challenge).stalled).to.equal(false);
  });

  it("does not mark non-active challenges as stalled", () => {
    const challenge = {
      status: ChallengeStatusEnum.COMPLETED,
      phases: [
        {
          id: "submission-challenge-phase",
          phaseId: "submission-phase",
          name: "Submission",
          isOpen: false,
          actualStartDate: "2000-01-01T00:00:00.000Z",
          actualEndDate: "2000-01-02T00:00:00.000Z",
        },
        {
          id: "review-challenge-phase",
          phaseId: "review-phase",
          name: "Review",
          predecessor: "submission-phase",
          isOpen: false,
          scheduledStartDate: "2000-01-02T00:00:00.000Z",
        },
      ],
    };

    expect(enrich(challenge).stalled).to.equal(false);
  });
});
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

describe("challenge metadata validation", () => {
  it("allows supported submission_type metadata values", () => {
    expect(() => challengeHelper.validateSubmissionTypeMetadata([
      {
        name: "submission_type",
        value: "zip",
      },
    ])).not.to.throw();

    expect(() => challengeHelper.validateSubmissionTypeMetadata([
      {
        name: "submission_type",
        value: "url",
      },
    ])).not.to.throw();
  });

  it("rejects unsupported submission_type metadata values", () => {
    expect(() => challengeHelper.validateSubmissionTypeMetadata([
      {
        name: "submission_type",
        value: "artifact",
      },
    ])).to.throw("metadata submission_type must be either zip or url");
  });

  it("allows exact string values for the registered-member winning download flag", () => {
    expect(() => challengeHelper.validateRegisteredMemberWinningSubmissionDownloadMetadata([
      {
        name: "allowAllRegistrantsToDownloadWinningSubmissions",
        value: "true",
      },
    ])).not.to.throw();

    expect(() => challengeHelper.validateRegisteredMemberWinningSubmissionDownloadMetadata([
      {
        name: "allowAllRegistrantsToDownloadWinningSubmissions",
        value: "false",
      },
    ])).not.to.throw();
  });

  it("allows the registered-member winning download flag to be omitted", () => {
    expect(() =>
      challengeHelper.validateRegisteredMemberWinningSubmissionDownloadMetadata(undefined)
    ).not.to.throw();
    expect(() => challengeHelper.validateRegisteredMemberWinningSubmissionDownloadMetadata([
      {
        name: "submission_type",
        value: "zip",
      },
    ])).not.to.throw();
  });

  it("rejects non-string or non-boolean registered-member winning download flag values", () => {
    for (const value of [true, false, "TRUE", "yes", " true "]) {
      expect(() => challengeHelper.validateRegisteredMemberWinningSubmissionDownloadMetadata([
        {
          name: "allowAllRegistrantsToDownloadWinningSubmissions",
          value,
        },
      ])).to.throw(
        "metadata allowAllRegistrantsToDownloadWinningSubmissions must be either true or false as a string"
      );
    }
  });

  it("adds an explicit false default when is_test_challenge is omitted", () => {
    challengeHelper.applyTestChallengeMetadataDefault(undefined).should.deep.equal([
      {
        name: "is_test_challenge",
        value: "false",
      },
    ]);

    challengeHelper.applyTestChallengeMetadataDefault([
      {
        name: "submission_type",
        value: "zip",
      },
    ]).should.deep.equal([
      {
        name: "submission_type",
        value: "zip",
      },
      {
        name: "is_test_challenge",
        value: "false",
      },
    ]);
  });

  it("preserves an explicit is_test_challenge value when applying the default", () => {
    challengeHelper.applyTestChallengeMetadataDefault([
      {
        name: "is_test_challenge",
        value: "true",
      },
    ]).should.deep.equal([
      {
        name: "is_test_challenge",
        value: "true",
      },
    ]);
  });

  it("allows exact string boolean values for is_test_challenge", () => {
    for (const value of ["true", "false"]) {
      expect(() => challengeHelper.validateTestChallengeMetadata([
        {
          name: "is_test_challenge",
          value,
        },
      ])).not.to.throw();
    }
  });

  it("allows is_test_challenge to be omitted from update metadata", () => {
    expect(() => challengeHelper.validateTestChallengeMetadata(undefined)).not.to.throw();
    expect(() => challengeHelper.validateTestChallengeMetadata([
      {
        name: "submission_type",
        value: "zip",
      },
    ])).not.to.throw();
  });

  it("rejects non-string or non-boolean is_test_challenge values", () => {
    for (const value of [true, false, "TRUE", "yes", " true "]) {
      expect(() => challengeHelper.validateTestChallengeMetadata([
        {
          name: "is_test_challenge",
          value,
        },
      ])).to.throw(
        "metadata is_test_challenge must be either true or false as a string"
      );
    }
  });
});

describe("active timeline template switch", () => {
  const moment = require("moment");
  const phaseHelper = require("../../src/common/phase-helper");
  const originalGetTemplateAndTemplateMap = phaseHelper.getTemplateAndTemplateMap;
  const originalGetPhaseDefinitionsAndMap = phaseHelper.getPhaseDefinitionsAndMap;
  const oneDay = 24 * 60 * 60;
  const phaseDefinitions = [
    { id: "registration-phase", name: "Registration" },
    { id: "submission-phase", name: "Submission" },
    { id: "ai-screening-phase", name: "AI Screening" },
    { id: "ai-review-phase", name: "AI Review" },
    { id: "review-phase", name: "Review" },
    { id: "appeals-phase", name: "Appeals" },
    { id: "appeals-response-phase", name: "Appeals Response" },
    { id: "approval-phase", name: "Approval" },
  ].map((phase) => ({ ...phase, description: `${phase.name} phase` }));
  const templates = {
    "default-template": [
      { phaseId: "registration-phase", defaultDuration: 5 * oneDay },
      { phaseId: "submission-phase", defaultDuration: 5 * oneDay },
      { phaseId: "review-phase", predecessor: "submission-phase", defaultDuration: 2 * oneDay },
      { phaseId: "appeals-phase", predecessor: "review-phase", defaultDuration: oneDay },
      {
        phaseId: "appeals-response-phase",
        predecessor: "appeals-phase",
        defaultDuration: oneDay / 2,
      },
    ],
    // Same row order as the AI Only template on dev.
    "ai-only-template": [
      { phaseId: "registration-phase", defaultDuration: 5 * oneDay },
      { phaseId: "ai-review-phase", predecessor: "submission-phase", defaultDuration: oneDay },
      { phaseId: "submission-phase", defaultDuration: 5 * oneDay },
      { phaseId: "approval-phase", predecessor: "ai-review-phase", defaultDuration: oneDay / 2 },
    ],
  };
  const aiReviewers = [
    {
      isMemberReview: false,
      aiWorkflowId: "workflow-1",
      phaseId: "review-phase",
      scorecardId: "ai-scorecard",
    },
  ];
  const startDate = moment().subtract(1, "day").toDate().toISOString();
  const submissionEndDate = moment(startDate).add(5, "days").toDate().toISOString();

  beforeEach(() => {
    const phaseDefinitionMap = new Map(phaseDefinitions.map((phase) => [phase.id, phase]));
    phaseHelper.getPhaseDefinitionsAndMap = async () => ({ phaseDefinitions, phaseDefinitionMap });
    phaseHelper.getTemplateAndTemplateMap = async (timelineTemplateId) => ({
      timelineTempate: templates[timelineTemplateId],
      timelineTemplateMap: new Map(
        templates[timelineTemplateId].map((phase) => [phase.phaseId, phase])
      ),
    });
  });

  afterEach(() => {
    phaseHelper.getTemplateAndTemplateMap = originalGetTemplateAndTemplateMap;
    phaseHelper.getPhaseDefinitionsAndMap = originalGetPhaseDefinitionsAndMap;
  });

  /**
   * Builds a persisted challenge phase scheduled after its predecessor.
   */
  function buildPhase(phaseId, name, scheduledStartDate, duration, extra = {}) {
    return {
      id: `challenge-${phaseId}`,
      phaseId,
      name,
      duration,
      isOpen: false,
      predecessor: null,
      constraints: [],
      scheduledStartDate,
      scheduledEndDate: moment(scheduledStartDate).add(duration, "seconds").toDate().toISOString(),
      ...extra,
    };
  }

  const openPhase = { isOpen: true, actualStartDate: startDate };

  /**
   * Switches the persisted phases to the given template like updateChallenge does.
   */
  async function switchTimeline(challengePhases, timelineTemplateId) {
    const templatePhases = await phaseHelper.populatePhasesForChallengeCreation(
      undefined,
      startDate,
      timelineTemplateId
    );

    return challengeHelper.populatePhasesForActiveTimelineTemplateSwitch(
      challengePhases,
      templatePhases,
      {
        reviewers: aiReviewers,
        timelineTemplateId,
        scheduleOptions: { allowActivePhaseShortening: false, preventPhaseShortening: true },
      }
    );
  }

  it("moves an active AI only challenge to the AI gating timeline without restarting open phases", async () => {
    const aiReviewStartDate = submissionEndDate;
    const phases = await switchTimeline(
      [
        buildPhase("registration-phase", "Registration", startDate, 5 * oneDay, openPhase),
        buildPhase("submission-phase", "Submission", startDate, 5 * oneDay, openPhase),
        buildPhase("ai-review-phase", "AI Review", aiReviewStartDate, oneDay, {
          predecessor: "submission-phase",
        }),
        buildPhase(
          "approval-phase",
          "Approval",
          moment(aiReviewStartDate).add(1, "day").toDate().toISOString(),
          oneDay / 2,
          { predecessor: "ai-review-phase" }
        ),
      ],
      "default-template"
    );
    const byName = new Map(phases.map((phase) => [phase.name, phase]));

    expect(phases.map((phase) => phase.name)).to.deep.equal([
      "Registration",
      "Submission",
      "AI Screening",
      "Review",
      "Appeals",
      "Appeals Response",
    ]);
    expect(byName.get("Submission")).to.include({
      id: "challenge-submission-phase",
      isOpen: true,
      actualStartDate: startDate,
      scheduledEndDate: submissionEndDate,
    });
    expect(byName.get("AI Screening")).to.include({
      predecessor: "submission-phase",
      scheduledStartDate: submissionEndDate,
    });
    expect(byName.get("Review")).to.include({
      predecessor: "ai-screening-phase",
      scheduledStartDate: byName.get("AI Screening").scheduledEndDate,
    });
    expect(byName.get("Appeals").scheduledStartDate).to.equal(
      byName.get("Review").scheduledEndDate
    );
  });

  it("moves an active AI gating challenge to the AI only timeline", async () => {
    const aiScreeningEndDate = moment(submissionEndDate).add(4, "hours").toDate().toISOString();
    const reviewEndDate = moment(aiScreeningEndDate).add(2, "days").toDate().toISOString();
    const appealsEndDate = moment(reviewEndDate).add(1, "day").toDate().toISOString();
    const phases = await switchTimeline(
      [
        buildPhase("registration-phase", "Registration", startDate, 5 * oneDay, openPhase),
        buildPhase("submission-phase", "Submission", startDate, 5 * oneDay, openPhase),
        buildPhase("ai-screening-phase", "AI Screening", submissionEndDate, 4 * 60 * 60, {
          predecessor: "submission-phase",
        }),
        buildPhase("review-phase", "Review", aiScreeningEndDate, 2 * oneDay, {
          predecessor: "ai-screening-phase",
        }),
        buildPhase("appeals-phase", "Appeals", reviewEndDate, oneDay, {
          predecessor: "review-phase",
        }),
        buildPhase("appeals-response-phase", "Appeals Response", appealsEndDate, oneDay / 2, {
          predecessor: "appeals-phase",
        }),
      ],
      "ai-only-template"
    );
    const byName = new Map(phases.map((phase) => [phase.name, phase]));

    expect(Array.from(byName.keys()).sort()).to.deep.equal([
      "AI Review",
      "Approval",
      "Registration",
      "Submission",
    ]);
    expect(byName.get("Submission")).to.include({
      id: "challenge-submission-phase",
      isOpen: true,
      actualStartDate: startDate,
    });
    expect(byName.get("AI Review")).to.include({
      predecessor: "submission-phase",
      scheduledStartDate: submissionEndDate,
    });
    expect(byName.get("Approval")).to.include({
      predecessor: "ai-review-phase",
      scheduledStartDate: byName.get("AI Review").scheduledEndDate,
    });
  });
});
