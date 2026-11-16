import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, TryOnGate } from '../backend/tryon/worker.mjs';
import { readTicket, signTicket, assetURL } from '../backend/tryon/avatar-model.mjs';
import catalog from '../backend/tryon/catalog.json' with {type:'json'};
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1cAAAAASUVORK5CYII=';
const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',base='https://queue.fal.run/meshy/v7.1/requests/'+id;
const body={images:[image,image,image,image],itemId:catalog[0].id,appearance:'production-avatar-v2',approved:true,bodyConfirmed:true,consent:true,token:'captcha',requestId:crypto.randomUUID()};
function setup(options={}){
  const calls=[],gateCalls=[];
  const env={FAL_KEY:'private-test-key',TURNSTILE_SECRET:'private-captcha-key',TRYON_GATE:{idFromName:s=>s,get:()=>({fetch:async(url,init)=>{gateCalls.push({url,body:JSON.parse(init.body)});return Response.json({allowed:true,released:true});}})}};
  const network=async(url,init={})=>{calls.push({url,init});
    if(url.includes('siteverify'))return Response.json({success:true,hostname:'the-pit.site',action:'fit-studio'});
    if(init.method==='POST')return options.reject?new Response('provider private diagnostics',{status:options.reject}):Response.json({request_id:id,status_url:base+'/status',response_url:options.badQueue?'https://untrusted.example/steal':base});
    if(url===base+'/status')return Response.json(options.failure?{status:'COMPLETED',error:'sensitive log'}:{status:'COMPLETED'});
    if(url===base)return Response.json({model_glb:{url:options.badAsset||'https://v3b.fal.media/files/model.glb'}});
    if(url==='https://v3b.fal.media/files/model.glb'){assert.equal(init.redirect,'manual');assert.equal(init.headers,undefined);return new Response('glb-test-data');}
    throw Error('Unexpected network destination');
  };
  const request=(path,data)=>new Request('https://worker.test/'+path,{method:'POST',headers:{Origin:'https://the-pit.site','Content-Type':'application/json'},body:JSON.stringify(data)});
  return {env,calls,gateCalls,run:(path,data)=>createHandler(network)(request(path,data),env)};
}
test('3D submission requires four verified views, explicit consent and current appearance before any network',async()=>{
  for(const change of [{images:[image]},{consent:false},{bodyConfirmed:false},{approved:false},{appearance:'photographic-v1'},{images:[image,image,image,'https://private/photo']}]){
    const s=setup(),response=await s.run('character-model',{...body,...change});assert.equal(response.status,400);assert.equal(s.calls.length,0);assert.equal(s.gateCalls.length,0);
  }
});
test('One paid queue request returns a read-only ticket; polling and file download never regenerate',async()=>{
  const s=setup(),response=await s.run('character-model',{...body,height:180,prompt:'injected'}),job=await response.json();
  assert.equal(response.status,202);assert.equal(job.status,'IN_QUEUE');assert.ok(!JSON.stringify(job).includes('private-test-key'));
  const submit=s.calls.find(c=>c.url==='https://queue.fal.run/meshy/v7.1/multi-image-to-3d'),input=JSON.parse(submit.init.body);
  assert.deepEqual(input.image_urls,body.images);assert.equal(input.enable_rigging,false);assert.equal(input.enable_pbr,true);assert.equal(input.pose_mode,'a-pose');assert.equal(input.height,undefined);assert.equal(input.prompt,undefined);
  const status=await s.run('character-model/status',{ticket:job.ticket});assert.deepEqual((await status.json()).formats,['glb']);
  const file=await s.run('character-model/file',{ticket:job.ticket,format:'glb'});assert.equal(await file.text(),'glb-test-data');assert.match(file.headers.get('Content-Disposition'),/avatar.glb/);
  assert.equal(s.calls.filter(c=>c.init.method==='POST'&&!c.url.includes('siteverify')).length,1);assert.equal(s.gateCalls.length,1);
});
test('Tampered and expired tickets cannot query the provider or read another job',async()=>{
  const s=setup();const job={id,status:base+'/status',result:base,expires:Date.now()-1};
  for(const ticket of ['bad',await signTicket(job,s.env.FAL_KEY),(await signTicket({...job,expires:Date.now()+10000},s.env.FAL_KEY))+'x']){const result=await s.run('character-model/status',{ticket});assert.equal(result.status,403);}
  assert.equal(s.calls.length,0);
  await assert.rejects(()=>readTicket('a.b',s.env.FAL_KEY));
});
test('Provider queue/asset addresses are constrained and raw error details never escape',async()=>{
  const bad=setup({badQueue:true});assert.equal((await bad.run('character-model',body)).status,502);
  for(const url of ['http://fal.media/a','https://fal.media.evil.test/a','https://127.0.0.1/a','https://user:pass@fal.media/a','https://fal.media:8443/a'])assert.equal(assetURL(url),null);
  const s=setup({failure:true}),job=await (await s.run('character-model',body)).json();const status=await (await s.run('character-model/status',{ticket:job.ticket})).json();assert.equal(status.status,'FAILED');assert.ok(!JSON.stringify(status).includes('sensitive'));
});
test('Definite 3D rejection releases the reservation; ambiguous errors preserve it',async()=>{
  for(const code of [402,403,422,500]){const s=setup({reject:code}),response=await s.run('character-model',body);assert.ok(response.status>=400);assert.equal(s.gateCalls.filter(c=>c.url.endsWith('/release')).length,code===500?0:1);assert.ok(!(await response.text()).includes('private diagnostics'));}
});
test('3D jobs have a distinct three-per-visitor and ten-per-site ceiling',async(t)=>{
  let now=Date.parse('2026-11-17T02:00:00Z');t.mock.method(Date,'now',()=>now);
  const records=new Map(),storage={get:async key=>structuredClone(records.get(key)),put:async(key,value)=>records.set(key,structuredClone(value)),setAlarm:async()=>{}};
  storage.transaction=async fn=>fn(storage);const gate=new TryOnGate({storage},{DAILY_LIMIT:'50',VISITOR_DAILY_LIMIT:'50'});
  const send=async(visitor,stage='avatar-model')=>{now+=61000;return gate.fetch(new Request('https://gate/permit',{method:'POST',body:JSON.stringify({visitor,stage,requestId:crypto.randomUUID()})}));};
  for(let i=0;i<3;i++)assert.equal((await send('first')).status,200);
  const denied=await send('first');assert.equal(denied.status,429);assert.equal((await denied.json()).code,'MODEL_DAILY_LIMIT');
  for(let i=0;i<7;i++)assert.equal((await send('visitor-'+i)).status,200);
  assert.equal((await send('eleventh')).status,429);
  assert.equal((await send('first','tryon')).status,200,'3D cap does not block an allowed image request');
});
