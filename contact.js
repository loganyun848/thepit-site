(function () {
  "use strict";
  const form = document.querySelector("#contactForm"), submit = document.querySelector("#contactSubmit");
  const note = document.querySelector("#contactNote"), done = document.querySelector("#contactDone");
  let sending = false;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (sending || form.elements.website.value || !form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    data.email = data.email.trim(); data.message = data.message.trim(); data.name = data.name.trim();
    if (data.message.length < 10) { note.textContent = "문의 내용을 10자 이상 입력해 주세요."; return; }
    data.agreePrivacy = "Y"; data.submittedAt = new Date().toISOString();
    sending = true; submit.disabled = true; submit.textContent = "문의 전송 중…"; note.textContent = "";
    try {
      await window.THEPIT_DELIVERY.send(data, "contact", window.THEPIT_CONFIG);
      form.hidden = true; done.hidden = false; done.focus();
    } catch (error) { note.textContent = error.message; }
    finally { sending = false; submit.disabled = false; submit.textContent = "문의 접수 보내기 ↗"; }
  });
  document.querySelector("#contactAgain").addEventListener("click", () => {
    form.reset(); note.textContent = ""; done.hidden = true; form.hidden = false; form.elements.email.focus();
  });
})();
