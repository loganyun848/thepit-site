import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = file => readFileSync(new URL('../../../' + file, import.meta.url), 'utf8');
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1cAAAAASUVORK5CYII=';
const detail = { stage: 'front', images: [image, '', '', ''], original: image, face: image, height: 180, size: 'XL', outfit: 'UNIQLO · Sweater · XL' };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

function setup(home = false) {
  const dom = new JSDOM(read(home ? 'index.html' : 'fit.html'), { url: 'https://the-pit.site/' + (home ? 'index.html' : 'fit.html'), runScripts: 'outside-only' });
  const w = dom.window, requests = [], deliveries = [];
  let failForm = false, failGeneration = false, failDelivery = false, blockForm = null;
  w.THEPIT_CONFIG = { TRYON_ENDPOINT: 'https://worker.test', TRYON_TURNSTILE_SITE_KEY: 'fixture', YOUTUBE_CHANNEL_URL: 'https://www.youtube.com/@the_pit_video' };
  w.AbortSignal = AbortSignal;
  w.matchMedia = () => ({ matches: true });
  w.HTMLElement.prototype.scrollIntoView = function () { w.lastScrolled = this.id; };
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, fillRect() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => image;
  w.Image = class { naturalWidth = 20; naturalHeight = 20; decode() { return Promise.resolve(); } };
  w.turnstile = { render(el, options) { queueMicrotask(() => options.callback('fixture-token')); return el.id; }, remove() {}, reset() {} };
  w.fetch = async (url, options) => {
    requests.push({ url, method: options?.method || 'GET' });
    if (url.startsWith('./index.html')) {
      if (blockForm) await blockForm;
      return new Response(read('index.html'), { status: failForm ? 503 : 200 });
    }
    if (url.endsWith('/health')) return Response.json({ ready: true, features: ['character', 'character-sheet'], characterAppearance: 'production-avatar-v2' });
    return Response.json(failGeneration ? { ok: false, error: 'Fixture rejection' } : { ok: true, image, appearance: 'production-avatar-v2' }, { status: failGeneration ? 503 : 200 });
  };
  w.THEPIT_DELIVERY = { async send(data) { deliveries.push(structuredClone(data)); if (failDelivery) throw Error('Fixture delivery failure'); return { accepted: true }; } };
  w.eval(read('application-form.js'));
  if (home) w.eval(read('app.js'));
  else { w.eval(read('fit-application.js')); w.eval(read('fit-tryon.js')); }
  const $ = id => w.document.getElementById(id);
  return { dom, w, $, requests, deliveries,
    emit(value = detail) { w.dispatchEvent(new w.CustomEvent('avatar:application', { detail: value })); },
    failures(form, generation = false, delivery = false) { failForm = form; failGeneration = generation; failDelivery = delivery; },
    blockForm(promise) { blockForm = promise; },
    async generate() {
      w.FIT_TRYON.open({ photo: image, item: { id: 'test', brand: 'UNIQLO', name: 'Sweater', image, sizing: { rows: [{ label: 'XL' }] } }, user: { height: 180 }, recommendation: { usual: { label: 'XL' } } });
      await settle(); $('tryonConsent').click(); await settle(); $('generateTryon').click(); await settle();
      $('characterConsent').click(); await settle(); $('generateCharacter').click(); await settle();
    },
    fill() {
      const form = $('applyForm');
      for (const [key, value] of Object.entries({ name: 'Fixture', email: 'fixture@example.com', country: 'Test country', ageGroup: '30s', headline: 'UI test only', story: 'A fixture story for local automated checks. '.repeat(4) })) form.elements[key].value = value;
      form.elements.color[0].checked = true;
      for (const key of ['agreeSelf', 'agreePortrait', 'agreePrivacy', 'agreeAge']) form.elements[key].checked = true;
      return form;
    }
  };
}

