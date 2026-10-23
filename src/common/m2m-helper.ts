const _ = require("lodash");
const config = require("config");
const { auth } = require("tc-core-library-js");

/**
 * Shared outbound M2M token provider for downstream calls made by the Challenge API
 * (projects, resources, submissions, members and other services).
 *
 * The provider follows `USE_KEYCLOAK`, which tc-core-library-js reads:
 * - `true`: Keycloak, using `KEYCLOAK_TOKEN_URL`, `KEYCLOAK_AUDIENCE`, `KEYCLOAK_CLIENT_ID`,
 *   `KEYCLOAK_CLIENT_SECRET` (and optional `KEYCLOAK_SCOPE`). The Auth0 options are ignored.
 * - unset, empty or `false`: Auth0, using the `AUTH0_*` settings from `config/default.js`
 *   exactly as before the Keycloak migration.
 *
 * One core factory retains its token cache for this service process. The module exports a
 * single instance that `helper`, `project-helper`, `challenge-helper` and scripts share.
 */
class M2MHelper {
  static m2m = null;

  /**
   * Creates the shared factory for the active provider. Takes no arguments and returns nothing.
   * @throws {TypeError} when USE_KEYCLOAK is not true/false, or in Keycloak mode when the
   *   KEYCLOAK_* settings are missing or invalid. Auth0 mode never throws here; missing Auth0
   *   settings reject when a token is requested.
   */
  constructor() {
    M2MHelper.m2m = auth.m2m(M2MHelper.auth0Options());
  }

  /**
   * Returns the Auth0 settings this service used before the Keycloak migration, under the
   * core's option names: `AUTH0_URL`, `AUTH0_AUDIENCE`, `TOKEN_CACHE_TIME`,
   * `AUTH0_PROXY_SERVER_URL`, `AUTH0_CLIENT_ID` and `AUTH0_CLIENT_SECRET` from config.
   * Takes no arguments and does not throw. Passed to `auth.m2m`, which uses them only
   * when USE_KEYCLOAK is not true.
   * @returns {Object} the Auth0 options
   */
  static auth0Options() {
    return _.pick(config, [
      "AUTH0_URL",
      "AUTH0_AUDIENCE",
      "TOKEN_CACHE_TIME",
      "AUTH0_PROXY_SERVER_URL",
      "AUTH0_CLIENT_ID",
      "AUTH0_CLIENT_SECRET",
    ]);
  }

  /**
   * Obtains a cached or new M2M token from the active provider, with that provider's
   * configured client credentials (KEYCLOAK_CLIENT_ID/SECRET or AUTH0_CLIENT_ID/SECRET).
   * Takes no arguments; returns Promise<string>; issuance/verification errors propagate.
   */
  getM2MToken() {
    return M2MHelper.m2m.getMachineToken();
  }
}

module.exports = new M2MHelper();
