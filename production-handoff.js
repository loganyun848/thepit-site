/* Explicit model transfer; no new AI generation and no automatic paid requests. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id),endpoint=String(window.THEPIT_CONFIG?.TRYON_ENDPOINT||'').replace(/\/$/,'');
  let source=null,receipt='',version=0,busy=false,timer=null;
  const labels={QUEUED:'Received. Waiting for the production workstation.',PROCESSING:'The production workstation is preparing your 5-second motion preview.',NEEDS_REVIEW:'Your 5-second preview and Blender project are saved at our studio for review. The team will check body movement before delivery.',FAILED:'This model needs manual inspection. The production team can inspect the saved files.',EXPIRED:'The source link expired before transfer. Save your GLB and contact the team.',INTERRUPTED:'The production workstation paused. The team can resume the saved local job.'};
  function buttons(){$('sendProduction').disabled=!source||busy||!!receipt||!$('productionConsent').checked;$('productionConsent').disabled=busy||!!receipt;$('checkProduction').hidden=!receipt;}
  async function post(path,data){const r=await fetch(endpoint+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(30000)});const result=await r.json();if(!r.ok||!result.ok)throw Error(result.error||'The production request could not be confirmed.');return result;}
  function show(result){$('productionStatus').textContent=(labels[result.status]||'Checking production status…')+' Job: '+result.jobId;}
  async function check(){if(!receipt)return;const v=version;clearTimeout(timer);try{const result=await post('/production/status',{receipt});if(v!==version)return;show(result);if(['QUEUED','PROCESSING'].includes(result.status))timer=setTimeout(check,10000);}catch(error){if(v===version)$('productionStatus').textContent=error.message+' Use Check production status to check the same job.';}}
  window.addEventListener('avatar:model-ready',event=>{version++;clearTimeout(timer);source=event.detail;receipt='';busy=false;$('productionConsent').checked=false;$('productionWorkspace').hidden=!source;$('productionStatus').textContent='Transfer one model for a 5-second wave preview. No additional AI generation credits are used. The preview is reviewed by our production team.';buttons();});
  $('productionConsent').addEventListener('change',buttons);
  $('sendProduction').addEventListener('click',async()=>{
    if($('sendProduction').disabled)return;
    const v=version,model=source;busy=true;buttons();$('productionStatus').textContent='Sending the completed model to our production queue…';
    try{const orientation=model.settings();const result=await post('/production/enqueue',{ticket:model.ticket,height:orientation.height,yaw:orientation.yaw,action:'wave-v1',consent:true});if(v!==version)return;receipt=result.receipt;if(!receipt)throw Error('No production receipt received.');show(result);timer=setTimeout(check,1000);}
    catch(error){if(v===version)$('productionStatus').textContent=error.message+' You may retry this transfer; the same model is accepted only once.';}
    finally{if(v===version){busy=false;buttons();}}
  });
  $('checkProduction').addEventListener('click',check);buttons();
})();
