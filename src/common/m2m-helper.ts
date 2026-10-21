const { auth } = require("tc-core-library-js");

/**
 * Shared outbound Keycloak token provider for downstream Challenge API calls.
 * One core factory retains its verified-token cache for this service process.
 */
class M2MHelper {
  static m2m = null;

  /** Initializes the shared factory; no arguments/return value; invalid configuration throws. */
  constructor() {
    M2MHelper.m2m = auth.m2m();
  }

  /**
   * Obtains a verified token using configured Keycloak credentials and approved scopes.
   * Takes no arguments; returns Promise<string>; issuance/verification errors propagate.
   */
  getM2MToken() {
    return M2MHelper.m2m.getMachineToken();
  }
}

module.exports = new M2MHelper();
