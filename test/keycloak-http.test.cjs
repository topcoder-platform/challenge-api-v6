/* Compiled route authentication with signed synthetic RSA tokens; business handlers are isolated. */
require('./keycloak.setup.cjs');
process.env.LOG_LEVEL='error';
process.env.DATABASE_URL='postgresql://local:local@127.0.0.1:1/unused';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {before,after,test}=require('node:test');
const express=require('express');
const nock=require('nock');
const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
let server,base;

/** Signs supplied test claims with the local RSA key; returns a JWT; crypto errors propagate. */
function serviceToken(claims={}) {
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const now=Math.floor(Date.now()/1000);
  const value=encode({alg:'RS256',kid:'route-test'})+'.'+encode({iss:process.env.KEYCLOAK_ISSUER,
    aud:process.env.KEYCLOAK_AUDIENCE,sub:'service-account-test',azp:'route-test-client',
    gty:'client-credentials',scope:'read:challenges',iat:now,exp:now+120,...claims});
  return value+'.'+crypto.sign('RSA-SHA256',Buffer.from(value),keys.privateKey).toString('base64url');
}

before(async()=>{
  const issuer=new URL(process.env.KEYCLOAK_ISSUER);
  nock(issuer.origin).persist().get(issuer.pathname+'/protocol/openid-connect/certs').reply(200,
    {keys:[{...keys.publicKey.export({format:'jwk'}),kid:'route-test',alg:'RS256',use:'sig'}]});
  const definitions=require('../dist/src/routes');
  const controllers=new Map();
  for(const verbs of Object.values(definitions)) for(const def of Object.values(verbs)) {
    if(!controllers.has(def.controller)) controllers.set(def.controller,{});
    controllers.get(def.controller)[def.method]=(req,res)=>res.json({principal:req.authUser||null});
  }
  const saved=[];
  for(const [name,exports] of controllers) {
    const file=require.resolve('../dist/src/controllers/'+name);saved.push([file,require.cache[file]]);
    require.cache[file]={id:file,filename:file,loaded:true,exports};
  }
  const app=express();
  try {require('../dist/app-routes')(app);} finally {
    for(const [file,previous] of saved) {if(previous) require.cache[file]=previous;else delete require.cache[file];}
  }
  app.use((error,_req,res,_next)=>res.status(error.httpStatus||500).json({error:error.name}));
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  base='http://127.0.0.1:'+server.address().port+'/v6';
});
after(async()=>{nock.cleanAll();if(server)await new Promise(resolve=>server.close(resolve));});

test('a service read reaches the public handler with no member identity',async()=>{
  const response=await fetch(base+'/challenges',{headers:{authorization:'Bearer '+serviceToken()}});
  assert.equal(response.status,200);
  const {principal}=await response.json();
  assert.equal(principal.kind,'service');assert.equal(principal.userId,undefined);
  assert.equal(principal.handle,undefined);assert.deepEqual(principal.roles,[]);
});
test('insufficient service scopes cannot retain a public whitelist bypass',async()=>{
  const response=await fetch(base+'/challenges',{headers:{authorization:'Bearer '+serviceToken({scope:'write:bus_api'})}});
  assert.equal(response.status,403);
});
test('a read scope cannot create challenges while an exact create grant can',async()=>{
  let response=await fetch(base+'/challenges',{method:'POST',headers:{authorization:'Bearer '+serviceToken()}});
  assert.equal(response.status,403);
  response=await fetch(base+'/challenges',{method:'POST',headers:{authorization:'Bearer '+serviceToken({scope:'create:challenges'})}});
  assert.equal(response.status,200);
  const {principal}=await response.json();assert.equal(principal.userId,undefined);
});
test('invalid or wrong-audience tokens are anonymous on public routes and unauthorized on protected routes',async()=>{
  for(const token of ['invalid',serviceToken({aud:'wrong-audience'})]) {
    const headers={authorization:'Bearer '+token};
    const response=await fetch(base+'/challenges',{headers});
    assert.equal(response.status,200);assert.equal((await response.json()).principal,null);
    assert.equal((await fetch(base+'/challenges',{method:'POST',headers})).status,401);
  }
});
