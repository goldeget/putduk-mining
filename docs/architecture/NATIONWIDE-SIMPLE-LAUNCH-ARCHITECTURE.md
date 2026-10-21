# 퍼뜩 채굴 — 전국 단순 출시 아키텍처

판정: **최종 아키텍처 결정됨. 출시 준비는 아니다.**

날짜: `2026-10-21`  
작업 공간: `C:\Dev\putduk-mining`  
원격: `https://github.com/goldeget/putduk-mining.git`  
기준: `develop` = `origin/develop` = `2d7e903c712726f4540cdbe860d9410935023f4e`  
상태: **NOT_LAUNCH_READY.** PRODUCT COMPLETE 경로 = **0.**

이 파일이 출시 단순화의 결정본이다. `docs/architecture/LAUNCH-SIMPLIFICATION-PATCH-ARCHITECTURE.md`는 자동화 메모다. 범위, 여정, 채굴, AI가 다르면 이 파일을 따른다.

이 문서는 원격 Supabase 적용, DNS, Worker 전환, 푸시, 머지, GitHub 설정 변경, 실제 지급, 유료 AI 호출을 실행 허가하지 않는다.

---

## 현재 진실

저장소 `goldeget/putduk-mining`은 공개다. 기본 브랜치는 `main`이다. `main` 보호 조회는 HTTP 404 `Branch not protected`다.

이 SHA의 full authenticated E2E는 run `39253488361` 하나이고 결과는 failure다. 실패한 lane은 **Authenticated product gates (10/12)** 뿐이다. 다른 SHA의 이후 run은 이 커밋의 통과 증거가 아니다.

`docs/quality/PRODUCT-COMPLETE-MATRIX.md`는 PRODUCT COMPLETE 경로가 없다고 적는다. 기준 develop은 `d3e5949`라 이 팁보다 오래됐다. 출시 매트릭스로 쓰지 않는다.

증거 위치: 이 작업 공간만 읽었다. `C:\Users\PC\Desktop\putduk-mining`은 SSOT가 아니므로 열지 않았다. `D:\PUTDUK-MINING-QA`는 **ABSENT**. E:와 F:는 **ABSENT**. 로컬 `test-results/`가 현재 증거 저장소다.

운영 결합은 **UNKNOWN**이다. UNKNOWN은 안전이 아니다. 원격 Supabase `osrmyjgmpdspdcwqjwuv`는 이 문서에서 조회하거나 바꾸지 않았다.

세 상태를 섞지 않는다.

- **SPECIFIED:** 문서와 승인 JSON에 적힌 규칙.
- **IMPLEMENTED IN CODE:** 이 커밋의 라우트, SQL, 워커가 그 규칙을 호출한다.
- **ACTUALLY RUNNING:** 사용자에게 그 결과가 나온다는 증거. 없으면 **NOT PROVEN** 또는 **NOT RUNNING**.

아래 표의 결정은 닫혀 있다. 기계가 할 수 없는 일만 실행 게이트로 남긴다. 실행 게이트는 제품 질문이 아니다.

---

## 결정표

이유의 앞은 운영자, 뒤는 전국 사용자(20대–70대)다.

