# THE PIT 착용·캐릭터 AI 연결

## 현재 상태

2026-10-26 기준 프런트엔드와 서버 코드는 구현되어 있습니다. **fal.ai 계정·유료 생성 키와 Cloudflare 배포가 아직 연결되지 않아 실제 이미지 생성은 비활성화되어 있습니다.** 사이즈 비교와 상품 탐색, 문의 접수는 별도로 작동합니다. 계정 생성이나 결제는 수행하지 않았습니다.

이 서버 하나에서 착용(FASHN v1.6)과 캐릭터(FLUX.2 Pro Edit)를 처리합니다. 모델마다 별도 계정을 만들 필요 없이 fal.ai 키 하나를 사용합니다. 프런트엔드는 GitHub Pages를 유지합니다.

## 로컬 연결 화면으로 설정하기

저장소 루트에서 `node scripts/connect-ai.cjs`를 실행하고 `http://127.0.0.1:8767`을 엽니다. 이 화면은 이 PC에서만 접근할 수 있습니다.

1. **Cloudflare 로그인 시작** → 표시되는 인증 링크에서 계정 소유자가 로그인/승인합니다.
2. fal.ai API key와 Turnstile의 Site key / Secret key를 로컬 입력란에 등록합니다. 키를 채팅에 보내지 마세요.
3. **서버 배포하고 홈페이지 연결**을 누르면 Worker 배포 → Cloudflare Secrets 등록 → 설정 확인 → 공개 값 두 개만 config.js에 반영 → GitHub Pages 푸시를 수행합니다.

API 계정 생성·결제·약관 승인과 Turnstile 위젯 생성은 서비스 대시보드에서 직접 해야 합니다. 연결 화면은 비밀 키를 파일/로그/Git에 저장하지 않으며, Wrangler 표준 입력으로 전달합니다. 이 연결 단계에서는 유료 이미지를 생성하지 않습니다. 실제 생성 성공과 품질은 아래 4단계에서 확인합니다. 저장소에 미검토 변경 사항이 있으면 자동 배포를 중단합니다.

## 1. 계정과 두 가지 키 준비

