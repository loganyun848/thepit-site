/* Website-to-inbox delivery. No mailto, email account login, or SMTP secret in the browser. */
(function (root) {
  "use strict";
  const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024;
  const FIELD_NAMES = {
    name: "이름 / Name", country: "국가 / Country", ageGroup: "연령대 / Age group", sns: "SNS",
    headline: "한줄소개 / Introduction", story: "이야기 / Story", color: "색 / Color", style: "스타일 / Style",
    place: "장소 / Place", toGolky: "골키에게 / To Golky", height: "키 / Height", size: "의류 사이즈 / Clothing size",
    agreeSelf: "본인사진 확인", agreePortrait: "초상권 동의", agreePrivacy: "개인정보 동의", agreeAge: "연령 확인",
    agreeNews: "소식 수신 동의", topic: "문의 유형 / Topic", message: "문의 내용 / Message", submittedAt: "제출 시각 / Submitted at"
  };
  function deliveryError(code, message) { const error = new Error(message); error.code = code; return error; }
  function readResponse(body, ok, appsScript) {
    const message = String(body?.message || body?.error || "");
    if (/activat|confirm.*email|verify.*email/i.test(message)) {
      throw deliveryError("activation", "수신 주소 확인이 아직 완료되지 않았습니다. 운영자가 확인을 완료한 뒤 다시 보내 주세요. / The receiving inbox is awaiting activation.");
    }
    const accepted = appsScript ? body?.ok === true : body?.success === true || body?.success === "true";
    if (!ok || !accepted) throw deliveryError("rejected", "접수가 완료되지 않았습니다. 잠시 후 다시 시도해 주세요. / Your submission was not accepted. Please try again later.");
    return { accepted: true, id: body?.id || null };
  }
  function toFormData(data, kind) {
    const body = new FormData();
    const email = String(data.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw deliveryError("email", "회신받을 이메일 주소를 확인해 주세요. / Enter a valid email address.");
    body.set("email", email);
    body.set("_replyto", email);
    body.set("_subject", `[THE PIT ${kind === "application" ? "신청" : "문의"}] ${String(data.headline || data.topic || data.name || "새 접수").replace(/[\r\n]/g, " ").slice(0, 90)}`);
    body.set("_template", "table");
    body.set("_honey", String(data.website || ""));
    body.set("접수 종류", kind === "application" ? "주인공 신청 / Application" : "일반 문의 / Contact");
    for (const [key, label] of Object.entries(FIELD_NAMES)) if (data[key] !== undefined && data[key] !== "") body.set(label, String(data[key]));
    let total = 0;
    for (const [index, photo] of (data.photos || []).entries()) {
      const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(photo.dataUrl || "");
      if (!match) throw deliveryError("photo", "사진을 다시 선택해 주세요. / Please select your photos again.");
      const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
      total += bytes.length;
      if (total > MAX_ATTACHMENTS_BYTES) throw deliveryError("attachment-size", "첨부 사진의 합계가 10 MB를 넘습니다. 사진 크기를 줄여 주세요. / Attachments must total 10 MB or less.");
      const name = `${String(photo.key || index).replace(/[^a-z0-9_-]/gi, "")}.${match[1] === "jpeg" ? "jpg" : match[1]}`;
      body.append(index === 0 ? "attachment" : `attachment${index + 1}`, new Blob([bytes], { type: `image/${match[1]}` }), name);
    }
    return body;
  }
  async function send(data, kind, config, fetchImpl = fetch) {
    const appsScript = kind === "application" && !!config.SUBMIT_ENDPOINT;
    const endpoint = appsScript ? config.SUBMIT_ENDPOINT : config.FORM_ENDPOINT;
    if (!endpoint) throw deliveryError("config", "접수 서버가 연결되지 않았습니다. / The submission service is not connected.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetchImpl(endpoint, appsScript ? {
        method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(data), signal: controller.signal,
      } : { method: "POST", headers: { Accept: "application/json" }, body: toFormData(data, kind), signal: controller.signal });
      let out;
      try { out = await response.json(); } catch (_) { throw deliveryError("response", "전송 결과를 확인하지 못했습니다. 입력 내용은 유지됩니다. / Could not confirm delivery. Your entries have been kept."); }
      return readResponse(out, response.ok, appsScript);
    } catch (error) {
      if (typeof error.code === "string") throw error;
      throw deliveryError("network", "전송 결과를 확인하지 못했습니다. 네트워크를 확인하고 잠시 후 다시 시도해 주세요. / Could not confirm delivery. Check your connection and try again later.");
    } finally { clearTimeout(timeout); }
  }
  const api = { send, toFormData, readResponse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.THEPIT_DELIVERY = api;
})(typeof window !== "undefined" ? window : globalThis);
