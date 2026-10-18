/* THE PIT — Fit Room 동작 (외부 라이브러리 없음)
   흐름: 사진 업로드 → 치수 → 추천 → 캔버스 가상 착용(데모) → 사이즈별 핏 체크
   실제 AI 가상 착용은 config.js 의 TRYON_ENDPOINT 가 설정되면 자동으로 켜집니다. */
(function () {
  "use strict";
  const CFG = window.THEPIT_CONFIG || {};
  const CAT = window.FIT_CATALOG;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  /* ── 공통: 내비 · 푸터 ── */
  const toggle = $("#navToggle"), links = $("#navLinks");
  toggle.addEventListener("click", () => { const o = links.classList.toggle("open"); toggle.setAttribute("aria-expanded", String(o)); });
  const yt = CFG.YOUTUBE_CHANNEL_URL || "#";
  $("#footYoutube").href = yt;
  if (CFG.INSTAGRAM_URL) { const a = $("#footInsta"); a.href = CFG.INSTAGRAM_URL; a.hidden = false; }
  $("#footMail").href = "mailto:" + (CFG.CONTACT_EMAIL || "");
  const LIVE = !!CFG.TRYON_ENDPOINT;
  if (LIVE) { const p = $("#privacyLine"); p.textContent = "✨ AI try-on enabled — photos are sent to our try-on server only when you press “AI try-on”."; p.classList.add("live"); $("#aiBtn").hidden = false; }

  /* ── 상태 ── */
  const state = { photo: null, photoW: 0, photoH: 0, user: null, picks: [], sel: null, g: { x: .5, y: .36, s: 1, r: 0 }, gImg: null, aiImg: null };

  /* ── 1. 사진 업로드 ── */
  const up = $("#photoUpload"), input = $("#photoInput"), prev = $("#photoPreview"), pimg = $("#photoImg");
  ["dragenter", "dragover"].forEach(ev => up.addEventListener(ev, e => { e.preventDefault(); up.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(ev => up.addEventListener(ev, e => { e.preventDefault(); up.classList.remove("drag"); }));
  up.addEventListener("drop", e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadPhoto(f); });
  input.addEventListener("change", () => { if (input.files[0]) loadPhoto(input.files[0]); });
  $("#photoRemove").addEventListener("click", () => { state.photo = null; state.aiImg = null; input.value = ""; prev.hidden = true; up.classList.remove("has-file"); $("#toneRead").hidden = true; draw(); });

  function loadPhoto(file) {
    if (!file.type.startsWith("image/")) return note("Please choose an image file.");
    if (file.size > (CFG.MAX_PHOTO_MB || 10) * 1024 * 1024) return note(`Photo is over ${CFG.MAX_PHOTO_MB || 10} MB.`);
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const max = CFG.RESIZE_MAX_PX || 1600, k = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      const out = new Image();
      out.onload = () => { state.photo = out; state.photoW = out.width; state.photoH = out.height; state.aiImg = null; pimg.src = out.src; prev.hidden = false; up.classList.add("has-file"); readTone(c); draw(); };
      out.src = c.toDataURL("image/jpeg", .9);
      URL.revokeObjectURL(url);
    };
    im.src = url;
  }

  /* 피부톤 추정: 사진 상단 중앙(얼굴 예상 영역)에서 피부색 픽셀만 평균 */
  function readTone(c) {
    const ctx = c.getContext("2d"), W = c.width, H = c.height;
    const x0 = Math.round(W * .3), y0 = Math.round(H * .05), w = Math.round(W * .4), h = Math.round(H * .3);
    const d = ctx.getImageData(x0, y0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      if (R > 95 && G > 40 && B > 20 && R > G && R > B && (R - Math.min(G, B)) > 15 && Math.abs(R - G) > 15) { r += R; g += G; b += B; n++; }
    }
    const box = $("#toneRead"), dot = $("#toneDot"), lab = $("#toneLabel");
    if (n < 40) { box.hidden = true; return; }
    r /= n; g /= n; b /= n;
    const under = (r + g) / 2 - b;           // 황색 기운이 클수록 warm
    const tone = under > 62 ? "warm" : under < 42 ? "cool" : "neutral";
    dot.style.background = `rgb(${r | 0},${g | 0},${b | 0})`;
    lab.textContent = tone[0].toUpperCase() + tone.slice(1);
    box.hidden = false;
    const radio = $(`input[name=tone][value=${tone}]`); if (radio) radio.checked = true;
  }

  /* ── 2. 치수 → 체형 ── */
  const form = $("#measureForm");
  const note = (m, ok) => { const n = $("#formNote"); n.textContent = m || ""; n.classList.toggle("ok", !!ok); };
  form.addEventListener("submit", e => {
    e.preventDefault();
    const h = +form.height.value, w = +form.weight.value;
    if (!h || !w) return note("Height and weight are needed to size you.");
    if (!state.photo) return note("Add a photo first — we use it for the try-on and your tone.");
    const bmi = w / ((h / 100) ** 2);
    const est = {};
    let chest = +form.chest.value || (est.chest = true, Math.round(86 + (bmi - 21) * 2.2 + (h - 168) * .25));
    let waist = +form.waist.value || (est.waist = true, Math.round(72 + (bmi - 21) * 2.6 + (h - 168) * .15));
    let hips  = +form.hips.value  || (est.hips  = true, Math.round(92 + (bmi - 21) * 2.0 + (h - 168) * .2));
    let body = bmi < 19.5 ? "slim" : bmi < 25 ? "average" : "broad";
    const measured = !est.chest && !est.hips;           // 실측일 때만 체형 비율 판단
    if (measured && hips - chest >= 5) body = "curvy";
    else if (measured && chest - hips >= 8) body = "broad";
    const tone = (form.querySelector("input[name=tone]:checked") || {}).value || "neutral";
    const pref = (form.querySelector("input[name=pref]:checked") || {}).value || "regular";
    const cats = $$("input[name=cat]:checked", form).map(i => i.value);
    const m = new Date().getMonth() + 1, season = (m >= 4 && m <= 9) ? "SS" : "FW";
    state.user = { h, w, bmi, chest, waist, hips, est, body, tone, pref, cats, season };
    note("");
    recommend();
  });

  /* ── 3. 추천 ── */
  const BODY_LABEL = { slim: "a slim frame", average: "a balanced frame", broad: "a broad frame", curvy: "a curvy frame" };
  const PREF_NEAR = { slim: ["slim", "regular"], regular: ["regular", "slim", "relaxed"], relaxed: ["relaxed", "regular", "oversized"], oversized: ["oversized", "relaxed"] };
  function recommend() {
    const u = state.user;
    const scored = CAT.ITEMS.filter(it => u.cats.includes(it.cat)).map(it => {
      let s = 0; const why = [];
      if (it.tone === u.tone) { s += 3; why.push("Your tone"); } else if (it.tone === "neutral") { s += 1.5; }
      if (it.season === u.season) { s += 2; why.push("In season"); } else if (it.season === "ALL") { s += 1.2; }
      if (it.body.includes(u.body)) { s += 2.5; why.push("Your shape"); }
      const pi = PREF_NEAR[u.pref].indexOf(it.fit); if (pi === 0) { s += 2; why.push("Your fit"); } else if (pi > 0) { s += .8; }
      s += (hash(it.id + u.h + u.w) % 10) / 20;   // 동점 흔들기
      return { it, s, why };
    }).sort((a, b) => b.s - a.s);
    // 카테고리 다양성: 같은 카테고리 3개 초과 금지
    const count = {}, picks = [];
    for (const p of scored) { count[p.it.cat] = (count[p.it.cat] || 0) + 1; if (count[p.it.cat] <= 3) picks.push(p); if (picks.length >= 8) break; }
    state.picks = picks;
    $("#bodyLabel").textContent = BODY_LABEL[u.body];
    $("#picksWhy").textContent = `${cap(u.tone)} undertone · ${u.season === "SS" ? "spring/summer" : "autumn/winter"} season · you like ${u.pref} fits. Tap an item to try it on.`;
    const grid = $("#picksGrid"); grid.innerHTML = "";
    picks.forEach((p, i) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "pick"; b.dataset.id = p.it.id;
      b.innerHTML = `<span class="pick__rank">${i + 1}</span><span class="pick__price">$${p.it.price}</span>
        <div class="pick__img"><img src="${p.it.image}" alt="${p.it.name}" loading="lazy" /></div>
        <div class="pick__body"><p class="pick__brand">${p.it.brand}</p><p class="pick__name">${p.it.name}</p>
        <div class="pick__tags">${p.why.map(w => `<span>${w}</span>`).join("")}<span>${cap(p.it.fit)}</span></div></div>`;
      b.addEventListener("click", () => select(p.it));
      grid.appendChild(b);
    });
    $("#picks").hidden = false; $("#studio").hidden = false;
    $("#picks").scrollIntoView({ behavior: "smooth", block: "start" });
    if (picks[0]) select(picks[0].it, true);
  }
  function hash(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); }
  const cap = s => s[0].toUpperCase() + s.slice(1);

  /* ── 4. 선택 → 스튜디오 + 핏 체크 ── */
  function select(it, quiet) {
    state.sel = it; state.aiImg = null;
    $$(".pick").forEach(b => b.classList.toggle("on", b.dataset.id === it.id));
    $("#selImg").src = it.image; $("#selBrand").textContent = it.brand; $("#selName").textContent = it.name;
    $("#selMeta").textContent = `${cap(it.cat)} · ${cap(it.fit)} fit · ${it.tone} tone · $${it.price}`;
    const im = new Image(); im.onload = () => { state.gImg = im; resetPose(); draw(); }; im.src = it.image;
    fitCheck(it);
    if (!quiet) $("#studio").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function resetPose() {
    const c = state.sel ? state.sel.cat : "top";
    state.g = c === "bottom" ? { x: .5, y: .68, s: 1, r: 0 } : c === "dress" ? { x: .5, y: .52, s: 1.15, r: 0 } : { x: .5, y: .37, s: 1, r: 0 };
    $("#scaleRange").value = state.g.s; $("#rotRange").value = 0;
  }

  /* ── 캔버스 ── */
  const cv = $("#stage"), cx = cv.getContext("2d");
  function draw() {
    const W = cv.width, H = cv.height;
    cx.clearRect(0, 0, W, H);
    cx.fillStyle = "#27272f"; cx.fillRect(0, 0, W, H);
    const base = state.aiImg || state.photo;
    if (!base) {
      cx.fillStyle = "rgba(255,255,255,.35)"; cx.font = "600 34px Inter, sans-serif"; cx.textAlign = "center";
      cx.fillText("Your photo appears here", W / 2, H / 2); return;
    }
    // cover
    const k = Math.max(W / base.width, H / base.height), bw = base.width * k, bh = base.height * k;
    cx.drawImage(base, (W - bw) / 2, (H - bh) / 2, bw, bh);
    if (state.aiImg || !state.gImg) return;
    const g = state.g, gw = W * .62 * g.s, gh = gw * 1.2;
    cx.save(); cx.translate(W * g.x, H * g.y); cx.rotate(g.r * Math.PI / 180);
    cx.globalAlpha = .96; cx.shadowColor = "rgba(0,0,0,.35)"; cx.shadowBlur = 24; cx.shadowOffsetY = 10;
    cx.drawImage(state.gImg, -gw / 2, -gh / 2, gw, gh);
    cx.restore();
  }
  // 드래그 / 핀치
  let drag = null, pinch = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const pts = new Map();
  cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, pos(e)); if (pts.size === 1) drag = { p: pos(e), g: { ...state.g } }; else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: state.g.s }; drag = null; } });
  cv.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, pos(e));
    if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; state.g.s = clamp(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, .4, 1.6); $("#scaleRange").value = state.g.s; draw(); return; }
    if (drag) { const p = pos(e); state.g.x = drag.g.x + (p.x - drag.p.x); state.g.y = drag.g.y + (p.y - drag.p.y); draw(); }
  });
  ["pointerup", "pointercancel"].forEach(ev => cv.addEventListener(ev, e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 0) drag = null; }));
  cv.addEventListener("wheel", e => { e.preventDefault(); state.g.s = clamp(state.g.s * (e.deltaY < 0 ? 1.05 : .95), .4, 1.6); $("#scaleRange").value = state.g.s; draw(); }, { passive: false });
  $("#scaleRange").addEventListener("input", e => { state.g.s = +e.target.value; draw(); });
  $("#rotRange").addEventListener("input", e => { state.g.r = +e.target.value; draw(); });
  $("#resetBtn").addEventListener("click", () => { state.aiImg = null; resetPose(); draw(); $("#stageBadge").textContent = "Demo preview · drag to move · pinch or slider to resize"; });
  $("#saveBtn").addEventListener("click", () => { const a = document.createElement("a"); a.download = `thepit-fit-${(state.sel || {}).id || "look"}.jpg`; a.href = cv.toDataURL("image/jpeg", .92); a.click(); });
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ── AI 가상 착용 (엔드포인트가 있을 때만) ──
     요청: POST JSON { photo: dataURL(jpeg), garment: dataURL(png), category, item }
     응답: { image: dataURL | https URL }  */
  $("#aiBtn").addEventListener("click", async () => {
    if (!state.photo || !state.sel) return;
    const busy = $("#stageBusy"); busy.hidden = false;
    try {
      const gc = document.createElement("canvas"); gc.width = 800; gc.height = 960; gc.getContext("2d").drawImage(state.gImg, 0, 0, 800, 960);
      const res = await fetch(CFG.TRYON_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo: state.photo.src, garment: gc.toDataURL("image/png"), category: state.sel.cat, item: state.sel.id }) });
      const j = await res.json(); if (!j.image) throw new Error("no image");
      const im = new Image(); im.crossOrigin = "anonymous";
      im.onload = () => { state.aiImg = im; draw(); $("#stageBadge").textContent = "AI try-on result"; busy.hidden = true; };
      im.onerror = () => { busy.hidden = true; note("Try-on server returned an image we couldn't load."); };
      im.src = j.image;
    } catch (err) { busy.hidden = true; $("#stageBadge").textContent = "AI try-on failed — showing demo preview"; }
  });

  /* ── 5. 핏 체크 ── */
  const RANK = { tight: 4, snug: 2, fit: 0, roomy: 1, loose: 3 };
  const LABEL = { tight: "Too tight", snug: "Snug", fit: "Good fit", roomy: "Roomy", loose: "Loose" };
  function verdict(v, [lo, hi]) { if (v > hi + 3) return "tight"; if (v > hi) return "snug"; if (v >= lo) return "fit"; if (v >= lo - 7) return "roomy"; return "loose"; }
  function fitCheck(it) {
    const u = state.user, wrap = $("#fitSizes"); wrap.innerHTML = "";
    const rows = Object.entries(it.sizes).map(([tag, rg]) => {
      const parts = Object.entries(rg).map(([k, range]) => ({ k, range, v: u[k], vd: verdict(u[k], range) }));
      const worst = parts.reduce((a, p) => RANK[p.vd] > RANK[a.vd] ? p : a, parts[0]);
      const dist = parts.reduce((a, p) => a + Math.abs(p.v - (p.range[0] + p.range[1]) / 2), 0);
      return { tag, parts, vd: worst.vd, dist };
    });
    const best = rows.slice().sort((a, b) => RANK[a.vd] - RANK[b.vd] || a.dist - b.dist)[0];
    $("#fitLead").innerHTML = best.vd === "fit"
      ? `Your size in this piece is <b class="gold">${best.tag}</b>.`
      : `Closest size is <b class="gold">${best.tag}</b> — ${LABEL[best.vd].toLowerCase()} on you.`;
    rows.forEach(r => {
      const el = document.createElement("div"); el.className = "size" + (r === best ? " best" : "");
      el.innerHTML = `<span class="size__tag">${r.tag}</span><div class="size__bars">${r.parts.map(p => {
        const lo = p.range[0] - 12, hi = p.range[1] + 12, pct = x => clamp((x - lo) / (hi - lo) * 100, 0, 100);
        return `<div class="bar"><span>${cap(p.k)}</span><div class="bar__track"><div class="bar__ok" style="left:${pct(p.range[0])}%;right:${100 - pct(p.range[1])}%"></div><div class="bar__you" style="left:${pct(p.v)}%"></div></div></div>`;
      }).join("")}</div><span class="size__verdict v-${r.vd}">${LABEL[r.vd]}</span>`;
      wrap.appendChild(el);
    });
    $("#fitEst").hidden = !Object.keys(u.est).length;
  }

  draw();
})();
