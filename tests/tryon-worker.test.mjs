import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, TryOnGate } from '../backend/tryon/worker.mjs';
import catalog from '../backend/tryon/catalog.json' with { type: 'json' };

// Tiny fixture used only by automated tests. It is never presented as a try-on result to a visitor.
const fixture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1cAAAAASUVORK5CYII=';
const taggedFixture = tag => 'data:image/png;base64,' + Buffer.concat([Buffer.from(fixture.split(',')[1],'base64'),Buffer.from(tag)]).toString('base64');
const origin = 'https://the-pit.site';
const payload = {photo:fixture,itemId:catalog[0].id,consent:true,token:'test-token',requestId:'11111111-1111-4111-8111-111111111111'};
const env = {FAL_KEY:'test-secret',TURNSTILE_SECRET:'turnstile-test-secret',TRYON_GATE:{idFromName:name=>name,get:()=>({fetch:async()=>new Response('{}')})}};
const request = (data=payload,from=origin,path='tryon') => new Request('https://worker.test/'+path,{method:'POST',headers:{Origin:from,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify(data)});
function networkStub(options={}) {
  const calls=[];
  const network=async(url,init={})=>{
    calls.push({url,init});
    if(url.includes('/siteverify')) return Response.json({success:!options.badToken,hostname:options.hostname||'the-pit.site',action:options.action||'fit-studio'});
    if(url.startsWith('https://fal.run/')) return options.providerError ? new Response(options.providerDetail || 'private debug secret', {status:options.providerError}) : Response.json({images:[{url:options.output||fixture}]});
    assert.ok(catalog.some(item=>item.image===url),'only catalog garment URLs are fetched');
    assert.equal(init.redirect,'manual','Use the Workers-supported redirect mode and reject redirects without following them');
    if(options.garmentRedirect)return new Response(null,{status:302,headers:{Location:'https://untrusted.example/photo.jpg'}});
    return new Response(Buffer.from(fixture.split(',')[1],'base64'),{headers:{'Content-Type':'image/png'}});
  };
  return {network,calls};
}
test('Health is explicitly unavailable before credentials and quota binding exist',async()=>{
  const response=await createHandler()(new Request('https://worker.test/health'),{});
  assert.equal((await response.json()).ready,false);
  assert.equal((await createHandler()(request(),{})).status,503);
});
test('Unknown origin, missing consent, invalid photo and catalog spoofing make no external calls',async()=>{
  for(const [data,from,status] of [[payload,'https://unknown.example',403],[{...payload,consent:false},origin,400],[{...payload,photo:'data:image/png;base64,YWJj'},origin,400],[{...payload,itemId:'http://internal.example'},origin,400]]) {
    const {network,calls}=networkStub(); assert.equal((await createHandler(network)(request(data,from),env)).status,status);assert.equal(calls.length,0);
  }
});
test('Failed/replayed captcha or mismatched hostname never reaches the paid provider',async()=>{
  for(const options of [{badToken:true},{hostname:'unrelated.example'},{action:'unrelated-action'}]) {
    const {network,calls}=networkStub(options); assert.equal((await createHandler(network)(request(),env)).status,403);assert.equal(calls.length,1);
  }
});

test('Character prioritizes original identity and never sends the unrelated animation thumbnail',async()=>{
  const {network,calls}=networkStub();
  const response=await createHandler(network)(request({...payload,original:fixture,scene:'city',prompt:'override',image_urls:['http://internal']},origin,'character'),env);
  assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
  const model=calls.find(call=>call.url.includes('/flux-2-pro/edit')),body=JSON.parse(model.init.body);
  assert.deepEqual(body.image_urls,[fixture,fixture]);
  assert.match(body.prompt,/Preserve this exact outfit/);assert.match(body.prompt,/original photograph/);
  assert.match(body.prompt,/city street/);assert.ok(!body.prompt.includes('override'));
  assert.match(body.prompt,/photorealistic live-action portrait photograph/);
  assert.match(body.prompt,/skin with fine pores/);
  assert.ok(!body.prompt.includes('lightly stylized 3D character'));
  assert.equal(body.sync_mode,true);assert.equal(body.enable_safety_checker,true);
  assert.deepEqual(body.image_size,{width:768,height:1024});assert.equal(calls.length,2);
});

test('All three orthogonal views reuse the approved anchor with original identity; client prompt cannot override directions',async()=>{
  const original=taggedFixture('original'),face=taggedFixture('face'),anchor=taggedFixture('anchor');
  for(let view=1;view<4;view++){
    const {network,calls}=networkStub();
    const response=await createHandler(network)(request({...payload,original,face,anchor,approved:true,appearance:'production-avatar-v2',view,prompt:'override'},origin,'character-view'),env);
    const result=await response.json();assert.equal(response.status,200);assert.equal(result.view,view);assert.equal(result.appearance,'production-avatar-v2');
    const model=JSON.parse(calls.find(call=>call.url.includes('/flux-2-pro/edit')).init.body);
    assert.deepEqual(model.image_urls,[original,face,fixture,anchor]);
    assert.ok(model.prompt.includes(`orientation ${view*90} degrees`));assert.match(model.prompt,/Image 4 is the approved FRONT photographic reference/);
    assert.match(model.prompt,/photorealistic live-action portrait photograph/);
    assert.match(model.prompt,/do not stylize the side or rear views/);
    assert.ok(!model.prompt.includes('override'));assert.equal(calls.length,2);
  }
});

test('Missing approval, invalid direction or invalid reference is rejected before network or quota use',async()=>{
  const base={...payload,original:fixture,anchor:fixture,approved:true,appearance:'production-avatar-v2',view:1};
  for(const data of [{...base,approved:false},{...base,anchor:undefined},{...base,face:'https://untrusted.example/face.jpg'},...[0,4,16,-1,1.5,'1',null].map(view=>({...base,view}))]){
    const {network,calls}=networkStub();const response=await createHandler(network)(request(data,origin,'character-view'),env);
    assert.equal(response.status,400);assert.equal(calls.length,0);
  }
});

test('Missing original photo or unknown character scene is rejected before any paid request',async()=>{
  for(const data of [{...payload,scene:'studio'},{...payload,original:fixture,scene:'arbitrary scene'}]) {
    const {network,calls}=networkStub();assert.equal((await createHandler(network)(request(data,origin,'character'),env)).status,400);assert.equal(calls.length,0);
  }
});

test('Stale character style is rejected before consuming captcha, quota or paid inference',async()=>{
  for(const appearance of [undefined,'stylized-v1']){
    let reserved=false;
    const backed={...env,TRYON_GATE:{idFromName:name=>name,get:()=>({fetch:async()=>{reserved=true;return Response.json({allowed:true})}})}};
    const {network,calls}=networkStub();
    const data={...payload,original:fixture,anchor:fixture,approved:true,view:1,appearance};
    const response=await createHandler(network)(request(data,origin,'character-view'),backed);
    assert.equal(response.status,409);assert.equal((await response.json()).code,'CHARACTER_VERSION_CHANGED');
    assert.equal(calls.length,0);assert.equal(reserved,false);
  }
});

test('Immediate try-on to character progression is allowed while repeat requests stay throttled',async()=>{
  const records=new Map();
  const storage={get:async key=>records.get(key),put:async(key,value)=>records.set(key,structuredClone(value)),setAlarm:async()=>{},deleteAll:async()=>records.clear()};
  storage.transaction=async fn=>fn(storage);const gate=new TryOnGate({storage},{DAILY_LIMIT:'10'});
  const permit=(stage,id)=>gate.fetch(new Request('https://gate/permit',{method:'POST',body:JSON.stringify({visitor:'same-user',requestId:id,stage})}));
  assert.equal((await permit('tryon','first')).status,200);
  assert.equal((await permit('character','second')).status,200);
  assert.equal((await permit('character','third')).status,429);
});
test('Quota denial prevents model invocation',async()=>{
  const {network,calls}=networkStub();
  const limited={...env,TRYON_GATE:{idFromName:name=>name,get:()=>({fetch:async()=>new Response('{}',{status:429})})}};
  assert.equal((await createHandler(network)(request(),limited)).status,429);assert.ok(!calls.some(call=>call.url.startsWith('https://fal.run/')));
});

test('Redirected catalog photos are rejected before quota reservation or paid generation',async()=>{
  let reserved=false;const backed={...env,TRYON_GATE:{idFromName:name=>name,get:()=>({fetch:async()=>{reserved=true;return Response.json({allowed:true})}})}};
  const stub=networkStub({garmentRedirect:true});const response=await createHandler(stub.network)(request(),backed);
  assert.equal(response.status,502);assert.equal(reserved,false);assert.ok(!stub.calls.some(call=>call.url.startsWith('https://fal.run/')));
});
test('Real model request uses both images, safe credentials, category and no body measurement metadata',async()=>{
  const {network,calls}=networkStub();const response=await createHandler(network)(request({...payload,chest:94,garment:'http://internal.example'}),env);
  assert.equal(response.status,200);assert.equal((await response.json()).image,fixture);
  const model=calls.find(call=>call.url.startsWith('https://fal.run/')),body=JSON.parse(model.init.body);
  assert.equal(body.model_image,fixture);assert.ok(body.garment_image.startsWith('data:image/png;'));
  assert.equal(body.category,'tops');assert.equal(body.chest,undefined);assert.equal(body.sync_mode,true);
  assert.equal(body.enable_safety_checker,true);assert.equal(model.init.headers['X-Fal-Store-IO'],'0');assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('Provider failures cannot leak private diagnostics or return a fake successful image',async()=>{
  const {network}=networkStub({providerError:402});const response=await createHandler(network)(request(),env);const result=await response.json();
  assert.equal(response.status,503);assert.equal(result.ok,false);assert.ok(!JSON.stringify(result).includes('private debug'));
  const invalid=networkStub({output:'https://untrusted.example/output.jpg'});assert.notEqual((await createHandler(invalid.network)(request(),env)).status,200);
});
test('Durable gate enforces account cap, replay prevention and per-visitor cooldown',async()=>{
  const records=new Map();let alarm;
  const storage={get:async key=>records.get(key),put:async(key,value)=>records.set(key,structuredClone(value)),setAlarm:async value=>{alarm=value},deleteAll:async()=>records.clear()};
  storage.transaction=async fn=>fn(storage);
  const gate=new TryOnGate({storage},{DAILY_LIMIT:'2'});
  const permit=(visitor,id)=>gate.fetch(new Request('https://gate/permit',{method:'POST',body:JSON.stringify({visitor,requestId:id})}));
  assert.equal((await permit('a','one')).status,200);assert.equal((await permit('a','two')).status,429);
  assert.equal((await permit('b','one')).status,409);assert.equal((await permit('b','two')).status,200);assert.equal((await permit('c','three')).status,429);
  assert.ok(alarm>Date.now());await gate.alarm();assert.equal(records.size,0);
});

test('fal exhausted-balance rejection is actionable and rolls back exactly one reservation',async()=>{
  const records=new Map();const storage={get:async key=>structuredClone(records.get(key)),put:async(key,value)=>records.set(key,structuredClone(value)),setAlarm:async()=>{}};
  storage.transaction=async fn=>fn(storage);const gate=new TryOnGate({storage},{DAILY_LIMIT:'10'});
  const backed={...env,TRYON_GATE:{idFromName:name=>name,get:()=>({fetch:(url,init)=>gate.fetch(new Request(url,init))})}};
  const failed=networkStub({providerError:403,providerDetail:'User is locked. Reason: Exhausted balance. Top up your balance. private debug secret'});
  const response=await createHandler(failed.network)(request(),backed),body=await response.json();
  assert.equal(response.status,503);assert.equal(body.code,'PROVIDER_BALANCE');assert.match(body.error,/잔액이 부족/);assert.match(body.error,/차감하지/);assert.ok(!JSON.stringify(body).includes('private debug'));
  assert.equal(records.get('quota').count,0);assert.equal(Object.values(records.get('quota').visitors)[0].count,0);
  const visitor=Object.keys(records.get('quota').visitors)[0];
  await gate.fetch(new Request('https://gate/release',{method:'POST',body:JSON.stringify({visitor,requestId:payload.requestId})}));
  assert.equal(records.get('quota').count,0);
  const replay=await gate.fetch(new Request('https://gate/permit',{method:'POST',body:JSON.stringify({visitor,requestId:payload.requestId})}));assert.equal(replay.status,409);
  const success=networkStub();assert.equal((await createHandler(success.network)(request({...payload,requestId:'22222222-2222-4222-8222-222222222222'}),backed)).status,200);
  assert.equal(records.get('quota').count,1);
});

test('Quota cooldown, daily exhaustion and storage failures have distinct responses',async()=>{
  for(const [code,status,retryAfter] of [['COOLDOWN',429,24],['DAILY_LIMIT',429,3600],['VISITOR_DAILY_LIMIT',429,3600],['DUPLICATE_REQUEST',409,60],['internal',500,undefined]]){
    const backed={...env,TRYON_GATE:{idFromName:name=>name,get:()=>({fetch:async()=>Response.json({code,retryAfter},{status})})}};
    const stub=networkStub();const response=await createHandler(stub.network)(request(),backed);const body=await response.json();
    assert.equal(response.status,status===500?503:status);assert.equal(body.code,status===500?'QUOTA_UNAVAILABLE':code);
    if(code==='COOLDOWN'){assert.match(body.error,/24초/);assert.equal(response.headers.get('Retry-After'),'24');}
    assert.ok(!stub.calls.some(call=>call.url.startsWith('https://fal.run/')));
  }
});

test('Uncertain provider failures keep the safety reservation while explicit rejections release it',async()=>{
  for(const providerError of [400,401,402,403,422,429,500,504]){
    const operations=[];const backed={...env,TRYON_GATE:{idFromName:name=>name,get:()=>({fetch:async(url)=>{operations.push(url);return Response.json(url.endsWith('/release')?{released:true}:{allowed:true})}})}};
    const stub=networkStub({providerError});await createHandler(stub.network)(request(),backed);
    assert.equal(operations.some(url=>url.endsWith('/release')),providerError<500);
  }
});

test('Configured testing allowance supports 20 full pairs plus 10 retries and still stops at 50',async(t)=>{
  let now=Date.parse('2026-11-16T02:00:00Z');t.mock.method(Date,'now',()=>now);
  const records=new Map();const storage={get:async key=>structuredClone(records.get(key)),put:async(key,value)=>records.set(key,structuredClone(value)),setAlarm:async()=>{}};
  storage.transaction=async fn=>fn(storage);
  const gate=new TryOnGate({storage},{DAILY_LIMIT:'50',VISITOR_DAILY_LIMIT:'50'});
  for(let i=0;i<50;i++){
    const response=await gate.fetch(new Request('https://gate/permit',{method:'POST',body:JSON.stringify({visitor:'tester',requestId:'test-'+i,stage:i%2?'character':'tryon'})}));
    assert.equal(response.status,200);now+=61000;
  }
  const stopped=await gate.fetch(new Request('https://gate/permit',{method:'POST',body:JSON.stringify({visitor:'tester',requestId:'one-too-many'})}));
  assert.equal(stopped.status,429);assert.equal((await stopped.json()).code,'DAILY_LIMIT');assert.equal(records.get('quota').count,50);
});

test('Missing or malformed visitor allowance retains the default five-request cap',async(t)=>{
  let now=Date.parse('2026-11-16T02:00:00Z');t.mock.method(Date,'now',()=>now);
  for(const value of [undefined,'0','-1','invalid','3.5']){
    const records=new Map();const storage={get:async key=>structuredClone(records.get(key)),put:async(key,data)=>records.set(key,structuredClone(data)),setAlarm:async()=>{}};
    storage.transaction=async fn=>fn(storage);const gate=new TryOnGate({storage},{DAILY_LIMIT:'50',VISITOR_DAILY_LIMIT:value});
    for(let i=0;i<5;i++){assert.equal((await gate.fetch(new Request('https://gate/permit',{method:'POST',body:JSON.stringify({visitor:'tester',requestId:'test-'+i})}))).status,200);now+=61000;}
    const result=await gate.fetch(new Request('https://gate/permit',{method:'POST',body:JSON.stringify({visitor:'tester',requestId:'sixth'})}));
    assert.equal((await result.json()).code,'VISITOR_DAILY_LIMIT');
  }
});
