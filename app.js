/* THE PIT — 프런트 동작 (외부 라이브러리 없음) */
(function () {
  "use strict";
  const CFG = window.THEPIT_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  /* ── 설정값을 링크에 반영 ── */
  const yt = CFG.YOUTUBE_CHANNEL_URL || "#";
  const trailer = CFG.TRAILER_URL || yt;
  ["trailerBtn", "trailerThumb", "trailerOpen", "ep0"].forEach(id => { const a = $("#" + id); if (a) a.href = trailer; });

  /* ── 썸네일 클릭 → 페이지 안에서 바로 재생 (영상 ID를 찾을 수 있을 때만) ── */
  const vidMatch = /(?:youtu\.be\/|[?&]v=|\/embed\/)([\w-]{11})/.exec(trailer);
  const thumbLink = $("#trailerThumb");
  if (vidMatch && thumbLink) {
    thumbLink.addEventListener("click", e => {
      e.preventDefault();
      const f = document.createElement("iframe");
      f.src = `https://www.youtube-nocookie.com/embed/${vidMatch[1]}?autoplay=1&rel=0`;
      f.title = "THE PIT trailer";
      f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      f.allowFullscreen = true;
      thumbLink.replaceWith(f);
    });
  }
  ["footYoutube", "doneYoutube"].forEach(id => { const a = $("#" + id); if (a) a.href = yt; });
  if (CFG.INSTAGRAM_URL) { const a = $("#footInsta"); a.href = CFG.INSTAGRAM_URL; a.hidden = false; }
  ["footMail", "faqMail"].forEach(id => { const a = $("#" + id); if (a) a.href = "contact.html"; });
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

  window.THEPIT_APPLICATION.mount(document);
})();
