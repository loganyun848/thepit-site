const {test}=require('node:test');const assert=require('node:assert/strict');
const http=require('node:http');
const {createServer,publicConfig,ensureWidget,LOGIN_SCOPES,HOST,ORIGIN}=require('../scripts/connect-ai.cjs');
test('Turnstile is created for only the two production domains and an existing widget is reused',async()=>{
  const calls=[];let stored;
  const network=async(url,init)=>{calls.push({url,init});if(init.method==='POST'){stored={...JSON.parse(init.body),sitekey:'public-test-sitekey',secret:'private-test-secret'};return Response.json({success:true,result:stored})}return Response.json({success:true,result:url.includes('?')?(stored?[stored]:[]):stored})};
  const first=await ensureWidget('account','test-token',network);assert.equal(first.secret,'private-test-secret');
  assert.deepEqual(stored.domains,['the-pit.site','www.the-pit.site']);assert.equal(stored.clearance_level,'no_clearance');
  const second=await ensureWidget('account','test-token',network);assert.equal(second.siteKey,first.siteKey);assert.equal(calls.filter(c=>c.init.method==='POST').length,1);
  assert.ok(LOGIN_SCOPES.includes('challenge-widgets.write'));assert.ok(!LOGIN_SCOPES.some(s=>s.includes('email')));
});
test('Setup writes only the validated public endpoint and site key',()=>{
  const source='TRYON_ENDPOINT: "",\nTRYON_TURNSTILE_SITE_KEY: "",\nFORM_ENDPOINT: "keep"';
  const result=publicConfig(source,'https://thepit-tryon.owner.workers.dev','public-site-key');
  assert.match(result,/FORM_ENDPOINT: "keep"/);assert.match(result,/public-site-key/);
  assert.throws(()=>publicConfig(source,'http://evil.example','public-site-key'));
  assert.throws(()=>publicConfig(source,'https://thepit-tryon.owner.workers.dev','bad";code'));
});
test('Local setup rejects cross-origin, forged-host and missing-token submissions',async()=>{
  let calls=0;const {server}=createServer({token:'test-token',onConnect:async(_data,state)=>{calls++;state.busy=false},login:async()=>{calls++}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try {
    const request=(url,options,body)=>new Promise((resolve,reject)=>{const req=http.request(url,options,res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(text)}))});req.on('error',reject);req.end(body)});
    const post=(headers)=>request(base+'/api/connect',{method:'POST',headers:{Host:HOST,Origin:ORIGIN,'Content-Type':'application/json','X-Setup-Token':'test-token',...headers}},'{}');
    assert.equal((await post({Origin:'https://attacker.example'})).status,403);
    assert.equal((await post({Host:'attacker.example'})).status,403);
    assert.equal((await post({'X-Setup-Token':'wrong'})).status,403);assert.equal(calls,0);
    assert.equal((await post({})).status,202);assert.equal(calls,1);
    const status=await request(base+'/api/status',{headers:{Host:HOST,'X-Setup-Token':'test-token'}});
    assert.equal(status.status,200);assert.ok(!JSON.stringify(await status.json()).includes('falKey'));
  }finally{await new Promise(resolve=>server.close(resolve))}
});
