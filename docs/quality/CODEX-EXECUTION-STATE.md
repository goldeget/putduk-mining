# Codex 연속 작업 상태

기록일: 2026-10-03 KST. 상태: **IN_PROGRESS / NOT RELEASE READY**.

## PR #47 통합 후보와 첫 CI의 제한

PR #47의 첫 head `5fe76eb066a58f52ac167a81a5506d28f272a83f`는 canonical
배경·공유 AI·5탭·published-only catalog를 포함했다. run `37126927027`
attempt 1은 인증 검사 실패와 18m30s budget 취소로 **FAILED ACCEPTANCE**다.
이 run의 빌드·DB·135 typography pass를 전체 통과나 제품 완료로 사용하지
않는다. 실제 pixels의 작은 한글 mono 라벨 결함도 별도로 발견했다.

후속 후보는 실제 radio hit area를 label 내부에 고정하고, 현재 경로의
visible 요소·pathname으로 검사와 AI 전용 레이아웃을 결정한다. catalog
fixture의 owner read를 격리 CI에 한정하며 service 권한을 넓히지 않는다.
숫자용 글꼴에도 bundled 한글 fallback을 공급하고 실제 mono 한글 라벨
검사를 추가한다. native dialog·주 스크롤·상세 focus 복귀를 보존한다.

승인 JSON의 SHA `158c81e91923ba31f57b457ae3a33bc4092455e4abe2a2c888d5b5d2bc33b9e0`
를 그대로 DB seed와 CI 검증에 결합했다. 서버 전용 BigInt preview는 정책
receipt/digest, 고정 cycle, lot effective time, forward proration, 하나의
global capacity와 carry를 검사한다. **PREVIEW_ONLY**이며 wallet·정산을
쓰지 않는다. 관리자 정책 저장·검토·승인·미래 발행은 append-only 버전,
fresh 권한·AAL2·bound session·one-use step-up·동일 key receipt를 사용한다.
운영자의 다음 버전에서 숫자를 바꿀 수 있으며 초기 운영값을 영구 상수로
고정하지 않는다. 정책 outbox는 consumer 연결 전 보류 상태다.

retired POST와 exact legacy seven-argument RPC의 service 실행 권한을 닫는다.
기존 owner fixture·historical rows·현대 request command·START 첫 출금은
보존한다. source-aware reserve/release/finalize·principal recovery·실채굴
DB writer·worker settlement는 후속 구현 대상이다. 원금 회수 시 lot 배분
선택은 별도 사용자 답변 전 활성화하지 않는다.

후속 head의 전체 18-job CI, 실제 pixels 및 develop 병합 CI는 별도 gate다.
원격 Supabase/Cloudflare/DNS/배포/실제 지급 잠금과 보호11개는 유지한다.

## 2026-10-03 후속 승인과 asset 등록

사용자가 시각 선택을 위임했고 기존 clean semiconductor master
`5d398a3155635d46a6d0b1f639c25d349ddf21607a16a4e6f948655744b8a6dd`를
앱용으로 채택했다. runtime `2026.10.03-semiconductor-memory-v1`의 전체
구도 AVIF/WebP8종이 추가되어 manifest는 `2026.10.03-v3`/96종이다.
기존88 entry digest와 파일 bytes를 보존했다. memory family만 approved,
다른13개 family는 pending이다. 기본 배경은 explicit registry로 정하며
world/code/name/회원 상태에서 상품을 추론하지 않는다.

asset verifier96종, brand unit9개, builder syntax, decoded geometry/hash가
통과했다. AVIF 최소41.067dB, WebP4종 resized pixel lossless이며640/1539
decoded pixels를 직접 검토했다. 증거는
`D:\PUTDUK-MINING-QA\scene-assets-20261003-2216-9df68e6d`다.
실제 앱 crop/theme/native zoom/성능/접근성/모션/서버 snapshot acceptance는
이 자산 검사와 분리한다. PRODUCT COMPLETE나 출시 완료가 아니다.

