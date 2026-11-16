/* Keep generation results in this tab while opening the existing application form. */
(function () {
  'use strict';
  const section = document.getElementById('apply');
  const content = document.getElementById('fitApplicationContent');
  const loadStatus = document.getElementById('fitApplicationStatus');
  const retry = document.getElementById('retryApplication');
  const nav = document.getElementById('fitApplyLink');
  let draft = null, revision = 0, loading = null, controller = null;
  const imagePattern = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  const labels = ['Front', 'Left', 'Back', 'Right'];
  const stages = { front: 'Front-view avatar ready', references: 'Four reference views ready', model: '3D avatar ready' };

  function suggest() {
    if (!draft || !controller) return;
    controller.suggestPhoto('body', draft.original);
    controller.suggestPhoto('face', draft.face);
    controller.suggestField('height', draft.height);
    controller.suggestField('size', /^(XXL|[3-9]XL)$/.test(draft.size) ? '2XL+' : draft.size);
  }
  async function mount() {
    if (controller) return;
    if (loading) return loading;
    loadStatus.textContent = 'Opening your application…'; retry.hidden = true;
    loading = (async () => {
      const response = await fetch('./index.html?v=20261117-apply1', { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error('Application form could not be loaded. Your avatar is still available above.');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const template = page.querySelector('#apply > .container');
      if (!template?.querySelector('#applyForm') || !template.querySelector('#doneBox')) throw Error('Application form is unavailable. Your avatar has been kept.');
      const clone = document.importNode(template, true);
      clone.querySelectorAll('.reveal').forEach(node => node.classList.remove('reveal'));
      const heading = clone.querySelector('h2'); heading.id = 'fitApplyTitle'; heading.tabIndex = -1;
      heading.textContent = 'Your avatar is ready. Your story is next.';
      clone.querySelector('.eyebrow').textContent = '05 / APPLY WITH YOUR AVATAR';
      clone.querySelector('.sub').textContent = 'Review your images, add your story and contact details, then submit your application. Nothing is sent until you choose Submit.';
      const summary = document.createElement('div'); summary.className = 'fit-application-summary'; summary.id = 'fitApplicationSummary';
      clone.querySelector('#applyForm').before(summary);
      clone.querySelector('#doneYoutube').href = window.THEPIT_CONFIG.YOUTUBE_CHANNEL_URL;
      clone.querySelector('.form__fine').textContent = 'Your application, selected photos and the avatar references shown above are sent to ceo@lecple.com through FormSubmit. 3D model files are not attached; save them from the avatar studio.';
      const privacy = clone.querySelector('[name="agreePrivacy"]').closest('label').querySelector('span');
      privacy.append(document.createTextNode(' This includes the generated avatar references shown above.'));
      clone.querySelector('#doneMsg').textContent = 'Your application and avatar references have been received. We will contact you at the email address you entered.';
      content.replaceChildren(clone);
      controller = window.THEPIT_APPLICATION.mount(content, {
        beforeSubmit(data) {
          if (!draft) throw Error('Your avatar has changed. Finish generating the new avatar before applying.');
          data.source = 'Fit Room'; data.avatarStage = stages[draft.stage];
          data.outfit = draft.outfit; data.referenceViews = draft.images.filter(Boolean).length;
          data.modelDelivery = draft.stage === 'model' ? '3D model generated; model file not attached' : 'Image references only; no 3D model attached';
          draft.images.forEach((dataUrl, i) => {
            if (dataUrl) data.photos.push({ key: 'avatar_' + labels[i].toLowerCase(), dataUrl });
          });
        },
        afterReset: suggest
      });
      loadStatus.textContent = '';
    })();
    try { await loading; } finally { loading = null; }
  }
  function renderSummary() {
    const summary = content.querySelector('#fitApplicationSummary');
    const title = document.createElement('h3'); title.textContent = stages[draft.stage];
    const outfit = document.createElement('p'); outfit.textContent = draft.outfit;
    const grid = document.createElement('div'); grid.className = 'fit-application-images';
    draft.images.forEach((src, i) => {
      if (!src) return;
      const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption');
      image.src = src; image.alt = labels[i] + ' avatar reference included with this application';
      caption.textContent = labels[i]; figure.append(image, caption); grid.append(figure);
    });
    const note = document.createElement('p'); note.className = 'fit-hint';
    note.textContent = 'These avatar images will be included with your application. Check the face and full-body photos below, and replace them if needed. You can return to the studio without losing this form.';
    const back = document.createElement('a'); back.href = draft.stage === 'model' ? '#avatarViewerWorkspace' : '#character';
    back.className = 'btn btn--ghost'; back.textContent = 'Back to avatar · Review & save ↑';
    summary.replaceChildren(title, outfit, grid, note, back);
  }
  async function openApplication() {
    if (!draft) return;
    const version = revision;
    section.hidden = false; nav.href = '#apply';
    try {
      await mount();
      if (version !== revision || !draft) return;
      controller.reopen(); suggest(); renderSummary();
      history.replaceState(null, '', '#apply');
      section.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      content.querySelector('#fitApplyTitle').focus({ preventScroll: true });
    } catch (error) {
      if (version !== revision || !draft) return;
      loadStatus.textContent = error.message; retry.hidden = false;
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  window.addEventListener('avatar:application', event => {
    revision++;
    const value = event.detail;
    if (!value) {
      draft = null; section.hidden = true; controller?.clearSuggestions();
      content.querySelector('#fitApplicationSummary')?.replaceChildren();
      nav.href = 'index.html#apply';
      return;
    }
    if (!stages[value.stage] || !Array.isArray(value.images) || value.images.length !== 4 ||
        !imagePattern.test(value.original || '') || !imagePattern.test(value.images[0] || '') ||
        value.images.some(src => src && !imagePattern.test(src))) return;
    draft = { ...value, images: [...value.images] };
    void openApplication();
  });
  retry.addEventListener('click', () => void openApplication());
  nav.addEventListener('click', event => { if (draft) { event.preventDefault(); void openApplication(); } });
})();
