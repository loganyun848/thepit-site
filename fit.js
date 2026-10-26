/* Fit Room: local photo/profile → 20 products per brand → automatic size. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const CFG = window.THEPIT_CONFIG || {}, ENGINE = window.FIT_SIZING, CATALOG = window.FIT_CATALOG;
  const state = { photo: null, photoLoading: false, uploadVersion: 0, user: null, items: [], brand: "all", category: "all", selected: null };
  const genderName = g => g === "women" ? "여성복" : "남성복";
  const cats = { top: "상의", outer: "아우터", bottom: "하의" };
  const money = n => `${n.toLocaleString("ko-KR")}원`;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const note = m => { $("#formNote").textContent = m; };
  const dialog = $("#sizeDialog"), form = $("#measureForm"), upload = $("#photoUpload"), input = $("#photoInput");
  $("#navToggle").addEventListener("click", () => { const open = $("#navLinks").classList.toggle("open"); $("#navToggle").setAttribute("aria-expanded", String(open)); });
  $("#footYoutube").href = CFG.YOUTUBE_CHANNEL_URL || "index.html";
  $("#footMail").href = "contact.html";
  $("#footMail").textContent = "문의하기";
  $("#catalogDate").textContent = CATALOG?.updatedAt || "";
  function invalidate() {
    if (state.user) note("정보가 바뀌었습니다. 아래 버튼을 눌러 사이즈를 다시 확인해 주세요.");
    state.user = null; state.selected = null; state.items = [];
    window.FIT_TRYON?.clear();
    $("#picks").hidden = true; $("#picksGrid").replaceChildren();
    if (dialog.open) dialog.close();
  }
  form.addEventListener("input", invalidate);
  function loadPhoto(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { note("JPG, PNG 또는 WEBP 사진을 선택해 주세요."); input.value = ""; return; }
    if (!file.size || file.size > (CFG.MAX_PHOTO_MB || 10) * 1024 * 1024) { note("사진은 0 MB 초과, 10 MB 이하로 선택해 주세요."); input.value = ""; return; }
    const version = ++state.uploadVersion, url = URL.createObjectURL(file), im = new Image();
    state.photoLoading = true; $("#goBtn").disabled = true; $("#photoStatus").textContent = "사진을 확인하고 있습니다…";
    function finish() { state.photoLoading = false; $("#goBtn").disabled = false; }
    im.onload = () => {
      if (version !== state.uploadVersion) { URL.revokeObjectURL(url); return; }
      finish(); invalidate();
      if (state.photo) URL.revokeObjectURL(state.photo);
      state.photo = url; $("#photoImg").src = url; $("#photoPreview").hidden = false; $("#photoLabel").hidden = true;
      $("#photoStatus").textContent = "사진 준비 완료 · 착용 이미지 생성에 동의하고 버튼을 누를 때만 사진이 전송됩니다.";
      note("");
    };
    im.onerror = () => {
      URL.revokeObjectURL(url); if (version !== state.uploadVersion) return;
      finish(); input.value = ""; note("사진을 읽을 수 없습니다. 다른 JPG·PNG·WEBP 파일을 선택해 주세요.");
      $("#photoStatus").textContent = state.photo ? "이전에 선택한 사진을 유지합니다." : "사진을 다시 선택해 주세요.";
    };
    im.src = url;
  }
  input.addEventListener("change", () => { if (input.files[0]) loadPhoto(input.files[0]); });
  ["dragenter", "dragover"].forEach(type => upload.addEventListener(type, e => { e.preventDefault(); upload.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(type => upload.addEventListener(type, e => { e.preventDefault(); upload.classList.remove("drag"); }));
  upload.addEventListener("drop", e => { if (e.dataTransfer.files[0]) loadPhoto(e.dataTransfer.files[0]); });
  $("#photoRemove").addEventListener("click", () => {
    ++state.uploadVersion; if (state.photo) URL.revokeObjectURL(state.photo);
    state.photo = null; state.photoLoading = false; $("#goBtn").disabled = false; input.value = "";
    $("#photoImg").removeAttribute("src"); $("#photoPreview").hidden = true; $("#photoLabel").hidden = false;
    $("#photoStatus").textContent = "사진이 삭제되었습니다. 새 사진을 선택해 주세요.";
    invalidate(); note(""); input.focus();
  });
  form.addEventListener("submit", e => {
    e.preventDefault(); note("");
    if (!ENGINE || !CATALOG?.ITEMS?.length) return note("상품 정보를 불러오지 못했습니다. 페이지를 새로고침해 주세요.");
    if (state.photoLoading) return note("사진 확인이 끝나면 다시 눌러 주세요.");
    if (!state.photo) { input.focus(); return note("먼저 사진을 선택해 주세요."); }
    try { state.user = ENGINE.profile(Object.fromEntries(new FormData(form))); }
    catch (err) { return note(err.message); }
    state.items = ENGINE.forGender(CATALOG.ITEMS, state.user.gender);
    state.brand = "all"; state.category = "all"; $("#categoryFilter").value = "all";
    $$("[data-brand]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.brand === "all")));
    const u = state.user;
    const known = ["chest", "waist", "hips"].filter(k => u[k] !== null).map(k => `${ENGINE.LABELS[k]} ${u[k]} cm`);
    $("#profileSummary").textContent = `${genderName(u.gender)} · ${u.height} cm / ${u.weight} kg${u.usualTopSize ? ` · 평소 상의 ${u.usualTopSize}` : ""}${known.length ? ` · ${known.join(" / ")}` : ""}`;
    $("#estimateNote").textContent = u.missing.length ? "평소 사이즈를 먼저 참고합니다. 비워 둔 둘레는 추정하지 않으며, 브랜드·디자인에 따라 실제 맞음은 달라질 수 있습니다." : "입력한 실측과 평소 사이즈를 함께 비교합니다. 마음에 드는 옷을 고르면 내 사진에 입어볼 수 있어요.";
    render(); $("#picks").hidden = false; $("#picksTitle").focus({ preventScroll: true }); $("#picks").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $$("[data-brand]").forEach(button => button.addEventListener("click", () => {
    state.brand = button.dataset.brand;
    $$("[data-brand]").forEach(b => b.setAttribute("aria-pressed", String(b === button))); render();
  }));
  $("#categoryFilter").addEventListener("change", e => { state.category = e.target.value; render(); });
  function resultLabel(r) {
    if (r.status === "usual-size") return r.sameBrand ? "평소 사이즈 기준" : "평소 사이즈 참고";
    if (r.status === "needs-measurements") return "사이즈 정보 필요";
    if (r.status === "conflict") return "실측·평소 비교";
    if (!r.best) return r.status === "unavailable" ? "사이즈표 확인 필요" : "추천 범위 밖";
    if (r.status === "borderline") return "경계 사이즈";
    return "실측 기준 추천";
  }
  function sizeLabel(r) { return r.best?.label || (r.status === "conflict" ? `${r.measured.label.split(" (")[0]} / ${r.usual.label.split(" (")[0]}` : "확인하기"); }
  function render() {
    if (!state.user) return;
    const grid = $("#picksGrid"); grid.replaceChildren();
    const visible = state.items.filter(it => (state.brand === "all" || it.brand === state.brand) && (state.category === "all" || it.cat === state.category));
    $("#resultCount").textContent = `${genderName(state.user.gender)} ${visible.length}개 · 상품을 선택하면 내 사이즈와 비교표를 볼 수 있어요.`;
    $("#emptyResults").hidden = visible.length > 0;
    for (const brand of ["UNIQLO", "ZARA"]) {
      const items = visible.filter(it => it.brand === brand); if (!items.length) continue;
      const section = document.createElement("section"); section.className = "brand-section"; section.setAttribute("aria-label", brand);
      section.innerHTML = `<div class="brand-section__heading"><h3>${brand}</h3><span>${genderName(state.user.gender)} / ${items.length}개</span></div><div class="picks"></div>`;
      items.forEach((it, i) => {
        const r = ENGINE.recommend(it, state.user), label = resultLabel(r), shortSize = sizeLabel(r).split(" (")[0];
        const button = document.createElement("button"); button.type = "button"; button.className = "pick"; button.dataset.id = it.id;
        button.setAttribute("aria-pressed", String(state.selected === it.id)); button.setAttribute("aria-label", `${brand} ${it.name}, ${label} ${shortSize}`);
        button.innerHTML = `<div class="pick__img"><img src="${esc(it.image)}" alt="${esc(it.name)} 공식 상품 사진" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="450" height="600" /><span class="pick__number">${String(i + 1).padStart(2, "0")}</span></div><div class="pick__body"><p class="pick__name">${esc(it.name)}</p><p class="pick__price">${money(it.price)}</p><div class="pick__size ${r.best ? "" : "pick__size--muted"}"><span>${label}</span><b>${esc(shortSize)} ↗</b></div></div>`;
        button.querySelector("img").addEventListener("error", e => {
          e.currentTarget.hidden = true; const holder = e.currentTarget.parentElement; holder.classList.add("image-error");
          const message = document.createElement("span"); message.textContent = "사진을 불러오지 못했어요. 선택 후 공식몰에서 확인해 주세요."; holder.append(message);
        }, { once: true });
        button.addEventListener("click", () => select(it)); section.querySelector(".picks").append(button);
      });
      grid.append(section);
    }
  }
  function select(it) {
    if (!state.user) return;
    state.selected = it.id; const r = ENGINE.recommend(it, state.user), chart = it.sizing, keys = chart?.keys || [];
    $$(".pick").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.id === it.id)));
    $("#selBrand").textContent = `${it.brand} / ${genderName(it.gender)}`; $("#selName").textContent = it.name;
    $("#selMeta").textContent = `${cats[it.cat]} · ${money(it.price)} · 상품 ${it.productCode}`;
    $("#detailImageError").hidden = true; $("#selImg").hidden = false; $("#selImg").alt = it.name;
    $("#selImg").onerror = () => { $("#selImg").hidden = true; $("#detailImageError").hidden = false; }; $("#selImg").src = it.image;
    $("#recommendLabel").textContent = resultLabel(r); $("#recommendedSize").textContent = sizeLabel(r);
    $("#sizeAnswer").classList.toggle("unavailable", !r.best);
    $("#recommendReason").textContent = r.status === "usual-size" ? `평소 편하게 입는 ${r.best.label}을 기준으로 표시했습니다. ${r.sameBrand ? "같은 브랜드여도 상품마다 핏이 다릅니다." : "브랜드 간 동일 사이즈의 치수는 다를 수 있습니다."} ${r.missing.map(k => ENGINE.LABELS[k]).join("·")} 실측을 입력하면 더 확인할 수 있습니다.` : r.status === "needs-measurements" ? `평소 사이즈 또는 ${r.missing.map(k => ENGINE.LABELS[k]).join("·")}를 입력해 주세요. 키·몸무게만으로 사이즈를 정하지 않습니다.` : r.status === "conflict" ? `입력 실측은 ${r.measured.label}, 평소 착용은 ${r.usual.label}입니다. 평소 사이즈를 자동으로 낮추지 않았습니다. 어깨·기장·선호 핏과 실측값을 함께 확인해 주세요.` : !r.best ? "확인된 사이즈표에서 입력 실측에 맞는 범위를 찾지 못했습니다. 치수와 공식몰 안내를 확인해 주세요." : r.status === "borderline" ? "입력 실측이 사이즈 경계에 가깝습니다. 비교표와 평소 착용감을 함께 확인하세요." : `${keys.map(k => `${ENGINE.LABELS[k]} ${state.user[k]} cm`).join(" · ")}를 비교했습니다. 어깨와 기장은 별도 확인이 필요합니다.`;
    const basis = chart?.kind === "garment-flat" ? "공식 상품 실측(단면 × 2)에 Fit Room의 착용 여유 기준을 적용했습니다. 아래 표는 옷 둘레입니다." : chart?.kind === "body-points" ? "공식 신체 치수 기준값에 가장 가까운 사이즈를 계산했습니다. 아래 표는 브랜드가 안내하는 신체 둘레입니다." : "유니클로 공식 신체 사이즈 가이드와 상품의 표기 사이즈 범위 기준입니다. 아래 표는 신체 둘레입니다.";
    $("#sizeBasis").textContent = chart ? basis : "이 상품의 사이즈표가 아직 연결되지 않았습니다.";
    if (chart?.scope === "brand-guide") $("#sizeBasis").textContent += " 상품별 실측이 아닌 브랜드 공통 가이드 기준입니다.";
    $("#sizeSource").hidden = !chart?.source;
    if (chart?.source) $("#sizeSource").href = chart.source;
    $("#fitHead").innerHTML = `<tr><th scope="col">사이즈</th>${keys.map(k => `<th scope="col">${ENGINE.LABELS[k]}</th>`).join("")}<th scope="col">비교</th></tr>`;
    $("#fitRows").innerHTML = `<tr class="my-row"><td>내 실측</td>${keys.map(k => `<td>${state.user[k] ?? "미입력"}</td>`).join("")}<td>cm</td></tr>` + r.rows.map(row => {
      const best = row === r.best;
      return `<tr class="${best ? "best" : ""}"><th scope="row">${esc(row.label)}</th>${row.parts.map(p => `<td>${Array.isArray(p.reference) ? p.reference.join("–") : chart.kind === "garment-flat" ? p.reference * 2 : p.reference}</td>`).join("")}<td>${row === r.usual ? "평소 사이즈" : r.missing.length ? "실측 필요" : best ? "추천" : row.fits ? "범위 안" : row.over > 2 ? "여유 적음" : row.under > 3 ? "여유 큼" : "경계"}</td></tr>`;
    }).join("");
    const caution = [];
    if (r.missing.length) caution.push("미입력 치수는 자동 추정하지 않습니다. 평소 사이즈 표시는 착용감이 검증된 추천이 아닙니다.");
    if (!keys.includes("hips") && it.cat === "bottom") caution.push("이 사이즈표에는 엉덩이 치수가 없어 허리를 기준으로 추천합니다.");
    if (/로우라이즈|미드라이즈/.test(it.name)) caution.push("이 바지는 허리선이 낮아 실제 착용 위치의 둘레도 확인해 주세요.");
    caution.push("실시간 재고와 원단의 신축성은 반영하지 않습니다.");
    $("#fitCaution").textContent = caution.join(" "); $("#shopLink").href = it.url;
    $(".size-comparison").open = false;
    dialog.showModal(); document.body.classList.add("dialog-open"); dialog.scrollTop = 0;
  }
  $("#closeDialog").addEventListener("click", () => dialog.close());
  $("#openTryonBtn").addEventListener("click", () => {
    const item = state.items.find(it => it.id === state.selected); if (!item || !state.photo) return;
    dialog.close(); window.FIT_TRYON.open({ photo: state.photo, item, user: state.user, recommendation: ENGINE.recommend(item, state.user) });
  });
  dialog.addEventListener("close", () => document.body.classList.remove("dialog-open"));
  dialog.addEventListener("click", e => { if (e.target !== dialog) return; const b = dialog.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) dialog.close(); });
  $("#editMeasurements").addEventListener("click", () => { dialog.close(); $("#measurements").scrollIntoView({ behavior: "smooth" }); $("#usualTopSize").focus({ preventScroll: true }); });
})();
