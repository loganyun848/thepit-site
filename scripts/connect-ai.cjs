/* Local setup only. Secrets stay in memory and go to Wrangler over stdin, never to Git or logs. */
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'backend/tryon');
const cli = path.join(backend, 'node_modules/wrangler/bin/wrangler.js');
const PORT = 8767, HOST = `127.0.0.1:${PORT}`, ORIGIN = `http://${HOST}`;

function publicConfig(source, endpoint, siteKey) {
  if (!/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(endpoint)) throw Error('올바른 Worker 주소가 필요합니다.');
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(siteKey)) throw Error('Turnstile 공개 Site key를 확인해 주세요.');
  for (const key of ['TRYON_ENDPOINT', 'TRYON_TURNSTILE_SITE_KEY']) {
    if ((source.match(new RegExp('\\b'+key+'\\s*:', 'g')) || []).length !== 1) throw Error('공개 설정 파일을 확인해야 합니다.');
  }
  return source.replace(/(TRYON_ENDPOINT\s*:\s*)"[^"]*"/,(_,prefix)=>prefix+JSON.stringify(endpoint))
    .replace(/(TRYON_TURNSTILE_SITE_KEY\s*:\s*)"[^"]*"/,(_,prefix)=>prefix+JSON.stringify(siteKey));
}

function run(command, args, { cwd = root, input = '', env = {}, onOutput } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    let output = '';
    const collect = chunk => { output = (output + chunk.toString()).slice(-64000); onOutput?.(output); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(output) : reject(Error('명령을 완료하지 못했습니다. 계정 권한과 입력 값을 확인해 주세요.')));
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}