test('Successful avatar generation opens Apply, keeps studio results and never auto-submits', async () => {
  const s = setup();
  try {
    await s.generate();
    assert.equal(s.$('apply').hidden, false);
    assert.equal(s.w.location.hash, '#apply');
    assert.equal(s.w.document.activeElement.id, 'fitApplyTitle');
    assert.equal(s.$('characterResult').hidden, false);
    assert.equal(s.$('downloadCharacter').hidden, false);
    assert.equal(s.$('applyForm').elements.height.value, '180');
    assert.equal(s.$('applyForm').elements.size.value, 'XL');
    assert.equal(s.$('applyForm').elements.agreePrivacy.checked, false);
    assert.equal(s.$('fitApplicationSummary').querySelectorAll('img').length, 1);
    assert.equal(s.deliveries.length, 0);
    assert.deepEqual(s.requests.filter(r => r.method === 'POST').map(r => r.url), ['https://worker.test/tryon', 'https://worker.test/character']);
  } finally { s.dom.window.close(); }
});

test('Reference and model completion updates the same form; explicit Submit attaches the current references', async () => {
  const s = setup();
  try {
    s.emit(); await settle(); s.fill();
    s.emit({ ...detail, stage: 'model', images: [image, image, image, image] }); await settle();
    assert.equal(s.$('applyForm').elements.name.value, 'Fixture');
    assert.equal(s.$('fitApplicationSummary').querySelectorAll('img').length, 4);
    s.$('submitBtn').click(); await settle();
    assert.equal(s.deliveries.length, 1);
    assert.equal(s.deliveries[0].avatarStage, '3D avatar ready');
    assert.deepEqual(s.deliveries[0].photos.map(p => p.key).sort(), ['avatar_back', 'avatar_front', 'avatar_left', 'avatar_right', 'body', 'face']);
    assert.equal(s.$('doneBox').hidden, false);
    assert.equal(s.$('applyForm').hidden, true);
  } finally { s.dom.window.close(); }
});

test('Changing the source clears stale attachments and keeps the entered story', async () => {
  const s = setup();
  try {
    s.emit(); await settle(); s.fill();
    s.w.FIT_TRYON.clear();
    assert.equal(s.$('apply').hidden, true);
    assert.equal(s.$('applyForm').elements.agreePrivacy.checked, false);
    assert.equal(s.$('applyForm').applicationController.collect().photos.length, 0);
    assert.equal(s.$('fitApplicationSummary').querySelectorAll('img').length, 0);
    s.emit({ ...detail, height: 170, size: 'L', face: '' }); await settle();
    assert.equal(s.$('applyForm').elements.name.value, 'Fixture');
    assert.equal(s.$('applyForm').elements.height.value, '170');
    assert.equal(s.$('applyForm').applicationController.collect().photos.find(p => p.key === 'face').dataUrl, image);
    assert.equal(s.deliveries.length, 0);
  } finally { s.dom.window.close(); }
});

test('Late form responses cannot reopen an application for a discarded avatar', async () => {
  const s = setup();
  try {
    let release; s.blockForm(new Promise(resolve => { release = resolve; }));
    s.emit(); s.emit(null); release(); await settle();
    assert.equal(s.$('apply').hidden, true);
    assert.equal(s.w.location.hash, '');
    assert.equal(s.deliveries.length, 0);
  } finally { s.dom.window.close(); }
});

test('Form-load failure can retry without generating again; generation failure never opens Apply', async () => {
  const s = setup();
  try {
    s.failures(true); s.emit(); await settle();
    assert.equal(s.$('retryApplication').hidden, false);
    s.failures(false); s.$('retryApplication').click(); await settle();
    assert.ok(s.$('applyForm')); assert.equal(s.requests.filter(r => r.method === 'POST').length, 0);
    s.w.FIT_TRYON.clear(); s.failures(false, true); await s.generate();
    assert.equal(s.$('apply').hidden, true);
    assert.equal(s.deliveries.length, 0);
  } finally { s.dom.window.close(); }
});

