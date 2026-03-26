const { expect } = require("chai");

const constants = require("../../app-constants");
const routes = require("../../src/routes");

describe("Challenge route access", () => {
  const talentManagerRoles = [
    constants.UserRoles.TalentManager,
  ];

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
});
