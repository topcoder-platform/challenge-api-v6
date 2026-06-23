const { expect } = require("chai");

const constants = require("../../app-constants");
const appRoutes = require("../../app-routes");
const routes = require("../../src/routes");

describe("Challenge route access", () => {
  const { __testables } = appRoutes;
  const talentManagerRoles = [constants.UserRoles.TalentManager];

  const challengeEditRoutes = [
    ["/challenges", "post"],
    ["/challenges/:challengeId", "put"],
    ["/challenges/:challengeId", "patch"],
    ["/challenges/:challengeId", "delete"],
    ["/challenges/:challengeId/attachments", "post"],
    ["/challenges/:challengeId/attachments/:attachmentId", "put"],
    ["/challenges/:challengeId/attachments/:attachmentId", "patch"],
    ["/challenges/:challengeId/attachments/:attachmentId", "delete"],
    ["/challenges/:challengeId/phases/:id", "patch"],
    ["/challenges/:challengeId/phases/:id", "delete"],
  ];

  it("allows talent manager roles on challenge create and edit routes", () => {
    challengeEditRoutes.forEach(([path, method]) => {
      const accessRoles = routes[path][method].access || [];

      talentManagerRoles.forEach((role) => {
        expect(accessRoles, `${method.toUpperCase()} ${path} should allow ${role}`).to.include(
          role,
        );
      });
    });
  });

  it("normalizes valid no-role scoped tokens as M2M callers", () => {
    const authUser = {
      scope: "read:challenges",
    };

    expect(__testables.isM2MAuthUser(authUser)).to.equal(true);
    expect(
      __testables.normalizeM2MAuthUser(routes["/challenges/:challengeId"].get, authUser),
    ).to.equal(true);
    expect(authUser.isMachine).to.equal(true);
    expect(authUser.scopes).to.deep.equal(["read:challenges"]);
  });

  it("does not normalize role-bearing users with scopes as M2M callers", () => {
    const authUser = {
      roles: [constants.UserRoles.User],
      scope: "read:challenges",
    };

    expect(__testables.isM2MAuthUser(authUser)).to.equal(false);
    expect(
      __testables.normalizeM2MAuthUser(routes["/challenges/:challengeId"].get, authUser),
    ).to.equal(false);
    expect(authUser.isMachine).to.equal(undefined);
  });
});
