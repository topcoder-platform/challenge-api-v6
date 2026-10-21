/* Run only against an explicitly supplied disposable DATABASE_URL. */
require('./keycloak.setup.cjs');
require('../dist/app-bootstrap');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomUUID}=require('node:crypto');
const {getClient}=require('../dist/src/common/prisma');
const helper=require('../dist/src/common/helper');
const service=require('../dist/src/services/PhaseService');
const prisma=getClient();

test('service writes persist client audit attribution without a member ID',async()=>{
  const caller=Object.freeze({kind:'service',isMachine:true,clientId:'audit-worker',roles:[],scopes:['all:challenges']});
  const previous=helper.postBusEvent;
  let id;
  helper.postBusEvent=async()=>{};
  try {
    const phase=await service.createPhase(caller,{name:'Keycloak audit '+randomUUID(),isOpen:false,duration:60});
    id=phase.id;
    let row=await prisma.phase.findUniqueOrThrow({where:{id}});
    assert.equal(row.createdBy,'service:audit-worker');assert.equal(row.updatedBy,'service:audit-worker');
    await service.partiallyUpdatePhase(caller,id,{duration:120});
    row=await prisma.phase.findUniqueOrThrow({where:{id}});
    assert.equal(row.duration,120);assert.equal(row.updatedBy,'service:audit-worker');
    assert.equal(caller.userId,undefined);
    for(const check of [helper.userHasProjectWriteAccess,helper.userHasProjectManagerAccess]) {
      assert.equal(await check(123,caller),true);
    }
  } finally {
    helper.postBusEvent=previous;
    if(id)await prisma.phase.delete({where:{id}});
    await prisma.$disconnect();
  }
});
