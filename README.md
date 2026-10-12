# THE PIT 홈페이지

사진과 이야기를 올리면, 무작위로 선정된 한 사람이 애니메이션의 주인공이 되는 참여형 홈페이지.
빌드 도구 없이 HTML/CSS/JS만으로 동작하며 GitHub Pages에 그대로 올라갑니다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 메인 페이지 (히어로 → 세계관 → 참여 방법 → 등장인물 → 에피소드 → 신청 폼 → FAQ) |
| `style.css` | 스타일. 위에서 아래로 갈수록 회색에서 색이 번지는 구조 |
| `app.js` | 내비, 스크롤 리빌, 사진 미리보기·리사이즈, 폼 검증·전송 |
| `config.js` | **운영자가 수정하는 유일한 파일.** 접수 URL, 유튜브 링크, 공지 문구 |
| `privacy.html` | 개인정보처리방침 |
| `backend/Code.gs` | 신청 접수 백엔드 (Google Apps Script). 시트 저장 + 드라이브 사진 저장 + 확인 메일 + 랜덤 추첨 |
| `assets/` | 배너, 썸네일, 골키 이미지 |

## 1. 로컬에서 보기

```bash
python -m http.server 8080
```

브라우저에서 http://localhost:8080 접속. (`index.html` 더블클릭으로도 열리지만 폰트 로드는 서버가 안정적입니다.)

## 2. GitHub Pages 배포

```bash
gh repo create thepit-site --public --source=. --push
```

그 다음 GitHub 저장소 → Settings → Pages → Branch: `main` / `(root)` → Save.
1~2분 뒤 `https://<계정>.github.io/thepit-site/` 에서 열립니다.
`.nojekyll` 파일이 있어 Jekyll 처리를 건너뜁니다.

### 도메인: the-pit.site (Cloudflare Registrar)

`CNAME` 파일에 `the-pit.site` 가 들어 있어 Pages가 자동으로 커스텀 도메인을 잡습니다.
Cloudflare DNS 에는 아래 레코드가 있어야 합니다 (Proxy status: **DNS only**).

| Type | Name | Content |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | loganyun848.github.io |

## 3. 신청 접수 연결 (Google Apps Script, 무료)

1. Google Sheets 새 문서 생성 → 메뉴 **확장 프로그램 → Apps Script**
2. `backend/Code.gs` 내용을 전부 붙여넣고 저장
3. 상단 `NOTIFY_EMAIL` 을 알림 받을 주소로 수정
4. **배포 → 새 배포 → 웹 앱** / 실행 계정: 나 / 액세스: **모든 사용자**
5. 권한 승인 후 나오는 **웹 앱 URL** 을 `config.js` 의 `SUBMIT_ENDPOINT` 에 붙여넣기
6. 커밋·푸시하면 끝

이후 신청이 들어오면:
- 시트 `신청` 탭에 한 줄씩 쌓이고
- 드라이브 `THE PIT 신청사진/접수ID_이름/` 폴더에 사진이 저장되고
- 신청자에게 접수 확인 메일, 운영자에게 알림 메일이 갑니다.

`SUBMIT_ENDPOINT` 가 비어 있으면 신청 버튼이 **이메일 접수 안내**로 대체되므로 백엔드 없이도 사이트는 깨지지 않습니다.

## 4. 회차 운영

Apps Script 편집기에서 함수를 골라 ▶ 실행:

| 함수 | 하는 일 |
|---|---|
| `pickRandomWinner()` | `접수` 상태인 신청자 중 1명을 무작위로 뽑아 행을 노란색으로 표시하고 `선정 날짜` 로 바꿈 |
| `closeRoundAndPurge()` | 남은 `접수` 행의 사진 폴더를 휴지통으로 보내고 이야기·연락처를 비움 (개인정보 파기 약속 이행) |

회차가 바뀌면 `config.js` 의 `ROUND_NOTICE` 문구와 `index.html` 에피소드 카드를 갱신하세요.

## 5. 수정 포인트

- 유튜브 채널/예고편 주소: `config.js`
- 에피소드 카드 추가: `index.html` 의 `#episodes` 섹션에서 카드 복사
- 색상: `style.css` 상단 `:root` 변수
