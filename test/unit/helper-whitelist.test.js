require("../../app-bootstrap");

const { expect } = require("chai");
const helper = require("../../src/common/helper");

describe("challenge whitelist helper", () => {
  it("does not apply challenge user whitelist checks to full M2M callers", () => {
    expect(helper.shouldApplyChallengeWhitelist({ isMachine: true })).to.equal(false);
  });

  it("does not apply challenge user whitelist checks to whitelist-only M2M callers", () => {
    expect(helper.shouldApplyChallengeWhitelist({ bypassChallengeWhitelist: true })).to.equal(
      false,
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
