/* THE PIT — 프런트 동작 (외부 라이브러리 없음) */
(function () {
  "use strict";
  const CFG = window.THEPIT_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  /* ── 설정값을 링크에 반영 ── */
  const yt = CFG.YOUTUBE_CHANNEL_URL || "#";
  const trailer = CFG.TRAILER_URL || yt;
  ["trailerBtn", "trailerThumb", "ep0"].forEach(id => { const a = $("#" + id); if (a) a.href = trailer; });
  ["footYoutube", "doneYoutube"].forEach(id => { const a = $("#" + id); if (a) a.href = yt; });
  if (CFG.INSTAGRAM_URL) { const a = $("#footInsta"); a.href = CFG.INSTAGRAM_URL; a.hidden = false; }
  const mail = "mailto:" + (CFG.CONTACT_EMAIL || "");
  ["footMail", "faqMail"].forEach(id => { const a = $("#" + id); if (a) a.href = mail; });
  if (CFG.ROUND_NOTICE) { $("#noticeText").textContent = CFG.ROUND_NOTICE; $("#notice").hidden = false; }

  /* ── 내비 토글 ── */
  const toggle = $("#navToggle"), links = $("#navLinks");
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  links.addEventListener("click", e => { if (e.target.tagName === "A") { links.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); } });

  /* ── 스크롤 리빌 ── */
  if ("IntersectionObserver" in window) {
    document.documentElement.classList.add("js");
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { threshold: 0.08, rootMargin: "0px 0px -5% 0px" });
    $$(".reveal").forEach(el => io.observe(el));
    // 안전장치: 어떤 이유로든 관찰이 안 되면 3초 후 전부 표시
    setTimeout(() => $$(".reveal:not(.in)").forEach(el => el.classList.add("in")), 3000);
  }

  /* ── 글자 수 카운터 ── */
  const story = $("textarea[name=story]"), counter = $("#storyCount");
  const updateCount = () => {
    const n = story.value.length;
    counter.textContent = `${n} / 1200`;
    counter.classList.toggle("ok", n >= 100 && n <= 1200);
  };
  story.addEventListener("input", updateCount); updateCount();

  /* ── 사진 업로드 (미리보기 + 리사이즈) ── */
  const MAX_MB = CFG.MAX_PHOTO_MB || 10;
  const MAX_PX = CFG.RESIZE_MAX_PX || 1600;
  const photos = {}; // key -> { name, type, dataUrl }

  function readAsImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("이미지를 읽을 수 없습니다")); };
      img.src = url;
    });
  }
  async function resizeToDataUrl(file) {
    const img = await readAsImage(file);
    let { width: w, height: h } = img;
    const scale = Math.min(1, MAX_PX / Math.max(w, h));
    w = Math.round(w * scale); h = Math.round(h * scale);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.86);
  }

  $$(".upload").forEach(box => {
    const key = box.dataset.key;
    const input = $("input[type=file]", box);
    const preview = $(".upload__preview", box);
    const pimg = $("img", preview);
    const remove = $(".upload__remove", box);

    async function setFile(file) {
      if (!file) return;
      if (!file.type.startsWith("image/")) return note("이미지 파일만 올릴 수 있어요.");
      if (file.size > MAX_MB * 1024 * 1024) return note(`사진 1장은 ${MAX_MB}MB 이하여야 해요.`);
      try {
        const dataUrl = await resizeToDataUrl(file);
        photos[key] = { name: file.name, type: "image/jpeg", dataUrl };
        pimg.src = dataUrl; preview.hidden = false; box.classList.add("has-file");
        input.classList.remove("invalid"); note("");
      } catch (err) { note(err.message); }
    }
    input.addEventListener("change", () => setFile(input.files[0]));
    remove.addEventListener("click", () => {
      delete photos[key]; input.value = ""; pimg.src = ""; preview.hidden = true; box.classList.remove("has-file");
    });
    ["dragenter", "dragover"].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); box.classList.add("drag"); }));
    ["dragleave", "drop"].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); box.classList.remove("drag"); }));
    box.addEventListener("drop", e => setFile(e.dataTransfer.files[0]));
  });

  /* ── 폼 제출 ── */
  const form = $("#applyForm"), noteEl = $("#formNote"), submitBtn = $("#submitBtn");
  const doneBox = $("#doneBox");
  function note(msg, ok = false) { noteEl.innerHTML = msg; noteEl.classList.toggle("ok", ok); }

  function validate() {
    let first = null;
    $$("[required]", form).forEach(el => el.classList.remove("invalid"));
    for (const el of $$("[required]", form)) {
      let bad = false;
      if (el.type === "checkbox") bad = !el.checked;
      else if (el.type === "radio") bad = !form.querySelector(`input[name="${el.name}"]:checked`);
      else if (el.type === "file") bad = !photos[el.closest(".upload").dataset.key];
      else bad = !el.checkValidity();
      if (bad) { el.classList.add("invalid"); if (!first) first = el; }
    }
    if (first) {
      const target = first.type === "file" ? first.closest(".upload") : (first.type === "radio" || first.type === "checkbox") ? first.closest("label, .field") : first;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      if (first.type !== "file" && first.type !== "radio") try { first.focus({ preventScroll: true }); } catch (_) {}
      const s = $("textarea[name=story]");
      if (first === s && s.value.length < 100) return "이야기를 100자 이상 적어주세요. 지금 " + s.value.length + "자예요.";
      return "별표(*) 항목을 모두 채워주세요.";
    }
    return "";
  }

  function collect() {
    const fd = new FormData(form);
    const data = {};
    for (const [k, v] of fd.entries()) {
      if (v instanceof File) continue;
      if (k === "style") { (data.style = data.style || []).push(v); continue; }
      data[k] = typeof v === "string" ? v.trim() : v;
    }
    data.style = (data.style || []).join(", ");
    ["agreeSelf", "agreePortrait", "agreePrivacy", "agreeAge", "agreeNews"].forEach(k => data[k] = fd.get(k) ? "Y" : "N");
    data.photos = Object.entries(photos).map(([key, p]) => ({ key, name: p.name, type: p.type, dataUrl: p.dataUrl }));
    data.userAgent = navigator.userAgent;
    data.page = location.href;
    data.submittedAt = new Date().toISOString();
    return data;
  }

  function buildMailFallback(data) {
    const body = [
      "[THE PIT 주인공 신청]", "",
      `이름/닉네임: ${data.name}`, `이메일: ${data.email}`, `연락처: ${data.phone}`, `연령대: ${data.ageGroup}`,
      `사는 곳: ${data.city}`, `SNS: ${data.sns}`, "",
      `한 줄 소개: ${data.headline}`, `나의 색: ${data.color}`, `스타일: ${data.style}`, `장소: ${data.place}`, `골키에게: ${data.toGolky}`,
      `키: ${data.height}`, `사이즈: ${data.size}`, "",
      "나의 이야기:", data.story, "",
      "※ 정면 얼굴 사진과 전신 사진을 이 메일에 첨부해 주세요.",
      "※ 본인 사진 확인 / 초상권·캐릭터 제작 동의 / 개인정보 동의 / 만 14세 이상 확인: 동의함",
    ].join("\n");
    return `mailto:${CFG.CONTACT_EMAIL}?subject=${encodeURIComponent("[THE PIT] 주인공 신청 - " + data.name)}&body=${encodeURIComponent(body)}`;
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (form.website.value) return; // 봇
    const err = validate();
    if (err) return note(err);
    const data = collect();

    if (!CFG.SUBMIT_ENDPOINT) {
      note(`온라인 접수 준비 중이에요. <a href="${buildMailFallback(data)}">이메일로 신청하기</a>를 눌러 사진 2장을 첨부해 보내주세요.`, true);
      return;
    }

    submitBtn.disabled = true; submitBtn.textContent = "열쇠를 돌리는 중…"; note("");
    try {
      const res = await fetch(CFG.SUBMIT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // Apps Script CORS 프리플라이트 회피
        body: JSON.stringify(data),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error || "서버 응답 오류");
      form.hidden = true; doneBox.hidden = false;
      doneBox.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      note(`전송에 실패했어요 (${err.message}). 잠시 후 다시 시도하시거나 <a href="${buildMailFallback(data)}">이메일로 신청</a>해 주세요.`);
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = "🔑 열쇠 받기 · 신청 제출";
    }
  });

  $("#doneAgain").addEventListener("click", () => {
    form.reset(); Object.keys(photos).forEach(k => delete photos[k]);
    $$(".upload").forEach(b => { b.classList.remove("has-file"); $(".upload__preview", b).hidden = true; });
    updateCount(); doneBox.hidden = true; form.hidden = false;
    form.scrollIntoView({ behavior: "smooth" });
  });
})();
