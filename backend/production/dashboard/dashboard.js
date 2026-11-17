(()=>{'use strict';
const $=id=>document.getElementById(id);
let data=null,selected=null,busy=false,polling=false,mediaKey='',noticeTimer=null,connectionError=false;
const activeStages=new Set(['receiving','validating','rigging','animating','rendering','verifying','reporting']);
const label={receiving:'Receiving model',validating:'Checking geometry',rigging:'Fitting the body rig',animating:'Applying the wave',rendering:'Rendering video',verifying:'Verifying 120 frames',reporting:'Updating production status',ready:'Ready for review',failed:'Needs attention',delivery_pending:'Delivery update pending',interrupted:'Interrupted'};
const step={receiving:0,validating:0,rigging:1,animating:2,rendering:3,verifying:3,reporting:3,ready:4};
label.waiting_model='Waiting for 3D model';
const clock=value=>value?new Date(value*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const when=value=>value?new Date(value*1000).toLocaleString('en-GB',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
function message(text,persistent=false){clearTimeout(noticeTimer);$('notice').textContent=text;$('notice').hidden=!text;if(text&&!persistent)noticeTimer=setTimeout(()=>{$('notice').hidden=true;},7000);}
function source(id,name){return '/media/'+encodeURIComponent(id)+'/'+name;}
function choose(id){selected=id;render();}
function nav(active){for(const id of ['overviewNav','jobsNav','sampleNav'])$(id).classList.toggle('active',id===active);}
function jobs(){return (data?.jobs||[]).filter(j=>!j.fixture);}
function render(){if(!data)return;
 const w=data.worker,list=jobs(),current=list.filter(j=>activeStages.has(j.stage)),ready=list.filter(j=>j.stage==='ready'&&j.verified);
 const mode=!w.online?'Offline':w.mode==='paused'?'Paused':w.mode==='error'?'Attention':w.mode==='processing'?'Working':'Online';
 $('receiverValue').textContent=mode;$('receiverDetail').textContent=w.online?'Heartbeat '+clock(w.heartbeat):'Start the receiver to accept jobs';
 $('receiverSignal').style.background=w.online?'#80d4b4':'#efc979';
 $('connectionBadge').replaceChildren(document.createElement('i'),document.createTextNode(w.online?(w.connection==='connected'?'Relay connected':'Receiver running'):'Receiver offline'));
 $('connectionBadge').classList.toggle('offline',!w.online);
 $('receivedValue').textContent=list.length;$('activeValue').textContent=current.length;$('readyValue').textContent=ready.length;
 $('navCount').textContent=list.length;$('jobsCount').textContent=list.length;
 const pausing=w.pausedRequested&&w.mode!=='paused';
 $('receiverHeading').textContent=!w.online?'Start your private receiver':pausing?'Pausing after the current job':w.mode==='paused'?'New jobs are paused':w.mode==='processing'?'An avatar is in production':w.mode==='error'?'Connection needs attention':'Listening for applications and models';
 $('receiverDescription').textContent=!w.online?'Run the receiver on this computer to accept models from Fit Room.':pausing?'The current job will finish safely. No new jobs will be claimed.':w.mode==='paused'?'Resume whenever you are ready. Your saved files are unchanged.':w.mode==='processing'?'The current model is being prepared and rendered locally.':w.mode==='error'?'The next connection check will run automatically. Inspect the local log if this continues.':'Your workstation checks the private queue every 10 seconds.';
 $('receiverButton').textContent=!w.online?'Start receiver':w.pausedRequested||w.mode==='paused'?'Resume receiving':'Pause receiving';$('receiverButton').disabled=busy;
 $('heartbeatTime').textContent=clock(w.heartbeat);$('contactTime').textContent=clock(w.lastContact);$('toolsStatus').textContent=data.setup.blender&&data.setup.videoCheck?'Blender + video verifier ready':'Check local tool configuration';
 $('queueFoot').textContent=w.online?(w.mode==='paused'?'Receiving paused':'Receiver online · No automatic publishing'):'Receiver offline · Saved files remain available';
 $('updatedTime').textContent='Updated '+clock(data.updatedAt);
 renderJobs(list);renderPreview();
}
function renderJobs(list){
 const search=$('jobSearch').value.toLowerCase(),filter=$('jobFilter').value;
 const visible=list.filter(j=>j.id.toLowerCase().includes(search)&&(filter==='all'||filter==='waiting'&&j.stage==='waiting_model'||filter==='active'&&activeStages.has(j.stage)||filter==='ready'&&j.stage==='ready'||filter==='failed'&&['failed','delivery_pending','interrupted'].includes(j.stage)));
 $('emptyJobs').hidden=list.length>0;
 const fragment=document.createDocumentFragment();
 for(const job of visible){const button=document.createElement('button');button.className='job-row'+(selected===job.id?' selected':'');button.type='button';button.setAttribute('aria-pressed',String(selected===job.id));
  const icon=document.createElement('span');icon.className='job-thumb';icon.textContent='◇';
  if(job.files.includes('avatar-front.jpg')){const image=document.createElement('img');image.src=source(job.id,'avatar-front.jpg');image.alt='Received front avatar';image.style.cssText='width:100%;height:100%;object-fit:contain';icon.replaceChildren(image);}
  const summary=document.createElement('span');summary.className='job-summary';const name=document.createElement('strong');name.textContent=job.id;const date=document.createElement('small');date.textContent=when(job.createdAt)+' · 5-second wave';summary.append(name,date);
  const status=document.createElement('span');status.className='pill'+(job.stage==='ready'?' ready':'');status.textContent=label[job.stage]||job.stage;
  button.append(icon,summary,status);button.addEventListener('click',()=>{nav('jobsNav');choose(job.id);});fragment.append(button);
 }
 if(list.length&&!visible.length){const empty=document.createElement('p');empty.className='no-match';empty.textContent='No jobs match this search.';fragment.append(empty);}
 $('jobList').replaceChildren(fragment);
}
function renderPreview(){
 const job=selected==='qa-sample'?data.sample:data.jobs.find(j=>j.id===selected);
 const sample=!!job?.fixture,video=$('videoPreview'),hasVideo=!!job?.verified&&job.files.includes('preview.mp4');
 $('previewTitle').textContent=sample?'Verified pipeline sample':job?.stage==='waiting_model'?'Received avatar · 3D required':'Motion preview';
 $('previewBadge').textContent=sample?'QA SAMPLE':job?label[job.stage].toUpperCase():'NO JOB SELECTED';$('previewBadge').className='pill'+(sample?' qa':job?.stage==='ready'?' ready':'');
 $('sampleNotice').hidden=!sample;$('previewPlaceholder').hidden=hasVideo;video.hidden=!hasVideo;$('previewStage').classList.toggle('playable',hasVideo);
 const key=hasVideo?job.id+':'+job.updatedAt:'';
 if(key!==mediaKey){mediaKey=key;video.pause();if(hasVideo){video.src=source(job.id,'preview.mp4');video.load();}else{video.removeAttribute('src');video.load();}}
 $('placeholderTitle').textContent=job?(label[job.stage]||'Preparing preview'):'Your next motion starts here.';
 $('placeholderDetail').textContent=job?(job.message||'The preview appears after rendering and frame verification.'):'Select a received avatar to follow its progress and review the finished five-second clip.';
 const reference=$('referencePreview');reference.hidden=hasVideo||!job?.files.includes('avatar-front.jpg');if(!reference.hidden)reference.src=source(job.id,'avatar-front.jpg');else reference.removeAttribute('src');
 $('selectedJobLabel').textContent=sample?'SYNTHETIC / MOTION QA':job?job.id:'No avatar selected';$('selectedJobTime').textContent=job?when(job.createdAt):'—';
 const index=job?(step[job.stage]??-1):-1;
 for(const node of $('pipeline').querySelectorAll('[data-step]')){const n=Number(node.dataset.step);node.classList.toggle('done',!!job&&n<index);node.classList.toggle('current',!!job&&n===index);}
 $('stageDetail').textContent=job?label[job.stage]:'Waiting for a production job';
 $('frameCount').textContent=job?.stage==='waiting_model'?'Not started · 3D required':job?(job.frame+' / 120 frames'):'— / 120 frames';$('renderProgress').value=job?.frame||0;
 $('reviewNote').textContent=sample?'Verified: 5 seconds, 120 frames, 24 fps. Synthetic geometry only; this is not a person’s avatar.':job?.message||'A motion preview is prepared for review. Joint placement and clothing deformation need a production check.';
 const links=[];for(const [name,title]of [['preview.mp4','MP4 ↓'],['motion.blend','Blender ↓'],['animated.glb','GLB ↓'],['avatar-front.jpg','Avatar reference ↓']])if(job?.files.includes(name)){const a=document.createElement('a');a.href=source(job.id,name)+'?download=1';a.textContent=title;a.download=name;links.push(a);}
 if(!links.length){const hint=document.createElement('span');hint.className='muted';hint.textContent='MP4 · Blender · Animated GLB';links.push(hint);}$('downloadLinks').replaceChildren(...links);
}
async function refresh(){if(polling)return;polling=true;try{const response=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error();data=await response.json();if(connectionError){message('');connectionError=false;}if(selected&&selected!=='qa-sample'&&!data.jobs.some(j=>j.id===selected))selected=null;if(!selected)selected=data.worker.jobId||data.jobs[0]?.id||null;render();}catch{connectionError=true;message('The local dashboard connection is unavailable. Reopen the dashboard launcher.',true);$('connectionBadge').textContent='Dashboard offline';$('connectionBadge').classList.add('offline');$('receiverButton').disabled=true;}finally{polling=false;}}
async function control(action){if(busy||!data)return;busy=true;render();try{const r=await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':data.csrfToken},body:JSON.stringify({action}),signal:AbortSignal.timeout(8000)});const result=await r.json();if(!r.ok)throw Error(result.error);message(result.message);await refresh();}catch(error){message(error.message||'The local action could not be completed.');}finally{busy=false;render();}}
function sample(){if(!data?.sample){message('No QA sample has been saved on this workstation.');return;}nav('sampleNav');choose('qa-sample');}
 $('receiverButton').addEventListener('click',()=>control(!data.worker.online?'start':data.worker.pausedRequested||data.worker.mode==='paused'?'resume':'pause'));
 $('folderButton').addEventListener('click',()=>control('open-folder'));
 $('sampleNav').addEventListener('click',sample);$('emptySampleButton').addEventListener('click',sample);
 $('overviewNav').addEventListener('click',()=>{nav('overviewNav');selected=data?.worker.jobId||null;$('jobSearch').value='';$('jobFilter').value='all';render();});
 $('jobsNav').addEventListener('click',()=>{nav('jobsNav');$('jobSearch').focus();});
 $('jobSearch').addEventListener('input',render);$('jobFilter').addEventListener('change',render);$('refreshButton').addEventListener('click',()=>{message('');refresh();});
 refresh();setInterval(refresh,2500);
})();
