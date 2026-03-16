const _ = require("lodash");
const config = require("config");
const m2mAuth = require("tc-core-library-js").auth.m2m;

class TCAIM2MHelper {
  static m2m = null;

  constructor() {
    TCAIM2MHelper.m2m = m2mAuth(
      _.pick(config, ["AUTH0_URL", "AUTH0_AUDIENCE", "TC_AI_M2M_AUTH0_CLIENT_ID", "TC_AI_M2M_AUTH0_CLIENT_SECRET", "AUTH0_PROXY_SERVER_URL"])
    );
  }
  /**
   * Get TC AI M2M token.
   * @returns {Promise<String>} the TC AI M2M token
   */
  getTCAIM2MToken() {
    return TCAIM2MHelper.m2m.getMachineToken(config.TC_AI_M2M_AUTH0_CLIENT_ID, config.TC_AI_M2M_AUTH0_CLIENT_SECRET);
  }
}

module.exports = new TCAIM2MHelper();
