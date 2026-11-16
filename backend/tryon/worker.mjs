import CATALOG from './catalog.json' with { type: 'json' };
import { CHARACTER_APPEARANCE, characterPrompt } from './character-style.mjs';
import { submitModel, modelStatus, modelFile } from './avatar-model.mjs';

const MODEL_URL = 'https://fal.run/fal-ai/fashn/tryon/v1.6';
const CHARACTER_URL = 'https://fal.run/fal-ai/flux-2-pro/edit';
const MAX_INPUT = 23 * 1024 * 1024; // Up to four independently bounded reference photos.
const fail = (status, message, details = {}) => Object.assign(new Error(message), { status, ...details });
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
function quotaLimits(env) {
  const limit = (value, fallback) => Number.isInteger(Number(value)) && Number(value) > 0 ? Math.min(1000, Number(value)) : fallback;
  return { daily: limit(env.DAILY_LIMIT, 10), visitor: limit(env.VISITOR_DAILY_LIMIT, 5) };
}
function origins(env) { return String(env.ALLOWED_ORIGINS || 'https://the-pit.site,https://www.the-pit.site').split(',').map(value => value.trim()).filter(Boolean); }
function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if ([137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return 'png';
  if (String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') return 'webp';
  return null;
}
export function validatePhoto(value, limit = 4 * 1024 * 1024) {
  if (typeof value !== 'string' || !value) throw fail(400, 'Please select your photo again.');
  if (value.length > Math.ceil(limit * 4 / 3) + 100) throw fail(413, 'Reduce the photo file size and select it again.');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw fail(400, 'Please choose a JPG, PNG or WEBP photo.');
  let bytes;
  try { bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)); } catch (_) { throw fail(400, 'The photo file could not be read.'); }
  if (bytes.length > limit || imageType(bytes) !== match[1]) throw fail(400, 'Please choose a valid image file.');
  return value;
}
async function readBytes(body, max) {
  if (!body) throw fail(400, 'Please check the photo to be sent.');
  const reader = body.getReader(), chunks = []; let total = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > max) { await reader.cancel(); throw fail(413, 'The photo file is too large.'); } chunks.push(value); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
