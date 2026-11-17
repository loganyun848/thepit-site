const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createTestHarness}=require('wrangler');
test('production leases and validated results persist in the real SQLite Durable Object',async()=>{
 const server=createTestHarness({workers:[{configPath:path.resolve(__dirname,'../wrangler.jsonc')}]});
 try{
  await server.listen();const env=await server.getWorker().getEnv();
  const queue=env.PRODUCTION_QUEUE.get(env.PRODUCTION_QUEUE.idFromName('production-regression'));
  const call=(route,data)=>queue.fetch('https://queue/'+route,{method:'POST',body:JSON.stringify(data)});
  const item={id:'test-runtime-model',created:Date.now(),sourceExpires:Date.now()+60000,source:'https://assets.fal.media/fixture.glb',height:180,yaw:0,action:'wave-v1'};
  assert.equal((await call('enqueue',item)).status,202);
  assert.equal((await call('enqueue',item)).status,200);
  const claims=await Promise.all([call('claim',{}),call('claim',{})]);
  const jobs=(await Promise.all(claims.map(r=>r.json()))).map(r=>r.job).filter(Boolean);assert.equal(jobs.length,1);
  const {lease}=jobs[0];assert.ok(lease);
  assert.equal((await call('heartbeat',{id:item.id,lease:'bad'})).status,409);
  assert.equal((await call('heartbeat',{id:item.id,lease})).status,200);
  assert.equal((await call('finish',{id:item.id,lease,status:'NEEDS_REVIEW',result:{duration:5,frames:120,fps:24,bytes:2500,sha256:'b'.repeat(64)}})).status,200);
  const final=await(await call('lookup',{id:item.id})).json();assert.equal(final.status,'NEEDS_REVIEW');assert.equal(final.source,undefined);assert.equal(final.lease,undefined);
  const image='data:image/jpeg;base64,'+Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(150000)]).toString('base64');
  const intake=await call('intake',{id:'app-runtime-test',image,stage:'front',height:180});assert.equal(intake.status,202);
  assert.equal((await(await call('claim',{})).json()).job,null,'Image intake must never be leased to the 3D renderer');
  const reference=await call('reference',{id:'app-runtime-test'});assert.equal((await reference.arrayBuffer()).byteLength,150003,'Large reference survives chunked SQLite storage');
  assert.equal((await(await call('intakes',{})).json()).jobs.length,1);
  await call('link',{id:item.id,applicationId:'app-runtime-test'});
  assert.equal((await(await call('lookup',{id:'app-runtime-test'})).json()).status,'NEEDS_REVIEW');
 }finally{await server.close();}
});