경제 V1 운영값은 [후속 승인](../product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md)과
`../product/economy-v1-approved-2026-10-03.json`에서 OWNER_APPROVED다.
아래 이전 "경제 숫자/scene 승인 대기" 기록은 해당 당시의 이력이다.
승인 범위의 값 때문에 구현을 보류하지 않으며 approved server policy로
연결한다. engine/DB/worker/정산의 실제 활성·완료 증거는 아직 별도이고
원격 Supabase/Cloudflare/DNS/배포/실제 지급 잠금은 유지한다.

## 현재 병합 상태

PR #46 최종 head `1b2b0fb4907f22cf8e9582d1c1b924b85bb900c9`의 run
`37114935163` attempt 1은 18개 job success, **18분 5초**다.
develop 병합 `034c78ccc8002c7eb9f34ca70ac88712f1cc16de`의 push run
`37116286293` attempt 1도 **POST_MERGE_VERIFIED**, **17분 20초**다.
2026-10-03 `10:23:57Z`–`10:41:17Z`이며 PR 전용 Exact diff integrity만
skip, 나머지 17개 job은 success다. 정상 merge이며 보호 규칙 우회는 없다.
원금 CREDIT3 capture의 DB·동시성·source 화면 증거와 제한은
`MONEY-SOURCE-CAPTURE-EVIDENCE.md`를 따른다. 제품·출시 완료는 아니다.

다음 작업은 같은 source workspace의 `codex/product-ai-navigation`에서
승인된 5개 탭, 공개 catalog read와 공유 AI session을 하나의 기능 묶음으로
진행한다. batch 7의 전체 robot face와 normal-flow 한 줄 도움 행은 승인됐다.
큰 장면 아래 상세 보기·AI 도움, 그 아래 5탭이며 모바일 전체 대화와 PC
오른쪽 panel/넓게 보기를 따른다. 인계 당시 반도체 scene master와 경제 숫자
승인은 별도 대기였고, 현재 상태는 위 후속 승인을 따른다. 사소한 편집마다 전체 CI를
반복하지 않으며 안정된 후보의 전체 PR CI와 병합 CI는 각각 검증한다.

## 2026-10-03 인계 대조와 재개 범위

- 아래 기존 검사/CI/실패 기록은 각 후보의 이력으로 보존한다. PR46 성공을
  이후 미커밋 UI의 acceptance로 전용하지 않는다.
- 인계는 구현 중단 시점을 기록한 것이다. 현재 재개 권한은 최신 직접 사용자
  지시에 따른다. 기존 보호11개와 소유권 경계, 원격 Supabase/Cloudflare/DNS/
  배포/실송금 잠금은 계속 유지한다.
- runtime manifest는 `2026.10.03-v2`/88종이다. HEAD의 기존84 entry는
  그대로이고 전체 얼굴128/256 AVIF/WebP4종이 추가됐다. source master와
  4종 실제 hash는 인계 대조에서 manifest와 일치했다. 이 대조는 새 asset
  verifier 실행 또는 실제 앱 pixels/성능 PASS가 아니다.
- 승인 얼굴 hash는
  `d7aa8e5c8ddf1215ca3be650699a6c18fe168c9eefbba86a7204718f9d39ffd2`,
  face version은 `2026.10.03-ai-help-face-v1`이다. 전체 구성의 재생성·crop·
  repaint 없이 public derivative를 사용한다. Visual Lab 식별자는 별도의
  `visual-lab-2026.09.27-v1`이다.
- 반도체 master hash
  `5d398a3155635d46a6d0b1f639c25d349ddf21607a16a4e6f948655744b8a6dd`는
  REVIEW 승인 대기다. 제공된 사진은 참고이며 얼굴/배치 승인으로 scene·
  경제 값·runtime activation을 승인하지 않는다.