function toDataURI(bytes, mime) {
  let binary = ''; for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:image/${mime};base64,${btoa(binary)}`;
}
export function createHandler(network = fetch) {
  return async function handle(request, env) {
    const origin = request.headers.get('Origin'), allowed = origins(env), url = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin': origin || allowed[0], 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (origin && !allowed.includes(origin)) return json({ ok: false, error: 'This site is not permitted.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const ready = !!(env.FAL_KEY && env.TURNSTILE_SECRET && env.TRYON_GATE);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ready, provider: 'fal.ai', features: ['tryon', 'character', 'character-sheet', 'avatar-model'], characterAppearance: CHARACTER_APPEARANCE, revision:'20261117-en1', language:'en' }, 200, cors);
    if (!['/tryon', '/character', '/character-view', '/character-model', '/character-model/status', '/character-model/file'].includes(url.pathname) || request.method !== 'POST') return json({ ok: false, error: 'This request was not found.' }, 404, cors);
    if (!origin || !allowed.includes(origin)) return json({ ok: false, error: 'Please submit your request from the website.' }, 403, cors);
    if (!ready) return json({ ok: false, error: 'The AI try-on service is being connected.' }, 503, cors);
    let reservation, releaseQuota = false;
    try {
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw fail(415, 'Please submit the request in the correct format.');
      let data; try { data = JSON.parse(new TextDecoder().decode(await readBytes(request.body, MAX_INPUT))); } catch (error) { if (error.status) throw error; throw fail(400, 'The request could not be read.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail(400, 'Please try again with a valid request.');
      if (url.pathname === '/character-model/status') return json(await modelStatus(data.ticket,env,network),200,cors);
      if (url.pathname === '/character-model/file') return await modelFile(data.ticket,data.format,env,network,cors);
      if (data.consent !== true) throw fail(400, 'Consent to photo processing is required.');
      const item = CATALOG.find(product => product.id === data.itemId);
      if (!item) throw fail(400, 'Please select an outfit from the catalog again.');
      const isModel = url.pathname === '/character-model';
      let modelImages;
      if (isModel) {
        if (data.appearance !== CHARACTER_APPEARANCE || data.approved !== true || data.bodyConfirmed !== true || !Array.isArray(data.images) || data.images.length !== 4) throw fail(400,'Check the front, left, back and right full-body images and consent to 3D generation.');
        modelImages = data.images.map(image => validatePhoto(image));
      }
      const photo = isModel ? modelImages[0] : validatePhoto(data.photo);
      const isView = url.pathname === '/character-view';
      const isCharacter = !isModel && url.pathname !== '/tryon';
      const original = isCharacter ? validatePhoto(data.original) : null;
      const face = isCharacter && data.face ? validatePhoto(data.face) : null;
      const anchor = isView ? validatePhoto(data.anchor) : null;
      if (isView && (data.approved !== true || !Number.isInteger(data.view) || data.view < 1 || data.view > 3)) throw fail(400, 'Approve the front reference before creating four full-body views.');
      if (isView && data.appearance !== CHARACTER_APPEARANCE) throw fail(409, 'The avatar workflow has been updated. Save your existing results, refresh the page and generate a new front reference first.', {code:'CHARACTER_VERSION_CHANGED'});
      const prompt = isCharacter ? characterPrompt(isView ? 'studio' : data.scene, { face: !!face, view: isView ? data.view : null }) : null;
      if (isCharacter && !prompt) throw fail(400, 'Please select an avatar background from the list.');
      if (!/^[a-f0-9-]{36}$/i.test(data.requestId || '') || typeof data.token !== 'string' || !data.token || data.token.length > 2048) throw fail(400, 'Please complete the security check again.');
      const verification = await network('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000), body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: data.token, remoteip: request.headers.get('CF-Connecting-IP') || undefined }) });
      const verified = await verification.json();
      if (!verification.ok || !verified.success || verified.action !== 'fit-studio' || verified.hostname !== new URL(origin).hostname) throw fail(403, 'The security check expired or failed. Please complete it again.');
      const day = new Date().toISOString().slice(0,10);
      const hashed = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}:${request.headers.get('CF-Connecting-IP') || 'unknown'}:${env.FAL_KEY}`));
      const visitor = [...new Uint8Array(hashed)].map(value => value.toString(16).padStart(2, '0')).join('');
      const gate = env.TRYON_GATE.get(env.TRYON_GATE.idFromName('global'));
      let input;
      if (isModel) {
        input = null;
      } else if (isCharacter) {
        input = { prompt, image_urls: [original, ...(face ? [face] : []), photo, ...(anchor ? [anchor] : [])], image_size: { width: 768, height: 1024 }, sync_mode: true, output_format: 'jpeg', enable_safety_checker: true, safety_tolerance: '2' };
      } else {
        // The garment URL comes exclusively from our catalog, never from an arbitrary client URL.
        // Workers supports manual/follow, not redirect:error. Reject 3xx via ok
        // instead of following a redirect beyond the trusted catalog source.
        const garmentResponse = await network(item.image, { signal: AbortSignal.timeout(15000), redirect: 'manual' });
        if (!garmentResponse.ok) throw fail(502, 'The product photo could not be loaded. Please choose another item.');
        const garmentBytes = await readBytes(garmentResponse.body, 4 * 1024 * 1024), mime = imageType(garmentBytes);
        if (!mime) throw fail(502, 'The product image format could not be verified.');
        input = { model_image: photo, garment_image: toDataURI(garmentBytes, mime), category: item.cat === 'bottom' ? 'bottoms' : 'tops', mode: 'quality', garment_photo_type: 'auto', num_samples: 1, sync_mode: true, output_format: 'jpeg', enable_safety_checker: true, moderation_level: 'conservative' };
      }
      const permit = await gate.fetch('https://gate/permit', { method: 'POST', body: JSON.stringify({ visitor, requestId: data.requestId, stage: isModel ? 'avatar-model' : isView ? `character-view-${data.view}` : isCharacter ? 'character' : 'tryon' }) });
      if (!permit.ok) {
        if (![409,429].includes(permit.status)) throw fail(503, 'Usage limits could not be checked. Please try again shortly.', {code:'QUOTA_UNAVAILABLE'});
        const limit = await permit.json();
        const retryAfter = Math.max(1, Number(limit.retryAfter) || 60);
        const messages = {
          COOLDOWN: `Please wait ${retryAfter} seconds before starting another generation.`,
          VISITOR_DAILY_LIMIT: `You have reached your daily limit of ${quotaLimits(env).visitor} generations. It resets at 00:00 UTC.`,
          DAILY_LIMIT: 'The service has reached its daily generation limit. It resets at 00:00 UTC.',
          DUPLICATE_REQUEST: 'This request has already been submitted. Please wait for the result.',
          MODEL_DAILY_LIMIT: 'The daily 3D generation limit has been reached. You can still check existing jobs.',
        };
        throw fail(permit.status, messages[limit.code] || 'Generation is currently unavailable. Please try again shortly.', {code:messages[limit.code]?limit.code:'QUOTA_DENIED',retryAfter});
      }
      reservation = { gate, visitor, requestId: data.requestId };
      if (isModel) return json(await submitModel(modelImages,env,network),202,cors);
      const response = await network(isCharacter ? CHARACTER_URL : MODEL_URL, { method: 'POST', signal: AbortSignal.timeout(120000), headers: {
        Authorization: `Key ${env.FAL_KEY}`, 'Content-Type': 'application/json', 'X-Fal-Store-IO': '0', 'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: 3600 }),
      }, body: JSON.stringify(input) });
      if (!response.ok) {
        // Definite provider rejections did not start generation. Timeouts and 5xx
        // remain charged against the safety cap because their outcome is unknown.
        releaseQuota = [400,401,402,403,422,429].includes(response.status);
        if ([401,402,403].includes(response.status)) {
          const detail = await response.text();
          if (response.status === 402 || /exhausted balance|insufficient.*(?:balance|credit)|top up/i.test(detail)) throw fail(503, 'AI generation is temporarily unavailable because service credits are depleted. The operator needs to add credits.', {code:'PROVIDER_BALANCE'});
          if (response.status === 401 || /no user found|invalid.*key|unauthorized/i.test(detail)) throw fail(503, 'AI service authentication failed. The operator needs to check the API configuration.', {code:'PROVIDER_AUTH'});
          throw fail(503, 'AI generation is not authorized. The operator needs to check API permissions and model access.', {code:'PROVIDER_PERMISSION'});
        }
        if (response.status === 422) throw fail(422, 'This photo could not be processed. Try another front-facing photo of yourself alone.');
        if (response.status === 429) throw fail(429, 'The AI service is busy. Please try again shortly.');
        throw fail(502, 'The AI service could not generate an image. Please try again shortly.');
      }
      const output = await response.json(); const image = validatePhoto(output.images?.[0]?.url, 10 * 1024 * 1024);
      return json({ ok: true, image, ...(isCharacter ? {appearance:CHARACTER_APPEARANCE} : {}), ...(isView ? {view:data.view} : {}) }, 200, cors);
    } catch (error) {
      if (reservation && (releaseQuota || error.releaseQuota)) {
        try {
          const released = await reservation.gate.fetch('https://gate/release', {method:'POST',body:JSON.stringify({visitor:reservation.visitor,requestId:reservation.requestId})});
          if (released.ok && (await released.json()).released === true) error.message += ' This request does not count toward your generation limit.';
        } catch (_) { /* Keep the safety cap if storage is unavailable. */ }
      }
      return json({ ok: false, error: error.status ? error.message : 'The generation result could not be confirmed. Please try again shortly.', code:error.code, retryAfter:error.retryAfter }, error.status || 502, {...cors,...(error.retryAfter?{'Retry-After':String(error.retryAfter)}:{})});
    }
  };
}
export default { fetch: createHandler() };

