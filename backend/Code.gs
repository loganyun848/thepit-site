/**
 * THE PIT — 주인공 신청 접수 백엔드 (Google Apps Script)
 *
 * 역할
 *  1. 홈페이지 신청 폼(JSON + base64 사진)을 받아서
 *  2. 사진은 Google Drive 폴더에, 나머지 정보는 Google Sheets 한 줄로 저장하고
 *  3. 신청자에게 접수 확인 메일을 보냅니다.
 *  4. pickRandomWinner() 로 이번 회차 주인공을 무작위 추첨합니다.
 *
 * 설치 (약 5분)
 *  1) Google Sheets 새 문서 만들기 → 확장 프로그램 → Apps Script
 *  2) 이 파일 내용을 전부 붙여넣고 저장
 *  3) 배포 → 새 배포 → 유형: 웹 앱
 *       - 실행 계정: 나
 *       - 액세스 권한: 모든 사용자 (익명)
 *  4) 나온 "웹 앱 URL" 을 홈페이지 config.js 의 SUBMIT_ENDPOINT 에 붙여넣기
 *  5) (선택) 아래 설정값 수정
 */

const SHEET_NAME = "신청";               // 접수 시트 이름 (없으면 자동 생성)
const DRIVE_FOLDER_NAME = "THE PIT 신청사진"; // 사진 저장 폴더 (없으면 자동 생성)
const NOTIFY_EMAIL = "ceo@integree.io";  // 새 신청이 오면 알림 받을 주소 ("" 이면 안 보냄)
const SEND_CONFIRM_MAIL = true;          // 신청자에게 접수 확인 메일 발송
const BRAND = "THE PIT";

const HEADERS = [
  "접수ID", "접수시각", "회차상태", "이름", "이메일", "국가", "연령대", "SNS",
  "한줄소개", "이야기", "나의색", "스타일", "장소", "골키에게", "키", "사이즈",
  "사진폴더", "얼굴사진", "전신사진", "추가1", "추가2",
  "본인확인", "초상권동의", "개인정보동의", "연령확인", "소식수신", "UA"
];

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: BRAND }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = JSON.parse(e.postData.contents || "{}");
    if (data.website) return json({ ok: true }); // 허니팟: 봇은 조용히 무시
    if (!data.name || !data.email || !data.story) return json({ ok: false, error: "필수 항목 누락" }, 400);

    const id = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd-HHmmss") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    const folder = getOrCreateFolder_(DRIVE_FOLDER_NAME).createFolder(id + "_" + sanitize_(data.name));
    const links = { face: "", body: "", extra1: "", extra2: "" };
    (data.photos || []).forEach(p => {
      const m = /^data:(.+?);base64,(.+)$/.exec(p.dataUrl || "");
      if (!m) return;
      const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], p.key + "_" + sanitize_(p.name || "photo.jpg"));
      const file = folder.createFile(blob);
      links[p.key] = file.getUrl();
    });

    const sheet = getOrCreateSheet_();
    sheet.appendRow([
      id, data.submittedAt || new Date().toISOString(), "접수", data.name, data.email, data.country || "", data.ageGroup || "",
      data.sns || "", data.headline || "", data.story || "", data.color || "", data.style || "",
      data.place || "", data.toGolky || "", data.height || "", data.size || "",
      folder.getUrl(), links.face, links.body, links.extra1, links.extra2,
      data.agreeSelf || "", data.agreePortrait || "", data.agreePrivacy || "", data.agreeAge || "", data.agreeNews || "",
      data.userAgent || ""
    ]);

    if (SEND_CONFIRM_MAIL) sendConfirm_(data, id);
    if (NOTIFY_EMAIL) notifyTeam_(data, id, folder.getUrl());
    return json({ ok: true, id });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  } finally {
    lock.releaseLock();
  }
}

