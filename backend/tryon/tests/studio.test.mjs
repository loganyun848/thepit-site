import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// DOM-only state tests. No browser, external network, real photos or paid generations.
const html = readFileSync(new URL('../../../fit.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../../fit-tryon.js', import.meta.url), 'utf8');
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1cAAAAASUVORK5CYII=';
const selection = {photo:'blob:original-test-photo',item:{id:'test-garment',image:'https://catalog.example/garment.jpg',brand:'UNIQLO',name:'Test sweater',sizing:{rows:[{label:'M'},{label:'XL'}]}},recommendation:{usual:{label:'XL'}}};
const prepared = value => 'data:image/jpeg;base64,'+Buffer.from('prepared:'+value).toString('base64');
async function until(condition) { for(let i=0;i<50;i++) { if(condition()) return; await new Promise(resolve=>setImmediate(resolve)); } assert.ok(condition(),'expected UI state was not reached'); }
function setup({configured=true,infer}={}) {
  const dom=new JSDOM(html,{url:'https://the-pit.site/fit.html',runScripts:'outside-only'}),w=dom.window,calls=[];
  w.THEPIT_CONFIG=configured?{TRYON_ENDPOINT:'https://worker.example',TRYON_TURNSTILE_SITE_KEY:'public-test-key'}:{};
  w.AbortSignal=AbortSignal;w.HTMLElement.prototype.scrollIntoView=function(){};
  w.Image=class {naturalWidth=800;naturalHeight=1200;async decode(){}};
  const drawings=[],labels=[];
  w.HTMLCanvasElement.prototype.getContext=function(){const canvas=this;return {fillRect(){},fillText(text,x,y){labels.push({text,x,y})},drawImage(img,...args){canvas.testSource=img.src;drawings.push({source:img.src,args})}}};
  w.HTMLCanvasElement.prototype.toDataURL=function(){return prepared(this.testSource)};
  w.HTMLCanvasElement.prototype.toBlob=function(callback){callback(new Blob(['sheet'],{type:'image/png'}))};
  w.URL.createObjectURL=()=> 'blob:test-export';w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){this.testClicked=true};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
  let next=0;const widgets=new Map();
  w.turnstile={render(_node,options){const id=next++;widgets.set(id,options);queueMicrotask(()=>options.callback('one-time-test-token'));return id},reset(id){widgets.get(id)?.callback('new-test-token')},remove(id){widgets.delete(id)}};
  w.fetch=async(url,init)=>{calls.push({url,init});if(url.endsWith('/health'))return Response.json({ready:true,characterAppearance:'production-avatar-v2',features:['tryon','character','character-sheet']});return infer?infer(url,init):Response.json({ok:true,appearance:'production-avatar-v2',image,...(url.endsWith('/character-view')?{view:JSON.parse(init.body).view}:{})})};
  w.eval(script);const $=id=>w.document.getElementById(id);
  async function consent(kind) {$(kind+'Consent').checked=true;$(kind+'Consent').dispatchEvent(new w.Event('change'));await until(()=>!$({tryon:'generateTryon',character:'generateCharacter',sheet:'generateSheet'}[kind]).disabled);}
  return {dom,w,$,calls,consent,drawings,labels,open:()=>w.FIT_TRYON.open(selection)};
}

async function readySheet(s) {
  s.open();await until(()=>!s.$('tryonConsent').disabled);await s.consent('tryon');s.$('generateTryon').click();await until(()=>!s.$('nextCharacter').hidden);
  await s.consent('character');s.$('generateCharacter').click();await until(()=>!s.$('sheetWorkspace').hidden);
}

test('Missing setup disables both generations without transmitting the uploaded photo',async()=>{
  const s=setup({configured:false});try{s.open();await new Promise(setImmediate);assert.equal(s.calls.length,0);assert.equal(s.$('tryon').hidden,false);assert.equal(s.$('character').hidden,false);assert.equal(s.$('tryonSize').value,'XL');assert.equal(s.$('generateTryon').disabled,true);assert.equal(s.$('generateCharacter').disabled,true);assert.equal(s.$('characterResult').hidden,true);assert.match(s.$('characterStatus').textContent,/연결 준비/);}finally{s.dom.window.close()}
});

