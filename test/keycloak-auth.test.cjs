/* Synthetic local authentication boundary checks; no real secrets or network calls. */
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { test } = require('node:test');

Object.assign(process.env, {
  M2M_PROVIDER: 'keycloak',
  KEYCLOAK_ISSUER: 'https://keycloak.example.test/realms/test',
  KEYCLOAK_AUDIENCE: 'https://api.example.test',
  KEYCLOAK_TOKEN_URL: 'https://keycloak.example.test/m2m/token',
  VALID_ISSUERS: '["https://members.example.test"]',
  AUTH_SECRET: 'synthetic-unit-test-key',
  ALLOW_LEGACY_USER_AUDIENCE: 'true',
});

/** Signs supplied synthetic claims with a test HMAC key; returns a JWT; throws for invalid JSON data. */
function signed(claims, secret = process.env.AUTH_SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: 'https://members.example.test', sub: '42',
    userId: 42, roles: ['Member'], iat: now, exp: now + 120, ...claims })).toString('base64url');
  const value = `${header}.${body}`;
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
}

/** Runs the compiled HTTP adapter with a supplied token; returns the principal or rejects on authentication failure. */
const adapter = require('../dist/src/common/auth');
function authenticate(token) {
  const request={headers:{authorization:'Bearer '+token}};
  return new Promise((resolve,reject)=>adapter.authenticate(request,{},error=>error?reject(error):resolve(request.authUser)));
}

test('member OAuth scopes cannot create a service identity', async () => {
  const user = await authenticate(signed({ scope: 'read:groups write:bus_api' }));
  assert.equal(user.kind, 'user');
  assert.equal(user.isMachine, false);
  assert.equal(user.userId, '42');
  assert.deepEqual(user.scopes, []);
});

test('invalid signatures and machine-like member claims are rejected', async () => {
  await assert.rejects(authenticate(signed({}, 'wrong-key')));
  await assert.rejects(authenticate(signed({ gty: 'client-credentials', azp: 'm2m-test' })));
  await assert.rejects(authenticate(signed({ isMachine: true })));
});

test('Keycloak issuer cannot authenticate using the member HMAC key', async () => {
  await assert.rejects(authenticate(signed({ iss: process.env.KEYCLOAK_ISSUER,
    gty: 'client-credentials', azp: 'm2m-test', scope: 'read:groups',
    aud: process.env.KEYCLOAK_AUDIENCE, userId: undefined, roles: undefined })));
});

test('route scopes require exact verified service identity and explicit metadata',()=>{
  const user={kind:'service',isMachine:true,roles:[],scopes:['read:resource']};
  assert.equal(adapter.hasRequiredScopes({scopes:['all:resource','read:resource']},user),true);
  assert.equal(adapter.hasRequiredScopes({scopes:['all:resource']},user),false);
  assert.equal(adapter.hasRequiredScopes({},user),false);
  assert.equal(adapter.hasRequiredScopes({scopes:['READ:RESOURCE']},user),false);
  assert.equal(adapter.hasRequiredScopes({scopes:['read:resource']},{...user,kind:'user',isMachine:false}),false);
});

const {getAuditActor}=require('../dist/src/common/audit');
test('service audit attribution never fabricates or mutates a member identity',()=>{
  const service=Object.freeze({kind:'service',isMachine:true,clientId:'worker-a',scopes:['write:challenges'],roles:[]});
  assert.equal(getAuditActor(service),'service:worker-a');
  assert.equal(service.userId,undefined);
  assert.equal(getAuditActor({kind:'user',userId:42}),'42');
  assert.equal(getAuditActor(undefined),'system');
  assert.throws(()=>getAuditActor({kind:'service',isMachine:true}),TypeError);
});