- 인계 source의 홈/채굴/상품은 Earth이며 Stage allowlist는 비어 있고
  Scene14종은 inactive다. Funding engine/30일 cycle/earned authority와
  V3 server-snapshot HUD는 미연결이다. 현재 값처럼 표시하지 않는다.
- 먼저 기존 AI/nav/catalog/dock의 결함·auth·복구·main 스크롤을 마무리하고
  실제 rendered mobile/PC/keyboard/modal/200%/theme/reduced-motion/성능
  증거를 확보한다. 구현·static 모델·검사·실제 runtime 상태를 구분한다.
- 원본의 사실적 금속·빛·공간 깊이·색상·배경 품질이 화면 기준이다.
  2D/2.5D라는 표현으로 하향 치환하지 않으며 실제 비교 전 100% 일치·
  무결점·렉없음을 달성으로 기록하지 않는다.

## 권한과 기준

- 소스·Git: `C:\Users\PC\Desktop\putduk-mining`.
- 원격: `https://github.com/goldeget/putduk-mining.git`만 허용.
- 검증 결과·임시 파일: 실행마다 새 `D:\PUTDUK-MINING-QA\codex-...` 폴더. D:는 `ESD-USB`, FAT32.
- 사용자가 2026-10-03 커밋·push·PR·develop 병합·CI 완료를 승인했다. 필수 검사나 보호 규칙을 우회하지 않는다.
- 원격 Supabase, Cloudflare, DNS, 배포, 실송금은 기존 잠금을 유지한다.
- 시작 HEAD/develop: `0a5ea7e5a66f801d59d82147629cf6caa9f85ffe`.
- PR #41 push run `37092611992`는 위 병합 SHA에서 success로 확인됐다. PR 전용 Exact diff integrity는 skip이고 다른 16개 job은 success였다. 확인 시각: 2026-10-03 12:39:37 KST.
- develop ruleset `24403592`: 시작 시 strict 필수 검사 16개. PR #43 검증 후 `CI completeness and 20-minute budget`을 추가해 현재 17개이며 integration ID `15368`, strict, 승인 수 0, bypass 없음, force push/삭제 차단이다. merge queue는 사용하지 않는다.

## 첫 변경 범위 — PR42 이전 이력

1. Windows QA 결과·로그·TEMP를 D:로 보낸다. source/origin/volume을 확인하고 기존 수정 파일 hash를 비교한다. 단위 검사 worker는 둘로 제한한다.
2. 관리자 송금·안전 모드 검토 시각을 한국 시간 입력에서 UTC로 변환한다. 잘못된 날짜는 작업 확인 소비 전에 거절한다. 안전 모드 보완 후보는 입력 검증과 원자적 저장·감사·outbox·복구를 같은 기능 묶음으로 검증한다.
3. USDT 입금 성공은 실제 입금·원장·지갑의 연결과 금액이 맞을 때만 표시한다. 다른 금액, 누락, 조회 실패, 응답 끊김은 성공으로 표시하지 않는다. 원화 RPC 인자는 정수 문자열로 전달한다.
4. START 남은 시간의 “이내” 문구는 올림한다. 서버 보상이나 자격 계산은 바꾸지 않는다.

기존 public RPC 이름·권한·원장·outbox 모델을 유지한다. DB 승인 명령 자체의 USDT payload 재시도 보강은 후속 변경이다.

## 초기 로컬 증거 — 현재 UI 후보의 검사 아님

아래 경로는 이 작업이 새로 생성한 QA 결과다. 단위 검사나 CI만으로 제품 완료를 주장하지 않는다.

