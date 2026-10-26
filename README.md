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
| `contact.html` / `contact.css` / `contact.js` | 이메일을 직접 입력하는 문의 페이지 |
| `form-delivery.js` | 문의·신청을 수신함으로 직접 전송, 사진 첨부, 성공/실패 검증 |
| `privacy.html` | 개인정보처리방침 |
| `fit.html` / `fit.css` / `fit.js` | **Fit Room** — 사진·평소 사이즈·실측 → 브랜드별 실사 상품 20개 → 사이즈 비교 |
| `fit-sizing.js` | 실제 입력 치수와 평소 사이즈 비교. 미입력 둘레는 추정하지 않음 |
| `fit-tryon.js` | 실제 AI 착용 → THE PIT 캐릭터 생성 흐름, 동의·상태·오류·다운로드 |
| `backend/tryon/` | fal.ai를 호출하는 Cloudflare Worker, 비밀 키 보호, 사용량 제한, 연결 안내 |
| `scripts/connect-ai.cjs` | 이 PC에서만 여는 AI 연결 화면. 로그인·키 입력 후 서버 배포와 공개 설정 반영 |
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

## 3. 문의·신청 메일 접수

문의 페이지는 `contact.html`이며, 메인 메뉴와 푸터, FAQ, Fit Room 푸터에서 연결합니다. 방문자가 이메일을 직접 입력하고 제출하면 FormSubmit을 거쳐 **ceo@lecple.com**으로 전달됩니다. 방문자의 메일 앱이나 메일 계정 로그인은 사용하지 않습니다. 입력한 이메일은 답장 주소(Reply-To)로 전달됩니다.

`config.js`의 `FORM_ENDPOINT`가 전송 주소입니다. 새 수신함은 FormSubmit에서 보내는 메일의 **Activate Form** 링크를 최초 1회 눌러야 합니다. 이 프로젝트의 ceo@lecple.com 주소는 2026-10-26 사용자 활성화 후 실제 전송 API의 성공 응답을 확인했습니다. 수신함을 바꾸거나 전송 도메인을 바꾸면 다시 확인이 필요할 수 있습니다.

- 문의 폼: 이메일, 유형, 내용, 선택 이름/회사명
- 기존 신청 폼: 입력 항목과 리사이즈한 사진을 실제 파일로 첨부 (사진 합계 10 MB 제한)
- 서비스가 명시적으로 성공을 응답한 경우에만 완료 화면 표시
- 실패/시간 초과/미활성화: 오류를 안내하고 입력 내용을 유지. 메일 앱으로 우회하지 않음
- 자동 확인 메일은 현재 전송 경로에서 제공하지 않음. 담당자가 입력 이메일로 회신
- FormSubmit은 텍스트 접수를 30일 보관한다고 안내하며, 개인정보 안내 페이지에 해당 처리 경로를 명시

서버의 접수 성공 응답과 실제 수신함의 스팸/분류 상태는 다릅니다. 운영 시 메일함도 확인하세요.

```bash
node --test tests/form-delivery.test.cjs
```

전송 서비스 문서: https://formsubmit.co/documentation

### 선택 사항: Google Apps Script로 신청 저장하기

아래 방식은 현재 사용 중인 메일 전송 경로를 대체할 때만 적용합니다. `SUBMIT_ENDPOINT`를 설정하면 **신청 폼만** Google 경로를 사용하며, 문의 폼은 FormSubmit을 유지합니다. 전환 시 신청 폼 하단의 전송 경로 안내도 갱신하세요.

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

`SUBMIT_ENDPOINT`가 비어 있으면 신청도 `FORM_ENDPOINT`로 직접 전송합니다.

## 4. 회차 운영 (Google Apps Script를 선택한 경우)

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

상단 메뉴 **Fit Room** 으로 들어가는 별도 페이지입니다. 사이즈 비교는 브라우저에서 계산하고, AI 생성은 별도 서버를 사용합니다.

1. 사진 업로드 (JPEG/PNG/WEBP, 최대 10 MB, 브라우저 미리보기)
2. 여성복/남성복 선택, 키·몸무게 입력, 평소 상·하의 사이즈와 브랜드·선호 핏, 실제 가슴·허리·엉덩이 둘레 선택 입력
3. 선택한 성별의 UNIQLO 20개와 ZARA 20개를 실사 상품 사진으로 표시
4. 브랜드/의류 종류 필터, 카드에 추천 사이즈 표시
5. 상품 선택 → 평소 사이즈/실측 결과 비교, 접을 수 있는 상세표, 공식몰 링크
6. **다음 · 내 사진에 입어보기** → 원본과 AI 착용 결과 비교·저장
7. **THE PIT 캐릭터** → 스튜디오/도시/포스터 장면 선택 → 원본 인물·착용 의상을 참고한 애니메이션 캐릭터 정지 이미지·저장

