const { expect } = require("chai");

const PhaseAdvancer = require("../../../src/phase-management/PhaseAdvancer");

const buildIterativeReviewPhase = () => ({
  id: "phase-iterative-review",
  phaseId: "003a4b14-de5d-43fc-9e35-835dbeb6af1f",
  name: "Iterative Review",
  description: "Iterative review phase",
  duration: 86400,
  isOpen: false,
  predecessor: "submission-phase-id",
  scheduledStartDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  scheduledEndDate: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
  actualStartDate: null,
  actualEndDate: null,
  constraints: [],
});

describe("PhaseAdvancer Iterative Review gating", () => {
  it("fails to open iterative review when no submissions exist", async () => {
    const challengeDomain = {
      async getPhaseFacts() {
        return {
          factResponses: [
            {
              response: {
                submissionCount: 0,
                reviewCount: 0,
              },
            },
          ],
        };
      },
    };
    const phaseAdvancer = new PhaseAdvancer(challengeDomain);
    const phases = [buildIterativeReviewPhase()];

    const result = await phaseAdvancer.advancePhase(
      "challenge-123",
      null,
      phases,
      "open",
      "Iterative Review"
    );

    expect(result.success).to.be.false;
    expect(result.failureReasons).to.be.an("array").that.is.not.empty;
    expect(phases[0].isOpen).to.be.false;
  });

  it("opens iterative review once submissions are present", async () => {
    const challengeDomain = {
      async getPhaseFacts() {
        return {
          factResponses: [
            {
              response: {
                submissionCount: 1,
                reviewCount: 0,
              },
            },
          ],
        };
      },
    };
    const phaseAdvancer = new PhaseAdvancer(challengeDomain);
    const phases = [buildIterativeReviewPhase()];

    const result = await phaseAdvancer.advancePhase(
      "challenge-123",
      null,
      phases,
      "open",
      "Iterative Review"
    );

    expect(result.success).to.be.true;
    expect(phases[0].isOpen).to.be.true;
  });
});
