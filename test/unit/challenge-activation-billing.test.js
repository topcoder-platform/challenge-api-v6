if (!process.env.REVIEW_DB_URL && process.env.DATABASE_URL) {
  process.env.REVIEW_DB_URL = process.env.DATABASE_URL;
}

require("../../app-bootstrap");
const chai = require("chai");
const config = require("config");
const service = require("../../src/services/ChallengeService");
const projectHelper = require("../../src/common/project-helper");
const { ChallengeStatusEnum } = require("../../src/common/prisma");

const should = chai.should();

describe("challenge activation billing validation unit tests", () => {
  const applyCreateChallengeApprovalStatusHotfix =
    service.__testables.applyCreateChallengeApprovalStatusHotfix;
  const applyNewDraftApprovalStatusPreservationHotfix =
    service.__testables.applyNewDraftApprovalStatusPreservationHotfix;
  const validateChallengeActivationBillingAccount =
    service.__testables.validateChallengeActivationBillingAccount;
  const shouldBlockChallengeLaunchForApproval =
    service.__testables.shouldBlockChallengeLaunchForApproval;
  const shouldSkipChallengeApprovalFlow = service.__testables.shouldSkipChallengeApprovalFlow;
  const syncChallengeBillingAccountLock = service.__testables.syncChallengeBillingAccountLock;
  const projectChallenge = {
    status: ChallengeStatusEnum.DRAFT,
    timelineTemplateId: "project-required-template",
  };
  const originalGetBillingAccountDetails = projectHelper.getBillingAccountDetails;
  const originalLockChallengeBillingAccountAmount = projectHelper.lockChallengeBillingAccountAmount;
  const originalIgnoredBillingAccounts = config.IGNORED_CHALLENGE_ACTIVATION_BILLING_ACCOUNT_IDS;
  const originalTopgearBillingAccounts = config.TOPGEAR_BILLING_ACCOUNTS_ID;

  afterEach(() => {
    projectHelper.getBillingAccountDetails = originalGetBillingAccountDetails;
    projectHelper.lockChallengeBillingAccountAmount = originalLockChallengeBillingAccountAmount;
    config.IGNORED_CHALLENGE_ACTIVATION_BILLING_ACCOUNT_IDS = originalIgnoredBillingAccounts;
    config.TOPGEAR_BILLING_ACCOUNTS_ID = originalTopgearBillingAccounts;
  });

  it("prevents activation when the project has no billing account", async () => {
    try {
      await validateChallengeActivationBillingAccount({
        billingAccountId: null,
        challenge: projectChallenge,
      });
    } catch (error) {
      should.equal(
        error.message,
        "Cannot activate challenge because the project has no billing account.",
      );
      return;
    }

    throw new Error("should not reach here");
  });

  it("prevents activation when the project billing account is inactive", async () => {
    try {
      await validateChallengeActivationBillingAccount({
        active: false,
        billingAccountId: "80001061",
        challenge: projectChallenge,
      });
    } catch (error) {
      should.equal(
        error.message,
        "Cannot activate challenge because the project billing account is inactive.",
      );
      return;
    }

    throw new Error("should not reach here");
  });

  it("prevents activation when the project billing account is expired", async () => {
    try {
      await validateChallengeActivationBillingAccount({
        active: true,
        billingAccountId: "80001061",
        challenge: projectChallenge,
        endDate: "2000-01-01T00:00:00.000Z",
      });
    } catch (error) {
      should.equal(
        error.message,
        "Cannot activate challenge because the project billing account is expired.",
      );
      return;
    }

    throw new Error("should not reach here");
  });

  it("prevents activation when the project billing account has no remaining funds", async () => {
    projectHelper.getBillingAccountDetails = async () => ({
      active: true,
      billingAccountId: "80001061",
      endDate: "2099-01-01T00:00:00.000Z",
      status: "ACTIVE",
      totalBudgetRemaining: 0,
    });

    try {
      await validateChallengeActivationBillingAccount({
        active: true,
        billingAccountId: "80001061",
        challenge: projectChallenge,
        endDate: "2099-01-01T00:00:00.000Z",
      });
    } catch (error) {
      should.equal(
        error.message,
        "Cannot activate challenge because the project billing account has insufficient remaining funds.",
      );
      return;
    }

    throw new Error("should not reach here");
  });

  it("allows activation when the billing account is active, unexpired, and funded", async () => {
    projectHelper.getBillingAccountDetails = async () => ({
      active: true,
      billingAccountId: "80001061",
      endDate: "2099-01-01T00:00:00.000Z",
      status: "ACTIVE",
      totalBudgetRemaining: 150,
    });

    await validateChallengeActivationBillingAccount({
      active: true,
      billingAccountId: "80001061",
      challenge: projectChallenge,
      endDate: "2099-01-01T00:00:00.000Z",
    });
  });

  it("allows activation when an ignored billing account is expired and out of funds", async () => {
    projectHelper.getBillingAccountDetails = async () => ({
      active: true,
      billingAccountId: "80000062",
      endDate: "2000-01-01T00:00:00.000Z",
      status: "ACTIVE",
      totalBudgetRemaining: 0,
    });

    await validateChallengeActivationBillingAccount({
      active: true,
      billingAccountId: "80000062",
      challenge: projectChallenge,
      endDate: "2000-01-01T00:00:00.000Z",
    });
  });

  it("skips approval flow for configured Topgear billing accounts", () => {
    config.TOPGEAR_BILLING_ACCOUNTS_ID = [" 80000062 ", 80000063];

    should.equal(shouldSkipChallengeApprovalFlow("80000062"), true);
    should.equal(shouldSkipChallengeApprovalFlow(80000063), true);
    should.equal(shouldSkipChallengeApprovalFlow("80001061"), false);
  });

  it("does not block launch approval for configured Topgear billing accounts", () => {
    config.TOPGEAR_BILLING_ACCOUNTS_ID = ["80000062"];

    should.equal(shouldBlockChallengeLaunchForApproval("PENDING_APPROVAL", "80000062"), false);
    should.equal(shouldBlockChallengeLaunchForApproval("PENDING_APPROVAL", "80001061"), true);
    should.equal(shouldBlockChallengeLaunchForApproval("APPROVED", "80001061"), false);
  });

  it("auto-approves NEW and DRAFT challenge creation payloads", () => {
    const defaultNewChallenge = {};
    const draftChallenge = {
      status: ChallengeStatusEnum.DRAFT,
      approvalStatus: "REJECTED",
      approvalRejectionReason: "too expensive",
      approvalApprovedBy: "approver",
    };
    const approvedChallenge = {
      status: ChallengeStatusEnum.APPROVED,
    };

    should.equal(applyCreateChallengeApprovalStatusHotfix(defaultNewChallenge), true);
    should.equal(defaultNewChallenge.approvalStatus, "APPROVED");
    should.equal(defaultNewChallenge.approvalRejectionReason, null);
    should.equal(defaultNewChallenge.approvalApprovedBy, null);

    should.equal(applyCreateChallengeApprovalStatusHotfix(draftChallenge), true);
    should.equal(draftChallenge.approvalStatus, "APPROVED");
    should.equal(draftChallenge.approvalRejectionReason, null);
    should.equal(draftChallenge.approvalApprovedBy, null);

    should.equal(applyCreateChallengeApprovalStatusHotfix(approvedChallenge), false);
    should.equal(approvedChallenge.approvalStatus, undefined);
  });

  it("keeps approved status when an approved NEW challenge is saved as DRAFT", () => {
    const existingChallenge = {
      status: ChallengeStatusEnum.NEW,
      approvalStatus: "APPROVED",
      approvalApprovedBy: "existing-approver",
    };
    const updatePayload = {
      status: ChallengeStatusEnum.DRAFT,
      approvalApprovedBy: "incoming-approver",
    };
    const pendingChallenge = {
      status: ChallengeStatusEnum.NEW,
      approvalStatus: "PENDING_APPROVAL",
    };
    const pendingUpdatePayload = {
      status: ChallengeStatusEnum.DRAFT,
    };
    const rejectedUpdatePayload = {
      status: ChallengeStatusEnum.DRAFT,
    };

    should.equal(
      applyNewDraftApprovalStatusPreservationHotfix(existingChallenge, updatePayload),
      true,
    );
    should.equal(updatePayload.approvalStatus, "APPROVED");
    should.equal(updatePayload.approvalRejectionReason, null);
    should.equal(updatePayload.approvalApprovedBy, undefined);

    should.equal(
      applyNewDraftApprovalStatusPreservationHotfix(pendingChallenge, pendingUpdatePayload),
      false,
    );
    should.equal(pendingUpdatePayload.approvalStatus, undefined);

    should.equal(
      applyNewDraftApprovalStatusPreservationHotfix(
        existingChallenge,
        rejectedUpdatePayload,
        "REJECTED",
      ),
      false,
    );
    should.equal(rejectedUpdatePayload.approvalStatus, undefined);
  });

  it("skips budget lock funds validation for ignored billing accounts", async () => {
    config.IGNORED_CHALLENGE_ACTIVATION_BILLING_ACCOUNT_IDS = ["80000062"];
    let lockCalled = false;
    projectHelper.lockChallengeBillingAccountAmount = async () => {
      lockCalled = true;
    };

    await syncChallengeBillingAccountLock({
      id: "challenge-id",
      status: ChallengeStatusEnum.DRAFT,
      billing: {
        billingAccountId: "80000062",
        markup: 0,
      },
      overview: {
        totalPrizes: 100,
      },
    });

    should.equal(lockCalled, false);
  });

  it("continues budget lock sync for non-ignored billing accounts", async () => {
    config.IGNORED_CHALLENGE_ACTIVATION_BILLING_ACCOUNT_IDS = ["80000062"];
    let lockRequest;
    projectHelper.lockChallengeBillingAccountAmount = async (request) => {
      lockRequest = request;
    };

    await syncChallengeBillingAccountLock({
      id: "challenge-id",
      status: ChallengeStatusEnum.DRAFT,
      billing: {
        billingAccountId: "80001061",
        markup: 0.1,
      },
      overview: {
        totalPrizes: 100,
      },
    });

    lockRequest.should.deep.equal({
      billingAccountId: "80001061",
      challengeId: "challenge-id",
      markup: 0.1,
      memberPaymentAmount: 100,
    });
  });
});
