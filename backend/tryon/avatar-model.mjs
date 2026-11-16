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
  } catch (_) { throw bad(403,'The model access link has expired or is invalid. Please use your saved files.','MODEL_TICKET_EXPIRED'); }
}
function queueURL(value, id, status) {
  const url = new URL(value);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id) || url.origin !== 'https://queue.fal.run' || url.pathname !== `/meshy/v7.1/requests/${id}${status?'/status':''}` || url.search || url.hash || url.username || url.password) throw bad(502,'The 3D generation request URL could not be verified.','MODEL_QUEUE_INVALID');
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
    const message = balance ? '3D generation credits are depleted. Please contact the operator.' : [401,403].includes(response.status) ? '3D model access is not authorized. The operator needs to enable Meshy access for the fal.ai key.' : 'The 3D request was rejected. Please check your reference images and usage limits before trying again.';
    throw Object.assign(bad(response.status === 422 ? 422 : 503,message,code), {releaseQuota:[400,401,402,403,422,429].includes(response.status)});
  }
  const result = await response.json();
  const job = {id:result.request_id,status:queueURL(result.status_url,result.request_id,true),result:queueURL(result.response_url,result.request_id,false),expires:Date.now()+7200000};
  return {ok:true,status:'IN_QUEUE',ticket:await signTicket(job,env.FAL_KEY),expires:job.expires};
}
async function resultFor(job, env, network) {
  const response = await network(job.result,{headers:headers(env),signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw bad(502,'The 3D result could not be retrieved. Select Check existing job to try again.','MODEL_RESULT_UNAVAILABLE');
  const result = await response.json();
  const glb = assetURL(result.model_glb || result.model_urls?.glb);
  if (!glb) throw bad(502,'The generated 3D model file could not be found.','MODEL_FILE_MISSING');
  return {glb,blend:assetURL(result.model_urls?.blend),fbx:assetURL(result.model_urls?.fbx)};
}
export async function modelStatus(ticket, env, network) {
  const job = await readTicket(ticket,env.FAL_KEY);
  const response = await network(job.status,{headers:headers(env),signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw bad(502,'The job status could not be checked. You can check again without starting another generation.','MODEL_STATUS_UNAVAILABLE');
  const result = await response.json();
  if (result.status === 'COMPLETED') {
    if (result.error || result.error_type) return {ok:true,status:'FAILED',error:'3D generation failed. Check full-body coverage and the consistency of hands, feet and clothing in your references.'};
    const files = await resultFor(job,env,network);
    return {ok:true,status:'COMPLETED',formats:Object.keys(files).filter(k=>files[k]),expires:job.expires};
  }
  if (!['IN_QUEUE','IN_PROGRESS'].includes(result.status)) throw bad(502,'An unknown job status was received. Please check again shortly.','MODEL_STATUS_INVALID');
  return {ok:true,status:result.status,expires:job.expires};
}
export async function modelFile(ticket, format, env, network, cors) {
  if (!['glb','blend','fbx'].includes(format)) throw bad(400,'This model format is not supported.');
  const job = await readTicket(ticket,env.FAL_KEY), files = await resultFor(job,env,network);
  if (!files[format]) throw bad(404,'This file was not provided. Use the Blender export in your browser instead.');
  const response = await network(files[format],{redirect:'manual',signal:AbortSignal.timeout(120000)});
  if (!response.ok || !response.body) throw bad(502,'The model file could not be downloaded. Please try again.');
  // Stream with a hard upper bound; don't buffer large meshes in a 128 MB Worker.
  let size = 0;
  const body = response.body.pipeThrough(new TransformStream({transform(chunk,controller){size+=chunk.length;if(size>100*1024*1024)throw Error('Model exceeds 100 MB');controller.enqueue(chunk);}}));
  return new Response(body,{headers:{...cors,'Content-Type':format==='glb'?'model/gltf-binary':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="THE-PIT-avatar.${format}"`}});
}