| 검사 | 결과 | D: 실행 폴더 |
| --- | --- | --- |
| 관리자 전체 단위 검사 | PASS, 20 files / 136 tests | `codex-2026-10-03T04-04-16-253Z-0e5fd951` |
| 회원 전체 단위 검사 | PASS, 64 files / 593 tests | `codex-2026-10-03T04-04-48-392Z-943d334b` |
| 두 앱 typecheck, incremental 쓰기 없음 | PASS | `codex-2026-10-03T04-06-07-130Z-48d11a2c` |
| 브랜드 자산 | PASS, 84 assets | `codex-2026-10-03T04-06-58-786Z-73358f2a` |
| 현재 Git 소스 목록 lint | PASS, 542 files / 6 batches | `codex-2026-10-03T04-19-12-038Z-a0d72a7e` |
| 전체 format | FAIL, 기존 미커밋 5개 파일 | `codex-2026-10-03T04-23-27-406Z-3510a48c` |

실패한 초기 실행도 남겼다. 관리자 전체 검사에서 worker 시작 시간 초과가 있었고, worker 수를 제한한 새 전체 실행은 통과했다. 초기 폴더 순회 lint가 중첩 worktree의 과거 임시 파일을 읽어 `BLOCKED_TARGET_SCOPE`로 중단했다. 해당 파일을 근거로 사용하지 않으며, 이후 실행은 Git 목록과 실제 경로 검사로 제한했다. 기본 ESLint/Prettier도 중첩 worktree를 제외한다.

전체 format 실패 파일은 기존 `putduk-sk-hynix-mining-v3-precision.html`과 authenticated E2E 4개 파일이다. 이 변경에 섞거나 자동 포맷하지 않는다. PR에 포함할 파일은 별도로 검사하고, CI는 커밋된 정확한 후보에서 전체 gate를 실행해야 한다.

C: 여유가 작업 중 크게 변동했다. 소스/Next 빌드/Docker 저장 공간을 D:로 옮겼다는 주장은 하지 않는다. 로컬 production build·DB·browser 실행은 통과로 기록하지 않았고 정확한 후보의 CI 증거가 필요하다.

## 보존한 기존 작업

`docs/quality/WS-05-CLOSURE.md`, `next-env.d.ts`, authenticated E2E 4개 파일은 최초 실행 hash와 일치했다. 기존 미추적 Cursor 규칙, audit/prompt 파일과 Scene HTML도 별도로 보존한다. staging은 이번 소유 파일만 명시한다.

## 첫 PR 병합과 CI 시간 보강