1. [fal.ai](https://fal.ai/) 계정에서 사용할 금액을 정하고 크레딧을 준비합니다. [API 키 관리](https://fal.ai/dashboard/keys)에서 키를 발급합니다. 생성 권한이 있는 키를 사용하세요. 이 값은 **FAL_KEY**이며 채팅·GitHub·config.js에 넣지 않습니다.
2. [Cloudflare Dashboard](https://dash.cloudflare.com/)에서 Workers & Pages를 사용할 계정에 로그인합니다. 도메인을 옮길 필요는 없습니다. Worker는 workers.dev 주소로 사용할 수 있습니다.
3. Cloudflare의 **Turnstile**에서 위젯을 만들고 허용 호스트에 `the-pit.site`, `www.the-pit.site`를 등록합니다. Managed 유형을 사용합니다. **Site key**는 공개 가능, **Secret key**는 서버 전용입니다.

## 2. Worker 배포

Node.js 24 LTS를 사용합니다. 터미널에서 이 문서가 있는 `backend/tryon` 폴더로 이동한 뒤 실행합니다.

```powershell
npm ci
npx wrangler login
npm run check
npm run deploy
```

첫 배포는 키가 없는 상태라 모든 생성 요청이 차단됩니다. 배포 결과의 `https://thepit-tryon.<계정>.workers.dev` 주소를 기록합니다. 계정 선택 화면에서는 사이트 운영 계정을 선택합니다. SQLite Durable Objects 바인딩은 `wrangler.jsonc`에 포함되어 있습니다.

아래 명령을 각각 실행하고 숨김 입력 프롬프트에 값을 붙여 넣습니다. 명령 인수에 비밀 키를 직접 적지 마세요.

```powershell
npx wrangler secret put FAL_KEY
npx wrangler secret put TURNSTILE_SECRET
```

두 키가 등록되면 `/health`에서 `ready: true`, `features: ["tryon", "character"]`가 나옵니다. 이는 설정 존재 여부를 뜻하며 키의 유효성·잔액·실제 생성 품질까지 보증하지 않습니다.

## 3. 홈페이지 연결

저장소 루트 `config.js`의 아래 **공개 값 두 개만** 입력합니다.

```js
TRYON_ENDPOINT: "https://thepit-tryon.<계정>.workers.dev",
TRYON_TURNSTILE_SITE_KEY: "Turnstile의 공개 Site key",
```

`FAL_KEY`와 `TURNSTILE_SECRET`은 config.js에 넣지 않습니다. `fit.html`의 config.js 버전 문자열도 갱신한 뒤 GitHub Pages에 배포합니다.

```powershell
git add config.js fit.html
git commit -m "Connect Fit Room AI backend"
git push origin main
```

다른 도메인을 쓰면 `wrangler.jsonc`의 `ALLOWED_ORIGINS`와 Turnstile 허용 호스트를 둘 다 바꾸고 재배포합니다. 임의 사이트에서 호출할 수 있는 와일드카드 CORS는 사용하지 않습니다.

## 4. 실제 생성 확인

1. `https://the-pit.site/fit.html`에서 본인이 사용할 권리가 있는 정면 사진을 올립니다. 전신 착용을 확인하려면 전신과 팔이 보이는 사진이 좋습니다.
2. 성별 의류·키·몸무게·평소 사이즈를 입력하고 상품을 선택합니다.
3. **다음 · 내 사진에 입어보기** → 사진 전송 동의 → 보안 확인 → 생성. 내 사진과 선택한 옷이 반영됐는지 확인하고 저장합니다.
4. **내 캐릭터 만들기** → 장면 선택 → 별도 전송 동의 → 생성. 얼굴·헤어·체형·의상 디테일을 원본 및 착용 결과와 비교합니다.
5. 다른 상품이나 사진으로 변경했을 때 이전 결과가 사라지는지, 실패 시 오류가 표시되는지 확인합니다.

AI 결과는 실제 상품 사이즈의 기장·품·착용감을 시뮬레이션하지 않습니다. 선택한 XL을 생성 모델의 사이즈 파라미터로 보내지 않습니다. 캐릭터는 정지 이미지이며 동영상·3D 모델 파일이 아닙니다. 얼굴이나 패턴의 완전한 일치는 보장되지 않으므로 실제 결과를 확인한 뒤 공개 운영하세요.

## 생성 비용과 제한

- 하루 **전체 10회**, 방문자 IP 기반 **하루 5회**, 같은 단계는 **1분당 1회**로 제한합니다. 착용 후 캐릭터로 이어지는 요청은 즉시 가능합니다. UTC 00:00(한국 09:00)에 하루 기준이 바뀝니다.
- 전체 한도는 `wrangler.jsonc`의 `DAILY_LIMIT`입니다. 1~1,000 범위이며 변경 후 배포합니다. 착용·캐릭터·재생성은 각각 1회입니다. 허용된 요청은 외부 생성 실패 시에도 한도에 포함됩니다.
- 이 한도는 금액 상한이 아닙니다. fal.ai에서 사용할 잔액과 비용 관리 설정을 함께 확인하세요. Cloudflare 요금/무료 할당량은 별도입니다.
- 2026-10-26 확인: FASHN v1.6은 이미지당 $0.075, FLUX.2 Pro Edit는 첫 출력 MP $0.03와 추가 입력·출력 MP 과금으로 안내됩니다. 캐릭터는 입력 이미지 3장을 사용하므로 $0.03 고정 비용이 아닙니다. [착용 가격](https://fal.ai/models/fal-ai/fashn/tryon/v1.6), [캐릭터 가격](https://fal.ai/models/fal-ai/flux-2-pro/edit)에서 활성화 시점의 가격을 확인하세요.
- 화면에서 대기 중단은 서버 생성/과금을 취소한다는 뜻이 아닙니다. 서버 120초, 브라우저 150초 제한을 사용하며 자동 재전송하지 않습니다. 결과 유실 후 자동 복구·작업 이력은 없습니다.

## 데이터 흐름과 운영

- 사진은 버튼 클릭 시 JPG로 재인코딩하여 최대 1,600픽셀로 보냅니다. 키·몸무게·둘레·평소 사이즈는 서버 생성 요청에서 제외합니다.
- 착용: 원본 사진 + 서버 카탈로그가 지정한 상품 사진. 클라이언트가 임의 외부 URL을 지정할 수 없습니다. 모델은 상품 사진의 모델 착용/평면 촬영 여부를 자동 판단합니다.
- 캐릭터: 착용 결과 + 원본 인물 + THE PIT 원작 스타일 참고 이미지. 서버의 고정 프롬프트는 각 이미지의 역할을 분리하고, 얼굴·옷·체형 보존을 요청합니다. 사용자가 임의 프롬프트나 외부 이미지 URL로 바꿀 수 없습니다.
- 두 API는 Turnstile의 성공 여부·호스트·action을 서버에서 확인하고, 원자적 사용량 제한 후 fal.ai를 호출합니다.
- 서버는 사진·결과를 영구 저장하거나 로그에 출력하지 않습니다. fal.ai 입력/출력 기록 저장을 끄는 헤더와 1시간 파일 만료 설정, sync_mode를 사용합니다. 모델 사업자의 별도 로그까지 즉시 삭제되는 것은 아닙니다. [fal 미디어 보관 문서](https://fal.ai/docs/documentation/model-apis/media-expiration)
- 사용량 저장소에는 일일 해시 방문자 ID·요청 ID·횟수만 남기고 마지막 허용 요청 약 24시간 후 삭제합니다. 설정 파일에는 Worker 관측 로그를 비활성화했습니다.
- 비밀 키는 Cloudflare Secrets로 관리합니다. `.dev.vars`, `.env`, `node_modules`, `.wrangler`는 git에서 제외됩니다.

## 오류별 조치

| 표시/응답 | 확인할 항목 |
|---|---|
| AI 연결 준비 중 | config.js 공개 값, Worker 배포, 두 Secrets, Durable Object 바인딩 |
| 403 보안 확인 실패 | Turnstile 도메인, Site/Secret 키의 같은 위젯 여부, 만료된 토큰 |
| 429 한도 도달 | 같은 단계 1분 제한 또는 전체/방문자 일일 횟수 |
| 503 연결/잔액 | fal.ai 키의 유효성·생성 권한·잔액 |
| 422 사진 처리 불가 | 한 명의 정면 사진, 충분한 해상도, 가려진 신체/의상, 모델의 콘텐츠 제한 |
| 502 또는 시간 초과 | fal 상태, 상품 사진 URL, 연결 상태. 자동 재시도하지 않음 |

## 로컬 검증

저장소 루트에서:

```powershell
node --test tests/fit-sizing.test.cjs tests/form-delivery.test.cjs tests/tryon-worker.test.mjs
node --test backend/tryon/tests/studio.test.mjs
npm run check --prefix backend/tryon
node scripts/preview-fit.cjs
```

자동 테스트는 외부 생성 요청을 테스트 응답으로 대체합니다. 비용이 발생하지 않으며, 테스트 통과가 실제 모델의 화질 검증을 의미하지 않습니다. 테스트 이미지를 웹사이트 생성 결과로 사용하지 않습니다.

공식 API: [FASHN v1.6](https://fal.ai/models/fal-ai/fashn/tryon/v1.6/api), [FLUX.2 Pro Edit](https://fal.ai/models/fal-ai/flux-2-pro/edit/api), [Turnstile 서버 검증](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
