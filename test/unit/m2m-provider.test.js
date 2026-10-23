/*
 * USE_KEYCLOAK selects the outbound M2M provider. Synthetic KEYCLOAK_* and AUTH0_* values come
 * from test/keycloak.setup.cjs; no real credentials or network calls are used.
 */
require("../../app-bootstrap");

const path = require("path");
const { expect } = require("chai");
const core = require("tc-core-library-js");

// The axios copy tc-core-library-js uses for Auth0 token requests.
const coreAxios = require(
  require.resolve("axios", { paths: [path.dirname(require.resolve("tc-core-library-js"))] }),
);

const helperPath = require.resolve("../../src/common/helper");
const m2mHelperPath = require.resolve("../../src/common/m2m-helper");
const busApiPath = require.resolve("topcoder-bus-api-wrapper");

describe("USE_KEYCLOAK M2M provider selection", () => {
  const original = {
    helper: require.cache[helperPath],
    m2mHelper: require.cache[m2mHelperPath],
    busApi: require.cache[busApiPath],
    m2m: core.auth.m2m,
    adapter: coreAxios.defaults.adapter,
    useKeycloak: process.env.USE_KEYCLOAK,
  };
  let busOptions;
  let factoryOptions;
  let tokenArgs;

  /**
   * Load fresh m2m-helper and helper modules for a USE_KEYCLOAK value.
   * @param {String|undefined} value USE_KEYCLOAK for this load; undefined removes it.
   * @param {Boolean} stubFactory replace auth.m2m with a recording stub when true.
   * @returns {Object} the fresh m2mHelper and helper modules.
   */
  function load(value, stubFactory = true) {
    if (value === undefined) delete process.env.USE_KEYCLOAK;
    else process.env.USE_KEYCLOAK = value;
    if (stubFactory) {
      core.auth.m2m = (options) => {
        factoryOptions = options;
        return {
          getMachineToken: async (...args) => {
            tokenArgs = args;
            return "token";
          },
        };
      };
    }
    require.cache[busApiPath] = {
      id: busApiPath,
      filename: busApiPath,
      loaded: true,
      exports: (options) => {
        busOptions = options;
        return { postEvent: async () => {} };
      },
    };
    delete require.cache[m2mHelperPath];
    delete require.cache[helperPath];
    return { m2mHelper: require(m2mHelperPath), helper: require(helperPath) };
  }

  beforeEach(() => {
    busOptions = undefined;
    factoryOptions = undefined;
    tokenArgs = undefined;
  });

  afterEach(() => {
    core.auth.m2m = original.m2m;
    coreAxios.defaults.adapter = original.adapter;
    if (original.useKeycloak === undefined) delete process.env.USE_KEYCLOAK;
    else process.env.USE_KEYCLOAK = original.useKeycloak;
    for (const [path, entry] of [
      [helperPath, original.helper],
      [m2mHelperPath, original.m2mHelper],
      [busApiPath, original.busApi],
    ]) {
      if (entry) require.cache[path] = entry;
      else delete require.cache[path];
    }
  });

  it("passes the pre-migration Auth0 settings when USE_KEYCLOAK=false", async () => {
    const { m2mHelper, helper } = load("false");
    expect(factoryOptions).to.deep.equal({
      AUTH0_URL: "https://auth0.example.test/oauth/token",
      AUTH0_AUDIENCE: "https://www.topcoder-dev.com",
      TOKEN_CACHE_TIME: "86400000",
      AUTH0_PROXY_SERVER_URL: "https://auth0-proxy.example.test/token",
      AUTH0_CLIENT_ID: "auth0-test-client",
      AUTH0_CLIENT_SECRET: "synthetic-auth0-secret",
    });
    expect(await m2mHelper.getM2MToken()).to.equal("token");
    expect(tokenArgs).to.deep.equal([]);

    await helper.postBusEvent("test.topic", {});
    expect(busOptions).to.include({
      AUTH0_URL: "https://auth0.example.test/oauth/token",
      AUTH0_AUDIENCE: "https://www.topcoder-dev.com",
      AUTH0_PROXY_SERVER_URL: "https://auth0-proxy.example.test/token",
      AUTH0_CLIENT_ID: "auth0-test-client",
      AUTH0_CLIENT_SECRET: "synthetic-auth0-secret",
      TOKEN_CACHE_TIME: "86400000",
    });
  });

  it("uses Auth0 when USE_KEYCLOAK is unset", async () => {
    const { helper } = load(undefined);
    await helper.postBusEvent("test.topic", {});
    expect(busOptions.AUTH0_URL).to.equal("https://auth0.example.test/oauth/token");
    expect(busOptions.AUTH0_CLIENT_ID).to.equal("auth0-test-client");
  });

  it("requests the Auth0 token with only the Auth0 credentials", async () => {
    let request;
    coreAxios.defaults.adapter = async (sent) => {
      request = { url: sent.url, body: JSON.parse(sent.data) };
      return {
        data: { access_token: "auth0-token" },
        status: 200,
        statusText: "OK",
        headers: {},
        config: sent,
      };
    };
    const { m2mHelper } = load("false", false);
    expect(await m2mHelper.getM2MToken()).to.equal("auth0-token");
    expect(request.url).to.equal("https://auth0-proxy.example.test/token");
    expect(request.body).to.deep.equal({
      grant_type: "client_credentials",
      client_id: "auth0-test-client",
      client_secret: "synthetic-auth0-secret",
      auth0_url: "https://auth0.example.test/oauth/token",
      audience: "https://www.topcoder-dev.com",
    });
  });

  it("gives the bus wrapper the Keycloak settings when USE_KEYCLOAK=true", async () => {
    const { m2mHelper, helper } = load("true");
    expect(await m2mHelper.getM2MToken()).to.equal("token");
    expect(tokenArgs).to.deep.equal([]);

    await helper.postBusEvent("test.topic", {});
    expect(busOptions).to.include({
      AUTH0_URL: "https://keycloak.example.test/m2m/token",
      AUTH0_AUDIENCE: "https://api.example.test",
      AUTH0_CLIENT_ID: "test-client",
      AUTH0_CLIENT_SECRET: "synthetic-test-secret",
    });
    expect(busOptions).to.not.have.property("TOKEN_CACHE_TIME");
  });

  it("fails at load for a USE_KEYCLOAK value other than true/false", () => {
    expect(() => load("yes", false)).to.throw(TypeError, "USE_KEYCLOAK must be true or false");
  });
});