test('Consent gates generation; successful try-on feeds the character stage with the correct identity',async()=>{
  const s=setup();try{
    s.open();await until(()=>!s.$('tryonConsent').disabled);assert.equal(s.calls.length,1);assert.equal(s.$('generateTryon').disabled,true);assert.equal(s.$('characterConsent').disabled,true);
    await s.consent('tryon');s.$('generateTryon').click();await until(()=>!s.$('nextCharacter').hidden);
    assert.equal(s.$('tryonResult').getAttribute('src'),image);assert.equal(s.$('downloadTryon').hidden,false);
    const first=JSON.parse(s.calls[1].init.body);assert.equal(first.photo,prepared(selection.photo));assert.equal(first.itemId,'test-garment');assert.equal(first.consent,true);assert.equal(first.chest,undefined);assert.equal(first.size,undefined);
    await s.consent('character');s.w.document.querySelector('[value="city"]').checked=true;s.$('generateCharacter').click();await until(()=>!s.$('downloadCharacter').hidden);
    const second=JSON.parse(s.calls[2].init.body);assert.equal(s.calls[2].url,'https://worker.example/character');assert.equal(second.photo,prepared(image));assert.equal(second.original,prepared(selection.photo));assert.equal(second.scene,'city');assert.equal(s.$('characterResult').hidden,false);assert.match(s.$('characterResultLabel').textContent,/야외 인물 사진/);
    s.w.FIT_TRYON.open({...selection,item:{...selection.item,id:'another-garment'}});assert.equal(s.$('characterResult').hasAttribute('src'),false);assert.equal(s.$('downloadCharacter').hasAttribute('href'),false);assert.equal(s.$('nextCharacter').hidden,true);assert.equal(s.$('characterConsent').checked,false);
  }finally{s.dom.window.close()}
});

test('Late results from a replaced photo cannot reappear in the studio',async()=>{
  let finish;const s=setup({infer:()=>new Promise(resolve=>{finish=resolve})});try{
    s.open();await until(()=>!s.$('tryonConsent').disabled);await s.consent('tryon');s.$('generateTryon').click();await until(()=>!!finish);
    s.w.FIT_TRYON.clear();finish(Response.json({ok:true,appearance:'production-avatar-v2',image}));await new Promise(setImmediate);
    assert.equal(s.$('tryon').hidden,true);assert.equal(s.$('character').hidden,true);assert.equal(s.$('tryonResult').hasAttribute('src'),false);assert.equal(s.$('downloadTryon').hidden,true);
  }finally{s.dom.window.close()}
});

test('Provider errors never unlock character generation or fabricate a result; retry is available',async()=>{
  const s=setup({infer:async()=>Response.json({ok:false,error:'테스트 생성 실패'},{status:502})});try{
    s.open();await until(()=>!s.$('tryonConsent').disabled);await s.consent('tryon');s.$('generateTryon').click();await until(()=>s.$('tryonStatus').textContent==='테스트 생성 실패');
    assert.equal(s.$('tryonResult').hidden,true);assert.equal(s.$('downloadTryon').hidden,true);assert.equal(s.$('generateCharacter').disabled,true);assert.equal(s.$('generateTryon').disabled,false);assert.equal(s.$('cancelTryon').hidden,true);
  }finally{s.dom.window.close()}
});

test('A character response from the old server cannot unlock a photographic sheet',async()=>{
  const s=setup({infer:async()=>Response.json({ok:true,image})});try{
    s.open();await until(()=>!s.$('tryonConsent').disabled);await s.consent('tryon');s.$('generateTryon').click();await until(()=>!s.$('nextCharacter').hidden);
    await s.consent('character');s.$('generateCharacter').click();await until(()=>s.$('characterStatus').textContent.includes('업데이트'));
    assert.equal(s.$('characterResult').hidden,true);assert.equal(s.$('sheetWorkspace').hidden,true);
    assert.equal(s.$('generateSheet').disabled,true);assert.equal(s.calls.filter(c=>c.url.endsWith('/character-view')).length,0);
  }finally{s.dom.window.close()}
});

test('Approval gates a sheet; exactly three requests share one anchor and produce four reconstruction references',async()=>{
  const s=setup();try{
    await readySheet(s);assert.equal(s.$('generateSheet').disabled,true);assert.equal(s.$('downloadSheet').disabled,true);assert.equal(s.$('sheetGrid').children.length,4);
    await s.consent('sheet');s.$('generateSheet').click();await until(()=>s.$('sheetCount').textContent==='4 / 4');await until(()=>s.$('cancelSheet').hidden);
    const calls=s.calls.filter(c=>c.url.endsWith('/character-view'));assert.equal(calls.length,3);
    assert.deepEqual(calls.map(c=>JSON.parse(c.init.body).view),Array.from({length:3},(_,i)=>i+1));
    for(const c of calls){const data=JSON.parse(c.init.body);assert.equal(data.anchor,prepared(image));assert.equal(data.original,prepared(selection.photo));assert.equal(data.approved,true);assert.equal(data.appearance,'production-avatar-v2');assert.ok(data.token);}
    assert.equal(new Set(calls.map(c=>JSON.parse(c.init.body).requestId)).size,3);
    assert.equal(s.$('downloadSheet').disabled,false);assert.equal(s.$('generateSheet').disabled,true);
    assert.equal(s.$('sheetGrid').querySelectorAll('img').length,4);
    s.$('sheetGrid').children[2].click();assert.equal(s.$('sheetDialog').open,true);assert.match(s.$('sheetDialogTitle').textContent,/뒷모습/);
    const before=s.calls.length;s.$('downloadSheet').click();await until(()=>s.labels.length===4);await until(()=>!s.$('downloadSheet').disabled);
    assert.equal(s.calls.length,before,'compositing and download must not generate more images');assert.equal(s.labels[3].x,1152);assert.equal(s.labels[3].y,2152);
  }finally{s.dom.window.close()}
});