- PR #42: head `59b5a99d72e140d267e46d2947c2bef3c42d5ff1`, run `37096613181` success. 최초 생성 `2026-10-03T04:27:40Z`부터 최종 종료 `04:46:05Z`까지 **18분 25초**. 품질 job 17개는 모두 success였다.
- 병합: `04f5a152390fb54c36574f7593c54561fa122bbf`, 2026-10-03 `04:47:07Z`, develop 정상 merge. 병합 전 fsck·누락 객체·origin 도달성·정확한 head를 확인했다.
- 병합 push CI `37097690478`: **success / POST_MERGE_VERIFIED**. `2026-10-03T04:47:10Z`부터 `05:03:34Z`까지 **16분 24초**. 16개 품질 job success, PR 전용 Exact diff integrity만 skip이다. PR 성공과 post-merge 성공은 별도 증거다.
- PR #42 shard 1 로그에는 KYC 검사 **1 flaky / 24 passed**가 있다. 첫 시도 실패 후 retry로 성공한 상태이며, 무결점이나 출시 완료 증거로 확대하지 않는다. 로그: `D:\PUTDUK-MINING-QA\codex-2026-10-03T04-12-29-350Z-16dabeea\logs\pr42-slowest-shard.log`.
- 원인: KYC 서버 액션이 성공과 함께 대기열을 갱신해 해당 카드가 제거되는데, 결과 메시지가 제거되는 카드 안에 있었다. 후속 변경은 유지되는 대기열 경계에 서버 성공 결과를 표시하고, E2E에서 결과 메시지·카드 제거·DB 상태·성공 스크린샷을 함께 확인한다. 권한·TOTP·명령은 그대로다.
- 사용자의 전체 CI **20분 이내** 요구를 반영한다. 생성부터 대기·빌드·후속 검사·증거 저장을 모두 포함하며 가장 긴 단일 job으로 계산하지 않는다. 새 `ci-budget` job은 전체 품질 job 17개와 정확한 run/attempt/head를 확인한다. 18m30s 미완료는 종료 여유를 확보해 취소·실패 처리한다. 검사 축소·assertion 완화·부분 실행을 성공으로 기록하는 방식은 금지다.
- 후속 CI에서는 네 Playwright 계층에 `--fail-on-flaky-tests`를 적용한다. retry는 진단에 남기지만 첫 실패 후 retry 성공을 green으로 받아들이지 않는다. KYC 결과는 다음 작업을 시작할 때 이전 성공을 지우며, 카드가 먼저 사라진 뒤 서버 응답이 도착해도 유지된다. 최종 focused 4 tests·타입 검사 PASS: `codex-2026-10-03T05-04-07-735Z-58303d45`, `codex-2026-10-03T05-04-15-553Z-d6b8e1d1`. 이번 소유 파일 format/lint는 `codex-2026-10-03T05-01-20-875Z-428cb044`에서 PASS였다. 새 테스트의 React 작성 규칙 오류는 수정 뒤 별도 검사했다.
- 후속 로컬 증거: 전체 회원 65 files / 604 tests PASS (`codex-2026-10-03T04-41-53-399Z-cad95ced`), Git 목록 lint PASS (`codex-2026-10-03T04-41-53-437Z-3a579dd2`), 두 앱 typecheck PASS (`codex-2026-10-03T04-48-59-915Z-674f4869`), KYC 제거 전후 결과 전달 단위 3 tests PASS (`codex-2026-10-03T04-52-25-416Z-30a0669a`). 초기 타입 검사 실패는 선언 파일·테스트 타입을 보완한 뒤 재검증했다. 최종 후보의 CI를 대신하지 않는다.

## 후속 PR/CI 이력과 당시 실행 순서

- PR #43 최종 head `0654ae1ab7feab0c0a9ad203d93b86965c21da96`: PR run `37100084715` success, 전체 **16분 34초**. 실제 KYC 성공 메시지·카드 제거·DB와 화면을 함께 확인했다. 병합 `6c60115dae694fbb20c6ad3b9ca21673cf4eceff`, push run `37101218564` success / **POST_MERGE_VERIFIED**, 전체 **17분 8초** (`05:52:18Z`–`06:09:26Z`). PR 전용 Exact diff integrity만 skip이다.
- PR #44 최종 head `ff9f910238cccbaca3d0e3f330d86047515394db`: PR run `37102198468` success, 전체 **16분 53초** (`06:10:48Z`–`06:27:41Z`). 21 pgTAP files / 572 assertions, 두 세션 KRW 7·USDT 11 assertions, DB lint·advisors가 모두 성공했다. 기존 public USDT 명령에서 payload 충돌·외부 영수증 충돌·불완전 원장을 거절하며 금액·원장·지갑·audit·outbox가 일치하는 영수증만 재사용한다. 병합 `a42c996b414aa32569523604505fcb9cf2e1807b`, push run `37103303899`는 **success / POST_MERGE_VERIFIED**, 전체 **16분 21초** (`06:30:48Z`–`06:47:09Z`)다. 18개 job을 확인했고 PR 전용 Exact diff integrity만 skip이다. 증거: `D:\PUTDUK-MINING-QA\codex-2026-10-03T06-08-46-870Z-f60472d8`.
- Supabase CLI 로컬 도움말 명령 두 건은 자동 승인 검토에서 `blocked by policy`로 실행 전에 거절됐다. 로컬 SQL은 실행 성공으로 기록하지 않는다. 우회하지 않고 동일 후보의 GitHub 일회용 DB 검사 증거로 검증했다. 원격 DB 변경은 하지 않았다.
- 운영 도우미 후보는 제공자 없이 실제 USDT 대기 조회와 5분 메모리 초안을 준비한다. 현재 역할·AAL2·운영 세션·정확한 설정 origin을 다시 확인하고, 기존 입금 화면의 명시적 초안 불러오기만 허용한다. 실제 지급은 기존 action과 TOTP를 사용하며 금액·사유 변경은 확인과 토큰을 지운다. 외부 AI 연결·자동 지급·미구현 기능 실행은 없다. 전체 관리자 단위 210 tests와 두 앱 타입 검사가 로컬에서 통과했으나 전체 후보 CI·브라우저·실제 화면 검토 전에는 FUNCTIONALLY/PRODUCT COMPLETE로 기록하지 않는다.

