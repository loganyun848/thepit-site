// Queue tickets grant read-only access to one model job for two hours.
// Photos and API credentials are never written to a ticket or persistent storage.
export const MODEL_ID = 'meshy/v7.1/multi-image-to-3d';
const QUEUE = 'https://queue.fal.run/';
const bad = (status, message, code) => Object.assign(new Error(message), { status, code });
const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const un64 = s => Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
async function key(secret) { return crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']); }
export async function signTicket(job, secret) {
  const payload = b64(enc.encode(JSON.stringify(job)));
  return payload+'.'+b64(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),enc.encode(payload))));
}
export async function readTicket(ticket, secret) {
  try {
    if (typeof ticket !== 'string' || ticket.length > 4096) throw Error();
    const parts = ticket.split('.');
    if (parts.length !== 2 || !await crypto.subtle.verify('HMAC', await key(secret), un64(parts[1]), enc.encode(parts[0]))) throw Error();
    const job = JSON.parse(new TextDecoder().decode(un64(parts[0])));
    if (!Number.isFinite(job.expires) || job.expires < Date.now()) throw Error();
    queueURL(job.status, job.id, true); queueURL(job.result, job.id, false);
    return job;
  } catch (_) { throw bad(403,'모델 조회 링크가 만료되었거나 유효하지 않습니다. 저장한 파일을 사용해 주세요.','MODEL_TICKET_EXPIRED'); }
}
function queueURL(value, id, status) {
  const url = new URL(value);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id) || url.origin !== 'https://queue.fal.run' || url.pathname !== `/meshy/v7.1/requests/${id}${status?'/status':''}` || url.search || url.hash || url.username || url.password) throw bad(502,'3D 생성 요청 주소를 확인하지 못했습니다.','MODEL_QUEUE_INVALID');
  return url.href;
}
export function assetURL(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : value?.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !/(^|\.)(fal\.media|meshy\.ai)$/.test(url.hostname)) return null;
    return url.href;
  } catch (_) { return null; }
}
function headers(env) { return {Authorization:`Key ${env.FAL_KEY}`,'Content-Type':'application/json','X-Fal-Store-IO':'0','X-Fal-Object-Lifecycle-Preference':JSON.stringify({expiration_duration_seconds:7200})}; }
export async function submitModel(images, env, network) {
  const response = await network(QUEUE+MODEL_ID, {method:'POST',headers:headers(env),signal:AbortSignal.timeout(45000),body:JSON.stringify({
    image_urls:images, topology:'triangle', target_polycount:50000,
    should_remesh:true, should_texture:true, texture_model:'meshy-7', enable_pbr:true,
    symmetry_mode:'off', pose_mode:'a-pose', enable_rigging:false, enable_animation:false, enable_safety_checker:true,
  })});
  if (!response.ok) {
    const detail=await response.text(),balance=response.status===402||/exhausted balance|insufficient.*(?:balance|credit)|top up/i.test(detail);
    const code = balance ? 'PROVIDER_BALANCE' : [401,403].includes(response.status) ? 'PROVIDER_PERMISSION' : 'MODEL_REJECTED';
    const message = balance ? 'fal.ai 잔액이 부족합니다. 충전 후 다시 이용해 주세요.' : [401,403].includes(response.status) ? '3D 모델 접근 권한을 확인해 주세요. fal.ai 키에서 Meshy 모델 사용이 허용되어야 합니다.' : '3D 생성 요청이 거절되었습니다. 잠시 후 사진과 이용 한도를 확인해 주세요.';
    throw Object.assign(bad(response.status === 422 ? 422 : 503,message,code), {releaseQuota:[400,401,402,403,422,429].includes(response.status)});
  }
  const result = await response.json();
  const job = {id:result.request_id,status:queueURL(result.status_url,result.request_id,true),result:queueURL(result.response_url,result.request_id,false),expires:Date.now()+7200000};
  return {ok:true,status:'IN_QUEUE',ticket:await signTicket(job,env.FAL_KEY),expires:job.expires};
}
async function resultFor(job, env, network) {
  const response = await network(job.result,{headers:headers(env),signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw bad(502,'3D 모델 결과를 가져오지 못했습니다. 결과 확인 버튼으로 다시 조회해 주세요.','MODEL_RESULT_UNAVAILABLE');
  const result = await response.json();
  const glb = assetURL(result.model_glb || result.model_urls?.glb);
  if (!glb) throw bad(502,'생성된 3D 모델 파일을 확인하지 못했습니다.','MODEL_FILE_MISSING');
  return {glb,blend:assetURL(result.model_urls?.blend),fbx:assetURL(result.model_urls?.fbx)};
}
export async function modelStatus(ticket, env, network) {
  const job = await readTicket(ticket,env.FAL_KEY);
  const response = await network(job.status,{headers:headers(env),signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw bad(502,'처리 상태를 확인하지 못했습니다. 재생성 없이 다시 조회할 수 있습니다.','MODEL_STATUS_UNAVAILABLE');
  const result = await response.json();
  if (result.status === 'COMPLETED') {
    if (result.error || result.error_type) return {ok:true,status:'FAILED',error:'3D 생성에 실패했습니다. 기준 이미지의 전신·손·발·의상 일관성을 확인해 주세요.'};
    const files = await resultFor(job,env,network);
    return {ok:true,status:'COMPLETED',formats:Object.keys(files).filter(k=>files[k]),expires:job.expires};
  }
  if (!['IN_QUEUE','IN_PROGRESS'].includes(result.status)) throw bad(502,'알 수 없는 처리 상태입니다. 잠시 후 다시 조회해 주세요.','MODEL_STATUS_INVALID');
  return {ok:true,status:result.status,expires:job.expires};
}
export async function modelFile(ticket, format, env, network, cors) {
  if (!['glb','blend','fbx'].includes(format)) throw bad(400,'지원하지 않는 모델 형식입니다.');
  const job = await readTicket(ticket,env.FAL_KEY), files = await resultFor(job,env,network);
  if (!files[format]) throw bad(404,'해당 파일은 제공되지 않았습니다. 브라우저의 블렌더 내보내기를 이용해 주세요.');
  const response = await network(files[format],{redirect:'manual',signal:AbortSignal.timeout(120000)});
  if (!response.ok || !response.body) throw bad(502,'모델 파일 다운로드에 실패했습니다. 다시 다운로드해 주세요.');
  // Stream with a hard upper bound; don't buffer large meshes in a 128 MB Worker.
  let size = 0;
  const body = response.body.pipeThrough(new TransformStream({transform(chunk,controller){size+=chunk.length;if(size>100*1024*1024)throw Error('Model exceeds 100 MB');controller.enqueue(chunk);}}));
  return new Response(body,{headers:{...cors,'Content-Type':format==='glb'?'model/gltf-binary':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="THE-PIT-avatar.${format}"`}});
}
