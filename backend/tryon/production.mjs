// Private relay. Approved avatar references expire after seven days.
// One motion job per verified 3D generation; this module never calls a paid model.
import { readTicket, modelSource } from './avatar-model.mjs';

const fail = (status, message) => Object.assign(Error(message), { status });
const json = (data, status=200, cors={}) => Response.json(data, {status, headers:{'Cache-Control':'no-store', ...cors}});
const enc = new TextEncoder();
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
export async function signIntake(id, image, secret) {
  const payload=base64(enc.encode(JSON.stringify({purpose:'avatar-intake-v1',id:'app-'+id,hash:await digest(image),expires:Date.now()+7*86400000})));
  return payload+'.'+base64(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),enc.encode(payload))));
}
async function readIntake(value, secret) {
  try {
    if(typeof value!=='string'||value.length>1024)throw Error();
    const [payload,signature,...extra]=value.split('.');
    if(extra.length||!await crypto.subtle.verify('HMAC',await key(secret),bytes(signature),enc.encode(payload)))throw Error();
    const data=JSON.parse(new TextDecoder().decode(bytes(payload)));
    if(data.purpose!=='avatar-intake-v1'||!uuid.test(data.id)||!/^app-/.test(data.id)||!Number.isFinite(data.expires)||data.expires<Date.now()||!/^[a-f0-9]{64}$/.test(data.hash))throw Error();
    return data;
  }catch{throw fail(403,'The avatar transfer reference has expired or is invalid. Save your images and contact the team.');}
}
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
async function body(request, maximum=12000) {
  if(!request.headers.get('Content-Type')?.startsWith('application/json')) throw fail(415,'JSON is required.');
  const reader=request.body?.getReader(); if(!reader)throw fail(400,'A request body is required.');
  let text='',size=0; const decoder=new TextDecoder();
  while(true) {const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maximum){await reader.cancel();throw fail(413,'Request too large.');}text+=decoder.decode(value,{stream:true});}
  let data;try{data=JSON.parse(text+decoder.decode());}catch{throw fail(400,'Invalid JSON.');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw fail(400,'Invalid request.');return data;
}
export async function productionRoute(request, env, network, cors) {
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/production/'))return null;
  try {
    if(request.method!=='POST')throw fail(405,'Use POST.');
    if(!env.PRODUCTION_QUEUE||!env.PRODUCTION_KEY||!env.FAL_KEY)throw fail(503,'The production worker is being connected.');
    const publicPath=['/production/enqueue','/production/status','/production/intake'].includes(path);
    if(publicPath&&!request.headers.get('Origin'))throw fail(403,'Open this request from Fit Room.');
    if(!publicPath&&!await authorized(request,env))throw fail(401,'Production authentication required.');
    const data=await body(request,path==='/production/intake'?15*1024*1024:12000);
    const queue=env.PRODUCTION_QUEUE.get(env.PRODUCTION_QUEUE.idFromName('motion-v1'));
    const call=(action,input)=>queue.fetch('https://production'+action,{method:'POST',body:JSON.stringify(input)});
    if(path==='/production/intake') {
      if(data.consent!==true||!['front','references','model'].includes(data.stage))throw fail(400,'Confirm transfer to the production team.');
      const grant=await readIntake(data.intakeTicket,env.FAL_KEY),height=Number(data.height);
      if(!Number.isFinite(height)||height<80||height>250)throw fail(400,'Check the avatar height.');
      if(typeof data.image!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data.image)||await digest(data.image)!==grant.hash)throw fail(400,'Use the original generated avatar reference.');
      const response=await call('/intake',{id:grant.id,image:data.image,stage:data.stage,height,created:Date.now()});
      return json({ok:response.ok,...await response.json(),...(response.ok?{receipt:await receipt(grant.id,env.PRODUCTION_KEY)}:{})},response.status,cors);
    }
    if(path==='/production/enqueue') {
      if(data.consent!==true||data.action!=='wave-v1')throw fail(400,'Confirm transfer to the production team.');
      const height=Number(data.height),yaw=Number(data.yaw);
      if(!Number.isFinite(height)||height<80||height>250||!Number.isFinite(yaw)||Math.abs(yaw)>Math.PI*2)throw fail(400,'Check height and front direction.');
      const job=await readTicket(data.ticket,env.FAL_KEY);
      const applicationId=data.intakeTicket?(await readIntake(data.intakeTicket,env.FAL_KEY)).id:undefined;
      // Query first so a client retry never resolves/downloads a model twice.
      const existing=await call('/lookup',{id:job.id});
      if(existing.ok) {
        const linked=applicationId?await call('/link',{id:job.id,applicationId}):existing;
        return json({ok:linked.ok,...await linked.json(),...(linked.ok?{receipt:await receipt(job.id,env.PRODUCTION_KEY)}:{})},linked.status,cors);
      }
      const source=await modelSource(job,env,network);
      const response=await call('/enqueue',{id:job.id,source,sourceExpires:job.expires,height,yaw,action:'wave-v1',applicationId,created:Date.now()});
      const result=await response.json();
      if(!response.ok)return json(result,response.status,cors);
      return json({ok:true,...result,receipt:await receipt(job.id,env.PRODUCTION_KEY)},202,cors);
    }
    if(path==='/production/status') {
      const id=await verifyReceipt(data.receipt,env.PRODUCTION_KEY),response=await call('/lookup',{id});
      return json({ok:response.ok,...await response.json()},response.status,cors);
    }
    const routes={'/production/claim':'/claim','/production/heartbeat':'/heartbeat','/production/finish':'/finish','/production/source':'/source','/production/intakes':'/intakes','/production/reference':'/reference'};
    if(!routes[path])throw fail(404,'Unknown production route.');
    const response=await call(routes[path],data);
    if(path==='/production/reference')return response;
    if(path!=='/production/source'||!response.ok)return json(await response.json(),response.status,cors);
    const {source}=await response.json();
    const asset=await network(source,{redirect:'manual',signal:AbortSignal.timeout(120000)});
    if(!asset.ok||!asset.body)throw fail(502,'The source model is unavailable. Please use a saved GLB.');
    let size=0;const stream=asset.body.pipeThrough(new TransformStream({transform(chunk,controller){size+=chunk.length;if(size>100*1024*1024)throw Error('Model exceeds 100 MB');controller.enqueue(chunk);}}));
    return new Response(stream,{headers:{'Content-Type':'model/gltf-binary','Cache-Control':'no-store'}});
  }catch(error){return json({ok:false,error:error.status?error.message:'Production request could not be confirmed. Check the existing job before retrying.'},error.status||502,cors);}
}
function summary(job){return {jobId:job.id,status:job.status,action:job.action,created:job.created,updated:job.updated,sourceExpires:job.sourceExpires,...(job.kind?{kind:job.kind,stage:job.stage,modelId:job.modelId,height:job.height}:{}),...(job.applicationId?{applicationId:job.applicationId}:{}),...(job.result?{result:job.result}:{}),...(job.error?{error:job.error}:{})};}
export class ProductionQueue {
  constructor(ctx){this.ctx=ctx;}
  async schedule(){const jobs=await this.ctx.storage.get('jobs')||{},now=Date.now();const deadlines=Object.values(jobs).flatMap(j=>[j.created+7*86400000,...(j.source&&j.sourceExpires>now?[j.sourceExpires]:[])]);if(deadlines.length)await this.ctx.storage.setAlarm(Math.max(now+1000,Math.min(...deadlines)));}
  async fetch(request) {
    const path=new URL(request.url).pathname,data=await request.json(),now=Date.now();
    const response=await this.ctx.storage.transaction(async txn=>{
      const jobs=await txn.get('jobs')||{};
      for(const [id,job]of Object.entries(jobs)) {
        if(now-job.created>7*86400000){for(let i=0;i<(job.imageChunks||0);i++)await txn.delete('reference:'+id+':'+i);delete jobs[id];continue;}
        if(job.status==='QUEUED'&&job.sourceExpires<=now){job.status='EXPIRED';job.error='The source download window expired. Use your saved GLB with the internal program.';job.updated=now;delete job.source;}
        if(job.status==='PROCESSING'&&job.leaseUntil<now){job.status='INTERRUPTED';job.error='The production worker stopped responding. The operator can resume the saved local job.';job.updated=now;}
      }
      let job=jobs[data.id];
      if(path==='/intake') {
        if(!job) {
          if(Object.keys(jobs).length>=100)return json({ok:false,error:'Production queue is full.'},429);
          const imageChunks=Math.ceil(data.image.length/64000);
          for(let i=0;i<imageChunks;i++)await txn.put('reference:'+data.id+':'+i,data.image.slice(i*64000,(i+1)*64000));
          job=jobs[data.id]={id:data.id,kind:'application',status:'WAITING_MODEL',stage:data.stage,height:data.height,imageChunks,created:now,updated:now};
        }else{job.stage=data.stage;job.updated=now;}
        await txn.put('jobs',jobs);return json(summary(job),202);
      }
      if(path==='/intakes'){await txn.put('jobs',jobs);return json({ok:true,jobs:Object.values(jobs).filter(j=>j.kind==='application').map(j=>({...summary(j),status:jobs[j.modelId]?.status||j.status}))});}
      if(path==='/reference') {
        if(!job||job.kind!=='application')return json({ok:false,error:'Avatar reference not found.'},404);
        let image='';for(let i=0;i<job.imageChunks;i++)image+=await txn.get('reference:'+job.id+':'+i)||'';
        const match=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image);
        if(!match)return json({ok:false,error:'Avatar reference is unavailable.'},410);
        return new Response(Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0)),{headers:{'Content-Type':match[1],'Cache-Control':'no-store'}});
      }
      if(path==='/enqueue') {
        if(job)return json(summary(job));
        if(Object.keys(jobs).length>=100)return json({ok:false,error:'Production queue is full. Please contact the team.'},429);
        if(data.applicationId&&(!jobs[data.applicationId]||jobs[data.applicationId].kind!=='application'))return json({ok:false,error:'Transfer the application reference first.'},409);
        if(data.applicationId&&jobs[data.applicationId].modelId&&jobs[data.applicationId].modelId!==data.id)return json({ok:false,error:'This application already has a production model.'},409);
        job=jobs[data.id]={...data,status:'QUEUED',updated:now};if(data.applicationId)jobs[data.applicationId].modelId=data.id;await txn.put('jobs',jobs);return json(summary(job),202);
      }
      if(path==='/claim') {
        job=Object.values(jobs).filter(j=>j.status==='QUEUED').sort((a,b)=>a.created-b.created)[0];
        if(!job){await txn.put('jobs',jobs);return json({ok:true,job:null});}
        job.status='PROCESSING';job.updated=now;job.lease=crypto.randomUUID();job.leaseUntil=now+180000;
        await txn.put('jobs',jobs);
        return json({ok:true,job:{...summary(job),height:job.height,yaw:job.yaw,lease:job.lease}});
      }
      if(!job){await txn.put('jobs',jobs);return json({ok:false,error:'Production job not found.'},404);}
      if(path==='/link') {
        const app=jobs[data.applicationId];
        if(!app||app.kind!=='application'||job.kind==='application'||app.modelId&&app.modelId!==job.id||job.applicationId&&job.applicationId!==app.id)return json({ok:false,error:'The application is linked to another model or is unavailable.'},409);
        app.modelId=job.id;job.applicationId=app.id;await txn.put('jobs',jobs);return json(summary(job));
      }
      if(path==='/lookup'){await txn.put('jobs',jobs);return json({...summary(job),...(job.modelId&&jobs[job.modelId]?{status:jobs[job.modelId].status}: {})});}
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
  async alarm(){await this.ctx.storage.transaction(async txn=>{const jobs=await txn.get('jobs')||{},now=Date.now();for(const[id,job]of Object.entries(jobs)){if(now-job.created>=7*86400000){for(let i=0;i<(job.imageChunks||0);i++)await txn.delete('reference:'+id+':'+i);delete jobs[id];continue;}if(job.sourceExpires<=now){delete job.source;if(job.status==='QUEUED'){job.status='EXPIRED';job.updated=now;job.error='The source download window expired. Use your saved GLB with the internal program.';}}}await txn.put('jobs',jobs);});await this.schedule();}
}