- PR #43 최초 후보 `bb4c837619dc10d5fbaf8a6e123a9571c984452f`의 run `37098981745`는 18개 job success, 전체 **16분 4초**였다. 시간 게이트도 success다. 다만 내려받은 KYC 승인·반려 스크린샷에서 성공 메시지가 기존 스크롤 위치의 화면 밖에 있었다. 이 후보를 바로 병합하지 않고, 실제 UI가 성공 메시지를 즉시 보이는 위치로 이동하도록 보완한다. 테스트가 임의로 스크롤해 결함을 가리지 않으며 E2E는 `toBeInViewport`를 확인한다. 움직임은 instant여서 reduced motion에서도 추가 애니메이션이 없다. 후속 focused KYC 4 tests와 두 앱 typecheck는 `codex-2026-10-03T05-29-38-921Z-6a4a6844`, `codex-2026-10-03T05-29-54-965Z-77419911`에서 PASS였다. 새 head의 전체 CI를 다시 확인해야 한다.

- PR #45 초기 run `37103975690`은 typography 기대 건수가 새 화면 7개를 반영하지 못해 실패했다. 기존 검사를 삭제하지 않고 기대값을 135 tests / 133 screenshots로 증가했다. 후속 head `bbd617607874efcb7717500b0e4e001140072a3f`의 run `37104572400`은 인증 브라우저 실패가 남아 **cancelled / NOT ACCEPTED**, 전체 **19분 8초** (`06:54:28Z`–`07:13:36Z`)다. 회원 UUID의 전역 선택자가 두 구역과 일치해 선택한 회원의 요약 구역으로 한정했다. API 401을 User-Agent로 추정한 초기 설명은 잘못됐다. 후속 trace에서 APIRequestContext의 Cookie header와 request cookie가 없음을 확인했다. 실제 브라우저의 same-origin fetch로 인증 경로를 검증하며 세션 지문·권한 검사는 완화하지 않는다.
- 후속 typography 실제 스크린샷은 운영 도우미가 정상 세션에서도 연결 실패 메시지를 표시하는 결함을 드러냈다. 공유 production build에는 브라우저 공개 환경값이 없었다. 보호 layout에서 실행 시점의 공개 URL·공개 키만 전달해 auth 구독을 구성하며 비밀 키는 서버에 남긴다. 구독 실패 시 초안 차단은 유지한다. 보완 단위 17 tests와 두 앱 typecheck PASS: `codex-2026-10-03T07-16-25-491Z-6c81994b`, `codex-2026-10-03T07-16-33-351Z-7d5d3d4b`. 새 head의 전체 CI·실제 화면은 아직 미검증이다.
- head `467e5936ff97eacf8cd8e6c6ff709b55c35134cb`, run `37105884120`은 **cancelled / NOT ACCEPTED**, 전체 **18분 55초** (`07:17:55Z`–`07:36:50Z`)다. 135 typography tests / 133 screenshots는 통과했으며 운영 도우미 7개 실제 화면에서 잘못된 세션 메시지가 제거된 것을 확인했다. 인증 browser의 APIRequestContext 401과 desktop 로그아웃 버튼의 viewport 이탈은 남았다. 실패 화면과 trace는 `codex-2026-10-03T06-41-19-399Z-2f6663f7`에 보존했다. 후속 후보는 브라우저 fetch, 스크롤 가능한 메뉴 목록, 항상 접근 가능한 세션 버튼, 모바일 테마 선택과 한국어 글꼴을 함께 보완한다. logout E2E는 강제 click 대신 실제 viewport와 클릭을 검사한다.
- PR #45에 안전 모드의 입력·일회용 확인 순서, 원자적 상태/감사/outbox/논리 키, stale 상태 거절, 원본 영수증 재시도, 연결 실패 복구와 내부 감사 소비자를 함께 묶는다. 기존 명령·테이블을 재사용하며 새 public RPC·AI 실행 권한을 만들지 않는다. 새 migration 두 건은 로컬·원격에서 적용하지 않았으며 정확한 후보의 일회용 CI DB·두 세션 검사·실제 등록 worker로 검증해야 한다. 다른 소비자 미구현을 완료 처리로 숨기지 않는다.
- 이 묶음의 로컬 관리자 전체 **25 files / 230 tests PASS** (`codex-2026-10-03T07-30-15-658Z-120e6bfd`), 안전 모드 worker 단위 **7 tests PASS** (`codex-2026-10-03T07-27-18-231Z-681833a9`), 두 앱 typecheck PASS (`codex-2026-10-03T07-33-34-245Z-73ba3f9e`). SQL·worker runtime·새 화면의 전체 CI 증거를 대신하지 않는다. 사소한 수정마다 push하지 않고 관련 흐름을 로컬 검토·집중 검사 후 한 후보로 공개한다. 최종 PR CI와 develop 병합 SHA CI는 각각 모든 품질 계층을 20분 이내 검증한다.
- 운영 도우미 후보의 정확한 head 전체 CI·화면 검토 → develop 정상 병합 → 병합 SHA push CI 확인. push/merge 전 fsck·누락 객체·정확한 origin을 검증한다.
- USDT DB 승인: 같은 키의 다른 payload, 다른 입금과 충돌한 키, 동시 승인, 원장·지갑·audit·outbox 일치. 새 migration만 사용하고 공유 테스트 DB를 초기화하지 않는다. 일회용 CI DB에서 검증한다.
- 운영자 공통 명령과 운영 도우미: 현존 명령을 재사용하고 별도 AI 지급 코드를 만들지 않는다. 간단한 입력·대상·시점·미리보기·확인 UI를 기본으로 한다. AI는 초안·설명·조회만 하고 운영자의 최종 실행은 같은 권한·작업 확인·명령 경계를 지난다. V1 필수 운영 도우미 계약과 관련 문서의 P2 표현을 함께 정리한 후보를 검증한다.
- 원금/정책/상품 → 서버 실채굴 정산 → outbox/worker 소비자 → 관리자/AI → 실제 데이터에 연결된 Scene·연출 → 제품 수준의 화면·접근성·성능 증거 순으로 닫는다.
- 경제 수치, 추천 수령자 등 미결 정책, 비주얼 master 승인, staging/production 대상은 임의로 확정하거나 활성화하지 않는다. 이 조건에 의존하지 않는 구현·검증은 계속한다.