| ID | 결정 | 이유 |
| --- | --- | --- |
| M1 | 실채굴 사용량 = 서버가 센 활성 경과 시간. 앱이 닫혀 있어도 포함된다. 화면을 연 시간이 아니다. | 서버 시각만 돈의 기준이 된다. 화면 시간은 보통의 사용을 깎고, 「앱을 닫아도 채굴은 계속돼요」와 어긋난다. |
| M2 | 입금 기준 = 남은 Eligible Funding Principal. 회원에게는 **넣아 둔 돈**이라고 말한다. 평생 누적 입금이 아니다. 이미 회수한 원금은 채굴하지 않는다. 회원 USDT 잔액이라는 말은 쓰지 않는다. | 빠져나간 돈이 계속 채굴되면 원장이 거짓이 된다. 넣아 둔 돈이 지금 남아 있는 돈이다. |
| M3 | 출시 경제 = `2026-10-03` 승인 하나만. `baseCycleRateBps` 1500, 주기 30일, 최소 활성 원금 100,000원. 실채굴을 공개하기 전에 이 규칙을 버전 런타임 정책으로 발행한다. 둘째 이율은 없다. 발행 시각부터 적용하고, 끝난 정산은 소급하지 않는다. | 승인된 숫자가 이미 있다. 새 이율은 회원과 원장을 갈라 놓는다. |
| M4 | 첫 공개 제품에 실채굴을 넣는다. 채굴이 제품이다. 규칙이 발행되고, 그 릴리스 SHA에서 원장 틱이 증명되기 전에는 실채굴을 켜지 않는다. 체험 START는 그 전부터 둔다. 입금 없이 한 번, 상한 KRW 5,000. | 채굴 없는 출시는 다른 제품이다. 체험은 입금 전에 앱을 이해하게 한다. |
| M5 | 10만 원 미만 화면의 한 문장: 「10만 원 이상 넣어 두셔야 채굴이 시작돼요.」 버튼은 입금 하나다. 등급표는 보여 주지 않는다. | 왜 멈추는지 한 문장이면 된다. 표는 다음 행동을 가린다. |
| M6 | 정산 프로세스는 Node `workers/runner.mjs`와 잡 `FUNDING_MINING_TICK_V1`이다. Cloudflare Worker로 옮기지 않는다. 그 프로세스를 띄울 호스트는 실행 게이트다. | 계산은 이미 SQL과 Node 잡이다. Worker는 두 번째 런타임이다. |
| A1 | Cloudflare 모델 단계는 빼 둔다. 모델 id가 생기기 전에는 넣지 않는다. id를 만들지 않는다. | 없는 모델은 장애를 답으로 만든다. |
| A2 | 무료 체인의 두 번째는 NVIDIA `google/diffusiongemma-26b-a4b-it`다. | 이미 코드에 있는 무료 모델이다. 유료로 건너뛸 이유가 아니다. |
| A3 | 하이쿠 예산은 확보되어 있다. 추가 예산 문서를 기다리지 않고, `anthropic/claude-haiku-5.5`를 체인에서 빼 두지 않는다. AI 화면이 켜지면 무료 체인 다음에 게이트에 걸릴 때 이 모델을 **한 번** 부른다. `paidCallAuthorized`는 그 홉만 참이다. 하이쿠는 잔액, 입금 승인, 채굴 보상을 바꾸지 못한다. 첫 공개 홈에는 AI가 없다. | 느린 답과 틀린 금액은 전국 사용자에게 해가 된다. 유료는 그 한 번으로 끝낸다. 홈의 돈 흐름은 모델에 기대지 않는다. |
| A4 | 첫 공개 회원 화면에서 AI를 뺀다. `/ai`와 `/menu/ai`는 하단 동료 버튼이 아니다. 그 화면을 켜는 날의 런타임은 A3이다. 답이 없으면 실패로 닫는다. | 모든 연령의 돈 앱이 무료 모델의 가용성에 기대면 안 된다. |
| L1 | 가입은 약관·개인정보 본문에 묶인 버전 동의 기록이 있어야 끝난다. 법률가의 본문 서명은 실행 게이트다. 그 본문이 연결되기 전에는 `/terms`, `/privacy`, 가입 동의를 출시 체크리스트 PASS에 넣지 않는다. 화면 문구는 짧게 둔다. | 동의 없는 가입은 전국 서비스가 아니다. 이 문서가 법률 문장에 서명하지 않는다. |
| G1 | 출시 자세는 비공개 저장소와 보호된 `main`이다. GitHub에서 바꾸는 일은 실행 게이트다. | 공개되고 보호되지 않은 `main`은 출시 자세가 아니다. |
| H1 | `mining.putduk.com`과 `admin.mining.putduk.com`은 출시 때 스테이징 워커를 서빙하지 않는다. 컷오버는 그 SHA의 full E2E가 녹색이고, 경제가 발행되고, 동의가 연결되고, 결합이 분류된 뒤에만 한다. DNS 변경은 실행 게이트다. | 스테이징 주소는 운영이 아니다. |
| C1 | 운영 결합은 UNKNOWN이며 컷오버를 막는다. | 모르는 결합을 안전으로 적지 않는다. |
| P1 | 공개 트래픽 전에 PostHog를 둔다. 동의 뒤, 비밀이 없는 이벤트만 보낸다. AI를 켜는 이유가 아니다. 운영 키를 넣는 일은 실행 게이트다. | 출시 뒤 고장을 보려면 기록이 필요하다. 기록에 비밀을 넣지 않는다. |
| Q1 | `D:\PUTDUK-MINING-QA`가 없으므로 D:로 PRODUCT COMPLETE를 서명하지 않는다. 현재 증거는 로컬 `test-results/`다. D:를 다시 연결하는 일은 실행 게이트다. | 없는 디스크의 증거를 있는 것처럼 쓰지 않는다. |
| U1 | 첫 공개 회원 표면은 아래 여정이다. 한 화면, 한 메시지, 한 주 버튼. 상품 둘러보기, 이벤트, 알림, AI는 첫 화면에서 뺀다. 운영자 최소 큐는 입금, 출금, 예외, 회원, 경제 발행이다. | 한 가지를 끝내면 된다. 동료 버튼이 많으면 채굴이 흐려진다. |

