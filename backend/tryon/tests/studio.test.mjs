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
  w.HTMLCanvasElement.prototype.getContext=function(){const canvas=this;return {fillRect(){},drawImage(img){canvas.testSource=img.src}}};
  w.HTMLCanvasElement.prototype.toDataURL=function(){return prepared(this.testSource)};
  let next=0;const widgets=new Map();
  w.turnstile={render(_node,options){const id=next++;widgets.set(id,options);queueMicrotask(()=>options.callback('one-time-test-token'));return id},reset(id){widgets.get(id)?.callback('new-test-token')},remove(id){widgets.delete(id)}};
  w.fetch=async(url,init)=>{calls.push({url,init});if(url.endsWith('/health'))return Response.json({ready:true,features:['tryon','character']});return infer?infer(url,init):Response.json({ok:true,image})};
  w.eval(script);const $=id=>w.document.getElementById(id);
  async function consent(kind) {$(kind+'Consent').checked=true;$(kind+'Consent').dispatchEvent(new w.Event('change'));await until(()=>!$(kind==='tryon'?'generateTryon':'generateCharacter').disabled);}
  return {dom,w,$,calls,consent,open:()=>w.FIT_TRYON.open(selection)};
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
    const second=JSON.parse(s.calls[2].init.body);assert.equal(s.calls[2].url,'https://worker.example/character');assert.equal(second.photo,prepared(image));assert.equal(second.original,prepared(selection.photo));assert.equal(second.scene,'city');assert.equal(s.$('characterResult').hidden,false);assert.match(s.$('characterResultLabel').textContent,/색을 찾은 도시/);
    s.w.FIT_TRYON.open({...selection,item:{...selection.item,id:'another-garment'}});assert.equal(s.$('characterResult').hasAttribute('src'),false);assert.equal(s.$('downloadCharacter').hasAttribute('href'),false);assert.equal(s.$('nextCharacter').hidden,true);assert.equal(s.$('characterConsent').checked,false);
  }finally{s.dom.window.close()}
});

test('Late results from a replaced photo cannot reappear in the studio',async()=>{
  let finish;const s=setup({infer:()=>new Promise(resolve=>{finish=resolve})});try{
    s.open();await until(()=>!s.$('tryonConsent').disabled);await s.consent('tryon');s.$('generateTryon').click();await until(()=>!!finish);
    s.w.FIT_TRYON.clear();finish(Response.json({ok:true,image}));await new Promise(setImmediate);
    assert.equal(s.$('tryon').hidden,true);assert.equal(s.$('character').hidden,true);assert.equal(s.$('tryonResult').hasAttribute('src'),false);assert.equal(s.$('downloadTryon').hidden,true);
  }finally{s.dom.window.close()}
});

test('Provider errors never unlock character generation or fabricate a result; retry is available',async()=>{
  const s=setup({infer:async()=>Response.json({ok:false,error:'테스트 생성 실패'},{status:502})});try{
    s.open();await until(()=>!s.$('tryonConsent').disabled);await s.consent('tryon');s.$('generateTryon').click();await until(()=>s.$('tryonStatus').textContent==='테스트 생성 실패');
    assert.equal(s.$('tryonResult').hidden,true);assert.equal(s.$('downloadTryon').hidden,true);assert.equal(s.$('generateCharacter').disabled,true);assert.equal(s.$('generateTryon').disabled,false);assert.equal(s.$('cancelTryon').hidden,true);
  }finally{s.dom.window.close()}
});
