# THE PIT 홈페이지

사진과 이야기를 올리면, 무작위로 선정된 한 사람이 애니메이션의 주인공이 되는 참여형 홈페이지.
빌드 도구 없이 HTML/CSS/JS만으로 동작하며 GitHub Pages에 그대로 올라갑니다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 메인 페이지 (히어로 → 세계관 → 참여 방법 → 등장인물 → 에피소드 → 신청 폼 → FAQ) |
| `style.css` | 스타일. 위에서 아래로 갈수록 회색에서 색이 번지는 구조 |
| `app.js` | 내비, 스크롤 리빌, 사진 미리보기·리사이즈, 폼 검증·전송 |
| `config.js` | 접수 URL, 유튜브 링크, 공지 문구 |
| `privacy.html` | 개인정보처리방침 |
| `fit.html` / `fit.css` / `fit.js` | **Fit Room** — 사진·치수 입력 → 브랜드별 실사 상품 20개 → 사이즈 추천 |
| `fit-sizing.js` | 신체 치수 검증, 미입력 둘레 추정, 사이즈표 비교 |
| `fit-catalog.js` | 여성/남성 × UNIQLO/ZARA × 20개 = 총 80개 상품과 사이즈표 |
| `data/` / `scripts/build-fit-catalog.cjs` | 확인한 상품·치수 원본과 정적 카탈로그 생성기 |
| `tests/fit-sizing.test.cjs` | 사이즈 추천과 카탈로그 검증 |
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


## 6. Fit Room (fit.html)

상단 메뉴 **Fit Room** 으로 들어가는 별도 페이지. 외부 라이브러리 없이 동작합니다.

1. 사진 업로드 (JPEG/PNG/WEBP, 최대 10 MB, 브라우저 미리보기)
2. 여성복/남성복 선택, 키·몸무게 입력, 가슴·허리·엉덩이 둘레 선택 입력
3. 선택한 성별의 UNIQLO 20개와 ZARA 20개를 실사 상품 사진으로 표시
4. 브랜드/의류 종류 필터, 카드에 추천 사이즈 표시
5. 상품 선택 → 추천 사이즈, 내 치수와 사이즈별 비교표, 공식몰 링크

사진과 신체 치수는 서버 전송·영구 저장하지 않습니다. 사진으로 성별이나 치수를 판독하지 않으며, 미입력 둘레는 키·몸무게 기반 추정임을 표시합니다. 입력을 바꾸면 이전 추천을 숨기고 다시 계산합니다.

### 상품 데이터와 사이즈 기준

2026-10-22에 공식몰에서 확인한 정적 스냅샷입니다. 사진은 공식 CDN URL을 참조하며, 상품명·가격·상품 링크와 치수 원본을 `data/`에 기록했습니다. 실시간 재고/가격 동기화나 브랜드 제휴 연동은 없습니다. 사진 주소가 만료되거나 변경되면 카탈로그를 갱신해야 합니다.

- `body-range`: UNIQLO 공식 신체 사이즈 범위. 상품에 표기된 사이즈 범위로 제한합니다.
- `body-points`: 공식 신체 치수 기준값. 인접 사이즈의 중간값으로 가까운 사이즈를 찾습니다.
- `garment-flat`: ZARA 공식 상품 단면 실측 × 2. Fit Room의 착용 여유 기준을 적용합니다.
- `scope: brand-guide`는 공통 신체 가이드이며 상품별 실측이 아닙니다. UI에서 구분하고 출처를 연결합니다.
- 비교하는 치수 모두가 기준에 맞아야 추천합니다. 경계값은 별도 표시하고, 범위를 벗어나면 가장 큰/작은 사이즈를 억지로 추천하지 않습니다. 하의에 엉덩이 기준이 없으면 허리만 비교했다는 안내를 표시합니다.

키·몸무게 추정 및 착용 여유 기준은 검증된 체형 분석 모델이 아닌 휴리스틱입니다. 원단 신축성, 기장, 실시간 재고는 추천에 반영하지 않습니다.

### 카탈로그 갱신 및 검증

`data/catalog-source.json`과 `data/catalog-measurements.json`을 실제 상품 정보로 갱신하고, 생성기의 `updatedAt`을 수정합니다. 각 성별·브랜드에 20개씩 유지하세요.

```bash
node scripts/build-fit-catalog.cjs
node --test tests/fit-sizing.test.cjs
node scripts/preview-fit.cjs
```

미리보기 주소: http://127.0.0.1:8766/fit.html. 생성된 `fit-catalog.js`를 함께 배포하며, 데이터 변경 시 HTML의 자산 버전도 갱신합니다.
