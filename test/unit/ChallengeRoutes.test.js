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

  it("accepts only a verified service with an exact route scope", () => {
    const principal = Object.freeze({kind:"service",isMachine:true,scopes:["read:challenges"],roles:[],clientId:"test-client"});
    expect(__testables.isM2MAuthUser(principal)).to.equal(true);
    expect(__testables.hasRequiredM2MScopes(routes["/challenges/:challengeId"].get,principal)).to.equal(true);
    expect(__testables.hasRequiredM2MScopes({scopes:["write:challenges"]},principal)).to.equal(false);
    expect(__testables.hasRequiredM2MScopes({},principal)).to.equal(false);
    expect(principal.userId).to.equal(undefined);
  });

  it("does not classify raw scopes, permissions, or a standalone machine flag as a service", () => {
    for(const principal of [{scope:"read:challenges"},{permissions:["read:challenges"]},{isMachine:true},
      {kind:"user",isMachine:false,roles:[constants.UserRoles.User],scopes:["read:challenges"]}]) {
      expect(__testables.isM2MAuthUser(principal)).to.equal(false);
      expect(__testables.hasRequiredM2MScopes(routes["/challenges/:challengeId"].get,principal)).to.equal(false);
    }
  });

  it("redacts query tokens and nested credential fields in diagnostics", () => {
    expect(__testables.sanitizeForLog({token:"sensitive",query:{access_token:"sensitive",name:"sample"}}))
      .to.deep.equal({token:"<redacted>",query:{access_token:"<redacted>",name:"sample"}});
  });
});
