import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const base=new URL('../../production/dashboard/',import.meta.url),html=readFileSync(new URL('index.html',base),'utf8'),code=readFileSync(new URL('dashboard.js',base),'utf8');
const tick=()=>new Promise(setImmediate);
function setup(extra={}){
 const sample={id:'qa-sample',fixture:true,stage:'ready',verified:true,files:['preview.mp4','motion.blend','animated.glb'],frame:120,createdAt:10,updatedAt:20};
 const payload={worker:{online:true,mode:'waiting',connection:'connected',lastContact:20,heartbeat:21},jobs:[],sample,updatedAt:21,csrfToken:'test-only',setup:{blender:true,videoCheck:true},...extra};
 const dom=new JSDOM(html,{url:'http://127.0.0.1:8767/',runScripts:'outside-only'}),w=dom.window,calls=[];
 w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};w.AbortSignal=AbortSignal;
 w.fetch=async(url,init)=>{if(url==='/api/control'){calls.push(JSON.parse(init.body));payload.worker.mode='paused';payload.worker.pausedRequested=true;return Response.json({ok:true,message:'Paused'});}return Response.json(payload);};
 w.eval(code);return{dom,w,calls,$:id=>w.document.getElementById(id)};
}
test('QA selection never becomes a received customer or ready-for-review count',async()=>{const s=setup();try{await tick();s.$('sampleNav').click();assert.equal(s.$('receivedValue').textContent,'0');assert.equal(s.$('readyValue').textContent,'0');assert.equal(s.$('sampleNotice').hidden,false);assert.equal(s.$('videoPreview').hidden,false);assert.equal(s.$('downloadLinks').querySelectorAll('a').length,3);assert.equal(s.calls.length,0);}finally{s.dom.window.close();}});
test('render indicator displays the actual frame count and active job',async()=>{const job={id:'actual-job-id',fixture:false,stage:'rendering',frame:42,files:[],verified:false,updatedAt:21,createdAt:10};const s=setup({worker:{online:true,mode:'processing',jobId:job.id},jobs:[job]});try{await tick();assert.equal(s.$('receivedValue').textContent,'1');assert.equal(s.$('activeValue').textContent,'1');assert.equal(s.$('renderProgress').value,42);assert.equal(s.$('frameCount').textContent,'42 / 120 frames');assert.equal(s.$('videoPreview').hidden,true);}finally{s.dom.window.close();}});
test('pause control sends an explicit action and changes to resume only after status response',async()=>{const s=setup();try{await tick();s.$('receiverButton').click();await tick();await tick();assert.equal(s.calls.length,1);assert.equal(s.calls[0].action,'pause');assert.equal(s.$('receiverValue').textContent,'Paused');assert.equal(s.$('receiverButton').textContent,'Resume receiving');}finally{s.dom.window.close();}});
