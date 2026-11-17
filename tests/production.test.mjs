import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProductionQueue,productionRoute,signIntake} from '../backend/tryon/production.mjs';
import {signTicket} from '../backend/tryon/avatar-model.mjs';

function setup(){
  const state=new Map();let chain=Promise.resolve();
  const storage={async get(k){return structuredClone(state.get(k));},async put(k,v){state.set(k,structuredClone(v));},async delete(k){state.delete(k);},async setAlarm(){},transaction(fn){const result=chain.then(()=>fn(storage));chain=result.catch(()=>{});return result;}};
  const queue=new ProductionQueue({storage});
  const env={FAL_KEY:'test-only-model-secret',PRODUCTION_KEY:'test-only-operator-secret',PRODUCTION_QUEUE:{idFromName:n=>n,get:()=>({fetch:(url,init)=>queue.fetch(new Request(url,init))})}};
  let calls=0;
  const network=async url=>{calls++;assert.equal(url,'https://queue.fal.run/meshy/v7.1/requests/test-model-123');return Response.json({model_glb:{url:'https://assets.fal.media/avatar.glb'}});};
  const request=(path,data,auth=false)=>new Request('https://worker.test/production/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+env.PRODUCTION_KEY}:{Origin:'https://the-pit.site'})},body:JSON.stringify(data)});
  const route=(path,data={},auth=false)=>productionRoute(request(path,data,auth),env,network,{});
  const direct=(path,data)=>queue.fetch(new Request('https://queue/'+path,{method:'POST',body:JSON.stringify(data)}));
  const ticket=()=>signTicket({id:'test-model-123',status:'https://queue.fal.run/meshy/v7.1/requests/test-model-123/status',result:'https://queue.fal.run/meshy/v7.1/requests/test-model-123',expires:Date.now()+7200000},env.FAL_KEY);
  return {env,route,direct,ticket,calls:()=>calls};
}

test('motion transfer requires consent, a valid model ticket and numeric dimensions',async()=>{
  const s=setup();
  const data={ticket:await s.ticket(),height:180,yaw:0,action:'wave-v1'};
  assert.equal((await s.route('enqueue',data)).status,400);
  assert.equal((await s.route('enqueue',{...data,consent:true,ticket:'fake'})).status,403);
  assert.equal((await s.route('enqueue',{...data,consent:true,height:'NaN'})).status,400);
  assert.equal(s.calls(),0);
});
test('duplicate transfer creates one job and status discloses neither source nor lease',async()=>{
  const s=setup(),data={ticket:await s.ticket(),height:180,yaw:0,action:'wave-v1',consent:true};
  const first=await(await s.route('enqueue',data)).json();
  const duplicate=await(await s.route('enqueue',data)).json();
  assert.equal(first.jobId,duplicate.jobId);assert.equal(s.calls(),1);
  assert.equal((await s.route('claim')).status,401);
  const claimed=await(await s.route('claim',{},true)).json();assert.ok(claimed.job.lease);
  assert.equal((await(await s.route('claim',{},true)).json()).job,null);
  const status=await(await s.route('status',{receipt:first.receipt})).json();
  assert.equal(status.status,'PROCESSING');assert.equal(status.source,undefined);assert.equal(status.lease,undefined);
  assert.equal((await s.route('status',{receipt:first.receipt+'changed'})).status,403);
});
test('wrong lease cannot finish; successful preview requires 120 verified frames',async()=>{
  const s=setup();await s.route('enqueue',{ticket:await s.ticket(),height:180,yaw:0,action:'wave-v1',consent:true});
  const {job}=await(await s.route('claim',{},true)).json();
  assert.equal((await s.route('finish',{id:job.jobId,lease:'wrong',status:'FAILED'},true)).status,409);
  assert.equal((await s.route('finish',{id:job.jobId,lease:job.lease,status:'NEEDS_REVIEW',result:{}},true)).status,400);
  const finished=await s.route('finish',{id:job.jobId,lease:job.lease,status:'NEEDS_REVIEW',result:{frames:120,fps:24,duration:5,bytes:2000,sha256:'a'.repeat(64)}},true);
  assert.equal(finished.status,200);assert.equal((await finished.json()).status,'NEEDS_REVIEW');
  assert.equal((await s.route('source',{id:job.jobId,lease:job.lease},true)).status,409);
});
test('expired models never enter a processing lease',async()=>{
  const s=setup();await s.direct('enqueue',{id:'expired-model',created:Date.now(),source:'https://assets.fal.media/expired.glb',sourceExpires:Date.now()-100,action:'wave-v1'});
  assert.equal((await(await s.direct('claim',{})).json()).job,null);
  assert.equal((await(await s.direct('lookup',{id:'expired-model'})).json()).status,'EXPIRED');
});
test('parallel claims lease a model once',async()=>{
  const s=setup();await s.direct('enqueue',{id:'parallel-model',created:Date.now(),sourceExpires:Date.now()+60000,action:'wave-v1'});
  const responses=await Promise.all([s.direct('claim',{}),s.direct('claim',{})]);
  const results=await Promise.all(responses.map(r=>r.json()));
  assert.equal(results.filter(r=>r.job).length,1);
});

test('signed image intake waits for a model, keeps image private, and links one motion job',async()=>{
  const s=setup(),image='data:image/jpeg;base64,/9j/AA==';
  const intakeTicket=await signIntake('test-front-123',image,s.env.FAL_KEY);
  assert.equal((await s.route('intake',{intakeTicket,image,stage:'front',height:180})).status,400);
  assert.equal((await s.route('intake',{intakeTicket,image:image+'a',stage:'front',height:180,consent:true})).status,400);
  const data={intakeTicket,image,stage:'front',height:180,consent:true};
  const first=await(await s.route('intake',data)).json();
  assert.equal(first.status,'WAITING_MODEL');assert.equal(first.jobId,'app-test-front-123');
  assert.equal((await(await s.route('intake',data)).json()).jobId,first.jobId);
  assert.equal((await(await s.route('claim',{},true)).json()).job,null);
  assert.equal((await s.route('intakes')).status,401);
  assert.equal((await s.route('reference',{id:first.jobId})).status,401);
  const reference=await s.route('reference',{id:first.jobId},true);
  assert.deepEqual(new Uint8Array(await reference.arrayBuffer()),new Uint8Array([255,216,255,0]));
  const model=await(await s.route('enqueue',{ticket:await s.ticket(),intakeTicket,height:180,yaw:0,action:'wave-v1',consent:true})).json();
  assert.equal(model.applicationId,first.jobId);
  const list=await(await s.route('intakes',{},true)).json();
  assert.equal(list.jobs.length,1);assert.equal(list.jobs[0].modelId,model.jobId);
  assert.equal((await(await s.route('status',{receipt:first.receipt})).json()).status,'QUEUED');
  assert.equal(s.calls(),1,'Only read an existing model; never generate one');
});
