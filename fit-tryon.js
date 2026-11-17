/* Real image generation only. Results stay in memory and are discarded on profile/photo changes. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id), config = window.THEPIT_CONFIG || {};
  const endpoint = String(config.TRYON_ENDPOINT || "").replace(/\/$/, "");
  const stages = {
    tryon: { button: "generateTryon", cancel: "cancelTryon", download: "downloadTryon", image: "", token: "", widget: null },
    character: { button: "generateCharacter", cancel: "cancelCharacter", download: "downloadCharacter", image: "", token: "", widget: null },
  };
  const state = { version: 0, selection: null, ready: false, sheetReady: false, busy: false, controller: null, face: '', faceVersion: 0, faceLoading: false };
  const sheet = { token: '', widget: null, images: Array(4).fill(''), refs: null, epoch: 0, exporting: false };
  const viewNames = ['Front · 0°', 'Left · 90°', 'Back · 180°', 'Right · 270°'];
  const sceneNames = { studio: "Photo studio", city: "Outdoor portrait", poster: "Studio portrait" };
  let challengeScript;
  function status(kind, text) { $(kind + "Status").textContent = text; }
  function buttons() {
    for (const [kind, stage] of Object.entries(stages)) {
      const eligible = kind === "tryon" || !!stages.tryon.image;
      $(stage.button).disabled = !state.ready || state.busy || state.faceLoading || !eligible || !stage.token || !$(kind + "Consent").checked;
      $(kind + "Consent").disabled = state.busy || !state.ready || !eligible;
    }
    document.querySelectorAll('[name="characterScene"]').forEach(input => { input.disabled = state.busy; });
    $('characterFace').disabled = state.busy; $('removeFace').disabled = state.busy;
    $('sheetConsent').disabled = state.busy || !state.sheetReady || !sheet.images[0];
    $('generateSheet').disabled = !state.sheetReady || state.busy || state.faceLoading || !sheet.images[0] || !$('sheetConsent').checked || !sheet.token || sheet.images.every(Boolean);
    $('downloadSheet').disabled = !sheet.images.every(Boolean) || sheet.exporting;
  }
  function resetChallenge(kind, remove = false) {
    const stage = kind === 'sheet' ? sheet : stages[kind]; stage.token = "";
    if (stage.widget !== null && window.turnstile) window.turnstile[remove ? "remove" : "reset"](stage.widget);
    if (remove) stage.widget = null;
    buttons();
  }
  function discard(kind) {
    if (kind === 'character') resetSheet();
    const stage = stages[kind]; stage.image = ""; stage.intakeTicket = ''; stage.productionId = ''; resetChallenge(kind, true);
    $(kind + "Result").hidden = true; $(kind + "Result").removeAttribute("src");
    $(stage.download).hidden = true; $(stage.download).removeAttribute("href");
    $(kind + "Placeholder").hidden = false; $(stage.cancel).hidden = true;
    $(kind + "ResultFrame").setAttribute("aria-busy", "false"); $(kind + "Consent").checked = false;
  }
  function clear() {
    state.version++; state.controller?.abort(); state.controller = null;
    state.busy = false; state.selection = null; state.ready = false;
    discard("tryon"); discard("character");
    state.sheetReady = false; state.face = ''; state.faceVersion++; state.faceLoading = false;
    $('characterFace').value = ''; $('facePreviewWrap').hidden = true; $('facePreview').removeAttribute('src');
    $('characterOriginal').removeAttribute('src');
    $("tryon").hidden = true; $("character").hidden = true; $("tryonOriginal").removeAttribute("src");
    $("nextCharacter").hidden = true; $("characterResultLabel").textContent = "Not generated yet";
    $("characterProgressTitle").textContent = "Start with a photoreal front view.";
    $("characterProgressCopy").textContent = "Based on your original face and selected outfit.";
    buttons();
  }
  async function challenge(kind) {
    const stage = kind === 'sheet' ? sheet : stages[kind], version = state.version;
    if (!state.ready || !$(kind + "Consent").checked || stage.widget !== null || (kind === "character" && !stages.tryon.image) || (kind === 'sheet' && !sheet.images[0])) return;
    try {
      if (!window.turnstile) {
        if (!challengeScript) challengeScript = new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; script.async = true;
          script.onload = resolve;
          script.onerror = () => { script.remove(); challengeScript = null; reject(Error("The security check could not load. Please refresh the page.")); };
          document.head.append(script);
        });
        await challengeScript;
      }
      if (version !== state.version || !$(kind + "Consent").checked || stage.widget !== null) return;
      stage.widget = window.turnstile.render($(kind + "Challenge"), {
        sitekey: config.TRYON_TURNSTILE_SITE_KEY, action: "fit-studio", theme: "dark", language: "en",
        callback: token => { if (version !== state.version || !$(kind + 'Consent').checked) return; stage.token = token; buttons(); },
        "expired-callback": () => { if (version !== state.version) return; stage.token = ""; buttons(); },
        "error-callback": () => { if (version !== state.version) return; stage.token = ""; status(kind, "The security check failed. Please try again shortly."); buttons(); },
      });
    } catch (error) { if (version === state.version) status(kind, error.message); }
  }
  async function checkService(version) {
    if (!endpoint || !config.TRYON_TURNSTILE_SITE_KEY) {
      for (const kind of Object.keys(stages)) {
        status(kind, "AI generation is being connected. You can generate images here once the service is available.");
        $(stages[kind].button).textContent = "AI connection pending";
      }
      buttons(); return;
    }
    $("generateTryon").textContent = "Generate try-on preview"; $("generateCharacter").textContent = "Generate front-view avatar";
    status("tryon", "Checking the image generation service…");
    try {
      const response = await fetch(endpoint + "/health", { signal: AbortSignal.timeout(10000), cache: "no-store" });
      const result = await response.json(); if (version !== state.version) return;
      state.ready = response.ok && result.ready === true && result.features?.includes("character");
      state.sheetReady = state.ready && result.features?.includes('character-sheet') && result.characterAppearance === 'production-avatar-v2';
      $("studioAvailability").textContent = state.ready ? "Size comparison · AI try-on · Photoreal avatars" : "Size comparison available · AI service pending";
      status("tryon", state.ready ? "Consent to photo processing, then select Generate. Processing may take a little time." : "The AI service is being prepared. Please check again shortly.");
      status("character", state.ready ? "Generate your try-on image in Step 03 first." : "The AI service will be available once the connection is ready.");
      buttons();
    } catch (_) {
      if (version !== state.version) return;
      for (const kind of Object.keys(stages)) status(kind, "Could not connect to the AI service. Your photos were not sent.");
    }
  }
  function open(selection) {
    clear(); state.selection = selection;
    $('characterOriginal').src = selection.photo;
    $("tryonOriginal").src = selection.photo; $("tryonGarment").src = selection.item.image;
    $("tryonBrand").textContent = selection.item.brand; $("tryonName").textContent = selection.item.name;
    const sizes = $("tryonSize"); sizes.replaceChildren();
    for (const row of selection.item.sizing.rows) { const option = document.createElement("option"); option.value = row.label; option.textContent = row.label; sizes.append(option); }
    const suggested = selection.recommendation.usual || selection.recommendation.best;
    if (suggested) sizes.value = suggested.label;
    else { const option = document.createElement("option"); option.value = ""; option.textContent = "Choose a size"; option.selected = true; sizes.prepend(option); }
    $("tryonSizeNote").textContent = suggested ? "Reference size: " + suggested.label + " · Check product measurements for actual fit." : "More information is needed for size guidance. You can choose a size to compare.";
    $("tryonProgressTitle").textContent = "Your chosen outfit, on you"; $("tryonProgressCopy").textContent = "Your try-on preview will appear here after generation.";
    $("tryon").hidden = false; $("character").hidden = false;
    $("tryonTitle").focus({ preventScroll: true }); $("tryon").scrollIntoView({ behavior: "smooth", block: "start" });
    checkService(state.version);
  }
  async function preparePhoto(url) {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", .9);
  }
  async function generate(kind) {
    const stage = stages[kind];
    if ($(stage.button).disabled || state.busy || !state.selection) return;
    const version = state.version, selection = state.selection, token = stage.token;
    const scene = document.querySelector('[name="characterScene"]:checked').value;
    const isCharacter = kind === "character", name = isCharacter ? "Photoreal avatar" : "Try-on image";
    if (isCharacter) resetSheet();
    state.busy = true; buttons();
    const controller = new AbortController(); state.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 150000);
    $(stage.cancel).hidden = false; $(kind + "ResultFrame").setAttribute("aria-busy", "true");
    $(kind + "ProgressTitle").textContent = name + " is being created";
    $(kind + "ProgressCopy").textContent = isCharacter ? "Creating a photographic look guided by your facial proportions, skin, hair and outfit." : "Combining your photo with the selected outfit.";
    status(kind, "Preparing your photo…");
    try {
      const photo = await preparePhoto(isCharacter ? stages.tryon.image : selection.photo);
      const original = isCharacter ? await preparePhoto(selection.photo) : undefined;
      const face = isCharacter && state.face ? state.face : undefined;
      if (version !== state.version) return;
      if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError");
      status(kind, "Generating: " + name + ". The result will appear automatically when ready.");
      const response = await fetch(endpoint + "/" + kind, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ photo, original, face, scene: isCharacter ? scene : undefined, itemId: selection.item.id, consent: true, token, requestId: crypto.randomUUID() }) });
      const result = await response.json(); if (version !== state.version) return;
      if (!response.ok || result.ok !== true || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(result.image || "")) throw Error(result.error || "Image generation failed. Check your photo and try again.");
      if (isCharacter && result.appearance !== 'production-avatar-v2') throw Error('Could not confirm the avatar service version. Please try again shortly.');
      const image = new Image(); image.src = result.image; await image.decode(); if (version !== state.version) return;
      if (!isCharacter) {
        discard("character"); $("characterResultLabel").textContent = "Not generated yet";
        $("characterProgressTitle").textContent = "Start with a photoreal front view.";
        $("characterProgressCopy").textContent = "Based on your new try-on image and original face.";
        $("nextCharacter").hidden = false;
        status("character", "Your try-on image is ready. Choose a background and consent to photo processing to create your avatar.");
      }
      stage.image = result.image; stage.intakeTicket=result.intakeTicket||''; stage.productionId=result.productionId||''; $(kind + "Result").src = result.image;
      $(kind + "Result").hidden = false; $(kind + "Placeholder").hidden = true;
      const ext = result.image.match(/^data:image\/(jpeg|png|webp)/)[1].replace("jpeg", "jpg");
      $(stage.download).href = result.image; $(stage.download).download = "THE-PIT-" + kind + "-" + selection.item.id + "." + ext; $(stage.download).hidden = false;
      if (isCharacter) {
        $("characterResultLabel").textContent = sceneNames[scene] + " · Photoreal front reference";
        sheet.images[0] = result.image; sheet.refs = { photo, original, face, appearance: result.appearance, itemId: selection.item.id };
        $('sheetWorkspace').hidden = false; renderSheet();
        status('sheet', state.sheetReady ? 'Check the face and outfit, then consent to generate the other three views.' : 'The four-view service needs an update. You can still save the front reference.');
      }
      status(kind, name + " is ready. Check the face, hands and outfit details before saving.");
      if (isCharacter) window.dispatchEvent(new CustomEvent('avatar:application', { detail: applicationResult('front') }));
    } catch (error) {
      if (version !== state.version) return;
      $(kind + "ProgressTitle").textContent = "Generation could not be completed";
      $(kind + "ProgressCopy").textContent = "Your photo and selected outfit have been kept. You can try again.";
      status(kind, controller.signal.aborted ? "Waiting has stopped. Server processing may continue. Please wait before sending another request." : error.message);
    } finally {
      clearTimeout(timeout);
      if (version === state.version) {
        state.busy = false; state.controller = null; $(stage.cancel).hidden = true;
        $(kind + "ResultFrame").setAttribute("aria-busy", "false"); resetChallenge(kind); buttons();
      }
    }
  }
  function resetSheet() {
    window.dispatchEvent(new CustomEvent('avatar:application', {detail:null}));
    window.dispatchEvent(new CustomEvent('avatar:references', {detail:null}));
    sheet.epoch++; sheet.images = Array(4).fill(''); sheet.refs = null; sheet.exporting = false;
    resetChallenge('sheet', true); $('sheetConsent').checked = false;
    $('sheetWorkspace').hidden = true; $('sheetGrid').replaceChildren();
    $('generateSheet').textContent = 'Create four full-body references'; $('cancelSheet').hidden = true;
    if ($('sheetDialog').open) $('sheetDialog').close();
    $('sheetDialogImage').removeAttribute('src'); $('downloadView').removeAttribute('href');
  }
  function renderSheet(active = -1, failed = -1) {
    const count = sheet.images.filter(Boolean).length;
    $('sheetCount').textContent = count + ' / 4'; $('sheetProgress').value = count;
    $('sheetGrid').replaceChildren(...viewNames.map((label, i) => {
      const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'sheet-cell';
      cell.disabled = !sheet.images[i]; cell.dataset.state = i === active ? 'busy' : i === failed ? 'error' : sheet.images[i] ? 'done' : 'waiting';
      cell.setAttribute('aria-label', (i + 1) + '. ' + label + (sheet.images[i] ? ' · Enlarge and save' : ' · Awaiting generation'));
      if (sheet.images[i]) { const img = document.createElement('img'); img.src = sheet.images[i]; img.alt = label + ' · Photoreal AI avatar'; cell.append(img); }
      else { const empty = document.createElement('span'); empty.className = 'sheet-empty'; empty.textContent = i === active ? 'Generating…' : i === failed ? 'Paused · Resume' : 'Waiting'; cell.append(empty); }
      const caption = document.createElement('small'); caption.textContent = String(i + 1).padStart(2, '0') + ' · ' + label; cell.append(caption);
      cell.addEventListener('click', () => {
        $('sheetDialogTitle').textContent = caption.textContent; $('sheetDialogImage').src = sheet.images[i]; $('sheetDialogImage').alt = label;
        const ext = sheet.images[i].match(/^data:image\/(jpeg|png|webp)/)[1].replace('jpeg', 'jpg');
        $('downloadView').href = sheet.images[i]; $('downloadView').download = 'THE-PIT-view-' + String(i + 1).padStart(2, '0') + '.' + ext;
        $('downloadView').textContent = 'Save this view ↓'; $('sheetDialog').showModal();
      }); return cell;
    }));
    buttons();
  }
  async function waitSheetToken(signal, version) {
    const until = Date.now() + 30000;
    while (!sheet.token) {
      if (signal.aborted || version !== state.version) throw new DOMException('Stopped', 'AbortError');
      if (Date.now() > until) throw Error('Complete the security check, then resume generation. Completed images will be kept.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const token = sheet.token; sheet.token = ''; return token;
  }
  async function generateSheet() {
    if ($('generateSheet').disabled) return;
    const version = state.version, epoch = sheet.epoch, refs = sheet.refs;
    const controller = new AbortController(); state.controller = controller; state.busy = true; buttons(); $('cancelSheet').hidden = false;
    let active = -1, failed = -1;
    try {
      const anchor = await preparePhoto(sheet.images[0]);
      for (let i = 1; i < 4; i++) {
        if (version !== state.version || epoch !== sheet.epoch) return;
        if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        if (sheet.images[i]) continue;
        active = i; renderSheet(i); status('sheet', (i + 1) + '/4 · ' + viewNames[i] + ' · Preparing. Complete the security check if it appears.');
        const token = await waitSheetToken(controller.signal, version);
        if (version !== state.version || epoch !== sheet.epoch || controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        status('sheet', (i + 1) + '/4 · ' + viewNames[i] + ' · Generating. Keep this page open.');
        const timeout = setTimeout(() => controller.abort(), 150000);
        try {
          const response = await fetch(endpoint + '/character-view', {method:'POST', headers:{'Content-Type':'application/json'}, signal:controller.signal,
            body:JSON.stringify({...refs, anchor, view:i, approved:true, consent:true, token, requestId:crypto.randomUUID()})});
          const result = await response.json();
          if (version !== state.version || epoch !== sheet.epoch) return;
          if (!response.ok || result.ok !== true || result.appearance !== 'production-avatar-v2' || result.view !== i || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(result.image || '')) throw Error(result.error || 'Could not confirm the reference image.');
          const img = new Image(); img.src = result.image; await img.decode();
          if (version !== state.version || epoch !== sheet.epoch) return;
          sheet.images[i] = result.image; renderSheet();
        } finally { clearTimeout(timeout); }
        resetChallenge('sheet');
      }
      window.dispatchEvent(new CustomEvent('avatar:references', {detail:avatarReferences()}));
      status('sheet', 'All four views are ready. Check the body, hands, feet and outfit before generating a 3D model below. Save the references individually or as a 2×2 sheet.');
      window.dispatchEvent(new CustomEvent('avatar:application', { detail: applicationResult('references') }));
    } catch (error) {
      if (version !== state.version || epoch !== sheet.epoch) return;
      failed = active;
      status('sheet', (controller.signal.aborted ? 'Generation has been stopped. The last request may still be processing; please wait before resuming.' : error.message) + ' Completed views kept: ' + sheet.images.filter(Boolean).length + '.');
    } finally {
      if (version === state.version && epoch === sheet.epoch) {
        state.busy = false; state.controller = null; $('cancelSheet').hidden = true;
        $('generateSheet').textContent = sheet.images.every(Boolean) ? 'Four views complete' : 'Generate remaining views';
        resetChallenge('sheet'); renderSheet(-1, failed); buttons();
      }
    }
  }
  async function downloadSheet() {
    if ($('downloadSheet').disabled) return;
    const epoch = sheet.epoch, sources = [...sheet.images]; sheet.exporting = true; buttons();
    try {
      const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 2176;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f6f3ee'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < 4; i++) {
        const img = new Image(); img.src = sources[i]; await img.decode();
        if (epoch !== sheet.epoch) return;
        const x = (i % 2) * 768, y = Math.floor(i / 2) * 1088, scale = Math.min(768 / img.naturalWidth, 1024 / img.naturalHeight);
        const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
        ctx.drawImage(img, x + (768-w)/2, y + (1024-h)/2, w, h);
        ctx.fillStyle = '#202028'; ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(i+1).padStart(2,'0') + ' · ' + viewNames[i], x+384, y+1064);
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (epoch !== sheet.epoch) return;
      if (!blob) throw Error('Could not save the sheet. Please try again.');
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'THE-PIT-avatar-reference-4.png';
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (epoch === sheet.epoch) status('sheet', error.message); }
    finally { if (epoch === sheet.epoch) { sheet.exporting = false; buttons(); } }
  }
  function faceChanged() {
    discard('character'); $('characterResultLabel').textContent = 'Face reference changed · Regeneration needed';
    status('character', 'Your face reference has changed. Consent to processing and regenerate your front-view avatar.'); buttons();
  }
  $('characterFace').addEventListener('change', async () => {
    const file = $('characterFace').files[0], version = state.version, upload = ++state.faceVersion;
    state.faceLoading = false; buttons();
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10*1024*1024) { $('faceStatus').textContent = 'Choose a JPG, PNG or WEBP photo up to 10 MB.'; return; }
    const url = URL.createObjectURL(file); state.faceLoading = true; buttons();
    try {
      const data = await preparePhoto(url);
      if (version !== state.version || upload !== state.faceVersion) return;
      state.face = data; $('facePreview').src = data; $('facePreviewWrap').hidden = false;
      $('faceStatus').textContent = 'Face reference ready. It will be sent when you start generation.'; faceChanged();
    } catch (_) { if (version === state.version && upload === state.faceVersion) $('faceStatus').textContent = 'This photo could not be read. Please choose another photo.'; }
    finally { URL.revokeObjectURL(url); if (version === state.version && upload === state.faceVersion) { state.faceLoading = false; buttons(); } }
  });
  $('chooseFace').addEventListener('click', () => $('characterFace').click());
  $('removeFace').addEventListener('click', () => { state.faceVersion++; state.faceLoading = false; state.face = ''; $('characterFace').value = ''; $('facePreviewWrap').hidden = true; $('facePreview').removeAttribute('src'); $('faceStatus').textContent = 'Face reference removed. Generation will use your original photo.'; faceChanged(); });
  $('sheetConsent').addEventListener('change', () => { if (!$('sheetConsent').checked) resetChallenge('sheet', true); buttons(); challenge('sheet'); });
  $('generateSheet').addEventListener('click', generateSheet);
  $('cancelSheet').addEventListener('click', () => state.controller?.abort());
  $('downloadSheet').addEventListener('click', downloadSheet);
  $('closeSheetDialog').addEventListener('click', () => $('sheetDialog').close());
  for (const [kind, stage] of Object.entries(stages)) {
    $(kind + "Consent").addEventListener("change", () => { if (!$(kind + "Consent").checked) resetChallenge(kind, true); buttons(); challenge(kind); });
    $(stage.button).addEventListener("click", () => generate(kind));
    $(stage.cancel).addEventListener("click", () => state.controller?.abort());
  }
  $("tryonBack").addEventListener("click", () => { $("picks").scrollIntoView({ behavior: "smooth" }); $("picksTitle").focus({ preventScroll: true }); });
  $("nextCharacter").addEventListener("click", () => $("characterTitle").focus({ preventScroll: true }));
  if (endpoint && config.TRYON_TURNSTILE_SITE_KEY) $("studioAvailability").textContent = "Size comparison · AI availability is checked after you choose an outfit";
  function avatarReferences() { return sheet.images.every(Boolean) && sheet.refs ? {images:[...sheet.images],appearance:sheet.refs.appearance,itemId:sheet.refs.itemId,height:state.selection?.user?.height || 180} : null; }
  function applicationResult(stage) {
    if (!sheet.images[0] || !sheet.refs || !state.selection) return null;
    const item = state.selection.item;
    return { stage, images: [...sheet.images], intakeTicket:stages.character.intakeTicket||'', productionId:stages.character.productionId||'', original: sheet.refs.original, face: sheet.refs.face || '',
      outfit: item.brand + ' · ' + item.name + ' · ' + $('tryonSize').value,
      height: state.selection.user?.height || '', size: $('tryonSize').value };
  }
  window.FIT_TRYON = { open, clear, avatarReferences, applicationResult };
})();