M3의 유지 혜택은 같은 승인 안의 조건부 몫이다. 새 이율이 아니다. 주기가 끝날 때까지 원금이 남아 자격이 생기기 전에는 받은 돈으로 보여 주지 않는다.

---

## 유저가 보는 여정

라우트는 이 커밋에 있다. 하단은 지금 `components/navigation/product-navigation.tsx`가 홈·채굴·상품·지갑·더보기다. 출시 하단은 **홈·채굴·지갑·더보기**다. 앱은 아직 그렇게 줄어 있지 않다.

홈의 주 버튼은 하나다. 이미 켜져 있으면 「채굴 중」은 상태이고 두 번째 버튼이 아니다.

| 순서 | 경로 | 한 문장 | 한 버튼 |
| --- | --- | --- | --- |
| 1 | `/signup` (`app/signup/page.tsx`) | 계정만 만들면 시작돼요. | 가입하기 |
| 2 | 가입 동의. 본문 링크는 `/terms`, `/privacy` (`app/(trust)/[...document]/page.tsx`) | 필수 내용을 확인하고 동의해요. | 동의하고 시작 |
| 3 | `/login` (`app/login/page.tsx`) | 다시 들어오면 이어서 볼 수 있어요. | 로그인 |
| 4 | `/home` (`app/(product)/home/page.tsx`) | 채굴을 시작해요. | 채굴 시작 |
| 5 | `/start` (`app/(product)/start/page.tsx`) | 앱을 닫아도 채굴은 계속돼요. | 결과 보기 |
| 6 | `/wallet` (`app/(product)/wallet/page.tsx`) | 쌓인 금액이에요. | 출금 신청 |
| 7 | `/wallet/withdraw` | 최대 5,000원까지 출금할 수 있어요. | 출금 신청 |
| 8 | `/wallet/deposit` (`app/(product)/wallet/deposit/page.tsx`) | 입금은 확인 후 반영돼요. | 입금 신청 |
| 9 | `/mining` (`app/(product)/mining/page.tsx`), 10만 원 미만 | 10만 원 이상 넣어 두셔야 채굴이 시작돼요. | 입금하기 |
| 10 | `/mining`, 실채굴 중 | 넣아 둔 돈으로 채굴 중이에요. | 결과 보기 |
| 11 | `/wallet` 뒤 `/wallet/withdraw` | 출금할 수 있는 원화를 신청해요. | 출금 신청 |
| 12 | `/menu`, `/menu/account` | 계정과 약관을 볼 수 있어요. | 계정 |

