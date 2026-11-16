const {test}=require('node:test');const assert=require('node:assert/strict');
const http=require('node:http');
const {createServer,publicConfig,ensureWidget,deviceLoginDetails,loginFailureMessage,LOGIN_SCOPES,HOST,ORIGIN}=require('../scripts/connect-ai.cjs');

test('Device login displays only a verified Cloudflare device URL and a user confirmation code',()=>{
  const output='To authorize Wrangler, please visit:\n https://dash.cloudflare.com/oauth2/device\n\nand enter the code:\n AB12-CD34\nYou have 5 minutes to approve this request.';
  assert.deepEqual(deviceLoginDetails(output),{loginUrl:'https://dash.cloudflare.com/oauth2/device?user_code=AB12-CD34',loginCode:'AB12-CD34'});
  assert.equal(deviceLoginDetails(output.replace('dash.cloudflare.com','attacker.example')),null);
  assert.equal(deviceLoginDetails(output.replace('/oauth2/device','/oauth2/device-evil')),null);
  assert.equal(deviceLoginDetails('https://dash.cloudflare.com/oauth2/auth?state=old'),null);
  assert.equal(deviceLoginDetails('and enter the code:'),null);
});

test('Device authorization clears expired links and presents actionable failures without CLI secrets',async()=>{
  const details='To authorize Wrangler, please visit:\n https://dash.cloudflare.com/oauth2/device\nand enter the code:\n AB12-CD34\n';
  let rejectCommand,commands;
  const {server,state}=createServer({token:'test-token',runCommand:(_command,args,options)=>{
    commands=args;options.onOutput(details);
    return new Promise((_resolve,reject)=>{rejectCommand=()=>{options.onOutput(details+'Device code expired before the request was approved.');reject(new Error('private-cli-output'))}});
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const status=await new Promise((resolve,reject)=>{
      const req=http.request('http://127.0.0.1:'+server.address().port+'/api/login',{method:'POST',headers:{Host:HOST,Origin:ORIGIN,'Content-Type':'application/json','X-Setup-Token':'test-token'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.end('{}');
    });
    assert.equal(status,202);assert.ok(commands.includes('--device'));assert.ok(commands.includes('--browser=true'));
    assert.equal(state.phase,'login');assert.equal(state.busy,true);assert.equal(state.loginCode,'AB12-CD34');
    rejectCommand();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(state.phase,'error');assert.equal(state.busy,false);assert.equal(state.loginUrl,'');assert.equal(state.loginCode,'');
    assert.match(state.message,/만료/);assert.ok(!state.message.includes('private-cli-output'));
  }finally{await new Promise(resolve=>server.close(resolve))}
  assert.match(loginFailureMessage('',{code:'EPERM'}),/실행 권한/);
  assert.match(loginFailureMessage('Consent denied.'),/취소/);
});
test('Turnstile is created for only the two production domains and an existing widget is reused',async()=>{
  const calls=[];let stored;
  const network=async(url,init)=>{calls.push({url,init});if(init.method==='POST'){stored={...JSON.parse(init.body),sitekey:'public-test-sitekey',secret:'private-test-secret'};return Response.json({success:true,result:stored})}return Response.json({success:true,result:url.includes('?')?(stored?[stored]:[]):stored})};
  const first=await ensureWidget('account','test-token',network);assert.equal(first.secret,'private-test-secret');
  assert.deepEqual(stored.domains,['the-pit.site','www.the-pit.site']);assert.equal(stored.clearance_level,'no_clearance');
  const second=await ensureWidget('account','test-token',network);assert.equal(second.siteKey,first.siteKey);assert.equal(calls.filter(c=>c.init.method==='POST').length,1);
  assert.ok(LOGIN_SCOPES.includes('challenge-widgets.write'));assert.ok(!LOGIN_SCOPES.some(s=>s.includes('email')));
  assert.ok(!LOGIN_SCOPES.includes('offline_access'),'Wrangler appends its reserved refresh scope automatically');
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
