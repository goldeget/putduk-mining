# 후보195 — CI 기준과 USDT fixture 소비 계약

상태: CODE_AUTHORED / STATIC_REVIEW_ONLY / NOT_TESTED.
이 문서는 백엔드 후보의 검증 기준이며 CI 통과·전체 백엔드 완료·출시 승인 증거가 아니다.

## 역사적 기준 보존

191·193 JSON/source guard/config/consumer, 현재152 principal native basis, 기존
USDT SQL/Python/E2E 원본을 변경하지 않는다. 새195 guard는 고정된
183→187→188→191→193 지도를 읽어 계보를 확인한 뒤 신규194/195 migration
정확2개와 Worker·AI usage 변경2개, AI/admin API·strict 증빙 helper 추가3개를
명시적으로 대조한다. 실제 SQL 경로 집합 전체가195와 정확히 같아야 하며
최소 개수·현재파일 재해시·환경변수·과거 통과 로그로 우회하지 않는다.

canonical63421/63422와 LOCAL_QA65421/65422는 각기 닫힌 entry를 사용한다.
현재 로컬 QA config를 canonical CI용으로 자동 복원하거나 바꾸지 않는다.
manifest, guard 자체 및 source-guard unit 간 해시 순환은 만들지 않으며
자체 guard/검증 명세의 bytes는 독립 리뷰와 외부 감사 manifest로 기록한다.
새195 해시 pin은 해당 후보의 정적 소스 식별이며 기능 테스트 승인과 다르다.

## backend 전용 소비자

- scripts/ci-backend-195.mjs: --plan은 소스 식별·필수 게이트 목록만 반환한다.
  SQL/프로세스/HTTP/테스트를 실행하지 않는다. 이번 작업에서도 호출하지 않았다.
- playwright.backend-http-195.config.ts: 실제 회원/관리자 HTTP 계약 명세
  usdt-manual-full-payout-195.spec.ts만 backend-api 프로젝트로 수집한다.
  APP_ENV=test, canonical loopback Supabase, E2E_WITH_ADMIN_SERVER=1,
  E2E_NEXT_START=1을 요구하며 기존 화면 코드를 수정하지 않는다.
- assertBackend195ExecutionReport는 제공된 보고서의 형식·소스/run 식별·
  필수 게이트 누락/중복·skip/flaky/expected-failure·시각/해시 필드를 검사한다.
  그 자체는 원시 artifact 해시나 실제 실행을 입증하지 않는다.
  반환 reportContract=VALIDATED를 테스트 PASS로 해석하지 않는다.
- assertBackend195HttpCoverage는 현재 동일 소스/config 수집 목록과 실행 목록의
  project/file/key 정확 일치, 모든 expectedStatus=passed, 단일 retry0 passed
  결과를 요구한다. UI_PENDING을 skip/expected-failure로 숨기지 않는다.

필수 게이트는 type, lint, unit195, native195, acl195,
externalSendConcurrency195, http195이다. 계획의 native/경합 항목은 검증해야
할 adapter 경로 설명이며 SQL/Python 실행 결과가 아니다. 실제 실행 시
원시 pgTAP/HTTP/Python 보고서·시작/종료·정확한 source/run metadata·artifact
해시를 별도 수집하고, 구193 로그를 새195 보고서로 가져오지 않는다.

## USDT fixture 원칙

신규 정상 송금만 strict v1 증빙과 등록 네트워크 원본을 명시한다.
fullPayoutConfirmed:true는 synthetic fixture 호출자가 분명히 선언해야 하며
과거 NULL/opaque 증빙이나 변조 input을 factory가 정상화하지 않는다.
금액은 정수/정확한 문자열로 유지하며 수수료0·전액 수동 지급이다.
synthetic KRW/USDT 조합을 승인 환율/환전율로 해석하지 않는다.

