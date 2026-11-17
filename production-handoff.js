/* Application receipt -> existing 3D model -> local motion. Never starts paid AI. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id),endpoint=String(window.THEPIT_CONFIG?.TRYON_ENDPOINT||'').replace(/\/$/,'');
  let source=null,receipt='',version=0,busy=false,timer=null,application=null,intakeSaved=false,intakeFlight=null;
  const labels={QUEUED:'Received. Waiting for the production workstation.',PROCESSING:'The production workstation is preparing your 5-second motion preview.',NEEDS_REVIEW:'Your 5-second preview and Blender project are saved at our studio for review. The team will check body movement before delivery.',FAILED:'This model needs manual inspection. The production team can inspect the saved files.',EXPIRED:'The source link expired before transfer. Save your GLB and contact the team.',INTERRUPTED:'The production workstation paused. The team can resume the saved local job.'};
  labels.WAITING_MODEL='Application received by the production desk. A 3D model is still required before motion can start.';
  function buttons(){$('sendProduction').disabled=!source||busy||!!receipt||!($('productionConsent').checked||application);$('productionConsent').disabled=busy||!!receipt;$('checkProduction').hidden=!receipt;}
  function say(text,error=false){$('productionStatus').textContent=text;window.dispatchEvent(new CustomEvent('production:status',{detail:{text,error}}));}
  async function post(path,data){const r=await fetch(endpoint+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(30000)});const result=await r.json();if(!r.ok||!result.ok)throw Error(result.error||'The production request could not be confirmed.');return result;}
  function show(result){say((labels[result.status]||'Checking production status…')+' Job: '+result.jobId);}
  async function check(){if(!receipt)return;const v=version;clearTimeout(timer);try{const result=await post('/production/status',{receipt});if(v!==version)return;show(result);if(['QUEUED','PROCESSING'].includes(result.status))timer=setTimeout(check,10000);}catch(error){if(v===version)$('productionStatus').textContent=error.message+' Use Check production status to check the same job.';}}
  async function register(){
    if(!application||intakeSaved)return;
    if(intakeFlight)return intakeFlight;
    const v=version,app=application;
    if(!app.intakeTicket)throw Error('This older avatar session has no production transfer reference. Keep your images; complete the 3D model above and use Send for a 5-second preview.');
    intakeFlight=(async()=>{const result=await post('/production/intake',{intakeTicket:app.intakeTicket,image:app.images[0],stage:app.stage,height:app.height,consent:true});if(v!==version)return;intakeSaved=true;show(result);})();
    try{await intakeFlight;}finally{if(v===version)intakeFlight=null;}
  }
  async function submitted(draft){application=draft;buttons();try{await register();if(source)await send();}catch(error){say(error.message+' Your application email remains sent.',true);}}
  window.THEPIT_PRODUCTION={applicationSubmitted:submitted,retry:async()=>{if(source)await send();else if(application)await submitted(application);}};
  window.addEventListener('avatar:application',event=>{if(event.detail)return;version++;clearTimeout(timer);application=null;intakeSaved=false;intakeFlight=null;receipt='';busy=false;source=null;buttons();});
  window.addEventListener('avatar:model-ready',event=>{source=event.detail;$('productionConsent').checked=false;$('productionWorkspace').hidden=!source;if(source){say('Transfer one model for a 5-second wave preview. No additional AI generation credits are used.');if(application)void send();}buttons();});
  $('productionConsent').addEventListener('change',buttons);
  async function send(){
    if(!source||busy||receipt||!($('productionConsent').checked||application))return;
    const v=version,model=source;busy=true;buttons();$('productionStatus').textContent='Sending the completed model to our production queue…';
    try{if(application?.intakeTicket)await register();if(v!==version)return;const orientation=model.settings();const result=await post('/production/enqueue',{ticket:model.ticket,height:orientation.height,yaw:orientation.yaw,action:'wave-v1',consent:true,...(application?.intakeTicket?{intakeTicket:application.intakeTicket}:{})});if(v!==version)return;receipt=result.receipt;if(!receipt)throw Error('No production receipt received.');show(result);timer=setTimeout(check,1000);}
    catch(error){if(v===version)say(error.message+' Retry production transfer without resending your email.',true);}
    finally{if(v===version){busy=false;buttons();}}
  }
  $('sendProduction').addEventListener('click',send);
  $('checkProduction').addEventListener('click',check);buttons();
})();
