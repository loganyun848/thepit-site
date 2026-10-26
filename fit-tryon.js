/* Real image generation only. Results stay in memory and are discarded on profile/photo changes. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id), config = window.THEPIT_CONFIG || {};
  const endpoint = String(config.TRYON_ENDPOINT || "").replace(/\/$/, "");
  const stages = {
    tryon: { button: "generateTryon", cancel: "cancelTryon", download: "downloadTryon", image: "", token: "", widget: null },
    character: { button: "generateCharacter", cancel: "cancelCharacter", download: "downloadCharacter", image: "", token: "", widget: null },
  };
  const state = { version: 0, selection: null, ready: false, busy: false, controller: null };
  const sceneNames = { studio: "캐릭터 스튜디오", city: "색을 찾은 도시", poster: "나의 주인공 포스터" };
  let challengeScript;
  function status(kind, text) { $(kind + "Status").textContent = text; }
  function buttons() {
    for (const [kind, stage] of Object.entries(stages)) {
      const eligible = kind === "tryon" || !!stages.tryon.image;
      $(stage.button).disabled = !state.ready || state.busy || !eligible || !stage.token || !$(kind + "Consent").checked;
      $(kind + "Consent").disabled = state.busy || !state.ready || !eligible;
    }
    document.querySelectorAll('[name="characterScene"]').forEach(input => { input.disabled = state.busy; });
  }
  function resetChallenge(kind, remove = false) {
    const stage = stages[kind]; stage.token = "";
    if (stage.widget !== null && window.turnstile) window.turnstile[remove ? "remove" : "reset"](stage.widget);
    if (remove) stage.widget = null;
    buttons();
  }
  function discard(kind) {
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
    $("tryon").hidden = true; $("character").hidden = true; $("tryonOriginal").removeAttribute("src");
    $("nextCharacter").hidden = true; $("characterResultLabel").textContent = "생성 전";
    $("characterProgressTitle").textContent = "다음 장면의 주인공은, 나.";
    $("characterProgressCopy").textContent = "03단계에서 만든 착용 이미지를 바탕으로 캐릭터를 생성합니다.";
    buttons();
  }
  async function challenge(kind) {
    const stage = stages[kind], version = state.version;
    if (!state.ready || !$(kind + "Consent").checked || stage.widget !== null || (kind === "character" && !stages.tryon.image)) return;
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
        callback: token => { stage.token = token; buttons(); },
        "expired-callback": () => { stage.token = ""; buttons(); },
        "error-callback": () => { stage.token = ""; status(kind, "보안 확인에 실패했습니다. 잠시 후 다시 시도해 주세요."); buttons(); },
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
    $("generateTryon").textContent = "내 사진에 착용 이미지 생성"; $("generateCharacter").textContent = "THE PIT 캐릭터 생성";
    status("tryon", "이미지 생성 서비스 연결을 확인하고 있습니다…");
    try {
      const response = await fetch(endpoint + "/health", { signal: AbortSignal.timeout(10000), cache: "no-store" });
      const result = await response.json(); if (version !== state.version) return;
      state.ready = response.ok && result.ready === true && result.features?.includes("character");
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
    state.busy = true; buttons();
    const controller = new AbortController(); state.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 150000);
    $(stage.cancel).hidden = false; $(kind + "ResultFrame").setAttribute("aria-busy", "true");
    $(kind + "ProgressTitle").textContent = name + "를 만들고 있어요";
    $(kind + "ProgressCopy").textContent = isCharacter ? "나의 얼굴과 의상을 THE PIT의 애니메이션 룩으로 바꾸고 있습니다." : "내 사진과 선택한 의상의 디자인을 합성하고 있습니다.";
    status(kind, "사진 준비 중…");
    try {
      const photo = await preparePhoto(isCharacter ? stages.tryon.image : selection.photo);
      const original = isCharacter ? await preparePhoto(selection.photo) : undefined;
      if (version !== state.version) return;
      if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError");
      status(kind, "AI가 " + name + "를 만들고 있습니다. 완료되면 결과가 자동으로 표시됩니다.");
      const response = await fetch(endpoint + "/" + kind, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ photo, original, scene: isCharacter ? scene : undefined, itemId: selection.item.id, consent: true, token, requestId: crypto.randomUUID() }) });
      const result = await response.json(); if (version !== state.version) return;
      if (!response.ok || result.ok !== true || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(result.image || "")) throw Error(result.error || "이미지를 만들지 못했습니다. 사진을 확인한 후 다시 시도해 주세요.");
      const image = new Image(); image.src = result.image; await image.decode(); if (version !== state.version) return;
      if (!isCharacter) {
        discard("character"); $("characterResultLabel").textContent = "생성 전";
        $("characterProgressTitle").textContent = "다음 장면의 주인공은, 나.";
        $("characterProgressCopy").textContent = "지금 만든 착용 이미지로 나만의 캐릭터를 만들어 보세요.";
        $("nextCharacter").hidden = false;
        status("character", "착용 이미지가 준비됐습니다. 장면을 고르고 사진 전송에 동의한 뒤 캐릭터를 생성하세요.");
      }
      stage.image = result.image; $(kind + "Result").src = result.image;
      $(kind + "Result").hidden = false; $(kind + "Placeholder").hidden = true;
      const ext = result.image.match(/^data:image\/(jpeg|png|webp)/)[1].replace("jpeg", "jpg");
      $(stage.download).href = result.image; $(stage.download).download = "THE-PIT-" + kind + "-" + selection.item.id + "." + ext; $(stage.download).hidden = false;
      if (isCharacter) $("characterResultLabel").textContent = sceneNames[scene] + " · AI 생성";
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
