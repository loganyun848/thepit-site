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
  const sheet = { token: '', widget: null, images: Array(16).fill(''), refs: null, epoch: 0, exporting: false };
  const viewNames = ['정면', '좌측 앞 22.5°', '좌측 앞 45°', '좌측 앞 67.5°', '좌측면', '좌측 뒤 112.5°', '좌측 뒤 135°', '좌측 뒤 157.5°', '뒷모습', '우측 뒤 202.5°', '우측 뒤 225°', '우측 뒤 247.5°', '우측면', '우측 앞 292.5°', '우측 앞 315°', '우측 앞 337.5°'];
  const sceneNames = { studio: "캐릭터 스튜디오", city: "색을 찾은 도시", poster: "나의 주인공 포스터" };
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
    const stage = stages[kind]; stage.image = ""; resetChallenge(kind, true);
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
    $("nextCharacter").hidden = true; $("characterResultLabel").textContent = "생성 전";
    $("characterProgressTitle").textContent = "먼저, 나를 닮은 정면 캐릭터.";
    $("characterProgressCopy").textContent = "원본 얼굴과 선택한 옷을 기준으로 만듭니다.";
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
          script.onerror = () => { script.remove(); challengeScript = null; reject(Error("보안 확인을 불러오지 못했습니다. 페이지를 새로고침해 주세요.")); };
          document.head.append(script);
        });
        await challengeScript;
      }
      if (version !== state.version || !$(kind + "Consent").checked || stage.widget !== null) return;
      stage.widget = window.turnstile.render($(kind + "Challenge"), {
        sitekey: config.TRYON_TURNSTILE_SITE_KEY, action: "fit-studio", theme: "dark",
        callback: token => { if (version !== state.version || !$(kind + 'Consent').checked) return; stage.token = token; buttons(); },
        "expired-callback": () => { if (version !== state.version) return; stage.token = ""; buttons(); },
        "error-callback": () => { if (version !== state.version) return; stage.token = ""; status(kind, "보안 확인에 실패했습니다. 잠시 후 다시 시도해 주세요."); buttons(); },
      });
    } catch (error) { if (version === state.version) status(kind, error.message); }
  }
  async function checkService(version) {
    if (!endpoint || !config.TRYON_TURNSTILE_SITE_KEY) {
      for (const kind of Object.keys(stages)) {
        status(kind, "AI 연결 준비 중입니다. 서비스 연결 후 이 화면에서 실제 이미지를 생성할 수 있습니다.");
        $(stages[kind].button).textContent = "AI 연결 준비 중";
      }
      buttons(); return;
    }
    $("generateTryon").textContent = "내 사진에 착용 이미지 생성"; $("generateCharacter").textContent = "정면 기준 캐릭터 생성";
    status("tryon", "이미지 생성 서비스 연결을 확인하고 있습니다…");
    try {
      const response = await fetch(endpoint + "/health", { signal: AbortSignal.timeout(10000), cache: "no-store" });
      const result = await response.json(); if (version !== state.version) return;
      state.ready = response.ok && result.ready === true && result.features?.includes("character");
      state.sheetReady = state.ready && result.features?.includes('character-sheet');
      $("studioAvailability").textContent = state.ready ? "사이즈 비교 · AI 착용 미리보기 · 캐릭터 스튜디오" : "사이즈 비교 이용 가능 · AI 서비스 준비 중";
      status("tryon", state.ready ? "사진 전송에 동의한 뒤 생성 버튼을 눌러 주세요. 생성에는 잠시 시간이 걸릴 수 있습니다." : "AI 서비스를 준비하고 있습니다. 잠시 후 다시 확인해 주세요.");
      status("character", state.ready ? "먼저 03단계에서 착용 이미지를 만들어 주세요." : "AI 서비스를 준비하고 있습니다. 연결이 완료되면 사용할 수 있습니다.");
      buttons();
    } catch (_) {
      if (version !== state.version) return;
      for (const kind of Object.keys(stages)) status(kind, "AI 서버에 연결하지 못했습니다. 사진은 전송되지 않았습니다.");
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
    else { const option = document.createElement("option"); option.value = ""; option.textContent = "사이즈 선택"; option.selected = true; sizes.prepend(option); }
    $("tryonSizeNote").textContent = suggested ? "확인 기준: " + suggested.label + " · 실제 핏은 상품 치수로 확인해 주세요." : "추천할 근거가 부족합니다. 비교할 사이즈를 직접 선택할 수 있어요.";
    $("tryonProgressTitle").textContent = "내가 고른 옷을 입은 모습"; $("tryonProgressCopy").textContent = "생성 버튼을 누르면 여기에 착용 이미지가 표시됩니다.";
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
    const isCharacter = kind === "character", name = isCharacter ? "캐릭터" : "착용 이미지";
    if (isCharacter) resetSheet();
    state.busy = true; buttons();
    const controller = new AbortController(); state.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 150000);
    $(stage.cancel).hidden = false; $(kind + "ResultFrame").setAttribute("aria-busy", "true");
    $(kind + "ProgressTitle").textContent = name + "를 만들고 있어요";
    $(kind + "ProgressCopy").textContent = isCharacter ? "얼굴형·안경·가르마를 원본 기준으로 유지하며 입체감을 더하고 있습니다." : "내 사진과 선택한 의상의 디자인을 합성하고 있습니다.";
    status(kind, "사진 준비 중…");
    try {
      const photo = await preparePhoto(isCharacter ? stages.tryon.image : selection.photo);
      const original = isCharacter ? await preparePhoto(selection.photo) : undefined;
      const face = isCharacter && state.face ? state.face : undefined;
      if (version !== state.version) return;
      if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError");
      status(kind, "AI가 " + name + "를 만들고 있습니다. 완료되면 결과가 자동으로 표시됩니다.");
      const response = await fetch(endpoint + "/" + kind, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ photo, original, face, scene: isCharacter ? scene : undefined, itemId: selection.item.id, consent: true, token, requestId: crypto.randomUUID() }) });
      const result = await response.json(); if (version !== state.version) return;
      if (!response.ok || result.ok !== true || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(result.image || "")) throw Error(result.error || "이미지를 만들지 못했습니다. 사진을 확인한 후 다시 시도해 주세요.");
      const image = new Image(); image.src = result.image; await image.decode(); if (version !== state.version) return;
      if (!isCharacter) {
        discard("character"); $("characterResultLabel").textContent = "생성 전";
        $("characterProgressTitle").textContent = "먼저, 나를 닮은 정면 캐릭터.";
        $("characterProgressCopy").textContent = "지금 만든 착용 이미지와 원본 얼굴을 함께 참고합니다.";
        $("nextCharacter").hidden = false;
        status("character", "착용 이미지가 준비됐습니다. 장면을 고르고 사진 전송에 동의한 뒤 캐릭터를 생성하세요.");
      }
      stage.image = result.image; $(kind + "Result").src = result.image;
      $(kind + "Result").hidden = false; $(kind + "Placeholder").hidden = true;
      const ext = result.image.match(/^data:image\/(jpeg|png|webp)/)[1].replace("jpeg", "jpg");
      $(stage.download).href = result.image; $(stage.download).download = "THE-PIT-" + kind + "-" + selection.item.id + "." + ext; $(stage.download).hidden = false;
      if (isCharacter) {
        $("characterResultLabel").textContent = sceneNames[scene] + " · 정면 기준";
        sheet.images[0] = result.image; sheet.refs = { photo, original, face, itemId: selection.item.id };
        $('sheetWorkspace').hidden = false; renderSheet();
        status('sheet', state.sheetReady ? '얼굴과 의상을 확인한 뒤 동의하면 나머지 15방향을 만들 수 있습니다.' : '16방향 생성 서버 업데이트가 필요합니다. 기준 캐릭터는 저장할 수 있습니다.');
      }
      status(kind, name + "가 생성되었습니다. 얼굴·손·의상 디테일을 확인한 뒤 저장해 주세요.");
    } catch (error) {
      if (version !== state.version) return;
      $(kind + "ProgressTitle").textContent = "생성을 완료하지 못했어요";
      $(kind + "ProgressCopy").textContent = "사진과 선택한 옷은 유지됩니다. 다시 시도할 수 있습니다.";
      status(kind, controller.signal.aborted ? "화면에서 대기를 중단했습니다. 서버 처리는 계속될 수 있으니 바로 재전송하지 말고 잠시 후 다시 시도해 주세요." : error.message);
    } finally {
      clearTimeout(timeout);
      if (version === state.version) {
        state.busy = false; state.controller = null; $(stage.cancel).hidden = true;
        $(kind + "ResultFrame").setAttribute("aria-busy", "false"); resetChallenge(kind); buttons();
      }
    }
  }
  function resetSheet() {
    sheet.epoch++; sheet.images = Array(16).fill(''); sheet.refs = null; sheet.exporting = false;
    resetChallenge('sheet', true); $('sheetConsent').checked = false;
    $('sheetWorkspace').hidden = true; $('sheetGrid').replaceChildren();
    $('generateSheet').textContent = '16방향 시트 만들기'; $('cancelSheet').hidden = true;
    if ($('sheetDialog').open) $('sheetDialog').close();
    $('sheetDialogImage').removeAttribute('src'); $('downloadView').removeAttribute('href');
  }
  function renderSheet(active = -1, failed = -1) {
    const count = sheet.images.filter(Boolean).length;
    $('sheetCount').textContent = count + ' / 16'; $('sheetProgress').value = count;
    $('sheetGrid').replaceChildren(...viewNames.map((label, i) => {
      const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'sheet-cell';
      cell.disabled = !sheet.images[i]; cell.dataset.state = i === active ? 'busy' : i === failed ? 'error' : sheet.images[i] ? 'done' : 'waiting';
      cell.setAttribute('aria-label', (i + 1) + '. ' + label + (sheet.images[i] ? ' 확대 및 저장' : ' 생성 대기'));
      if (sheet.images[i]) { const img = document.createElement('img'); img.src = sheet.images[i]; img.alt = label + ' AI 캐릭터'; cell.append(img); }
      else { const empty = document.createElement('span'); empty.className = 'sheet-empty'; empty.textContent = i === active ? '생성 중…' : i === failed ? '중단됨 · 이어 만들기' : '대기'; cell.append(empty); }
      const caption = document.createElement('small'); caption.textContent = String(i + 1).padStart(2, '0') + ' · ' + label; cell.append(caption);
      cell.addEventListener('click', () => {
        $('sheetDialogTitle').textContent = caption.textContent; $('sheetDialogImage').src = sheet.images[i]; $('sheetDialogImage').alt = label;
        const ext = sheet.images[i].match(/^data:image\/(jpeg|png|webp)/)[1].replace('jpeg', 'jpg');
        $('downloadView').href = sheet.images[i]; $('downloadView').download = 'THE-PIT-view-' + String(i + 1).padStart(2, '0') + '.' + ext;
        $('downloadView').textContent = '이 방향 이미지 저장 ↓'; $('sheetDialog').showModal();
      }); return cell;
    }));
    buttons();
  }
  async function waitSheetToken(signal, version) {
    const until = Date.now() + 30000;
    while (!sheet.token) {
      if (signal.aborted || version !== state.version) throw new DOMException('Stopped', 'AbortError');
      if (Date.now() > until) throw Error('보안 확인을 완료한 뒤 이어 만들기를 눌러 주세요. 완료한 이미지는 유지됩니다.');
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
      for (let i = 1; i < 16; i++) {
        if (version !== state.version || epoch !== sheet.epoch) return;
        if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        if (sheet.images[i]) continue;
        active = i; renderSheet(i); status('sheet', (i + 1) + '/16 · ' + viewNames[i] + ' 준비 중. 보안 확인이 나타나면 완료해 주세요.');
        const token = await waitSheetToken(controller.signal, version);
        if (version !== state.version || epoch !== sheet.epoch || controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        status('sheet', (i + 1) + '/16 · ' + viewNames[i] + ' 생성 중. 이 페이지를 열어 두세요.');
        const timeout = setTimeout(() => controller.abort(), 150000);
        try {
          const response = await fetch(endpoint + '/character-view', {method:'POST', headers:{'Content-Type':'application/json'}, signal:controller.signal,
            body:JSON.stringify({...refs, anchor, view:i, approved:true, consent:true, token, requestId:crypto.randomUUID()})});
          const result = await response.json();
          if (version !== state.version || epoch !== sheet.epoch) return;
          if (!response.ok || result.ok !== true || result.view !== i || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(result.image || '')) throw Error(result.error || '방향 이미지를 확인하지 못했습니다.');
          const img = new Image(); img.src = result.image; await img.decode();
          if (version !== state.version || epoch !== sheet.epoch) return;
          sheet.images[i] = result.image; renderSheet();
        } finally { clearTimeout(timeout); }
        resetChallenge('sheet');
      }
      status('sheet', '16방향 생성 완료. 방향별 얼굴·의상을 확인하고 4×4 시트 또는 개별 이미지로 저장해 주세요.');
    } catch (error) {
      if (version !== state.version || epoch !== sheet.epoch) return;
      failed = active;
      status('sheet', (controller.signal.aborted ? '생성을 중단했습니다. 마지막 서버 요청은 계속 처리될 수 있으니 잠시 후 이어 만들어 주세요.' : error.message) + ' 완료된 ' + sheet.images.filter(Boolean).length + '장은 유지됩니다.');
    } finally {
      if (version === state.version && epoch === sheet.epoch) {
        state.busy = false; state.controller = null; $('cancelSheet').hidden = true;
        $('generateSheet').textContent = sheet.images.every(Boolean) ? '16방향 생성 완료' : '남은 방향 이어 만들기';
        resetChallenge('sheet'); renderSheet(-1, failed); buttons();
      }
    }
  }
  async function downloadSheet() {
    if ($('downloadSheet').disabled) return;
    const epoch = sheet.epoch, sources = [...sheet.images]; sheet.exporting = true; buttons();
    try {
      const canvas = document.createElement('canvas'); canvas.width = 3072; canvas.height = 4352;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f6f3ee'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < 16; i++) {
        const img = new Image(); img.src = sources[i]; await img.decode();
        if (epoch !== sheet.epoch) return;
        const x = (i % 4) * 768, y = Math.floor(i / 4) * 1088, scale = Math.min(768 / img.naturalWidth, 1024 / img.naturalHeight);
        const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
        ctx.drawImage(img, x + (768-w)/2, y + (1024-h)/2, w, h);
        ctx.fillStyle = '#202028'; ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(i+1).padStart(2,'0') + ' · ' + viewNames[i], x+384, y+1064);
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (epoch !== sheet.epoch) return;
      if (!blob) throw Error('시트 저장에 실패했습니다. 다시 눌러 주세요.');
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'THE-PIT-character-sheet-16.png';
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (epoch === sheet.epoch) status('sheet', error.message); }
    finally { if (epoch === sheet.epoch) { sheet.exporting = false; buttons(); } }
  }
  function faceChanged() {
    discard('character'); $('characterResultLabel').textContent = '얼굴 참고 변경 · 다시 생성 필요';
    status('character', '얼굴 참고 사진이 바뀌었습니다. 전송에 동의한 뒤 기준 캐릭터를 다시 생성해 주세요.'); buttons();
  }
  $('characterFace').addEventListener('change', async () => {
    const file = $('characterFace').files[0], version = state.version, upload = ++state.faceVersion;
    state.faceLoading = false; buttons();
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10*1024*1024) { $('faceStatus').textContent = '10 MB 이하 JPG·PNG·WEBP 사진을 선택해 주세요.'; return; }
    const url = URL.createObjectURL(file); state.faceLoading = true; buttons();
    try {
      const data = await preparePhoto(url);
      if (version !== state.version || upload !== state.faceVersion) return;
      state.face = data; $('facePreview').src = data; $('facePreviewWrap').hidden = false;
      $('faceStatus').textContent = '얼굴 참고 사진 준비 완료. 생성 버튼을 누를 때 함께 전송합니다.'; faceChanged();
    } catch (_) { if (version === state.version && upload === state.faceVersion) $('faceStatus').textContent = '사진을 읽을 수 없습니다. 다른 사진을 선택해 주세요.'; }
    finally { URL.revokeObjectURL(url); if (version === state.version && upload === state.faceVersion) { state.faceLoading = false; buttons(); } }
  });
  $('removeFace').addEventListener('click', () => { state.faceVersion++; state.faceLoading = false; state.face = ''; $('characterFace').value = ''; $('facePreviewWrap').hidden = true; $('facePreview').removeAttribute('src'); $('faceStatus').textContent = '얼굴 참고 사진 제거 완료. 원본 사진을 기준으로 생성합니다.'; faceChanged(); });
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
  if (endpoint && config.TRYON_TURNSTILE_SITE_KEY) $("studioAvailability").textContent = "사이즈 비교 · AI 연결 상태는 옷 선택 후 확인합니다";
  window.FIT_TRYON = { open, clear };
})();