- PR #45 head `f16a80ef3adf1248e2a6e224a2414dea78456785`, run `37107334766`은 **cancelled / NOT ACCEPTED**, 전체 **19분 8초** (`07:44:15Z`–`08:03:23Z`)다. 일회용 DB 22 files / 606 assertions, KRW 7·USDT 11·안전 모드 6 동시성 assertions와 실제 worker runtime 18 tests는 통과했다. Typography 135 tests / 133 screenshots도 통과했다. 브라우저 두 shard의 운영 도우미 검사는 실제 선택란과 신청이 있어도 `getByLabel`의 전체 label 텍스트 비교가 맞지 않아 각 180초 후 재시도했고, desktop 나머지 검사는 시간 게이트가 취소했다. 실제 접근성 snapshot의 `combobox "입금 신청"`으로 조회한다. 옵션의 `USDT USDT` 중복도 제거한다. 권한·TOTP·시간 제한·retry·assertion을 완화하지 않는다. 원본 logs·실패 화면: `D:\PUTDUK-MINING-QA\codex-2026-10-03T07-44-00-157Z-63be5628`.

- PR #45 head `66c550c2fe2322f963e73edfaccdce407df187b8`, run `37108655192`는 **success**, 18개 job 전체 성공, **16분 50초** (`08:07:49Z`–`08:24:39Z`)다. 그러나 새 실제 화면의 390px 다크 전환 직후 제목이 어둡게 남은 PNG를 발견해 **VISUAL_REVIEW_NOT_ACCEPTED / NOT MERGED**로 유지했다. 계산된 색상의 원인이나 사용자 화면의 지속 시간을 추정하지 않는다. 제목은 현재 테마의 ink를 명시적으로 사용하며 각 테마의 실제 root·제목·초안 제목 색상을 E2E로 확인한다. 고정 sleep·시간 제한 축소·강제 click은 추가하지 않는다. 원본 성공 run/jobs와 pixels는 `D:\PUTDUK-MINING-QA\codex-2026-10-03T08-21-39-921Z-5e120777`에 보존했다. 후속 정확한 head의 전체 CI와 실제 PNG를 다시 검토해야 한다.

