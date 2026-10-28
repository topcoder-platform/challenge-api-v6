const assert = require('node:assert/strict');
const Module = require('node:module');
const { generateKeyPairSync } = require('node:crypto');
const { createRequire } = require('node:module');
const jwt = require('jsonwebtoken');

const secret = 'routes-test-signing-secret-at-least-32-bytes';
const issuer = 'https://auth.topcoder-dev.com/';
const sharedRequire = createRequire(require.resolve('tc-core-library-js'));
const { JwksClient } = sharedRequire('jwks-rsa');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

describe('route JWT configuration', () => {
  const originalEnv = process.env;
  const originalSigningKey = JwksClient.prototype.getSigningKey;
  let authenticate: any;
  let optionalAuthenticate: any;

  before(() => {
    process.env = { ...originalEnv, AUTH_SECRET: secret, VALID_ISSUERS: JSON.stringify([issuer]), JWT_AUDIENCE: 'browser-client', AUTH0_AUDIENCE: 'machine-api' };
    // Stub only JWKS I/O. The actual route middleware and released verifier run.
    JwksClient.prototype.getSigningKey = async () => ({ getPublicKey: () => publicKey.export({ type: 'spki', format: 'pem' }).toString() });
    const configPath = require.resolve('../../config/default.js');
    delete require.cache[configPath];
    const config = require(configPath);
    const routePath = require.resolve('../../app-routes');
    delete require.cache[routePath];
    const originalLoad = Module._load;
    const routes: Record<string, any[]> = {};
    Module._load = function (name: string, parent: any, ...rest: any[]) {
      if (parent?.filename === routePath) {
        if (name === 'config') return config;
        if (name === './src/routes') return { '/jwt-test': { get: { auth: true, controller: 'JwtTest', method: 'run', scopes: ['read:test'], access: ['User'] } }, '/optional-jwt-test': { get: { auth: false, controller: 'JwtTest', method: 'run' } } };
        if (name === './src/controllers/JwtTest') return { run: () => undefined };
        if (name === './src/common/helper') return { autoWrapExpress: (actions: any[]) => actions };
        if (name === './src/common/logger') return { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
      }
      return originalLoad.call(this, name, parent, ...rest);
    };
    try {
      require(routePath)({ get: (path: string, actions: any[]) => { routes[path] = actions; }, use: () => undefined });
      authenticate = routes[`/${config.API_VERSION}/jwt-test`][2];
      optionalAuthenticate = routes[`/${config.API_VERSION}/optional-jwt-test`][2];
    } finally {
      Module._load = originalLoad;
      delete require.cache[routePath];
      delete require.cache[configPath];
    }
  });

  after(() => {
    process.env = originalEnv;
    JwksClient.prototype.getSigningKey = originalSigningKey;
  });

  /** Executes the registered protected-route authenticator with a signed token.
   * @param token Compact JWT. @returns Status and verified identity; rejects on unexpected middleware errors.
   */
  function verify(token: string): Promise<any> {
    const request: any = { headers: { authorization: `Bearer ${token}` } };
    return new Promise((resolve, reject) => {
      const response: any = { statusCode: 200 };
      response.status = (status: number) => { response.statusCode = status; return response; };
      response.json = () => resolve({ status: response.statusCode, user: request.authUser });
      response.send = response.json;
      authenticate(request, response, (error?: Error) => error ? reject(error) : resolve({ status: response.statusCode, user: request.authUser }));
    });
  }

  it('finishes optional authentication promptly for an invalid bearer token', async () => {
    const request: any = { headers: { authorization: 'Bearer invalid-token' } };
    let calls = 0;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Optional JWT rejection did not continue promptly')), 500);
      optionalAuthenticate(request, {}, () => { calls++; clearTimeout(timeout); resolve(); });
    });
    assert.equal(calls, 1);
    assert.equal(request.authUser, undefined);
  });

  it('accepts browser RSA tokens using JWT_AUDIENCE', async () => {
    const token = jwt.sign({ userId: '42', roles: ['User'] }, privateKey, { algorithm: 'RS256', keyid: 'test-key', issuer, audience: 'browser-client', expiresIn: 300 });
    const result = await verify(token);
    assert.equal(result.status, 200);
    assert.equal(result.user.isMachine, false);
  });

  it('accepts machine RSA tokens using AUTH0_AUDIENCE', async () => {
    const token = jwt.sign({ sub: 'client@clients', gty: 'client-credentials', scope: 'read:test' }, privateKey, { algorithm: 'RS256', keyid: 'test-key', issuer, audience: 'machine-api', expiresIn: 300 });
    const result = await verify(token);
    assert.equal(result.status, 200);
    assert.equal(result.user.isMachine, true);
  });

  it('retains legacy HS256 human tokens without an audience', async () => {
    const token = jwt.sign({ userId: '42', roles: ['User'] }, secret, { issuer, expiresIn: 300 });
    assert.equal((await verify(token)).status, 200);
  });

  it('rejects an untrusted audience', async () => {
    const token = jwt.sign({ userId: '42' }, privateKey, { algorithm: 'RS256', keyid: 'test-key', issuer, audience: 'another-api', expiresIn: 300 });
    assert.equal((await verify(token)).status, 401);
  });

  it('rejects a machine token addressed to the browser client', async () => {
    const token = jwt.sign({ sub: 'client@clients', gty: 'client-credentials' }, privateKey, { algorithm: 'RS256', keyid: 'test-key', issuer, audience: 'browser-client', expiresIn: 300 });
    assert.equal((await verify(token)).status, 401);
  });

  it('rejects an invalid signature', async () => {
    const token = jwt.sign({ userId: '42' }, 'incorrect-secret-at-least-32-bytes', { issuer, expiresIn: 300 });
    assert.equal((await verify(token)).status, 401);
  });
});
