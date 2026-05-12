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
  const validateChallengeActivationBillingAccount =
    service.__testables.validateChallengeActivationBillingAccount;
  const shouldBlockChallengeLaunchForApproval =
    service.__testables.shouldBlockChallengeLaunchForApproval;
  const shouldSkipChallengeApprovalFlow = service.__testables.shouldSkipChallengeApprovalFlow;
  const projectChallenge = {
    status: ChallengeStatusEnum.DRAFT,
    timelineTemplateId: "project-required-template",
  };
  const originalGetBillingAccountDetails = projectHelper.getBillingAccountDetails;
  const originalTopgearBillingAccounts = config.TOPGEAR_BILLING_ACCOUNTS_ID;

  afterEach(() => {
    projectHelper.getBillingAccountDetails = originalGetBillingAccountDetails;
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
});
