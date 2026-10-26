const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const delivery = require('../form-delivery.js');
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../config.js'),'utf8'),context);
const config = context.window.THEPIT_CONFIG;
const contact = {name:'Delivery test',email:'test@example.com',message:'Synthetic test only.',agreePrivacy:'Y'};

test('The receiving endpoint is fixed to CEO; visitor email is only Reply-To', () => {
  assert.equal(config.FORM_ENDPOINT,'https://formsubmit.co/ajax/ceo@lecple.com');
  const body = delivery.toFormData({...contact,_cc:'unexpected@example.com',_subject:'injected'},'contact');
  assert.equal(body.get('_replyto'),'test@example.com');
  assert.equal(body.get('email'),'test@example.com');
  assert.equal(body.get('_cc'),null);
  assert.match(body.get('_subject'),/^\[THE PIT 문의\]/);
});
test('Every selected photo is a real attachment, not a base64 text field', async () => {
  const photos = ['face','body','extra1','extra2'].map(key=>({key,dataUrl:'data:image/jpeg;base64,YWJj'}));
  const body = delivery.toFormData({...contact,photos},'application');
  for(const [i,key] of ['attachment','attachment2','attachment3','attachment4'].entries()) {
    assert.equal(body.get(key).name,`${photos[i].key}.jpg`);
    assert.equal(await body.get(key).text(),'abc');
  }
  assert.equal(body.get('photos'),null);
});
test('Invalid email, invalid image and oversized attachments stop before delivery', () => {
  assert.throws(()=>delivery.toFormData({...contact,email:'invalid'},'contact'),{code:'email'});
  assert.throws(()=>delivery.toFormData({...contact,photos:[{dataUrl:'data:text/html;base64,YWJj'}]},'application'),{code:'photo'});
  const dataUrl='data:image/jpeg;base64,'+Buffer.alloc(6*1024*1024).toString('base64');
  assert.throws(()=>delivery.toFormData({...contact,photos:[{dataUrl},{dataUrl}]},'application'),{code:'attachment-size'});
});
test('Unactivated addresses never produce a success screen', () => {
  for(const success of [true,'true',false]) assert.throws(()=>delivery.readResponse({success,message:'This form needs activation. Check your email.'},true,false),{code:'activation'});
});
test('Only an explicit successful server acknowledgement counts as accepted', () => {
  for(const body of [{},{success:false},{success:'false'},{ok:true}]) assert.throws(()=>delivery.readResponse(body,true,false));
  assert.throws(()=>delivery.readResponse({success:true},false,false));
  assert.deepEqual(delivery.readResponse({success:'true'},true,false),{accepted:true,id:null});
  assert.throws(()=>delivery.readResponse({},true,true));
  assert.equal(delivery.readResponse({ok:true,id:'test'},true,true).id,'test');
});
test('Direct submission uses multipart and preserves application fields and attachments', async () => {
  let request;
  const result=await delivery.send({...contact,story:'Test story'},'application',config,async(url,options)=>{
    request={url,options};return {ok:true,json:async()=>({success:'true'})};
  });
  assert.equal(result.accepted,true);
  assert.equal(request.url,config.FORM_ENDPOINT);
  assert.equal(request.options.body.get('이야기 / Story'),'Test story');
  assert.equal(request.options.headers['Content-Type'],undefined);
});
test('Network/invalid JSON errors do not create false positive submissions', async () => {
  await assert.rejects(delivery.send(contact,'contact',config,async()=>{throw new TypeError('Failed to fetch')}),{code:'network'});
  await assert.rejects(delivery.send(contact,'contact',config,async()=>({ok:true,json:async()=>{throw new Error('HTML response')}})),{code:'response'});
  await assert.rejects(delivery.send(contact,'contact',config,async()=>{throw new DOMException('Aborted','AbortError')}),{code:'network'});
});
test('Optional Apps Script route requires explicit ok and does not replace inquiry delivery', async () => {
  const configured={...config,SUBMIT_ENDPOINT:'https://script.google.com/macros/s/test/exec'};
  await delivery.send(contact,'application',configured,async(url,options)=>{
    assert.equal(url,configured.SUBMIT_ENDPOINT);assert.equal(JSON.parse(options.body).email,contact.email);
    return {ok:true,json:async()=>({ok:true,id:'test'})};
  });
  await delivery.send(contact,'contact',configured,async(url)=>{assert.equal(url,config.FORM_ENDPOINT);return {ok:true,json:async()=>({success:true})}});
});
