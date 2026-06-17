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
