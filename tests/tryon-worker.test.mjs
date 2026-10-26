import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, TryOnGate } from '../backend/tryon/worker.mjs';
import catalog from '../backend/tryon/catalog.json' with { type: 'json' };
import { STYLE_REFERENCE } from '../backend/tryon/character-style.mjs';

// Tiny fixture used only by automated tests. It is never presented as a try-on result to a visitor.
const fixture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1cAAAAASUVORK5CYII=';
const origin = 'https://the-pit.site';
const payload = {photo:fixture,itemId:catalog[0].id,consent:true,token:'test-token',requestId:'11111111-1111-4111-8111-111111111111'};
const env = {FAL_KEY:'test-secret',TURNSTILE_SECRET:'turnstile-test-secret',TRYON_GATE:{idFromName:name=>name,get:()=>({fetch:async()=>new Response('{}')})}};
const request = (data=payload,from=origin,path='tryon') => new Request('https://worker.test/'+path,{method:'POST',headers:{Origin:from,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify(data)});
function networkStub(options={}) {
  const calls=[];
  const network=async(url,init={})=>{
    calls.push({url,init});
    if(url.includes('/siteverify')) return Response.json({success:!options.badToken,hostname:options.hostname||'the-pit.site',action:options.action||'fit-studio'});
    if(url.startsWith('https://fal.run/')) return options.providerError ? new Response('private debug secret', {status:options.providerError}) : Response.json({images:[{url:options.output||fixture}]});
    assert.ok(catalog.some(item=>item.image===url),'only catalog garment URLs are fetched');
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

test('Character stage receives the dressed person, original identity and first-party style in that order',async()=>{
  const {network,calls}=networkStub();
  const response=await createHandler(network)(request({...payload,original:fixture,scene:'city',prompt:'override',image_urls:['http://internal']},origin,'character'),env);
  assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
  const model=calls.find(call=>call.url.includes('/flux-2-pro/edit')),body=JSON.parse(model.init.body);
  assert.deepEqual(body.image_urls,[fixture,fixture,STYLE_REFERENCE]);
  assert.match(body.prompt,/Preserve this exact outfit/);assert.match(body.prompt,/original photograph/);
  assert.match(body.prompt,/city street/);assert.ok(!body.prompt.includes('override'));
  assert.equal(body.sync_mode,true);assert.equal(body.enable_safety_checker,true);
  assert.deepEqual(body.image_size,{width:864,height:1152});assert.equal(calls.length,2);
});

test('Missing original photo or unknown character scene is rejected before any paid request',async()=>{
  for(const data of [{...payload,scene:'studio'},{...payload,original:fixture,scene:'arbitrary scene'}]) {
    const {network,calls}=networkStub();assert.equal((await createHandler(network)(request(data,origin,'character'),env)).status,400);assert.equal(calls.length,0);
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
  assert.equal((await createHandler(network)(request(),limited)).status,429);assert.equal(calls.length,1);
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
  assert.equal((await permit('b','one')).status,429);assert.equal((await permit('b','two')).status,200);assert.equal((await permit('c','three')).status,429);
  assert.ok(alarm>Date.now());await gate.alarm();assert.equal(records.size,0);
});
