import CATALOG from './catalog.json' with { type: 'json' };
import { STYLE_REFERENCE, characterPrompt } from './character-style.mjs';

const MODEL_URL = 'https://fal.run/fal-ai/fashn/tryon/v1.6';
const CHARACTER_URL = 'https://fal.run/fal-ai/flux-2-pro/edit';
const MAX_INPUT = 12 * 1024 * 1024;
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
  if (typeof value !== 'string' || !value) throw fail(400, '사진을 다시 선택해 주세요.');
  if (value.length > Math.ceil(limit * 4 / 3) + 100) throw fail(413, '사진 용량을 줄여 다시 선택해 주세요.');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw fail(400, 'JPG, PNG 또는 WEBP 사진을 선택해 주세요.');
  let bytes;
  try { bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)); } catch (_) { throw fail(400, '사진 파일을 읽을 수 없습니다.'); }
  if (bytes.length > limit || imageType(bytes) !== match[1]) throw fail(400, '올바른 이미지 파일을 선택해 주세요.');
  return value;
}
async function readBytes(body, max) {
  if (!body) throw fail(400, '전송할 사진을 확인해 주세요.');
  const reader = body.getReader(), chunks = []; let total = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > max) { await reader.cancel(); throw fail(413, '사진 용량이 너무 큽니다.'); } chunks.push(value); }
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
    if (origin && !allowed.includes(origin)) return json({ ok: false, error: '허용되지 않은 사이트입니다.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const ready = !!(env.FAL_KEY && env.TURNSTILE_SECRET && env.TRYON_GATE);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ready, provider: 'fal.ai', features: ['tryon', 'character'], revision:'20261116-photo-fetch' }, 200, cors);
    if (!['/tryon', '/character'].includes(url.pathname) || request.method !== 'POST') return json({ ok: false, error: '찾을 수 없는 요청입니다.' }, 404, cors);
    if (!origin || !allowed.includes(origin)) return json({ ok: false, error: '웹사이트에서 다시 요청해 주세요.' }, 403, cors);
    if (!ready) return json({ ok: false, error: '가상착용 AI 연결을 준비하고 있습니다.' }, 503, cors);
    let reservation, releaseQuota = false;
    try {
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw fail(415, '올바른 형식으로 다시 요청해 주세요.');
      let data; try { data = JSON.parse(new TextDecoder().decode(await readBytes(request.body, MAX_INPUT))); } catch (error) { if (error.status) throw error; throw fail(400, '요청을 읽을 수 없습니다.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail(400, '올바른 요청으로 다시 시도해 주세요.');
      if (data.consent !== true) throw fail(400, '사진 전송 동의가 필요합니다.');
      const item = CATALOG.find(product => product.id === data.itemId);
      if (!item) throw fail(400, '카탈로그에서 옷을 다시 선택해 주세요.');
      const photo = validatePhoto(data.photo);
      const isCharacter = url.pathname === '/character';
      const original = isCharacter ? validatePhoto(data.original) : null;
      const prompt = isCharacter ? characterPrompt(data.scene) : null;
      if (isCharacter && !prompt) throw fail(400, '캐릭터 배경을 목록에서 선택해 주세요.');
      if (!/^[a-f0-9-]{36}$/i.test(data.requestId || '') || typeof data.token !== 'string' || !data.token || data.token.length > 2048) throw fail(400, '보안 확인을 다시 진행해 주세요.');
      const verification = await network('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000), body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: data.token, remoteip: request.headers.get('CF-Connecting-IP') || undefined }) });
      const verified = await verification.json();
      if (!verification.ok || !verified.success || verified.action !== 'fit-studio' || verified.hostname !== new URL(origin).hostname) throw fail(403, '보안 확인이 만료되었거나 실패했습니다. 다시 확인해 주세요.');
      const day = new Date().toISOString().slice(0,10);
      const hashed = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}:${request.headers.get('CF-Connecting-IP') || 'unknown'}:${env.FAL_KEY}`));
      const visitor = [...new Uint8Array(hashed)].map(value => value.toString(16).padStart(2, '0')).join('');
      const gate = env.TRYON_GATE.get(env.TRYON_GATE.idFromName('global'));
      let input;
      if (isCharacter) {
        input = { prompt, image_urls: [photo, original, STYLE_REFERENCE], image_size: { width: 864, height: 1152 }, sync_mode: true, output_format: 'jpeg', enable_safety_checker: true, safety_tolerance: '2' };
      } else {
        // The garment URL comes exclusively from our catalog, never from an arbitrary client URL.
        // Workers supports manual/follow, not redirect:error. Reject 3xx via ok
        // instead of following a redirect beyond the trusted catalog source.
        const garmentResponse = await network(item.image, { signal: AbortSignal.timeout(15000), redirect: 'manual' });
        if (!garmentResponse.ok) throw fail(502, '선택한 상품 사진을 불러오지 못했습니다. 다른 상품을 선택해 주세요.');
        const garmentBytes = await readBytes(garmentResponse.body, 4 * 1024 * 1024), mime = imageType(garmentBytes);
        if (!mime) throw fail(502, '선택한 상품 사진 형식을 확인할 수 없습니다.');
        input = { model_image: photo, garment_image: toDataURI(garmentBytes, mime), category: item.cat === 'bottom' ? 'bottoms' : 'tops', mode: 'quality', garment_photo_type: 'auto', num_samples: 1, sync_mode: true, output_format: 'jpeg', enable_safety_checker: true, moderation_level: 'conservative' };
      }
      const permit = await gate.fetch('https://gate/permit', { method: 'POST', body: JSON.stringify({ visitor, requestId: data.requestId, stage: isCharacter ? 'character' : 'tryon' }) });
      if (!permit.ok) {
        if (![409,429].includes(permit.status)) throw fail(503, '생성 횟수 확인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', {code:'QUOTA_UNAVAILABLE'});
        const limit = await permit.json();
        const retryAfter = Math.max(1, Number(limit.retryAfter) || 60);
        const messages = {
          COOLDOWN: `연속 요청을 방지하기 위해 ${retryAfter}초 후 다시 생성할 수 있습니다.`,
          VISITOR_DAILY_LIMIT: `오늘 이용 가능한 생성 횟수(${quotaLimits(env).visitor}회)에 도달했습니다. 한국 시간 오전 9시에 초기화됩니다.`,
          DAILY_LIMIT: '오늘 서비스 전체 생성 한도에 도달했습니다. 한국 시간 오전 9시에 초기화됩니다.',
          DUPLICATE_REQUEST: '이미 접수한 요청입니다. 결과를 기다린 후 다시 시도해 주세요.',
        };
        throw fail(permit.status, messages[limit.code] || '현재 생성 요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.', {code:messages[limit.code]?limit.code:'QUOTA_DENIED',retryAfter});
      }
      reservation = { gate, visitor, requestId: data.requestId };
      const response = await network(isCharacter ? CHARACTER_URL : MODEL_URL, { method: 'POST', signal: AbortSignal.timeout(120000), headers: {
        Authorization: `Key ${env.FAL_KEY}`, 'Content-Type': 'application/json', 'X-Fal-Store-IO': '0', 'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: 3600 }),
      }, body: JSON.stringify(input) });
      if (!response.ok) {
        // Definite provider rejections did not start generation. Timeouts and 5xx
        // remain charged against the safety cap because their outcome is unknown.
        releaseQuota = [400,401,402,403,422,429].includes(response.status);
        if ([401,402,403].includes(response.status)) {
          const detail = await response.text();
          if (response.status === 402 || /exhausted balance|insufficient.*(?:balance|credit)|top up/i.test(detail)) throw fail(503, 'AI 생성 서비스의 이용 잔액이 부족합니다. 운영자의 fal.ai 크레딧 충전 후 다시 이용할 수 있습니다.', {code:'PROVIDER_BALANCE'});
          if (response.status === 401 || /no user found|invalid.*key|unauthorized/i.test(detail)) throw fail(503, 'AI 연결 키 인증에 실패했습니다. 운영자의 키 설정 확인이 필요합니다.', {code:'PROVIDER_AUTH'});
          throw fail(503, 'AI 생성 권한이 없습니다. 운영자의 API 키 권한과 모델 접근 설정 확인이 필요합니다.', {code:'PROVIDER_PERMISSION'});
        }
        if (response.status === 422) throw fail(422, '이 사진으로 이미지를 만들 수 없습니다. 정면에서 혼자 찍은 다른 사진을 사용해 주세요.');
        if (response.status === 429) throw fail(429, 'AI 서비스가 혼잡합니다. 잠시 후 다시 시도해 주세요.');
        throw fail(502, 'AI가 이미지를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
      const output = await response.json(); const image = validatePhoto(output.images?.[0]?.url, 10 * 1024 * 1024);
      return json({ ok: true, image }, 200, cors);
    } catch (error) {
      if (reservation && releaseQuota) {
        try {
          const released = await reservation.gate.fetch('https://gate/release', {method:'POST',body:JSON.stringify({visitor:reservation.visitor,requestId:reservation.requestId})});
          if (released.ok && (await released.json()).released === true) error.message += ' 이번 요청은 생성 횟수에서 차감하지 않습니다.';
        } catch (_) { /* Keep the safety cap if storage is unavailable. */ }
      }
      return json({ ok: false, error: error.status ? error.message : '이미지 생성 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', code:error.code, retryAfter:error.retryAfter }, error.status || 502, {...cors,...(error.retryAfter?{'Retry-After':String(error.retryAfter)}:{})});
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