7은 체험 출금이다. 입금은 그 출금의 조건이 아니다. 11은 실채굴 원화 출금이다. USDT로 나가는 출금도 원화 잔액 기준이다. 회원에게 USDT 잔액이라고 말하지 않는다.

휴대폰 문구는 가입할 수 있는지, 이미 쓰였는지다.

운영자 화면은 회원이 보지 않는다. 경로는 `apps/admin/app/(control)/` 아래다.

- 입금: `deposits/krw`, `deposits/usdt`
- 출금: `withdrawals/krw-bank`, `withdrawals/usdt`
- 예외: `exceptions`
- 회원: `members`
- 규칙 발행: `economy`

관리자 `login`, `mfa`, `reauth`는 그 큐의 문이다.

첫 화면에서 뺀다. `/products`, `/products/allocation`, `/events`, `/events/[slug]`, `/events/notices/[slug]`, `/notifications`, `/menu/notifications`, `/ai`, `/menu/ai`. 추천은 `/menu`의 부가 링크다. 초대는 제한하지 않는다. 표준 자동 지급 상한은 유지한다. 같은 IP만으로 거절하지 않는다.

동의 본문이 법률 승인과 연결되기 전에는 2번을 PASS로 적지 않는다. 가입 코드는 `app/signup/actions.ts`에서 버전 동의 기록을 쓰려 한다. 승인된 본문이 연결됐다는 뜻은 아니다.

---

## 채굴 규칙

회원에게 보이는 말: **넣아 둔 돈에, 발행된 비율을, 서버가 센 시간을 곱한다.** 앱을 닫아도 시간은 흐른다. 10만 원 미만이면 실채굴이 시작되지 않는다.

서버 기호:

- 원금 `p_principal_atomic`: 남은 Eligible Funding Principal. 승인된 KRW 입금, 수신 확인 후 KRW 원금으로 잡은 USDT-TRC20, 명시적 principal correction만 넣는다. 가입·환영·이벤트·추천·프로모션·채굴·관리자 보너스, BONUS, MINING_REWARD는 원금이 아니다.
- 기본 비율 `p_base_bps`: 발행 정책의 `baseCycleRateBps` **1500**. 30일 Capacity는 그 원금의 15.00%다.
- 주기 `cycleDays` **30**. 함수 인자 `p_cycle_microseconds`.
- 경과 `p_elapsed_microseconds`: 상태 cursor부터 서버 now까지. 주기 끝과 정책 `effective_until` 중 이른 시각을 넘기지 않는다.
- 최소 활성 원금 `minimumPrincipalKrw` **100000**. 미만은 `FUNDING_BELOW_MINIMUM`.
- 기본분: `principal_atomic × base_bps × elapsed_microseconds × allocation_bps / (10000 × cycle_microseconds × 10000)`
- 함수: `app_private.funding_exact_condition_interval`
- 잡: `app_private.process_neutral_funding_condition_job`, 타입 `FUNDING_MINING_TICK_V1`
- 정수 KRW만 적립하고 나머지는 carry다. 원금이 0 이하면 함수가 거절한다.
- 정책 행이 없으면 적립하지 않는다. 화면 상수로 메우지 않는다.

같은 승인의 유지분은 `principal_atomic × retention_bps × elapsed_microseconds / (10000 × cycle_microseconds)`다. `p_qualify_retention`이 참일 때만 확정 금액에 들어간다. 회원 화면은 이것을 이미 받은 돈으로 보여 주지 않는다.

발행 대상은 `docs/product/economy-v1-approved-2026-10-03.json`의 `PUTDUK-MINING-V1-2026-10-03`이다. 설명은 `docs/product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md`다. 운영 DB에 발행됐는지는 **NOT PROVEN**이다. 원격으로 발행하는 일은 실행 게이트다.

