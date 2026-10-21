require("../../app-bootstrap");

const { expect } = require("chai");
const helper = require("../../src/common/helper");

describe("challenge whitelist helper", () => {
  it("does not apply challenge user whitelist checks to full M2M callers", () => {
    expect(helper.shouldApplyChallengeWhitelist({ isMachine: true })).to.equal(false);
  });

  it("applies challenge user whitelist checks to a standalone bypass property", () => {
    expect(helper.shouldApplyChallengeWhitelist({ bypassChallengeWhitelist: true })).to.equal(
      true,
    );
  });

  it("continues to apply challenge user whitelist checks to interactive callers", () => {
    expect(
      helper.shouldApplyChallengeWhitelist({
        roles: ["administrator"],
        userId: "blocked-user",
      }),
    ).to.equal(true);
  });

  it("does not apply challenge group checks to M2M callers", async () => {
    await helper.ensureAccessibleByGroupsAccess({ isMachine: true }, { groups: ["private-group"] });
  });
});
