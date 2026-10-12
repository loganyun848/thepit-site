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
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Couldn't read that image")); };
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
      if (!file.type.startsWith("image/")) return note("Only image files can be uploaded.");
      if (file.size > MAX_MB * 1024 * 1024) return note(`Each photo must be ${MAX_MB}MB or smaller.`);
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
      if (first === s && s.value.length < 100) return "Please write at least 100 characters for your story. You have " + s.value.length + " so far.";
      return "Please fill in every field marked with *.";
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
      "[THE PIT application]", "",
      `Name/nickname: ${data.name}`, `Email: ${data.email}`, `Country: ${data.country}`, `Age group: ${data.ageGroup}`,
      `Social: ${data.sns}`, "",
      `One-line intro: ${data.headline}`, `Color: ${data.color}`, `Style: ${data.style}`, `Place: ${data.place}`, `To Golky: ${data.toGolky}`,
      `Height: ${data.height}`, `Size: ${data.size}`, "",
      "My story:", data.story, "",
      "* Please attach your face photo and full-body photo to this email.",
      "* Confirmed: photos are of me / consent to character creation & publication / privacy policy / age 14+ (guardian consent if under 19)",
    ].join("\n");
    return `mailto:${CFG.CONTACT_EMAIL}?subject=${encodeURIComponent("[THE PIT] Application - " + data.name)}&body=${encodeURIComponent(body)}`;
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (form.website.value) return; // 봇
    const err = validate();
    if (err) return note(err);
    const data = collect();

    if (!CFG.SUBMIT_ENDPOINT) {
      note(`Online submissions are almost ready. For now, <a href="${buildMailFallback(data)}">apply by email</a> and attach your two photos.`, true);
      return;
    }

    submitBtn.disabled = true; submitBtn.textContent = "Turning the key…"; note("");
    try {
      const res = await fetch(CFG.SUBMIT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // Apps Script CORS 프리플라이트 회피
        body: JSON.stringify(data),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error || "server error");
      form.hidden = true; doneBox.hidden = false;
      doneBox.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      note(`Something went wrong (${err.message}). Please try again in a moment, or <a href="${buildMailFallback(data)}">apply by email</a>.`);
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = "🔑 Receive the key · Submit application";
    }
  });

  $("#doneAgain").addEventListener("click", () => {
    form.reset(); Object.keys(photos).forEach(k => delete photos[k]);
    $$(".upload").forEach(b => { b.classList.remove("has-file"); $(".upload__preview", b).hidden = true; });
    updateCount(); doneBox.hidden = true; form.hidden = false;
    form.scrollIntoView({ behavior: "smooth" });
  });
})();