**ACTUALLY RUNNING: NOT PROVEN.** 이 커밋에 워커가 떠 있다는 증거가 없고, 승인 1500 bps가 유효 발행 행인지도 확인하지 않았다. full E2E 10/12 실패는 엔진이 죽었다는 증거도, 회원 채굴이 돈으로 이어진다는 증거도 아니다.

`domain/mining/calculate-settlement.ts`의 `calculateSettlement`는 `baseRateAtomicPerSecond × 경과 × 배수`다. 원금 인자가 없다. `app/`, `lib/`, `workers/`, `components/`, `packages/`에서 이 함수를 호출하지 않는다. 회원 보상 경로로 쓰지 않는다. `public.record_mining_settlement`는 다시 열지 않는다.

Node `workers/runner.mjs`는 금액을 계산하지 않는다. 금액은 SQL이 만든다.

체험은 다른 장부다. `docs/product/PUTDUK-START.md`: 최대 24시간, 사용량 100%, 입금 불필요, 실제 원화 전환은 한 번, 상한 KRW 5,000. 체험 적립은 실채굴 원금이 아니다. 둘을 한 종류의 수익으로 합치지 않는다.

---

## AI

첫 공개 홈과 하단에 AI를 두지 않는다. 아래는 AI 화면을 켤 때의 런타임이다. 그 화면은 아직 켜지 않는다.

지금 이 작업 공간의 공급자 호출은 **NOT RUNNING**이다. `app/api/v1/ai/chat/route.ts`는 `paidCallAuthorized: false`를 넘긴다. `isAiProviderDispatchAdmitted`는 `APP_ENV === "production"`이면 거절한다. `AI_PROVIDER_DISPATCH_ENABLED`가 여기 프로세스에서 `true`가 아니면 호출하지 않는다. 키 값은 적지 않는다.

코드에 있는 모델 id (`lib/ai/provider-models.ts`):

| 순서 | 제공자 | 모델 id | 지금 코드의 등급 |
| --- | --- | --- | --- |
| 1 | NVIDIA `https://integrate.api.nvidia.com/v1/chat/completions` | `openai/gpt-oss-20b` | trial |
| 2 | NVIDIA 같은 URL | `google/diffusiongemma-26b-a4b-it` | trial |
| 3 | OpenRouter `https://openrouter.ai/api/v1/chat/completions` | `apodex/apodex-1.1-mini:free` | free. 엔드포인트 태그 `novita/bf16` |
| 4 | OpenRouter 같은 URL | `anthropic/claude-haiku-5.5` | paid. 엔드포인트 태그 `anthropic` |

`MemberAiProvider`는 `"nvidia" | "openrouter"`뿐이다. Cloudflare / Workers AI 모델 id는 없다. `@cf/` 호출도 없다.

결정된 체인:

1. 무료를 이 순서로 시도한다. `openai/gpt-oss-20b`, 다음 `google/diffusiongemma-26b-a4b-it`, 다음 `apodex/apodex-1.1-mini:free`.
2. 유료 `anthropic/claude-haiku-5.5`는 무료 답이 전국 사용자에게 너무 느리거나 충분하지 않을 때만, 한 질문당 한 번 부른다. 연구용 점수표는 만들지 않는다. 게이트는 세 가지다.
   - (a) 짧은 서버 시간 안에 쓸 수 있는 글이 없다. 그 시간은 기존 `AI_FIRST_TOKEN_TIMEOUT_MS`다. 기본 2000ms, 허용 1000–90000ms. 새 평가 시간을 만들지 않는다.
   - (b) 빈 답, 오류, 거절.
   - (c) 초안에 서버 데이터가 아닌 금액, 잔액, 채굴 이율, 승인이 있다.
