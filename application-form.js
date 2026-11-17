/* Shared application form for Home and Fit Room. No transmission until Submit. */
(function () {
  "use strict";
  function mount(scope = document, options = {}) {
  const CFG = window.THEPIT_CONFIG || {};
  const $ = (selector, parent = scope) => parent.querySelector(selector);
  const $$ = (selector, parent = scope) => Array.from(parent.querySelectorAll(selector));
  if (!$("#applyForm")) throw Error("The application form is unavailable.");
  if ($("#applyForm").applicationController) return $("#applyForm").applicationController;
  /* ── 글자 수 카운터 ── */
  const story = $("textarea[name=story]"), counter = $("#storyCount");
  const updateCount = () => {
    const n = story.value.length;
    counter.textContent = `${n} / 1200`;
    counter.classList.toggle("ok", n >= 10 && n <= 1200);
  };
  story.addEventListener("input", updateCount); updateCount();

  /* ── 사진 업로드 (미리보기 + 리사이즈) ── */
  const MAX_MB = CFG.MAX_PHOTO_MB || 10;
  const MAX_PX = CFG.RESIZE_MAX_PX || 1600;
  const photos = {}; // key -> { name, type, dataUrl }
  const suggestedPhotos = {}, suggestedFields = {}, uploads = {};
  let pendingUploads = 0;

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
    let uploadVersion = 0;
    const showPhoto = photo => {
      if (photo) photos[key] = photo; else delete photos[key];
      if (photo) pimg.src = photo.dataUrl; else pimg.removeAttribute('src');
      preview.hidden = !photo; box.classList.toggle('has-file', !!photo);
      refreshValidation();
    };
    uploads[key] = { show: showPhoto, cancel: () => { uploadVersion++; input.value = ''; } };

    async function setFile(file) {
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return note("Choose a JPG, PNG or WEBP photo.");
      if (file.size > MAX_MB * 1024 * 1024) return note(`Each photo must be ${MAX_MB}MB or smaller.`);
      const version = ++uploadVersion;
      pendingUploads++; submitBtn.disabled = true;
      try {
        const dataUrl = await resizeToDataUrl(file);
        if (version !== uploadVersion) return;
        delete suggestedPhotos[key];
        showPhoto({ name: file.name, type: "image/jpeg", dataUrl });
        if (!validationAttempted) note("");
      } catch (err) { if (version === uploadVersion) note(err.message); }
      finally { pendingUploads--; submitBtn.disabled = sending || pendingUploads > 0; }
    }
    $(".upload__box", box).addEventListener("click", () => input.click());
    input.addEventListener("change", () => setFile(input.files[0]));
    remove.addEventListener("click", () => {
      uploadVersion++; delete suggestedPhotos[key]; input.value = ""; showPhoto(null);
    });
    ["dragenter", "dragover"].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); box.classList.add("drag"); }));
    ["dragleave", "drop"].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); box.classList.remove("drag"); }));
    box.addEventListener("drop", e => setFile(e.dataTransfer.files[0]));
  });

  /* ── 폼 제출 ── */
  const form = $("#applyForm"), noteEl = $("#applicationNote", form) || $("#formNote", form), submitBtn = $("#submitBtn");
  const doneBox = $("#doneBox");
  let sending = false;
  let validationAttempted = false;
  const feedback = new Map();
  const labels = {
    name: 'Name or nickname', email: 'Email', country: 'Country', ageGroup: 'Age group',
    headline: 'One-line intro', story: 'Your story', color: 'Your color',
    photoFace: 'Face photo', photoBody: 'Full-body photo',
    agreeSelf: 'Photo ownership confirmation', agreePortrait: 'Character and publication consent',
    agreePrivacy: 'Privacy consent', agreeAge: 'Age / guardian confirmation'
  };
  function note(msg, ok = false) { noteEl.textContent = msg; noteEl.classList.toggle("ok", ok); }

  function fieldError(el) {
    const label = labels[el.name] || el.name;
    if (el.type === 'checkbox') return el.checked ? '' : `Please confirm: ${label}.`;
    if (el.type === 'radio') return form.elements.namedItem(el.name).value ? '' : `Please select ${label.toLowerCase()}.`;
    if (el.type === 'file') return photos[el.closest('.upload').dataset.key] ? '' : `Please add your ${label.toLowerCase()}.`;
    const value = el.value.trim();
    if (!value) return `Please ${el.tagName === 'SELECT' ? 'select' : 'enter'} ${label.toLowerCase()}.`;
    if (el.minLength > 0 && value.length < el.minLength) return `${label} needs at least ${el.minLength} characters. You have ${value.length}.`;
    if (el.maxLength > 0 && value.length > el.maxLength) return `${label} must be ${el.maxLength} characters or fewer.`;
    if (el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Please enter a valid email address, such as name@example.com.';
    return el.checkValidity() ? '' : `Please check ${label.toLowerCase()}.`;
  }
  function showError(el, message) {
    const wrapper = el.closest('.upload, .field, .check');
    let entry = feedback.get(el);
    if (!entry && message) {
      const error = document.createElement('small');
      error.id = `apply-error-${el.name}`; error.className = 'field-error';
      (el.type === 'checkbox' ? wrapper.querySelector('span') : wrapper).append(error);
      const target = el.type === 'file' ? wrapper.querySelector('.upload__box') : el;
      entry = { error, target, describedBy: target.getAttribute('aria-describedby') || '' };
      feedback.set(el, entry);
    }
    el.classList.toggle('invalid', !!message);
    wrapper.classList.toggle('has-error', !!message);
    if (!entry) return;
    entry.error.textContent = message; entry.error.hidden = !message;
    if (message) {
      entry.target.setAttribute('aria-invalid', 'true');
      entry.target.setAttribute('aria-describedby', `${entry.describedBy} ${entry.error.id}`.trim());
    } else {
      entry.target.removeAttribute('aria-invalid');
      if (entry.describedBy) entry.target.setAttribute('aria-describedby', entry.describedBy);
      else entry.target.removeAttribute('aria-describedby');
    }
  }
  function validate(moveFocus = true) {
    validationAttempted = true;
    const problems = [];
    for (const el of $$("[required]", form)) {
      const message = fieldError(el);
      showError(el, message);
      if (message) problems.push({ el, message });
    }
    if (!problems.length) return '';
    const first = problems[0].el;
    if (moveFocus) {
      first.closest('.upload, .field, .check').scrollIntoView({ behavior: 'smooth', block: 'center' });
      const target = first.type === 'file' ? first.closest('.upload').querySelector('.upload__box') : first;
      try { target.focus({ preventScroll: true }); } catch (_) {}
    }
    return problems[0].message + (problems.length > 1 ? ' Also check: ' + problems.slice(1).map(p => labels[p.el.name] || p.el.name).join(', ') + '.' : '');
  }
  function refreshValidation() { if (validationAttempted && !sending) note(validate(false)); }
  form.addEventListener('input', refreshValidation);
  form.addEventListener('change', refreshValidation);

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
    data.submittedAt = new Date().toISOString();
    return data;
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (sending || pendingUploads || form.elements.website.value) return;
    const err = validate();
    if (err) return note(err);
    const data = collect();

    sending = true; submitBtn.disabled = true; submitBtn.textContent = "Sending your application…"; note("");
    try {
      if (options.beforeSubmit) await options.beforeSubmit(data);
      await window.THEPIT_DELIVERY.send(data, "application", CFG);
      form.hidden = true; doneBox.hidden = false;
      doneBox.scrollIntoView({ behavior: "smooth", block: "center" });
      options.afterSuccess?.();
    } catch (err) {
      note(err.message || "Could not confirm delivery. Your entries have been kept. Please try again later.");
    } finally {
      sending = false; submitBtn.disabled = pendingUploads > 0; submitBtn.textContent = "🔑 Receive the key · Submit application";
    }
  });

  function resetForm() {
    validationAttempted = false;
    for (const el of feedback.keys()) showError(el, '');
    form.reset(); Object.keys(photos).forEach(k => delete photos[k]);
    Object.keys(suggestedPhotos).forEach(k => delete suggestedPhotos[k]);
    Object.keys(suggestedFields).forEach(k => delete suggestedFields[k]);
    Object.values(uploads).forEach(upload => { upload.cancel(); upload.show(null); });
    note('');
    updateCount(); doneBox.hidden = true; form.hidden = false;
  }
  $("#doneAgain").addEventListener("click", () => {
    resetForm(); options.afterReset?.();
    form.scrollIntoView({ behavior: "smooth" });
  });

  return form.applicationController = {
    collect, validate,
    reopen() { if (form.hidden) resetForm(); },
    suggestPhoto(key, dataUrl) {
      if (!uploads[key] || (photos[key] && photos[key] !== suggestedPhotos[key])) return;
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl || '')) return;
      const type = dataUrl.slice(5, dataUrl.indexOf(';'));
      uploads[key].cancel();
      const photo = { name: key, type, dataUrl };
      suggestedPhotos[key] = photo; uploads[key].show(photo);
    },
    suggestField(key, value) {
      const field = form.elements.namedItem(key);
      if (!field || (field.value && field.value !== suggestedFields[key])) return;
      field.value = String(value || ''); suggestedFields[key] = field.value;
    },
    clearSuggestions() {
      for (const key of ['agreeSelf', 'agreePortrait', 'agreePrivacy']) form.elements.namedItem(key).checked = false;
      for (const key of Object.keys(suggestedPhotos)) {
        if (photos[key] === suggestedPhotos[key]) { uploads[key].cancel(); uploads[key].show(null); }
        delete suggestedPhotos[key];
      }
      for (const key of Object.keys(suggestedFields)) {
        if (form.elements.namedItem(key)?.value === suggestedFields[key]) form.elements.namedItem(key).value = '';
        delete suggestedFields[key];
      }
    }
  };
  }
  window.THEPIT_APPLICATION = { mount };
})();
