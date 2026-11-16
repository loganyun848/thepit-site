const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createTestHarness}=require('wrangler');

// Real local workerd + SQLite storage. No real photos, remote bindings or paid API calls.
test('SQLite quota reservation refunds survive the real Worker boundary and remain idempotent',async()=>{
 const server=createTestHarness({workers:[{configPath:path.resolve(__dirname,'../wrangler.jsonc')}]});
 try{
  await server.listen();
  const env=await server.getWorker().getEnv();
  const gate=env.TRYON_GATE.get(env.TRYON_GATE.idFromName('quota-regression'));
  const call=(action,requestId,visitor='test-user',stage='tryon')=>gate.fetch('https://gate/'+action,{method:'POST',body:JSON.stringify({visitor,requestId,stage})});
  assert.equal((await call('permit','one')).status,200);
  const cooldown=await call('permit','two');assert.equal(cooldown.status,429);assert.equal((await cooldown.json()).code,'COOLDOWN');
  assert.equal((await call('release','one','different-user')).status,404);
  assert.equal((await call('release','one')).status,200);
  assert.equal((await call('release','one')).status,200);
  assert.equal((await call('permit','one')).status,409);
  assert.equal((await call('permit','two')).status,200);
  assert.equal((await call('permit','three','test-user','character')).status,200);
 }finally{await server.close()}
});
