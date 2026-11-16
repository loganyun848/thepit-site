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
function references(value){reset();if(!value)return;refs=value;$('avatarModelWorkspace').hidden=false;$('avatarHeight').value=value.height;say('전신 기준 4장을 확인한 뒤 입체 모델을 생성해 주세요. 사진에 없는 부위는 AI 추정입니다.');buttons();}
async function security(){
  if(!refs||ticket||!$('modelConsent').checked||!$('modelBodyConfirmed').checked||widget!==null)return;
  if(!window.turnstile){say('보안 확인을 불러오지 못했습니다. 페이지를 유지한 채 잠시 후 동의를 다시 선택해 주세요.');return;}
  const version=epoch;
  widget=window.turnstile.render($('modelChallenge'),{sitekey:config.TRYON_TURNSTILE_SITE_KEY,action:'fit-studio',theme:'dark',callback:value=>{if(version!==epoch)return;token=value;buttons();},'expired-callback':()=>{token='';buttons();},'error-callback':()=>{token='';say('보안 확인에 실패했습니다. 동의를 다시 선택해 주세요.');buttons();}});
}
for(const id of ['modelConsent','modelBodyConfirmed'])$(id).addEventListener('change',()=>{token='';if(widget!==null&&window.turnstile)window.turnstile.remove(widget);widget=null;buttons();security();});
async function post(path,data,timeout=20000){
  const response=await fetch(endpoint+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(timeout)});
  const result=await response.json();if(!response.ok||!result.ok)throw Object.assign(Error(result.error||'요청을 처리하지 못했습니다.'),{code:result.code,status:response.status});return result;
}
$('generateModel').addEventListener('click',async()=>{
  if($('generateModel').disabled)return;
  const version=epoch,source=refs;busy=true;buttons();say('입체 모델 생성 요청을 접수하고 있습니다. 중복으로 누르지 마세요.');
  try{
    const result=await post('/character-model',{images:source.images,appearance:source.appearance,itemId:source.itemId,approved:true,bodyConfirmed:true,consent:true,token,requestId:crypto.randomUUID()},65000);
    if(version!==epoch)return;
    ticket=result.ticket;if(!ticket)throw Error('접수 번호를 받지 못했습니다. 바로 재생성하지 말고 운영자에게 문의해 주세요.');
    busy=false;buttons();await poll(version);
  }catch(error){if(version!==epoch)return;say(error.name==='TimeoutError'||!error.status?'접수 결과를 확인하지 못했습니다. 서버에서 이미 처리 중일 수 있으므로 자동 재시도하지 않습니다. 잠시 후 fal.ai 요청 내역을 확인해 주세요.':error.message);
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
      if(result.status==='COMPLETED'){say('입체 모델 생성 완료. 360° 뷰어를 준비합니다…');await loadModel(version);return;}
      say(result.status==='IN_QUEUE'?'3D 생성 대기 중. 기존 요청을 조회하고 있으며 새 생성 비용은 발생하지 않습니다.':'입체 형상과 표면 재질을 만들고 있습니다. 수 분이 걸릴 수 있습니다.');
      if(Date.now()>until){say('처리가 오래 걸리고 있습니다. ‘접수한 작업 결과 확인’으로 이어서 조회해 주세요. 다시 생성하지 않습니다.');return;}
      await new Promise(resolve=>setTimeout(resolve,6000));
    }
  }catch(error){if(version===epoch&&run===pollRun)say(error.message+' 기존 작업은 유지됩니다. 결과 확인을 눌러 다시 조회해 주세요.');}
  finally{if(version===epoch&&run===pollRun){polling=false;buttons();}}
}
async function loadModel(version){
  const response=await fetch(endpoint+'/character-model/file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket,format:'glb'}),signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error('모델 다운로드에 실패했습니다. 결과 확인으로 다시 시도해 주세요.');
  const buffer=await response.arrayBuffer();if(version!==epoch)return;
  const [{createAvatarViewer},cameraPlan]=await Promise.all([import('./avatar-viewer.mjs'),fetch('./avatar-camera-plan.json').then(r=>r.json())]);if(version!==epoch)return;
  plans=cameraPlan;modelBuffer=buffer;$('avatarViewerWorkspace').hidden=false;
  let loaded;
  try{loaded=await createAvatarViewer($('avatarViewer'),buffer,{onCamera:plan=>{$('avatarCameraLabel').textContent=plan?`${plan.label} · 방위 ${plan.azimuth}° / 높이 ${plan.elevation}°`:'자유 시점';if(plan){rotating=false;$('avatarAutoRotate').setAttribute('aria-pressed','false');}for(const b of $('avatarCameraGrid').children)b.setAttribute('aria-pressed',String(b.dataset.id===plan?.id));}});}catch(error){$('downloadBlend').disabled=true;$('avatarExportStatus').textContent='브라우저에서 이 모델을 열지 못했습니다. 원본 GLB 저장은 가능합니다. '+error.message;say('3D 생성은 완료됐으나 미리보기를 열지 못했습니다. 원본 GLB를 내려받아 Blender에서 가져오기로 열어 주세요.');buttons();return;}
  if(version!==epoch){loaded.dispose();return;}viewer=loaded;modelBuffer=buffer;
  $('avatarCameraGrid').replaceChildren(...plans.map(plan=>{const button=document.createElement('button');button.type='button';button.dataset.id=plan.id;button.setAttribute('aria-pressed',String(plan.id==='front'));const strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=plan.label;small.textContent=plan.purpose;button.append(strong,small);button.addEventListener('click',()=>viewer?.shot(plan));return button;}));
  say('3D 모델 준비 완료. 드래그로 회전하고 촬영 각도를 선택해 주세요. 페이지를 떠나기 전에 .blend와 원본 GLB를 저장하세요.');buttons();
}
function save(blob,filename){if(!blob)throw Error('파일을 만들지 못했습니다.');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('checkModel').addEventListener('click',()=>poll());
$('pauseModel').addEventListener('click',()=>{polling=false;pollRun++;say('상태 조회를 멈췄습니다. 서버 생성은 계속되며, 결과 확인으로 다시 조회할 수 있습니다.');buttons();});
$('avatarReset').addEventListener('click',()=>viewer?.shot(plans[0]));
$('avatarSetFront').addEventListener('click',()=>{viewer?.setFront();viewer?.shot(plans[0]);});
$('avatarAutoRotate').addEventListener('click',()=>{rotating=!rotating;viewer?.autoRotate(rotating);$('avatarAutoRotate').setAttribute('aria-pressed',String(rotating));});
$('downloadModel').addEventListener('click',()=>{if(modelBuffer)save(new Blob([modelBuffer],{type:'model/gltf-binary'}),'THE-PIT-avatar-source.glb');});
$('downloadCamera').addEventListener('click',async()=>{if(viewer)save(await viewer.snapshot(),'THE-PIT-avatar-camera.png');});
$('downloadBlend').addEventListener('click',async()=>{
  if(!viewer||$('downloadBlend').disabled)return;
  const height=Number($('avatarHeight').value),version=epoch,current=viewer;
  if(!Number.isFinite(height)||height<80||height>250){$('avatarExportStatus').textContent='키를 80–250 cm 범위로 입력해 주세요.';return;}
  $('downloadBlend').disabled=true;$('avatarExportStatus').textContent='메시·UV·재질·카메라를 블렌더 프로젝트로 묶고 있습니다. 추가 AI 생성 비용은 없습니다.';
  try{const blob=await current.blend(height/100);if(version!==epoch)return;save(blob,'THE-PIT-avatar-production.blend');$('avatarExportStatus').textContent='블렌더 프로젝트 저장 완료. 현재 지정한 정면과 기준 키를 반영했습니다. Blender 3.6 이상 권장.';}
  catch(error){if(version===epoch)$('avatarExportStatus').textContent=error.message;}
  finally{if(version===epoch)$('downloadBlend').disabled=false;}
});
window.addEventListener('avatar:references',event=>references(event.detail));
references(window.FIT_TRYON?.avatarReferences()||null);
