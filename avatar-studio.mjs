const $=id=>document.getElementById(id), config=window.THEPIT_CONFIG||{};
const endpoint=String(config.TRYON_ENDPOINT||'').replace(/\/$/,'');
let refs=null,epoch=0,widget=null,token='',ticket='',busy=false,polling=false,pollRun=0,viewer=null,modelBuffer=null,plans=[],rotating=false;
const say=text=>{$('modelStatus').textContent=text;};
function buttons(){
  $('generateModel').disabled=!refs||busy||!!ticket||!token||!$('modelConsent').checked||!$('modelBodyConfirmed').checked;
  $('modelConsent').disabled=busy||!!ticket;$('modelBodyConfirmed').disabled=busy||!!ticket;
  $('checkModel').hidden=!ticket||!!modelBuffer;$('checkModel').disabled=polling;
  $('pauseModel').hidden=!polling;
}
function reset(){
  epoch++;pollRun++;refs=null;ticket='';token='';busy=false;polling=false;modelBuffer=null;rotating=false;
  if(widget!==null&&window.turnstile)window.turnstile.remove(widget);widget=null;
  viewer?.dispose();viewer=null;
  $('modelConsent').checked=false;$('modelBodyConfirmed').checked=false;
  $('avatarModelWorkspace').hidden=true;$('avatarViewerWorkspace').hidden=true;
  $('avatarCameraGrid').replaceChildren();$('avatarExportStatus').textContent='';$('downloadBlend').disabled=false;buttons();
}
function references(value){reset();if(!value)return;refs=value;$('avatarModelWorkspace').hidden=false;$('avatarHeight').value=value.height;say('Check all four full-body references before generating a 3D model. Unseen areas are inferred by AI.');buttons();}
async function security(){
  if(!refs||ticket||!$('modelConsent').checked||!$('modelBodyConfirmed').checked||widget!==null)return;
  if(!window.turnstile){say('The security check could not load. Keep this page open and select the consent checkbox again shortly.');return;}
  const version=epoch;
  widget=window.turnstile.render($('modelChallenge'),{sitekey:config.TRYON_TURNSTILE_SITE_KEY,action:'fit-studio',theme:'dark',language:'en',callback:value=>{if(version!==epoch)return;token=value;buttons();},'expired-callback':()=>{token='';buttons();},'error-callback':()=>{token='';say('The security check failed. Please select the consent checkbox again.');buttons();}});
}
for(const id of ['modelConsent','modelBodyConfirmed'])$(id).addEventListener('change',()=>{token='';if(widget!==null&&window.turnstile)window.turnstile.remove(widget);widget=null;buttons();security();});
async function post(path,data,timeout=20000){
  const response=await fetch(endpoint+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(timeout)});
  const result=await response.json();if(!response.ok||!result.ok)throw Object.assign(Error(result.error||'The request could not be processed.'),{code:result.code,status:response.status});return result;
}
$('generateModel').addEventListener('click',async()=>{
  if($('generateModel').disabled)return;
  const version=epoch,source=refs;busy=true;buttons();say('Submitting your 3D generation request. Please do not submit it again.');
  try{
    const result=await post('/character-model',{images:source.images,appearance:source.appearance,itemId:source.itemId,approved:true,bodyConfirmed:true,consent:true,token,requestId:crypto.randomUUID()},65000);
    if(version!==epoch)return;
    ticket=result.ticket;if(!ticket)throw Error('No job reference was received. Please contact support before generating again.');
    busy=false;buttons();await poll(version);
  }catch(error){if(version!==epoch)return;say(error.name==='TimeoutError'||!error.status?'The submission could not be confirmed. It may already be processing, so no automatic retry will be made. Please contact support to check the existing request before generating again.':error.message);
    // A definite rejection can be retried; an ambiguous timeout must not duplicate a charge.
    if(error.status){busy=false;if(widget!==null)window.turnstile?.reset(widget);}buttons();
  }
});
async function poll(version=epoch){
  if(polling||!ticket)return;polling=true;buttons();const run=++pollRun,until=Date.now()+20*60*1000;
  try{
    while(polling&&version===epoch&&run===pollRun){
      const result=await post('/character-model/status',{ticket});if(version!==epoch||!polling||run!==pollRun)return;
      if(result.status==='FAILED'){say(result.error);return;}
      if(result.status==='COMPLETED'){say('3D generation complete. Preparing the 360° viewer…');await loadModel(version);return;}
      say(result.status==='IN_QUEUE'?'Your 3D model is queued. We are checking the existing job without starting a new generation.':'Creating the 3D geometry and textures. This may take several minutes.');
      if(Date.now()>until){say('This is taking longer than expected. Select Check existing job to continue checking without starting another generation.');return;}
      await new Promise(resolve=>setTimeout(resolve,6000));
    }
  }catch(error){if(version===epoch&&run===pollRun)say(error.message+' Your existing job is kept. Select Check existing job to check again.');}
  finally{if(version===epoch&&run===pollRun){polling=false;buttons();}}
}
async function loadModel(version){
  const response=await fetch(endpoint+'/character-model/file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket,format:'glb'}),signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error('Model download failed. Select Check existing job to try again.');
  const buffer=await response.arrayBuffer();if(version!==epoch)return;
  const [{createAvatarViewer},cameraPlan]=await Promise.all([import('./avatar-viewer.mjs?v=20261117-en1'),fetch('./avatar-camera-plan.json?v=20261117-en1').then(r=>r.json())]);if(version!==epoch)return;
  plans=cameraPlan;modelBuffer=buffer;$('avatarViewerWorkspace').hidden=false;
  let loaded;
  try{loaded=await createAvatarViewer($('avatarViewer'),buffer,{onCamera:plan=>{$('avatarCameraLabel').textContent=plan?`${plan.label} · Azimuth ${plan.azimuth}° / Elevation ${plan.elevation}°`:'Free view';if(plan){rotating=false;$('avatarAutoRotate').setAttribute('aria-pressed','false');}for(const b of $('avatarCameraGrid').children)b.setAttribute('aria-pressed',String(b.dataset.id===plan?.id));}});}catch(error){$('downloadBlend').disabled=true;$('avatarExportStatus').textContent='The browser could not open this model. You can still download the original GLB. '+error.message;say('3D generation is complete, but the preview could not load. Download the original GLB and import it into Blender.');buttons();return;}
  if(version!==epoch){loaded.dispose();return;}viewer=loaded;modelBuffer=buffer;
  $('avatarCameraGrid').replaceChildren(...plans.map(plan=>{const button=document.createElement('button');button.type='button';button.dataset.id=plan.id;button.setAttribute('aria-pressed',String(plan.id==='front'));const strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=plan.label;small.textContent=plan.purpose;button.append(strong,small);button.addEventListener('click',()=>viewer?.shot(plan));return button;}));
  say('Your 3D model is ready. Drag to rotate or choose a camera preset. Save the .blend and original GLB before leaving this page.');buttons();
  window.dispatchEvent(new CustomEvent('avatar:application', {detail:window.FIT_TRYON?.applicationResult('model')}));
}
function save(blob,filename){if(!blob)throw Error('The file could not be created.');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('checkModel').addEventListener('click',()=>poll());
$('pauseModel').addEventListener('click',()=>{polling=false;pollRun++;say('Status checks are paused. Generation continues on the server. Select Check existing job to resume checking.');buttons();});
$('avatarReset').addEventListener('click',()=>viewer?.shot(plans[0]));
$('avatarSetFront').addEventListener('click',()=>{viewer?.setFront();viewer?.shot(plans[0]);});
$('avatarAutoRotate').addEventListener('click',()=>{rotating=!rotating;viewer?.autoRotate(rotating);$('avatarAutoRotate').setAttribute('aria-pressed',String(rotating));});
$('downloadModel').addEventListener('click',()=>{if(modelBuffer)save(new Blob([modelBuffer],{type:'model/gltf-binary'}),'THE-PIT-avatar-source.glb');});
$('downloadCamera').addEventListener('click',async()=>{if(viewer)save(await viewer.snapshot(),'THE-PIT-avatar-camera.png');});
$('downloadBlend').addEventListener('click',async()=>{
  if(!viewer||$('downloadBlend').disabled)return;
  const height=Number($('avatarHeight').value),version=epoch,current=viewer;
  if(!Number.isFinite(height)||height<80||height>250){$('avatarExportStatus').textContent='Enter a height between 80 and 250 cm.';return;}
  $('downloadBlend').disabled=true;$('avatarExportStatus').textContent='Packaging the mesh, UVs, textures and cameras into a Blender project. No additional AI generation charges apply.';
  try{const blob=await current.blend(height/100);if(version!==epoch)return;save(blob,'THE-PIT-avatar-production.blend');$('avatarExportStatus').textContent='Blender project saved with your chosen front direction and height. Blender 3.6 or newer is recommended.';}
  catch(error){if(version===epoch)$('avatarExportStatus').textContent=error.message;}
  finally{if(version===epoch)$('downloadBlend').disabled=false;}
});
window.addEventListener('avatar:references',event=>references(event.detail));
references(window.FIT_TRYON?.avatarReferences()||null);
