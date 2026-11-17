import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../../../fit.html',import.meta.url),'utf8'),script=readFileSync(new URL('../../../production-handoff.js',import.meta.url),'utf8');
const tick=()=>new Promise(setImmediate);
function setup(){const dom=new JSDOM(html,{url:'https://the-pit.site',runScripts:'outside-only'}),w=dom.window,calls=[];w.THEPIT_CONFIG={TRYON_ENDPOINT:'https://worker.test'};w.AbortSignal=AbortSignal;w.fetch=async(url,init)=>{calls.push({url,data:JSON.parse(init.body)});return Response.json({ok:true,jobId:'test-model',status:'QUEUED',receipt:'test-receipt'});};w.eval(script);const $=id=>w.document.getElementById(id);return{dom,w,$,calls,ready(){w.dispatchEvent(new w.CustomEvent('avatar:model-ready',{detail:{ticket:'model-ticket',settings:()=>({height:180,yaw:1.2})}}));}};}
test('completed model is not sent without separate consent and a click',async()=>{const s=setup();try{s.ready();assert.equal(s.calls.length,0);assert.equal(s.$('sendProduction').disabled,true);s.$('productionConsent').checked=true;s.$('productionConsent').dispatchEvent(new s.w.Event('change'));s.$('sendProduction').click();await tick();assert.equal(s.calls.length,1);assert.equal(s.calls[0].data.yaw,1.2);assert.equal(s.calls[0].data.consent,true);assert.equal(s.$('sendProduction').disabled,true);}finally{s.dom.window.close();}});
test('replacing avatar clears production access and prior consent',async()=>{const s=setup();try{s.ready();s.$('productionConsent').checked=true;s.w.dispatchEvent(new s.w.CustomEvent('avatar:model-ready',{detail:null}));assert.equal(s.$('productionWorkspace').hidden,true);assert.equal(s.$('productionConsent').checked,false);assert.equal(s.$('sendProduction').disabled,true);assert.equal(s.calls.length,0);}finally{s.dom.window.close();}});

test('successful application receives image once then automatically transfers the completed model',async()=>{
 const s=setup();try{
  const draft={intakeTicket:'signed-front',images:['data:image/jpeg;base64,/9j/AA=='],height:180,stage:'front'};
  await s.w.THEPIT_PRODUCTION.applicationSubmitted(draft);
  assert.deepEqual(s.calls.map(c=>new URL(c.url).pathname),['/production/intake']);
  s.ready();await tick();await tick();
  assert.deepEqual(s.calls.map(c=>new URL(c.url).pathname),['/production/intake','/production/enqueue']);
  assert.equal(s.calls[1].data.intakeTicket,'signed-front');
  s.ready();await tick();assert.equal(s.calls.length,2,'Duplicate model events cannot submit twice');
 }finally{s.dom.window.close();}
});
test('failed production transfer can retry without sending email or starting paid generation',async()=>{
 const s=setup();try{
  let fail=true;
  s.w.fetch=async(url,init)=>{s.calls.push({url,data:JSON.parse(init.body)});return fail?Response.json({ok:false,error:'Unavailable'},{status:503}):Response.json({ok:true,jobId:'app-test',status:'WAITING_MODEL'});};
  await s.w.THEPIT_PRODUCTION.applicationSubmitted({intakeTicket:'signed-front',images:['image'],height:180,stage:'front'});
  assert.match(s.$('productionStatus').textContent,/email remains sent/);
  fail=false;await s.w.THEPIT_PRODUCTION.retry();
  assert.equal(s.calls.length,2);assert.ok(s.calls.every(c=>c.url.endsWith('/production/intake')));
 }finally{s.dom.window.close();}
});