3. (a) 또는 (b)이면 그 무료 시도는 실패다. 다음 무료 모델이 있으면 그 모델로 간다. 유료로 바로 건너뛰지 않는다.
4. (c)이면 그 초안을 회원에게 보여 주지 않는다. 남은 무료 모델을 더 시키지 않고 하이쿠를 한 번 부른다.
5. 무료 셋이 모두 (a) 또는 (b)로 끝나면 하이쿠를 한 번 부른다.
6. 하이쿠도 게이트에 걸리면 실패로 닫는다. 두 번째 유료 호출은 없다. Cloudflare로 넘어가지 않는다.
7. 무료 키가 없어 그 모델을 부르지 못한 것은 게이트 실패가 아니다. 하이쿠로 넘어가지 않고 실패로 닫는다.
8. `paidCallAuthorized`는 이 하이쿠 홉에서만 참이다. 무료 홉은 참이 아니다.
9. 하이쿠는 돈을 움직이지 않는다. 입금을 승인하지 않는다. 채굴 보상을 정하지 않는다.
10. 아무도 답하지 않으면 실패로 닫고, 정직한 안내만 한다.

무료 초안은 게이트를 통과하기 전에 회원 화면에 흘리지 않는다. 지금 코드의 `mayFallbackBeforeAnswer`는 글자가 보이기 전 `NETWORK`, `FIRST_TOKEN_TIMEOUT`, `HTTP_5XX`, `PROVIDER_RATE_LIMIT`만 다음 모델로 보낸다. (b)의 거절, (c)의 금액 검사, 하이쿠 홉의 `paidCallAuthorized: true`는 아직 코드에 없다. AI 화면을 켤 때 구현한다. 첫 공개를 그 구현이 끝날 때까지 막지 않는다. 첫 공개는 AI를 켜지 않기 때문이다.

서버 가드 `AI_CUMULATIVE_PAID_CAP_MICRO_USD`는 남긴다. 그 가드가 결정된 한 번의 하이쿠를 막으면, 그 한 번이 되게 가드를 맞춘다. 상한을 없애거나 다른 유료 모델을 더하지 않는다. 새 예산 문서를 기다리지 않는다.

---

## 패치 순서

### 엔지니어링

로컬에서 한다. 원격 적용, 푸시, DNS, GitHub 설정, 유료 호출은 하지 않는다.

1. 하단을 홈·채굴·지갑·더보기로 줄이고, 위 여정의 한 문장과 한 버튼을 맞춘다. 돈 공식을 클라이언트에 넣지 않는다.
2. 실채굴 적립은 발행된 정책과 `funding_exact_condition_interval` / `FUNDING_MINING_TICK_V1`만 쓴다. `calculateSettlement`와 `record_mining_settlement`는 회원 보상 경로로 쓰지 않는다. 정책이 없으면 적립하지 않는다.
3. 로컬 DB에서 남은 원금 × 경과 영수증, 같은 잡의 재시도 멱등, 체험 장부와의 분리를 증명한다.
4. 입금 확인 → 원금 → 틱 → 지갑 조회 → 출금 신청. 명령 이름은 WS-04 그대로다. USDT 문구는 수동 입금과 원화 출금이다.
5. full E2E lane 10/12의 원인을 고친다. 단언을 약하게 만들거나 spec을 지우지 않는다. 좁은 재실행만 한다.
6. PostHog는 동의 뒤의 허용 이벤트만 코드에 연결한다. 이벤트에 비밀을 넣지 않는다. AI 체인과 묶지 않는다.
7. AI 화면용 게이트 (a)(b)(c)와 하이쿠 한 번을 코드로 준비할 수 있다. 첫 공개 내비게이션에는 올리지 않는다. 운영 스위치는 켜지 않는다. 유료 호출은 하지 않는다.

### 실행 게이트

기계가 대신하지 않는다. 제품 질문이 아니다. 이 문서가 실행을 허가하지 않는다.