새 native adapter는 원본 SHA와 정확한 치환 구간/개수를 먼저 확인하고
허용된 등록 이력·증빙 입력·exact 증빙 assertion만 별도 후보로 바꾼다.
다른 원장·분개·잔액·principal seal·clock·request 금액·경합/replay assertion은
보존한다. 원본 파일과 pinned152/191/193 hash는 덮어쓰지 않는다.
API fixture의 합성 준비는 실제 금융 데이터/송금이 아니며 native proof PASS도
아니다. 실제 Auth/TOTP/server proof/session/one-use stepup은 HTTP에서 검증할
명세를 작성하되 이번 단계에서는 사용자·세션을 생성하지 않는다.

## 기존 CI 및 잔여 검증

기존 .github/workflows/ci.yml과 ci-authenticated-shards.mjs,
playwright.backend-http-193.config.ts는 그대로 둔다. 새backend195 계획은
기존 application/database/browser/authenticated8/worker/typography gates를
삭제하거나 대체하지 않는다. 새 job을 실제 wholeCI에 연결하는 후속 단계에서는
ci-wall-clock.mjs의 exact required job 목록도 함께 검증해야 한다.
현재 자동화 workflow/원격 CI를 새로 실행하지 않는다.

default db:test의 구USDT fresh NULL fixture, 원본 concurrency의 등록 이력/
generic 증빙, 기존193 unit이 현재 checkout runtime을 복사하는 부분은
195에 그대로 사용할 수 없다. 새로운 adapter 검증과 진짜 historical
immutable fixture 분리를 확인하기 전 전체 suite 통과라고 주장하지 않는다.
기존 성공 assertion을 false 기대·skip·누락으로 바꾸지 않는다.

진짜 before194→195 upgrade에서 legacyNULL identical receipt replay와
이미 완료된 원장 재조회가 유지되는지, 미완료 증빙 부족이 완료되지 않는지는
별도 격리 DB 검증 대기이다. trigger를 끄거나 새195 DB에 강제 old receipt를
삽입해 upgrade라고 주장하지 않는다.

기존 관리자 화면은 {note:...}/null 증빙을 보내므로 UI_INTEGRATION_PENDING.
Worker3 정상 원본 및 lease/retry/원장 부작용0의 실제 체인, AI 실제 DB 무응답/
응답 유실/cancel, 전체 UI 통합 E2E는 별도 검증이다.

현재 모든 test/type/lint/DB/HTTP/Auth/Worker/Docker/provider/CI 실행0.
운영 DB·실제 지급·Push/PR/Merge·배포0. 실행 재개와 원격 반영은 사용자 지시
범위를 따르며 이 문서는 해당 실행 승인을 만들지 않는다.

## 독립 정적 대조 보완

새 195 Playwright 설정은 기존 authenticated 설정의 globalSetup을 명시적으로 해제합니다. 역사 준비 코드가 기존 관리자 비밀번호/email_confirm을 변경할 수 있으므로, 신규 명세가 자체 생성하는 합성 회원·운영자만 사용합니다. 기존 준비 코드와 UI는 수정하지 않습니다. 이 경로 차단은 소스 확인이며 실제 Auth 검증은 NOT_TESTED입니다.

focused unit195 목록에는 ai-persistence-recovery-regression.test.ts도 포함합니다. 기록 복구·소유자 분리·중복 복구·redaction 회귀 명세를 해시 보호에만 두지 않고 향후 필수 검사 대상으로 지정합니다. 아직 실행 결과는 없습니다.

--plan은 향후 실행 시 Git 메타데이터 조회를 수행합니다. 신규 entry가 기존 collectCiSourceEvidence의 readGit 인자에 git --no-optional-locks와 30초 timeout을 주입해 index 선택적 갱신을 막습니다. 기존 helper는 보존합니다. 게이트·서버·SQL 실행은 하지 않는 설계이며 이번에는 --plan 및 guard도 호출하지 않았습니다.