/** 이번 회차 주인공 무작위 추첨 — Apps Script 편집기에서 직접 실행 */
function pickRandomWinner() {
  const sheet = getOrCreateSheet_();
  const rows = sheet.getDataRange().getValues();
  const col = HEADERS.indexOf("회차상태");
  const candidates = [];
  for (let r = 1; r < rows.length; r++) if (rows[r][col] === "접수") candidates.push(r);
  if (!candidates.length) { Logger.log("추첨 대상이 없습니다."); return null; }
  const r = candidates[Math.floor(Math.random() * candidates.length)];
  sheet.getRange(r + 1, col + 1).setValue("선정 " + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd"));
  sheet.getRange(r + 1, 1, 1, HEADERS.length).setBackground("#fff3c4");
  const winner = { id: rows[r][0], name: rows[r][3], email: rows[r][4], headline: rows[r][8], folder: rows[r][HEADERS.indexOf("사진폴더")] };
  Logger.log("🔑 선정: " + JSON.stringify(winner) + " (후보 " + candidates.length + "명)");
  return winner;
}

/** 회차 종료: 미선정자 행을 "종료" 로 표시하고 사진 폴더를 휴지통으로 (개인정보 파기) */
function closeRoundAndPurge() {
  const sheet = getOrCreateSheet_();
  const rows = sheet.getDataRange().getValues();
  const col = HEADERS.indexOf("회차상태"), fcol = HEADERS.indexOf("사진폴더");
  let n = 0;
  for (let r = 1; r < rows.length; r++) {
    if (rows[r][col] !== "접수") continue;
    const m = /folders\/([\w-]+)/.exec(rows[r][fcol] || "");
    if (m) try { DriveApp.getFolderById(m[1]).setTrashed(true); } catch (_) {}
    for (const c of ["이야기", "얼굴사진", "전신사진", "추가1", "추가2"]) sheet.getRange(r + 1, HEADERS.indexOf(c) + 1).setValue("");
    sheet.getRange(r + 1, col + 1).setValue("종료(파기)");
    n++;
  }
  Logger.log(n + "건 파기 완료");
}

/* ── 내부 함수 ── */
function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); }
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); sh.setFrozenRows(1); sh.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold"); }
  return sh;
}
function getOrCreateFolder_(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
function sanitize_(s) { return String(s).replace(/[\\/:*?"<>|]/g, "_").slice(0, 40); }
function json(obj, code) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function sendConfirm_(d, id) {
  try {
    MailApp.sendEmail({
      to: d.email,
      subject: `[${BRAND}] The key has arrived — your application is in (${id})`,
      htmlBody: `
        <div style="font-family:sans-serif;max-width:560px;line-height:1.7;color:#222">
          <h2 style="color:#c98a17">${escape_(d.name)}, your application is in 🔑</h2>
          <p>You're now in the draw to become the hero of the next THE PIT episode.<br>
          We'll send the draw results to this email. If you're picked, we confirm it's really you and then start building your character.</p>
          <p style="background:#fff8e5;padding:12px 14px;border-radius:8px">
            <b>Your one-line intro</b><br>${escape_(d.headline || "")}<br><br>
            <b>Your color</b> ${escape_(d.color || "")} · <b>Style</b> ${escape_(d.style || "")}
          </p>
          <p>If you'd like to stay in the draw for future episodes even if you're not picked this time, just reply to this email with "keep me in". If we don't hear from you, your photos and information are deleted when this round ends.</p>
          <p style="color:#777;font-size:13px">Application ID ${id} · LECPLE Inc. · THE PIT production team · Busan, South Korea</p>
        </div>`
    });
  } catch (err) { Logger.log("confirm mail fail: " + err); }
}
function notifyTeam_(d, id, folderUrl) {
  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: `[${BRAND} 신청] ${d.name} — ${d.headline || ""}`,
      body: `접수 ${id}\n이름 ${d.name} / ${d.email}\n국가 ${d.country || "-"} · 연령 ${d.ageGroup} · ${d.sns || "-"}\n색 ${d.color} · 스타일 ${d.style}\n\n${d.story}\n\n사진: ${folderUrl}`
    });
  } catch (err) { Logger.log("notify fail: " + err); }
}
function escape_(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
