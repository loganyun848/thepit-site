/* Website-to-inbox delivery. No mailto, email account login, or SMTP secret in the browser. */
(function (root) {
  "use strict";
  const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024;
  const FIELD_NAMES = {
    name: "Name", country: "Country", ageGroup: "Age group", sns: "SNS",
    headline: "Introduction", story: "Story", color: "Color", style: "Style",
    place: "Place", toGolky: "To Golky", height: "Height", size: "Clothing size",
    agreeSelf: "Photo ownership confirmation", agreePortrait: "Likeness consent", agreePrivacy: "Privacy consent", agreeAge: "Age confirmation",
    agreeNews: "News consent", topic: "Topic", message: "Message", submittedAt: "Submitted at",
    source: "Application source", avatarStage: "Avatar stage", outfit: "Selected outfit",
    referenceViews: "Avatar reference count", modelDelivery: "3D model delivery", productionId: "Production reference"
  };
  function deliveryError(code, message) { const error = new Error(message); error.code = code; return error; }
  function readResponse(body, ok, appsScript) {
    const message = String(body?.message || body?.error || "");
    if (/activat|confirm.*email|verify.*email/i.test(message)) {
      throw deliveryError("activation", "The receiving inbox is awaiting activation. Please try again after the operator completes setup.");
    }
    const accepted = appsScript ? body?.ok === true : body?.success === true || body?.success === "true";
    if (!ok || !accepted) throw deliveryError("rejected", "Your submission was not accepted. Please try again later.");
    return { accepted: true, id: body?.id || null };
  }
  function toFormData(data, kind) {
    const body = new FormData();
    const email = String(data.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw deliveryError("email", "Enter a valid email address.");
    body.set("email", email);
    body.set("_replyto", email);
    body.set("_subject", `[THE PIT ${kind === "application" ? "Application" : "Contact"}] ${String(data.headline || data.topic || data.name || "New submission").replace(/[\r\n]/g, " ").slice(0, 90)}`);
    body.set("_template", "table");
    body.set("_honey", String(data.website || ""));
    body.set("Submission type", kind === "application" ? "Application" : "Contact");
    for (const [key, label] of Object.entries(FIELD_NAMES)) if (data[key] !== undefined && data[key] !== "") body.set(label, String(data[key]));
    let total = 0;
    for (const [index, photo] of (data.photos || []).entries()) {
      const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(photo.dataUrl || "");
      if (!match) throw deliveryError("photo", "Please select your photos again.");
      const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
      total += bytes.length;
      if (total > MAX_ATTACHMENTS_BYTES) throw deliveryError("attachment-size", "Attachments must total 10 MB or less. Please reduce the photo sizes.");
      const name = `${String(photo.key || index).replace(/[^a-z0-9_-]/gi, "")}.${match[1] === "jpeg" ? "jpg" : match[1]}`;
      body.append(index === 0 ? "attachment" : `attachment${index + 1}`, new Blob([bytes], { type: `image/${match[1]}` }), name);
    }
    return body;
  }
  async function send(data, kind, config, fetchImpl = fetch) {
    const appsScript = kind === "application" && !!config.SUBMIT_ENDPOINT;
    const endpoint = appsScript ? config.SUBMIT_ENDPOINT : config.FORM_ENDPOINT;
    if (!endpoint) throw deliveryError("config", "The submission service is not connected.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetchImpl(endpoint, appsScript ? {
        method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(data), signal: controller.signal,
      } : { method: "POST", headers: { Accept: "application/json" }, body: toFormData(data, kind), signal: controller.signal });
      let out;
      try { out = await response.json(); } catch (_) { throw deliveryError("response", "Could not confirm delivery. Your entries have been kept."); }
      return readResponse(out, response.ok, appsScript);
    } catch (error) {
      if (typeof error.code === "string") throw error;
      throw deliveryError("network", "Could not confirm delivery. Check your connection and try again later.");
    } finally { clearTimeout(timeout); }
  }
  const api = { send, toFormData, readResponse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.THEPIT_DELIVERY = api;
})(typeof window !== "undefined" ? window : globalThis);