async function connect(data, state) {
  let secretInput;
  try {
    if (typeof data.falKey !== 'string' || data.falKey.trim().length < 10 || data.falKey.length > 4096 || /[\r\n]/.test(data.falKey)) throw Error('fal.ai 키를 확인해 주세요.');
    if (typeof data.turnstileSecret !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(data.turnstileSecret)) throw Error('Turnstile Secret key를 확인해 주세요.');
    if (!/^[A-Za-z0-9_-]{10,100}$/.test(data.siteKey || '')) throw Error('Turnstile 공개 Site key를 확인해 주세요.');
    if ((await run('git', ['status','--porcelain'])).trim()) throw Error('작업 폴더에 미저장 변경이 있습니다. 먼저 변경 사항 검토가 필요합니다.');
    state.message = 'Cloudflare 로그인과 계정을 확인하고 있습니다.';
    const identity = await run(process.execPath, [cli,'whoami'], { cwd: backend });
    if (/not authenticated/i.test(identity)) throw Error('먼저 Cloudflare 로그인 버튼을 누르고 계정에서 승인해 주세요.');
    const accounts = [...new Set(identity.match(/\b[a-f0-9]{32}\b/gi) || [])];
    const account = data.accountId?.trim() || (accounts.length === 1 ? accounts[0] : '');
    if (!/^[a-f0-9]{32}$/i.test(account)) throw Error('Cloudflare 계정이 여러 개이거나 계정 확인이 필요합니다. 운영할 Account ID를 입력해 주세요.');
    const env = { CLOUDFLARE_ACCOUNT_ID: account };
    state.message = '이미지 생성 서버를 배포하고 있습니다.';
    const deployed = await run(process.execPath, [cli,'deploy'], { cwd: backend, env });
    const endpoint = deployed.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b/)?.[0];
    if (!endpoint) throw Error('서버 배포 주소를 확인하지 못했습니다. Cloudflare Worker 상태를 확인해 주세요.');
    state.message = '비밀 키를 Cloudflare Secrets에 등록하고 있습니다.';
    secretInput = JSON.stringify({ FAL_KEY: data.falKey.trim(), TURNSTILE_SECRET: data.turnstileSecret });
    data.falKey = ''; data.turnstileSecret = '';
    await run(process.execPath, [cli,'secret','bulk'], { cwd: backend, env, input: secretInput });
    secretInput = '';
    state.message = '서버 연결 상태를 확인하고 있습니다.';
    const health = await fetch(endpoint+'/health', { signal: AbortSignal.timeout(15000) });
    const ready = await health.json();
    if (!health.ok || !ready.ready || !ready.features?.includes('character')) throw Error('서버가 아직 준비되지 않았습니다. 등록된 Secrets와 배포 상태를 확인해 주세요.');
    const configPath = path.join(root, 'config.js'), htmlPath = path.join(root, 'fit.html');
    const config = await fs.readFile(configPath, 'utf8'), html = await fs.readFile(htmlPath, 'utf8');
    await fs.writeFile(configPath, publicConfig(config, endpoint, data.siteKey));
    await fs.writeFile(htmlPath, html.replace(/config\.js\?v=[^"\s]+/, 'config.js?v=ai-'+Date.now()));
    state.message = '홈페이지에 공개 연결 설정을 배포하고 있습니다.';
    await run('git', ['add','--','config.js','fit.html']);
    await run('git', ['commit','-m','Connect live Fit Room AI services']);
    await run('git', ['push','origin','main']);
    state.phase = 'configured'; state.endpoint = endpoint;
    state.message = '서버 연결 설정을 배포했습니다. GitHub Pages 반영 후 홈페이지에서 착용 → 캐릭터를 실제 생성해 확인하세요. AI 키 유효성·잔액과 생성 품질은 아직 검증하지 않았습니다.';
  } catch (error) {
    state.phase = 'error'; state.message = error.message;
  } finally {
    data.falKey = ''; data.turnstileSecret = ''; secretInput = ''; state.busy = false;
  }
}

function createServer({ token = randomBytes(32).toString('hex'), onConnect = connect, login } = {}) {
  const state = { phase: 'idle', busy: false, message: '로그인 후 세 가지 키를 등록하면 서버와 홈페이지 연결을 진행합니다.', loginUrl: '', endpoint: '' };
  const loginAction = login || (async () => {
    state.busy = true; state.phase = 'login'; state.message = 'Cloudflare 인증 페이지를 준비하고 있습니다.';
    try {
      await run(process.execPath, [cli, 'login', '--browser=false'], { cwd: backend, onOutput(output) {
        const match = output.match(/https:\/\/dash\.cloudflare\.com\/[^\s\x1b]+/);
        if (match) { state.loginUrl = match[0]; state.message = '아래 Cloudflare 인증 열기 링크에서 본인 계정으로 로그인하고 승인해 주세요.'; }
      }});
      state.phase = 'idle'; state.loginUrl = ''; state.message = 'Cloudflare 로그인이 완료됐습니다. 키를 입력하고 연결을 실행해 주세요.';
    } catch (_) { state.phase = 'error'; state.loginUrl = ''; state.message = 'Cloudflare 로그인이 완료되지 않았습니다. 다시 로그인해 주세요.'; }
    finally { state.busy = false; }
  });
  const server = http.createServer(async (req, res) => {
    const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'self'; script-src 'nonce-${token}'; style-src 'nonce-${token}'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'`};
    const send = (status, body, type = 'application/json') => { res.writeHead(status, {...headers,'Content-Type':type+'; charset=utf-8'});res.end(type==='application/json'?JSON.stringify(body):body); };
    if (req.headers.host !== HOST) return send(403,{error:'Invalid local host'});
    if (req.method === 'GET' && req.url === '/') {
      const page = await fs.readFile(path.join(__dirname,'connect-ai.html.txt'),'utf8'); return send(200,page.replaceAll('__TOKEN__', token),'text/html');
    }
    // Status also requires the page token; no CORS access is provided.
    if (req.headers['x-setup-token'] !== token) return send(403,{error:'Local setup page required'});
    if (req.method === 'GET' && req.url === '/api/status') return send(200,state);
    if (req.method !== 'POST' || req.headers.origin !== ORIGIN || req.headers['content-type'] !== 'application/json') return send(403,{error:'Local setup page required'});
    if (state.busy) return send(409,{error:'이미 연결 작업을 진행 중입니다.'});
    if (req.url === '/api/login') { send(202,{ok:true});loginAction();return; }
    if (req.url !== '/api/connect') return send(404,{error:'Not found'});
    let raw='', data;
    try { for await (const chunk of req) { raw += chunk; if(raw.length>16000)throw Error('Input too large'); } data=JSON.parse(raw); if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid input'); }
    catch (_) { return send(400,{error:'입력 값을 확인해 주세요.'}); }
    raw='';state.busy=true;state.phase='connecting';state.message='입력 값과 연결 상태를 확인하고 있습니다.';send(202,{ok:true});onConnect(data,state);
  });
  return { server, state };
}
if (require.main === module) {
  fs.access(cli).then(()=>{
    const {server}=createServer();server.on('error',()=>{console.error('로컬 연결 화면을 열지 못했습니다. 포트 8767을 확인하세요.');process.exitCode=1});
    server.listen(PORT,'127.0.0.1',()=>console.log('THE PIT AI 연결: '+ORIGIN+' (이 PC에서만 접근 가능)'));
  }).catch(()=>{console.error('먼저 npm ci --prefix backend/tryon 을 실행하세요.');process.exitCode=1});
}
module.exports = { createServer, publicConfig, HOST, ORIGIN };
