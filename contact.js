(function () {
  "use strict";
  const form = document.querySelector("#contactForm"), submit = document.querySelector("#contactSubmit");
  const note = document.querySelector("#contactNote"), done = document.querySelector("#contactDone");
  let sending = false;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (sending || form.elements.website.value) return;
    const data = Object.fromEntries(new FormData(form));
    data.email = data.email.trim(); data.message = data.message.trim(); data.name = data.name.trim();
    const invalid = (message, field) => { note.textContent = message; field.focus(); };
    if (!data.email || data.email.length > 254 || !form.elements.email.validity.valid) return invalid("Please enter a valid email address.", form.elements.email);
    if (data.message.length < 10 || data.message.length > 3000) return invalid("Please enter a message between 10 and 3,000 characters.", form.elements.message);
    if (data.name.length > 80) return invalid("Please keep your name or company within 80 characters.", form.elements.name);
    if (!form.elements.agreePrivacy.checked) return invalid("Please agree to the Privacy Notice before sending your message.", form.elements.agreePrivacy);
    data.agreePrivacy = "Y"; data.submittedAt = new Date().toISOString();
    sending = true; submit.disabled = true; submit.textContent = "Sending your message…"; note.textContent = "";
    try {
      await window.THEPIT_DELIVERY.send(data, "contact", window.THEPIT_CONFIG);
      form.hidden = true; done.hidden = false; done.focus();
    } catch (error) { note.textContent = error.message; }
    finally { sending = false; submit.disabled = false; submit.textContent = "Send message ↗"; }
  });
  document.querySelector("#contactAgain").addEventListener("click", () => {
    form.reset(); note.textContent = ""; done.hidden = true; form.hidden = false; form.elements.email.focus();
  });
})();