test('Home keeps required photo/consent validation and retains fields after a delivery failure', async () => {
  const s = setup(true);
  try {
    const controller = s.$('applyForm').applicationController;
    s.fill(); s.$('submitBtn').click(); await settle(); assert.equal(s.deliveries.length, 0);
    controller.suggestPhoto('face', image); controller.suggestPhoto('body', image);
    s.$('applyForm').elements.agreePrivacy.checked = false;
    s.$('submitBtn').click(); await settle(); assert.equal(s.deliveries.length, 0);
    s.$('applyForm').elements.agreePrivacy.checked = true; s.failures(false, false, true);
    s.$('submitBtn').click(); await settle();
    assert.equal(s.$('doneBox').hidden, true); assert.equal(s.$('applyForm').elements.name.value, 'Fixture');
    s.failures(false); s.$('submitBtn').click(); await settle();
    assert.equal(s.$('doneBox').hidden, false);
    s.$('doneAgain').click(); assert.equal(controller.collect().photos.length, 0);
  } finally { s.dom.window.close(); }
});

test('Fit Room accepts required answers with no optional face reference or optional answers', async () => {
  const s = setup();
  try {
    s.emit({ ...detail, face: '' }); await settle();
    const form = s.fill();
    form.elements.story.value = 'Ten letters';
    form.elements.color[1].checked = true;
    for (const key of ['sns', 'place', 'toGolky', 'height', 'size']) form.elements[key].value = '';
    assert.equal(form.applicationController.validate(), '');
    s.$('submitBtn').click(); await settle();
    assert.equal(s.deliveries.length, 1, s.$('applicationNote').textContent);
    assert.equal(s.deliveries[0].photos.find(p => p.key === 'face').dataUrl, detail.original);
    assert.equal(s.deliveries[0].agreeNews, 'N');
  } finally { s.dom.window.close(); }
});

test('Home accepts all optional fields blank while keeping the two required photos', async () => {
  const s = setup(true);
  try {
    const form = s.fill();
    form.applicationController.suggestPhoto('face', image);
    form.applicationController.suggestPhoto('body', image);
    s.$('submitBtn').click(); await settle();
    assert.equal(s.deliveries.length, 1);
    assert.equal(s.deliveries[0].style, '');
    assert.equal(s.deliveries[0].agreeNews, 'N');
    assert.deepEqual(s.deliveries[0].photos.map(p => p.key), ['face', 'body']);
  } finally { s.dom.window.close(); }
});

test('Missing photos have visible errors and focus; valid changes clear them', async () => {
  const s = setup(true);
  try {
    const form = s.fill(), controller = form.applicationController;
    s.$('submitBtn').click(); await settle();
    assert.match(s.$('applicationNote').textContent, /face photo.*Full-body photo/i);
    const button = s.$('photoFace').closest('.upload').querySelector('.upload__box');
    assert.equal(s.w.document.activeElement, button);
    assert.equal(button.getAttribute('aria-invalid'), 'true');
    assert.equal(s.$('apply-error-photoFace').hidden, false);
    controller.suggestPhoto('face', image); controller.suggestPhoto('body', image);
    assert.equal(s.$('applicationNote').textContent, '');
    assert.equal(button.hasAttribute('aria-invalid'), false);
    assert.equal(s.$('apply-error-photoFace').hidden, true);
    assert.equal(s.deliveries.length, 0);
  } finally { s.dom.window.close(); }
});

test('Required answer and consent failures name the exact field and preserve entered data', async () => {
  const s = setup();
  try {
    s.emit(); await settle(); const form = s.fill();
    assert.equal(form.noValidate, true);
    form.elements.email.value = 'invalid-email';
    form.elements.agreePrivacy.checked = false;
    s.$('submitBtn').click(); await settle();
    assert.match(s.$('applicationNote').textContent, /valid email.*Privacy consent/);
    assert.equal(s.deliveries.length, 0);
    form.elements.email.value = 'fixture@example.com';
    form.elements.agreePrivacy.click();
    assert.equal(s.$('applicationNote').textContent, '');
    form.elements.story.value = '123456789';
    s.$('submitBtn').click(); await settle();
    assert.match(s.$('applicationNote').textContent, /at least 10 characters/);
    assert.equal(s.deliveries.length, 0);
    form.elements.story.value += '0';
    form.elements.story.dispatchEvent(new s.w.Event('input', { bubbles: true }));
    assert.equal(s.$('applicationNote').textContent, '');
    s.$('submitBtn').click(); await settle();
    assert.equal(s.deliveries.length, 1);
    assert.equal(s.deliveries[0].story, '1234567890');
  } finally { s.dom.window.close(); }
});
