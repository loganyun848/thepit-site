// ─────────────────────────────────────────────────────────────
//  THE PIT 홈페이지 설정
//  이 파일만 수정하면 됩니다. (index.html / app.js 는 건드리지 않아도 됩니다)
// ─────────────────────────────────────────────────────────────
window.THEPIT_CONFIG = {
  // 신청 접수 엔드포인트 (Google Apps Script 웹앱 URL)
  // backend/Code.gs 를 배포한 뒤 "웹 앱 URL" 을 여기에 붙여넣으세요.
  // 비워 두면 신청 버튼을 눌렀을 때 이메일 접수 안내로 대체됩니다.
  SUBMIT_ENDPOINT: "",

  // 유튜브 채널 / 예고편 링크
  YOUTUBE_CHANNEL_URL: "https://www.youtube.com/@the_pit_video",
  TRAILER_URL: "https://www.youtube.com/watch?v=kyT88ZIhH9E",

  // 인스타그램 (없으면 빈 문자열)
  INSTAGRAM_URL: "",

  // 문의 / 이메일 접수용 주소
  CONTACT_EMAIL: "marketing@lecple.com",

  // 이번 회차 안내 (상단 공지 띠에 표시, 비우면 숨김)
  ROUND_NOTICE: "EP.1 now casting · One applicant is picked at random every episode",

  // 사진 업로드 제한
  MAX_PHOTO_MB: 10,          // 원본 파일 1장당 최대 용량
  RESIZE_MAX_PX: 1600        // 업로드 전 긴 변 기준 리사이즈 (전송 용량 절약)
};