test('Failed sheet stops immediately; explicit resume keeps completed images and retries only missing views',async()=>{
  let fail=true;const s=setup({infer:async(url,init)=>{
    const view=JSON.parse(init.body).view;
    if(url.endsWith('/character-view')&&view===3&&fail)return Response.json({ok:false,error:'테스트 중단'},{status:502});
    return Response.json({ok:true,appearance:'production-avatar-v2',image,view});
  }});try{
    await readySheet(s);await s.consent('sheet');s.$('generateSheet').click();await until(()=>s.$('sheetStatus').textContent.includes('테스트 중단'));
    assert.equal(s.$('sheetCount').textContent,'3 / 4');assert.equal(s.calls.filter(c=>c.url.endsWith('/character-view')).length,3);
    assert.equal(s.$('downloadSheet').disabled,true);fail=false;s.$('generateSheet').click();await until(()=>s.$('sheetCount').textContent==='4 / 4');
    const views=s.calls.filter(c=>c.url.endsWith('/character-view')).map(c=>JSON.parse(c.init.body).view);
    assert.deepEqual(views,[1,2,3,...Array.from({length:1},(_,i)=>i+3)]);
  }finally{s.dom.window.close()}
});

test('Replacing the selected person during a view request discards all previous sheet images and ignores late results',async()=>{
  let finish;const s=setup({infer:async(url)=>url.endsWith('/character-view')?new Promise(resolve=>finish=resolve):Response.json({ok:true,appearance:'production-avatar-v2',image})});try{
    await readySheet(s);await s.consent('sheet');s.$('generateSheet').click();await until(()=>!!finish);
    s.w.FIT_TRYON.open({...selection,photo:'blob:new-person'});finish(Response.json({ok:true,appearance:'production-avatar-v2',image,view:1}));await new Promise(setImmediate);
    assert.equal(s.$('sheetWorkspace').hidden,true);assert.equal(s.$('sheetGrid').children.length,0);assert.equal(s.$('characterResult').hasAttribute('src'),false);
    assert.equal(s.calls.filter(c=>c.url.endsWith('/character-view')).length,1);
  }finally{s.dom.window.close()}
});

test('Cancellation preserves completed angles and does not start subsequent requests',async()=>{
  let finish;const s=setup({infer:async(url)=>url.endsWith('/character-view')?new Promise(resolve=>finish=resolve):Response.json({ok:true,appearance:'production-avatar-v2',image})});try{
    await readySheet(s);await s.consent('sheet');s.$('generateSheet').click();await until(()=>!!finish);
    s.$('cancelSheet').click();finish(Response.json({ok:true,appearance:'production-avatar-v2',image,view:1}));await until(()=>s.$('cancelSheet').hidden);
    assert.equal(s.$('sheetCount').textContent,'2 / 4');assert.equal(s.calls.filter(c=>c.url.endsWith('/character-view')).length,1);assert.equal(s.$('generateSheet').disabled,false);
  }finally{s.dom.window.close()}
});

test('Adding and removing a close-up clears the old anchor and sheet; only consented generation sends the face',async()=>{
  const s=setup();try{
    await readySheet(s);const before=s.calls.length;
    Object.defineProperty(s.$('characterFace'),'files',{value:[new s.w.File(['fixture'],'face.jpg',{type:'image/jpeg'})],configurable:true});
    s.$('characterFace').dispatchEvent(new s.w.Event('change'));await until(()=>!s.$('facePreviewWrap').hidden);
    assert.equal(s.calls.length,before);assert.equal(s.$('sheetWorkspace').hidden,true);assert.equal(s.$('characterResult').hasAttribute('src'),false);
    assert.equal(s.$('characterConsent').checked,false);await s.consent('character');s.$('generateCharacter').click();await until(()=>!s.$('sheetWorkspace').hidden);
    assert.equal(JSON.parse(s.calls.at(-1).init.body).face,prepared('blob:test-export'));
    s.$('removeFace').click();assert.equal(s.$('sheetWorkspace').hidden,true);assert.equal(s.$('facePreviewWrap').hidden,true);assert.equal(s.$('sheetGrid').children.length,0);
  }finally{s.dom.window.close()}
});
