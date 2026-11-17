// Metadata-only relay. Models are downloaded directly into the operator's worker.
// One motion job per verified 3D generation; this module never calls a paid model.
import { readTicket, modelSource } from './avatar-model.mjs';

const fail = (status, message) => Object.assign(Error(message), { status });
const json = (data, status=200, cors={}) => Response.json(data, {status, headers:{'Cache-Control':'no-store', ...cors}});
const enc = new TextEncoder();
const uuid = /^[a-zA-Z0-9_-]{8,100}$/;
const bytes = s => Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')), c=>c.charCodeAt(0));
const base64 = a => btoa(String.fromCharCode(...a)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
async function key(secret) { return crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC',hash:'SHA-256'},false,['sign','verify']); }
async function receipt(id, secret) {
  const payload = base64(enc.encode(JSON.stringify({purpose:'motion-status-v1',id,expires:Date.now()+7*86400000})));
  return payload+'.'+base64(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),enc.encode(payload))));
}
async function verifyReceipt(value, secret) {
  try {
    if(typeof value!=='string'||value.length>1024) throw Error();
    const [payload,signature,...extra]=value.split('.');
    if(extra.length||!await crypto.subtle.verify('HMAC',await key(secret),bytes(signature),enc.encode(payload))) throw Error();
    const data=JSON.parse(new TextDecoder().decode(bytes(payload)));
    if(data.purpose!=='motion-status-v1'||!uuid.test(data.id)||!Number.isFinite(data.expires)||data.expires<Date.now()) throw Error();
    return data.id;
  } catch { throw fail(403,'This production receipt has expired or is invalid.'); }
}
async function authorized(request, env) {
  if(!env.PRODUCTION_KEY) return false;
  const actual=request.headers.get('Authorization')||'';
  const digest=async text=>new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(text)));
  const [a,b]=await Promise.all([digest(actual),digest('Bearer '+env.PRODUCTION_KEY)]);
  return a.every((v,i)=>v===b[i]);
}
async function body(request) {
  if(!request.headers.get('Content-Type')?.startsWith('application/json')) throw fail(415,'JSON is required.');
  const reader=request.body?.getReader(); if(!reader)throw fail(400,'A request body is required.');
  let text='',size=0; const decoder=new TextDecoder();
  while(true) {const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>12000){await reader.cancel();throw fail(413,'Request too large.');}text+=decoder.decode(value,{stream:true});}
  let data;try{data=JSON.parse(text+decoder.decode());}catch{throw fail(400,'Invalid JSON.');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw fail(400,'Invalid request.');return data;
}
export async function productionRoute(request, env, network, cors) {
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/production/'))return null;
  try {
    if(request.method!=='POST')throw fail(405,'Use POST.');
    if(!env.PRODUCTION_QUEUE||!env.PRODUCTION_KEY||!env.FAL_KEY)throw fail(503,'The production worker is being connected.');
    const publicPath=['/production/enqueue','/production/status'].includes(path);
    if(publicPath&&!request.headers.get('Origin'))throw fail(403,'Open this request from Fit Room.');
    if(!publicPath&&!await authorized(request,env))throw fail(401,'Production authentication required.');
    const data=await body(request);
    const queue=env.PRODUCTION_QUEUE.get(env.PRODUCTION_QUEUE.idFromName('motion-v1'));
    const call=(action,input)=>queue.fetch('https://production'+action,{method:'POST',body:JSON.stringify(input)});
    if(path==='/production/enqueue') {
      if(data.consent!==true||data.action!=='wave-v1')throw fail(400,'Confirm transfer to the production team.');
      const height=Number(data.height),yaw=Number(data.yaw);
      if(!Number.isFinite(height)||height<80||height>250||!Number.isFinite(yaw)||Math.abs(yaw)>Math.PI*2)throw fail(400,'Check height and front direction.');
      const job=await readTicket(data.ticket,env.FAL_KEY);
      // Query first so a client retry never resolves/downloads a model twice.
      const existing=await call('/lookup',{id:job.id});
      if(existing.ok) return json({ok:true,...await existing.json(),receipt:await receipt(job.id,env.PRODUCTION_KEY)},200,cors);
      const source=await modelSource(job,env,network);
      const response=await call('/enqueue',{id:job.id,source,sourceExpires:job.expires,height,yaw,action:'wave-v1',created:Date.now()});
      const result=await response.json();
      if(!response.ok)return json(result,response.status,cors);
      return json({ok:true,...result,receipt:await receipt(job.id,env.PRODUCTION_KEY)},202,cors);
    }
    if(path==='/production/status') {
      const id=await verifyReceipt(data.receipt,env.PRODUCTION_KEY),response=await call('/lookup',{id});
      return json({ok:response.ok,...await response.json()},response.status,cors);
    }
    const routes={'/production/claim':'/claim','/production/heartbeat':'/heartbeat','/production/finish':'/finish','/production/source':'/source'};
    if(!routes[path])throw fail(404,'Unknown production route.');
    const response=await call(routes[path],data);
    if(path!=='/production/source'||!response.ok)return json(await response.json(),response.status,cors);
    const {source}=await response.json();
    const asset=await network(source,{redirect:'manual',signal:AbortSignal.timeout(120000)});
    if(!asset.ok||!asset.body)throw fail(502,'The source model is unavailable. Please use a saved GLB.');
    let size=0;const stream=asset.body.pipeThrough(new TransformStream({transform(chunk,controller){size+=chunk.length;if(size>100*1024*1024)throw Error('Model exceeds 100 MB');controller.enqueue(chunk);}}));
    return new Response(stream,{headers:{'Content-Type':'model/gltf-binary','Cache-Control':'no-store'}});
  }catch(error){return json({ok:false,error:error.status?error.message:'Production request could not be confirmed. Check the existing job before retrying.'},error.status||502,cors);}
}
function summary(job){return {jobId:job.id,status:job.status,action:job.action,created:job.created,updated:job.updated,sourceExpires:job.sourceExpires,...(job.result?{result:job.result}:{}),...(job.error?{error:job.error}:{})};}
export class ProductionQueue {
  constructor(ctx){this.ctx=ctx;}
  async schedule(){const jobs=await this.ctx.storage.get('jobs')||{},now=Date.now();const deadlines=Object.values(jobs).flatMap(j=>[j.created+7*86400000,...(j.source&&j.sourceExpires>now?[j.sourceExpires]:[])]);if(deadlines.length)await this.ctx.storage.setAlarm(Math.max(now+1000,Math.min(...deadlines)));}
  async fetch(request) {
    const path=new URL(request.url).pathname,data=await request.json(),now=Date.now();
    const response=await this.ctx.storage.transaction(async txn=>{
      const jobs=await txn.get('jobs')||{};
      for(const [id,job]of Object.entries(jobs)) {
        if(now-job.created>7*86400000){delete jobs[id];continue;}
        if(job.status==='QUEUED'&&job.sourceExpires<=now){job.status='EXPIRED';job.error='The source download window expired. Use your saved GLB with the internal program.';job.updated=now;delete job.source;}
        if(job.status==='PROCESSING'&&job.leaseUntil<now){job.status='INTERRUPTED';job.error='The production worker stopped responding. The operator can resume the saved local job.';job.updated=now;}
      }
      let job=jobs[data.id];
      if(path==='/enqueue') {
        if(job)return json(summary(job));
        if(Object.keys(jobs).length>=100)return json({ok:false,error:'Production queue is full. Please contact the team.'},429);
        job=jobs[data.id]={...data,status:'QUEUED',updated:now};await txn.put('jobs',jobs);return json(summary(job),202);
      }
      if(path==='/claim') {
        job=Object.values(jobs).filter(j=>j.status==='QUEUED').sort((a,b)=>a.created-b.created)[0];
        if(!job){await txn.put('jobs',jobs);return json({ok:true,job:null});}
        job.status='PROCESSING';job.updated=now;job.lease=crypto.randomUUID();job.leaseUntil=now+180000;
        await txn.put('jobs',jobs);
        return json({ok:true,job:{...summary(job),height:job.height,yaw:job.yaw,lease:job.lease}});
      }
      if(!job){await txn.put('jobs',jobs);return json({ok:false,error:'Production job not found.'},404);}
      if(path==='/lookup'){await txn.put('jobs',jobs);return json(summary(job));}
      if(!['PROCESSING','INTERRUPTED'].includes(job.status)||data.lease!==job.lease)return json({ok:false,error:'The production lease does not match.'},409);
      if(path==='/heartbeat'){job.status='PROCESSING';job.updated=now;job.leaseUntil=now+180000;}
      else if(path==='/source') {
        if(job.sourceExpires<=now)return json({ok:false,error:'Source link expired.'},410);
        return json({source:job.source});
      } else if(path==='/finish') {
        if(!['NEEDS_REVIEW','FAILED'].includes(data.status))return json({ok:false,error:'Invalid production status.'},400);
        if(data.status==='NEEDS_REVIEW') {
          const r=data.result;
          if(!r||r.duration!==5||r.frames!==120||r.fps!==24||!/^[a-f0-9]{64}$/.test(r.sha256)||!Number.isInteger(r.bytes)||r.bytes<=0)return json({ok:false,error:'Video verification is required.'},400);
          job.result={duration:5,frames:120,fps:24,sha256:r.sha256,bytes:r.bytes,filename:'preview.mp4'};
        } else job.error='The model needs manual inspection. The operator can inspect the local job log and saved model.';
        job.status=data.status;job.updated=now;delete job.source;
      }else return json({ok:false,error:'Unknown operation.'},404);
      await txn.put('jobs',jobs);return json({ok:true,...summary(job)});
    });
    await this.schedule();return response;
  }
  async alarm(){await this.ctx.storage.transaction(async txn=>{const jobs=await txn.get('jobs')||{},now=Date.now();for(const[id,job]of Object.entries(jobs)){if(now-job.created>=7*86400000){delete jobs[id];continue;}if(job.sourceExpires<=now){delete job.source;if(job.status==='QUEUED'){job.status='EXPIRED';job.updated=now;job.error='The source download window expired. Use your saved GLB with the internal program.';}}}await txn.put('jobs',jobs);});await this.schedule();}
}