사진으로 성별이나 치수를 판독하지 않습니다. 키·몸무게로 가슴둘레 94cm 등을 임의 추정하던 계산을 제거했습니다. 예를 들어 180cm·73kg·평소 상의 XL이면 **평소 사이즈 기준 XL**을 표시하고, 실측이 부족한 상태에서 확정 추천으로 표현하지 않습니다. 입력한 실측이 M을 가리키더라도 평소 XL과 충돌하면 두 결과를 비교하도록 안내합니다. 상의 XL을 하의에 자동 적용하지 않습니다.

사진은 각 AI 단계의 동의를 체크하고 생성 버튼을 눌러야 서버로 전송됩니다. 신체 치수와 평소 사이즈는 생성 API에 보내지 않습니다. 입력 변경 시 추천과 생성 결과를 초기화하고, 변경 전 진행하던 요청의 늦은 결과가 다시 나타나지 않도록 처리합니다. 이미지는 브라우저 메모리에만 유지하므로 페이지를 떠나기 전에 저장해야 합니다.

**현재 생성 연결 상태:** 계정과 키가 없어 `TRYON_ENDPOINT`, `TRYON_TURNSTILE_SITE_KEY`는 비어 있습니다. 실제 화면도 ‘AI 연결 준비 중’으로 표시하며 생성 버튼은 비활성화합니다. 화면과 서버 구현을 실제 AI 생성 검증과 구분합니다. 연결 방법은 [backend/tryon/README.md](backend/tryon/README.md)에 정리했습니다.

터미널 명령을 줄이려면 `node scripts/connect-ai.cjs` 실행 후 `http://127.0.0.1:8767`에서 연결합니다. 계정 소유자의 인증과 키 입력이 필요하며, 키는 채팅이나 공개 사이트 입력란에 보내지 않습니다.

### 상품 데이터와 사이즈 기준

2026-10-22에 공식몰에서 확인한 정적 스냅샷입니다. 사진은 공식 CDN URL을 참조하며, 상품명·가격·상품 링크와 치수 원본을 `data/`에 기록했습니다. 실시간 재고/가격 동기화나 브랜드 제휴 연동은 없습니다. 사진 주소가 만료되거나 변경되면 카탈로그를 갱신해야 합니다.

- `body-range`: UNIQLO 공식 신체 사이즈 범위. 상품에 표기된 사이즈 범위로 제한합니다.
- `body-points`: 공식 신체 치수 기준값. 인접 사이즈의 중간값으로 가까운 사이즈를 찾습니다.
- `garment-flat`: ZARA 공식 상품 단면 실측 × 2. Fit Room의 착용 여유 기준을 적용합니다.
- `scope: brand-guide`는 공통 신체 가이드이며 상품별 실측이 아닙니다. UI에서 구분하고 출처를 연결합니다.
- 비교하는 치수 모두가 기준에 맞아야 추천합니다. 경계값은 별도 표시하고, 범위를 벗어나면 가장 큰/작은 사이즈를 억지로 추천하지 않습니다. 하의에 엉덩이 기준이 없으면 허리만 비교했다는 안내를 표시합니다.

상품 실측에 적용하는 착용 여유 기준은 휴리스틱이며 검증된 체형 분석 모델이 아닙니다. 원단 신축성, 어깨, 기장, 실시간 재고는 추천에 반영하지 않습니다. 이미지 생성은 선택 사이즈의 실제 기장·품을 시뮬레이션하지 않습니다.

### 카탈로그 갱신 및 검증

`data/catalog-source.json`과 `data/catalog-measurements.json`을 실제 상품 정보로 갱신하고, 생성기의 `updatedAt`을 수정합니다. 각 성별·브랜드에 20개씩 유지하세요.

```bash
node scripts/build-fit-catalog.cjs
npm ci --prefix backend/tryon
node --test tests/fit-sizing.test.cjs tests/form-delivery.test.cjs tests/tryon-worker.test.mjs backend/tryon/tests/studio.test.mjs
npm run check --prefix backend/tryon
node scripts/preview-fit.cjs
```

미리보기 주소: http://127.0.0.1:8766/fit.html. 생성된 `fit-catalog.js`, `backend/tryon/catalog.json`을 함께 갱신하며, 데이터 변경 시 HTML의 자산 버전도 갱신합니다. 서버 카탈로그를 변경하면 Worker도 재배포합니다. 자동 테스트의 AI 응답은 대체 데이터이며, 실제 유료 모델을 호출하지 않습니다.