/* Atomic account-wide daily cap and per-visitor throttling; no photos or measurements are stored. */
export class TryOnGate {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    const { visitor, requestId, stage = 'tryon' } = await request.json(), now = Date.now(), day = new Date(now).toISOString().slice(0,10);
    const action = new URL(request.url).pathname;
    if (!['/permit','/release'].includes(action)) return json({allowed:false},404);
    const { daily: dailyLimit, visitor: visitorLimit } = quotaLimits(this.env);
    const response = await this.ctx.storage.transaction(async txn => {
      let state = await txn.get('quota');
      if (!state || state.day !== day) state = { day, count: 0, visitors: {}, requests: [], reservations: {} };
      state.reservations ||= {};
      if (action === '/release') {
        const entry = state.reservations[requestId];
        if (!entry || entry.visitor !== visitor) return json({released:false},404);
        if (!entry.released) {
          const previous = state.visitors[visitor];
          state.count = Math.max(0,state.count - 1);
          previous.count = Math.max(0,previous.count - 1);
          if (previous.last[entry.stage] === entry.at) delete previous.last[entry.stage];
          entry.released = true;
          await txn.put('quota',state);
        }
        return json({released:true});
      }
      const previous = state.visitors[visitor] || { count: 0, last: {} };
      const resetAfter = Math.ceil((Date.parse(day+'T00:00:00Z') + 86400000 - now) / 1000);
      if (state.requests.includes(requestId)) return json({allowed:false,code:'DUPLICATE_REQUEST',retryAfter:60},409);
      if (stage === 'avatar-model') {
        const models = Object.values(state.reservations).filter(entry => entry.stage === stage && !entry.released);
        if (models.length >= 10 || models.filter(entry => entry.visitor === visitor).length >= 3) return json({allowed:false,code:'MODEL_DAILY_LIMIT',retryAfter:resetAfter},429);
      }
      if (state.count >= dailyLimit) return json({allowed:false,code:'DAILY_LIMIT',retryAfter:resetAfter},429);
      if (previous.count >= visitorLimit) return json({allowed:false,code:'VISITOR_DAILY_LIMIT',retryAfter:resetAfter},429);
      if (now - (previous.last[stage] || 0) < 60000) return json({allowed:false,code:'COOLDOWN',retryAfter:Math.ceil((60000 - (now - previous.last[stage]))/1000)},429);
      state.count++; state.requests.push(requestId); state.visitors[visitor] = { count: previous.count + 1, last: { ...previous.last, [stage]: now } };
      state.reservations[requestId] = {visitor,stage,at:now,released:false};
      await txn.put('quota', state);
      return json({ allowed: true });
    });
    if (response.ok) await this.ctx.storage.setAlarm(now + 86400000);
    return response;
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}
