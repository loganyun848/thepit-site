/* Fit Room: local photo/profile → 20 products per brand → automatic size. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const CFG = window.THEPIT_CONFIG || {}, ENGINE = window.FIT_SIZING, CATALOG = window.FIT_CATALOG;
  const state = { photo: null, photoLoading: false, uploadVersion: 0, user: null, items: [], brand: "all", category: "all", selected: null };
  const genderName = g => g === "women" ? "Women" : "Men";
  const cats = { top: "Tops", outer: "Outerwear", bottom: "Bottoms" };
  const money = n => `KRW ${n.toLocaleString("en-US")}`;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const note = m => { $("#formNote").textContent = m; };
  const dialog = $("#sizeDialog"), form = $("#measureForm"), upload = $("#photoUpload"), input = $("#photoInput");
  $("#navToggle").addEventListener("click", () => { const open = $("#navLinks").classList.toggle("open"); $("#navToggle").setAttribute("aria-expanded", String(open)); });
  $("#footYoutube").href = CFG.YOUTUBE_CHANNEL_URL || "index.html";
  $("#footMail").href = "contact.html";
  $("#footMail").textContent = "Contact";
  $("#catalogDate").textContent = CATALOG?.updatedAt || "";
  function invalidate() {
    if (state.user) note("Your profile has changed. Select the button below to update your size comparison.");
    state.user = null; state.selected = null; state.items = [];
    window.FIT_TRYON?.clear();
    $("#picks").hidden = true; $("#picksGrid").replaceChildren();
    if (dialog.open) dialog.close();
  }
  const autoFields = ['chest', 'waist', 'hips', 'usualTopSize', 'usualBottomSize'];
  const manualFields = new Set(autoFields.filter(key => form.elements[key].value !== ''));
  const autoValues = new Map();
  for (const key of autoFields) {
    const tag = document.createElement('small'); tag.id = key + 'Source'; tag.className = 'profile-source';
    form.elements[key].closest('.field').append(tag);
    form.elements[key].setAttribute('aria-describedby', tag.id + ' profileEstimateHelp');
  }
  for (const inches of [22, 23, 35, 42]) {
    const option = document.createElement('option'); option.value = 'inch:' + inches; option.textContent = `Waist ${inches} in`;
    const next = [...form.elements.usualBottomSize.options].find(item => item.value.startsWith('inch:') && Number(item.value.slice(5)) > inches);
    form.elements.usualBottomSize.add(option, next || null);
  }
  function profileInput() {
    const values = Object.fromEntries(new FormData(form));
    values.estimated = ['chest', 'waist', 'hips'].filter(key => form.elements[key].dataset.source === 'estimated');
    values.suggestedSizes = ['usualTopSize', 'usualBottomSize'].filter(key => form.elements[key].dataset.source === 'suggested');
    return values;
  }
  function setSuggestion(key, value) {
    const field = form.elements[key];
    // Browser autofill/restored entries count as user input, too.
    if (field.value && field.value !== autoValues.get(key)) manualFields.add(key);
    const source = manualFields.has(key) ? (field.value ? 'entered' : '') : value ? (key.startsWith('usual') ? 'suggested' : 'estimated') : '';
    if (!manualFields.has(key)) {
      field.value = value ?? '';
      autoValues.set(key, field.value);
    }
    field.dataset.source = field.value ? source : '';
    const tag = document.getElementById(key + 'Source');
    tag.textContent = field.dataset.source === 'entered' ? 'Your entry' : field.dataset.source === 'suggested' ? 'Suggested · Editable' : field.dataset.source === 'estimated' ? 'Estimated · Editable' : '';
  }
  function updateSuggestions() {
    const input = Object.fromEntries(new FormData(form));
    const estimated = ENGINE?.estimateMeasurements(input);
    for (const key of ['chest', 'waist', 'hips']) setSuggestion(key, estimated?.[key]);
    let sizes = null;
    if (estimated && CATALOG?.ITEMS) {
      try { sizes = ENGINE.suggestSizes(ENGINE.profile(profileInput()), CATALOG.ITEMS); } catch (_) { /* Keep invalid user entries for correction. */ }
    }
    for (const key of ['usualTopSize', 'usualBottomSize']) setSuggestion(key, sizes?.[key]);
    $('#refreshEstimates').disabled = !estimated;
    const generated = autoFields.filter(key => ['estimated', 'suggested'].includes(form.elements[key].dataset.source));
    $('#profileEstimateStatus').textContent = !estimated ? 'Select Women or Men, then enter a valid height and weight for editable starting estimates.' : generated.length ? `Starting estimates filled in. Size suggestions use ${sizes?.brand || (input.usualBrand === 'ZARA' ? 'ZARA' : 'UNIQLO')} charts. Your edits are kept.` : 'Your entries are kept. Use suggested values again to replace them with fresh estimates.';
  }
  function profileChanged(event) {
    if (autoFields.includes(event.target.name)) manualFields.add(event.target.name);
    updateSuggestions(); invalidate();
  }
  form.addEventListener('input', profileChanged);
  form.addEventListener('change', profileChanged);
  $('#refreshEstimates').addEventListener('click', () => {
    manualFields.clear();
    autoFields.forEach(key => { autoValues.set(key, form.elements[key].value); });
    updateSuggestions(); invalidate();
  });
  updateSuggestions();
  function loadPhoto(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { note("Please choose a JPG, PNG or WEBP photo."); input.value = ""; return; }
    if (!file.size || file.size > (CFG.MAX_PHOTO_MB || 10) * 1024 * 1024) { note("Please choose a non-empty photo up to 10 MB."); input.value = ""; return; }
    const version = ++state.uploadVersion, url = URL.createObjectURL(file), im = new Image();
    state.photoLoading = true; $("#goBtn").disabled = true; $("#photoStatus").textContent = "Checking your photo…";
    function finish() { state.photoLoading = false; $("#goBtn").disabled = false; }
    im.onload = () => {
      if (version !== state.uploadVersion) { URL.revokeObjectURL(url); return; }
      finish(); invalidate();
      if (state.photo) URL.revokeObjectURL(state.photo);
      state.photo = url; $("#photoImg").src = url; $("#photoPreview").hidden = false; $("#photoLabel").hidden = true;
      $("#photoStatus").textContent = "Photo ready · Your photo is sent only when you consent and start try-on generation.";
      note("");
    };
    im.onerror = () => {
      URL.revokeObjectURL(url); if (version !== state.uploadVersion) return;
      finish(); input.value = ""; note("This photo could not be read. Please choose another JPG, PNG or WEBP file.");
      $("#photoStatus").textContent = state.photo ? "Your previous photo has been kept." : "Please select your photo again.";
    };
    im.src = url;
  }
  $("#photoLabel").addEventListener("click", () => input.click());
  input.addEventListener("change", () => { if (input.files[0]) loadPhoto(input.files[0]); });
  ["dragenter", "dragover"].forEach(type => upload.addEventListener(type, e => { e.preventDefault(); upload.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(type => upload.addEventListener(type, e => { e.preventDefault(); upload.classList.remove("drag"); }));
  upload.addEventListener("drop", e => { if (e.dataTransfer.files[0]) loadPhoto(e.dataTransfer.files[0]); });
  $("#photoRemove").addEventListener("click", () => {
    ++state.uploadVersion; if (state.photo) URL.revokeObjectURL(state.photo);
    state.photo = null; state.photoLoading = false; $("#goBtn").disabled = false; input.value = "";
    $("#photoImg").removeAttribute("src"); $("#photoPreview").hidden = true; $("#photoLabel").hidden = false;
    $("#photoStatus").textContent = "Photo removed. Please choose a new photo.";
    invalidate(); note(""); $("#photoLabel").focus();
  });
  form.addEventListener("submit", e => {
    e.preventDefault(); note("");
    if (!ENGINE || !CATALOG?.ITEMS?.length) return note("Product details could not be loaded. Please refresh the page.");
    if (state.photoLoading) return note("Please wait for the photo check to finish.");
    if (!state.photo) { $("#photoLabel").focus(); return note("Please choose a photo first."); }
    try { updateSuggestions(); state.user = ENGINE.profile(profileInput()); }
    catch (err) { return note(err.message); }
    state.items = ENGINE.forGender(CATALOG.ITEMS, state.user.gender);
    state.brand = "all"; state.category = "all"; $("#categoryFilter").value = "all";
    $$("[data-brand]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.brand === "all")));
    const u = state.user;
    const known = ["chest", "waist", "hips"].filter(k => u[k] !== null).map(k => `${ENGINE.LABELS[k]} ${u.estimated.includes(k) ? '≈ ' : ''}${u[k]} cm`);
    const sizeSummary = [['usualTopSize', 'top'], ['usualBottomSize', 'bottom']].filter(([key]) => u[key]).map(([key, label]) => `${u.suggestedSizes.includes(key) ? 'Suggested' : 'Usual'} ${label} ${u[key].replace('inch:', 'waist ')}${u[key].startsWith('inch:') ? ' in' : ''}`);
    $("#profileSummary").textContent = `${genderName(u.gender)} · ${u.height} cm / ${u.weight} kg${sizeSummary.length ? ' · ' + sizeSummary.join(' · ') : ''}${known.length ? ` · ${known.join(" / ")}` : ""}`;
    $("#estimateNote").textContent = u.estimated.length ? '≈ Auto-filled starting estimates, not measured body dimensions. Edit them for a closer comparison. Your explicitly selected usual sizes take priority.' : u.missing.length ? "Your usual size is the starting point. Add missing measurements for a closer comparison." : "Compare your measurements and usual size, then choose an outfit to preview on your photo.";
    render(); $("#picks").hidden = false; $("#picksTitle").focus({ preventScroll: true }); $("#picks").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $$("[data-brand]").forEach(button => button.addEventListener("click", () => {
    state.brand = button.dataset.brand;
    $$("[data-brand]").forEach(b => b.setAttribute("aria-pressed", String(b === button))); render();
  }));
  $("#categoryFilter").addEventListener("change", e => { state.category = e.target.value; render(); });
  function resultLabel(r) {
    if (r.status === 'estimated') return 'Estimated size · Check fit';
    if (r.status === "usual-size") return r.sameBrand ? "Based on your usual size" : "Usual size reference";
    if (r.status === "needs-measurements") return "Size details needed";
    if (r.status === "conflict") return "Compare measured and usual sizes";
    if (!r.best) return r.status === "unavailable" ? "Check the size chart" : "Outside chart range";
    if (r.status === "borderline") return "Between sizes";
    return "Based on measurements";
  }
  function sizeLabel(r) { return r.best?.label || (r.status === "conflict" ? `${r.measured.label.split(" (")[0]} / ${r.usual.label.split(" (")[0]}` : "View details"); }
  function render() {
    if (!state.user) return;
    const grid = $("#picksGrid"); grid.replaceChildren();
    const visible = state.items.filter(it => (state.brand === "all" || it.brand === state.brand) && (state.category === "all" || it.cat === state.category));
    $("#resultCount").textContent = `${visible.length} ${genderName(state.user.gender).toLowerCase()} pieces · Select an item to compare your size.`;
    $("#emptyResults").hidden = visible.length > 0;
    for (const brand of ["UNIQLO", "ZARA"]) {
      const items = visible.filter(it => it.brand === brand); if (!items.length) continue;
      const section = document.createElement("section"); section.className = "brand-section"; section.setAttribute("aria-label", brand);
      section.innerHTML = `<div class="brand-section__heading"><h3>${brand}</h3><span>${genderName(state.user.gender)} / ${items.length} pieces</span></div><div class="picks"></div>`;
      items.forEach((it, i) => {
        const r = ENGINE.recommend(it, state.user), label = resultLabel(r), shortSize = sizeLabel(r).split(" (")[0];
        const button = document.createElement("button"); button.type = "button"; button.className = "pick"; button.dataset.id = it.id;
        button.setAttribute("aria-pressed", String(state.selected === it.id)); button.setAttribute("aria-label", `${brand} ${it.name}, ${label} ${shortSize}`);
        button.innerHTML = `<div class="pick__img"><img src="${esc(it.image)}" alt="${esc(it.name)} official product photo" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="450" height="600" /><span class="pick__number">${String(i + 1).padStart(2, "0")}</span></div><div class="pick__body"><p class="pick__name">${esc(it.name)}</p><p class="pick__price">${money(it.price)}</p><div class="pick__size ${r.best ? "" : "pick__size--muted"}"><span>${label}</span><b>${esc(shortSize)} ↗</b></div></div>`;
        button.querySelector("img").addEventListener("error", e => {
          e.currentTarget.hidden = true; const holder = e.currentTarget.parentElement; holder.classList.add("image-error");
          const message = document.createElement("span"); message.textContent = "Photo unavailable. Select this item to view it on the official store."; holder.append(message);
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
    $("#selMeta").textContent = `${cats[it.cat]} · ${money(it.price)} · Item ${it.productCode}`;
    $("#detailImageError").hidden = true; $("#selImg").hidden = false; $("#selImg").alt = it.name;
    $("#selImg").onerror = () => { $("#selImg").hidden = true; $("#detailImageError").hidden = false; }; $("#selImg").src = it.image;
    $("#recommendLabel").textContent = resultLabel(r); $("#recommendedSize").textContent = sizeLabel(r);
    $("#sizeAnswer").classList.toggle("unavailable", !r.best);
    $("#recommendReason").textContent = r.status === "usual-size" ? `Shown based on your usual comfortable size, ${r.best.label}. ${r.sameBrand ? "Fit varies between products, even within the same brand." : "The same size label can have different measurements across brands."} Add your ${r.missing.map(k => ENGINE.LABELS[k].toLowerCase()).join(" / ")} measurements for a closer comparison.` : r.status === "needs-measurements" ? `Enter your usual size or ${r.missing.map(k => ENGINE.LABELS[k].toLowerCase()).join(" / ")} measurements. Height and weight alone do not determine your size.` : r.status === "conflict" ? `Your measurements suggest ${r.measured.label}; your usual size is ${r.usual.label}. We have not automatically reduced your usual size. Compare shoulder width, garment length, fit preference and measurements.` : !r.best ? "Your measurements fall outside the available chart range. Please check them and the official size guide." : r.status === "borderline" ? "Your measurements are close to a size boundary. Check the comparison chart alongside your usual fit." : `${keys.map(k => `${ENGINE.LABELS[k]} ${state.user[k]} cm`).join(" · ")} compared. Check shoulder width and garment length separately.`;
    if (r.estimated.length) $('#recommendReason').textContent = r.usual ? `Your selected usual size ${r.usual.label} is kept. The auto-filled ${r.estimated.map(k => ENGINE.LABELS[k].toLowerCase()).join(' / ')} values are rough estimates; replace them with tape measurements to compare fit.` : `${r.best ? 'An approximate starting size based on' : 'No size in this chart matches'} your estimated ${r.estimated.map(k => ENGINE.LABELS[k].toLowerCase()).join(' / ')}. Check actual measurements, garment length and the product chart before choosing.`;
    const basis = chart?.kind === "garment-flat" ? "Based on official garment measurements (flat width × 2) and Fit Room ease allowances. The table shows garment circumferences." : chart?.kind === "body-points" ? "Calculated from the closest official body measurements. The table shows the body circumferences listed by the brand." : "Based on the official UNIQLO body size guide and the size range listed for this item. The table shows body circumferences.";
    $("#sizeBasis").textContent = chart ? basis : "A size chart is not available for this item yet.";
    if (chart?.scope === "brand-guide") $("#sizeBasis").textContent += " This is a general brand guide, not product-specific garment measurements.";
    $("#sizeSource").hidden = !chart?.source;
    if (chart?.source) $("#sizeSource").href = chart.source;
    $("#fitHead").innerHTML = `<tr><th scope="col">Size</th>${keys.map(k => `<th scope="col">${ENGINE.LABELS[k]}</th>`).join("")}<th scope="col">Comparison</th></tr>`;
    $("#fitRows").innerHTML = `<tr class="my-row"><td>${r.estimated.length ? 'Your profile (≈ estimated)' : 'Your measurements'}</td>${keys.map(k => `<td>${r.estimated.includes(k) ? '≈ ' : ''}${state.user[k] ?? "Not provided"}</td>`).join("")}<td>cm</td></tr>` + r.rows.map(row => {
      const best = row === r.best;
      return `<tr class="${best ? "best" : ""}"><th scope="row">${esc(row.label)}</th>${row.parts.map(p => `<td>${Array.isArray(p.reference) ? p.reference.join("–") : chart.kind === "garment-flat" ? p.reference * 2 : p.reference}</td>`).join("")}<td>${row === r.usual ? "Usual size" : r.missing.length ? "Measurements needed" : best ? "Suggested" : row.fits ? "Within range" : row.over > 2 ? "Less room" : row.under > 3 ? "More room" : "Borderline"}</td></tr>`;
    }).join("");
    const caution = [];
    if (r.estimated.length) caution.push('Estimated circumferences are editable starting values, not a body scan or a confirmed fit.');
    if (r.missing.length) caution.push("Some measurements are missing. A usual-size reference is not a verified fit recommendation.");
    if (!keys.includes("hips") && it.cat === "bottom") caution.push("This chart does not include hip measurements, so the comparison uses your waist.");
    if (/low[- ]rise|mid[- ]rise/i.test(it.name)) caution.push("These pants sit below the natural waist. Also check your circumference at the intended waistband position.");
    caution.push("Live stock and fabric stretch are not included.");
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