| 게이트 | 통과 조건 |
| --- | --- |
| 법률 서명 | 승인된 약관·개인정보 본문이 `/terms`, `/privacy`와 가입 동의 버전에 연결됨 |
| GitHub | 저장소 비공개, `main` 보호. 사람이 설정에서 실행 |
| 경제 발행 | `PUTDUK-MINING-V1-2026-10-03`이 버전 런타임 규칙으로 발행됨. 소급 없음 |
| 원격 DB | Supabase `osrmyjgmpdspdcwqjwuv` 적용은 별도 승인 |
| full E2E | 그 릴리스 SHA의 `ci-full-e2e`가 녹색. lane 10/12를 삭제로 지우지 않음 |
| 결합 | UNKNOWN이 아님. 분류 전 컷오버 금지 |
| DNS | `mining.putduk.com`, `admin.mining.putduk.com`이 그 SHA의 운영 아티팩트를 봄. 스테이징 워커가 아님 |
| 워커 호스트 | Node 정산 프로세스의 상시 실행. Cloudflare Worker가 아님 |
| D: | `D:\PUTDUK-MINING-QA` 재연결. 없어도 로컬 증거로 개발은 계속한다. D: 없이 PRODUCT COMPLETE를 서명하지 않는다 |
| PostHog 키 | 운영 프로젝트 키 투입. 값은 문서에 적지 않는다 |
| AI 화면 | 첫 공개의 게이트가 아니다. 켤 때는 위의 체인과 실패 폐쇄가 코드에 있어야 한다 |

공개 컷오버는 다음이 한 SHA에 모인 뒤에만 한다. full E2E 녹색, 경제 발행, 동의 연결, 결합 분류. 하나라도 없으면 컷오버하지 않는다.

---

## 이 문서가 허가하지 않는 것

- `mining.putduk.com`, `admin.mining.putduk.com`의 DNS 전환과 Worker 교체
- 원격 Supabase 마이그레이션과 데이터 변경
- 운영에서의 실제 입금 반영, 실제 출금, 실제 채굴 적립
- 저장소를 비공개로 바꾸는 일, `main` 보호를 켜는 일
- 푸시, develop/main 머지, 운영 배포
- PRODUCT COMPLETE 또는 LAUNCH READY 선언
- 승인 JSON에 없는 새 이율
- `calculateSettlement` 또는 `record_mining_settlement`를 회원 보상으로 쓰는 일
- 체험 5,000원과 실채굴을 한 종류의 수익으로 합치는 일
- 첫 공개 홈에 AI를 올리는 일
- 지금 유료 AI를 호출하는 일, 운영에서 `AI_PROVIDER_DISPATCH_ENABLED`를 켜는 일
- 하이쿠가 잔액, 입금 승인, 채굴 보상을 바꾸는 일
- 하이쿠를 한 질문당 두 번 이상 부르는 일
- 없는 Cloudflare 모델 id로 Workers AI를 만드는 일
- 스테이징 워커 기록을 운영 출시로 부르는 일
- UNKNOWN 결합을 안전으로 두고 컷오버하는 일

로컬 패치, 로컬 데이터베이스, 좁은 테스트, 이 문서의 수정은 위 허가 없이 할 수 있다. 그 작업이 끝나도 출시 준비는 아니다.

---

## 판정 한 줄

채굴: **SPECIFIED** (남은 원금 × 발행 1500 bps × 서버 경과, 30일, 최소 100,000원). **IMPLEMENTED IN CODE** (`funding_exact_condition_interval`, `FUNDING_MINING_TICK_V1`). **ACTUALLY RUNNING NOT PROVEN.**

AI: 첫 공개 화면에서는 꺼 둔다. 화면을 켤 때의 체인은 무료 `openai/gpt-oss-20b` → `google/diffusiongemma-26b-a4b-it` → `apodex/apodex-1.1-mini:free`, 그리고 게이트 때의 `anthropic/claude-haiku-5.5` 한 번이다. Cloudflare는 없다. 지금 런타임은 **NOT RUNNING**이고 라우트는 아직 `paidCallAuthorized: false`다.

출시: **최종 아키텍처 결정됨. 출시 준비는 아니다.**