- PR #45 최종 head `e9b3c32a5ca7bd232b8261f7f588baa8182117dc`, run `37110294199`는 **success**, 18개 job 모두 성공, 전체 **16분 55초** (`08:36:49Z`–`08:53:44Z`)다. 실제 운영 도우미 320/390/834/1440px × System/Light/Dark 12개 화면과 390px 다크 제목 pixels, 720px 높이 로그아웃의 실제 접근·클릭 증거를 검토했다. 앞선 다크 제목 결함은 이 후보에서 수정·재검증했다. 증거는 `D:\\PUTDUK-MINING-QA\\codex-2026-10-03T08-51-13-057Z-5a9555e6`에 보존했다. scoped 기능·시각 검증이며 전체 관리자 PRODUCT COMPLETE나 출시 증거는 아니다.
- 정상 develop 병합은 `5a7ba0c462307a26788a6f4749e45a0ba4fa64a3`, `2026-10-03T09:04:01Z`다. 부모는 `a42c996b414aa32569523604505fcb9cf2e1807b`와 위 e9b3c32 후보이며 admin bypass 없이 head 일치·17 strict 필수 검사·origin·무결성을 확인했다. 병합 push run `37111792067`는 **success / POST_MERGE_VERIFIED**, 전체 **17분 16초** (`09:04:03Z`–`09:21:19Z`)다. exact repository/workflow/head/attempt와 동일한 18개 job을 확인했으며 PR 전용 Exact diff integrity만 skip, 나머지는 success다. 병합 시점과 최종 raw run/jobs·검증 결과는 `D:\\PUTDUK-MINING-QA\\codex-2026-10-03T09-05-03-452Z-c42540d9`에 보존했다. PR 성공과 push 성공은 독립 증거다.

기준 계약: `WS-04-DOMAIN-COMMAND-CONTRACT.md`, `LEDGER-RECONCILIATION.md`, `DOMAIN-EVENTS-OUTBOX.md`, master architecture, visual/motion/Visual Lab, `GIT-CI-CD-POLICY.md`, `DEFINITION-OF-DONE.md`. 현재 저장소에 없는 보고서나 과거 다른 구현을 추측해서 보충하지 않는다.
