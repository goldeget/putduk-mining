# 백엔드 후보195 — 실행 보류 중 추가 연결 계약

CODE_AUTHORED / STATIC_REVIEW_ONLY / NOT_TESTED. 실행 보류는 유지된다.
이 문서는 기존195 소스 지도 또는 전체 CI를 대체하지 않는다. 코드·명세 작성은 실행 성공이나 출시 승인이 아니다.

## 단일 USDT 실행의 CI 연결

기존 scripts/ci-backend-195.mjs 및 191/193/195 지도와 runner를 보존한다.
새 scripts/ci-backend-195-usdt.mjs는 실행 승인 이후 사용할 단일 소유자다.
native195와 externalSendConcurrency195를 각각 실행하지 않고,
원래 runner 한 번의 krw→principal→concurrency 결과에서 두 게이트를 소비한다.

--plan은 향후 소스/Git 읽기 전용 계획이다. 이번 작업에서는 --plan도 호출하지 않았다.
실행 entry는 원래 runner의 --execute / --allow-synthetic-db-writes /
--confirmed-full-payout / --fresh-container-id / --output 다섯 인자를 그대로 요구한다.
플래그·키·로컬 코드 존재는 사람이 승인한 실행 범위를 확대하지 않는다.

수수료는 영구0, 입금은 운영자 확인, 지급은 운영자 직접 송금 후 완료다.
USDT 보유 지갑·온체인 자동 송금·가격 API·승인 환율은 추가하지 않는다.
KRW native80, principal388, concurrency 로컬39/정규CI41은 소스에서 확인한
기대 계약이며 새 PASS 결과가 아니다.

새 artifact 소비자는 실제 execution.json 및 krw.sql/principal.sql/concurrency.py
bytes를 artifact manifest와 대조한다. 현재 Git source/run/attempt와 child 시각,
고정195/runner/guard pins, 같은 컨테이너 lease, 파생 원본의8/3/2 단일치환,
phase 순서·exit0·proof·타임라인을 대조한 뒤 두 게이트 형식을 만든다.
LOCAL_QA artifact는 정규CI 게이트를 생성하지 않는다.

runner UUID, source.runId(GitHub 숫자), concurrency.run(16hex)는 각각 다른 식별자다.
둘을 같은 ID로 변환하지 않는다. child가 실패/timeout이면 DB 결과 UNKNOWN,
부분commit 가능성·재시도 금지를 기록한다. 안전한 종료/시간/해시 메타데이터만
현재 CLI 로그 및 소유가 확인된 외부 증거 디렉터리에 기록한다.

원래 runner는 raw SQL/Python stdout을 보존하지 않는다. 따라서 소비자는
저장된 parser proof와 artifact provenance를 확인할 뿐 raw TAP을 다시 판독했다고
주장하지 않는다. 반환 artifactContract=VALIDATED는 함수 계약 확인이며
독립적 실행 진위 증명이나 whole-CI PASS가 아니다.

외부18분 child 상한은 whole-CI20분 예산을 늘리지 않는다. 실제 시간·메모리·
Docker호환·취소가 DB에 미치는 영향은 검증 대기다. timeout으로 원래child/DB가
모두 멈췄거나 rollback됐다고 가정하지 않는다. 해당 컨테이너는 다시 쓰지 않는다.

## 전체 CI 통합 경계

기존 workflow/ci-wall-clock/package scripts/193 consumer/config는 보존한다.
원래 database job은 native fixture를 이미 commit한 뒤의 DB를 사용할 수 있어
새 runner의 fresh/empty preflight와 충돌한다. 준비 순서와 실제 fresh195 DB,
canonical config 및 whole17-job/20분 completeness를 함께 해결해야 한다.

새 plan은 기존 type/lint/unit/native/ACL/concurrency/HTTP 필수 게이트를 유지하며
unit 명세에 runner·artifact·HOLD receipt 회귀를 추가한다.
새 콘텐츠 준비 descriptor 명세는 관리자 test suite에 있고 전체 application test
및 source 검증 대상이다. workflow 등록이나 GitHub Actions 실행은 하지 않았다.

실제 HTTP195 inventory/리포트, ACL raw TAP, type/lint/unit 결과, Worker 원본 정상
연결, UI 전체 E2E는 별도 필수 증거다. 저장한 두 게이트만으로
assertBackend195ExecutionReport를 full PASS로 만들지 않는다.

## HOLD 해제 응답 보완 후보

현재 고정195 API는 release_withdrawal_hold 결과 뒤 disposition을 요청값으로
돌려준다(route260–279). SQL20261006133350:241–248은 이미 완료된 원래UUID를
돌려주므로 REJECTED 완료 후 CANCELLED 재요청에서 응답과 원본이 상충할 수 있다.
P2 정적 계약 불일치이며 실제 금전 손실/재현을 확인한 것이 아니다.

새 apps/admin/lib/withdrawals/hold-release-receipt.ts는 실제 request/REVERSAL 원장/
2개 동일금액 분개·원래reason/clock을 대조하고 저장된 처분을 반환한다.
현재 replay key/actor를 기존 원장 key/actor와 같게 요구하지 않는다.
서로 다른 저장 처분이면 적용 대기 API patch는409 actualDisposition을,
null/불일치/read 오류는503 UNCONFIRMED를 반환한다.

이 helper는 계정 UUID·서로 다른 계정·분개 방향과 금액만 검증한다.
account owner/type 자체 조회와 DB 재현은 별도이며 원래 SQL 계정 경계를 대체하지 않는다.
포맷이 다른 동일시각 timestamp는 엄격한 readback에서 UNCONFIRMED가 될 수 있으므로
실제 PostgREST 직렬화·microsecond 계약은 실행 검증 대기다.

외부 evidence의 RELEASE_HOLD_READBACK_PROPOSED.patch와 proposed route를 준비했지만
원래 route에는 적용하지 않았다. 원래195 지도는 해당 route SHA를 고정하며
즉시 덮어쓰기하면 기존runner를 차단한다. 이것을 fallback/재해시로 우회하지 않는다.
통합은 BACKEND_INTEGRATION_PENDING: 원본 보존과 별도 후보 revision·source 지도·
HTTP 회귀·CI 수집 목록을 함께 갱신하는 단위다. UI는 수정 대상이 아니다.

## 운영 AI 콘텐츠 준비 포트

apps/admin/lib/assistant/content-source-preparation.ts는 원래 원문 추출 POST
/api/content/source/preview를 가리키는 EVENT/NOTICE/FAQ 준비 catalog다.
원문 parser/handler/endpoint와 기존 USDT assistant operations2개를 복제·수정하지 않는다.
본문은 sourceRevision/sourcePath/sourceSha256/rawSourceText 정확4개이며
descriptor operation/task/kind를 요청 본문에 추가하지 않는다.

원래ba9ed931… 원문30/26/68 pins,512KiB HTTP body,원문 UTF8 bytes·blob,
기존 ADMIN/SUPER_ADMIN/AAL2/origin/session 권한을 재사용한다.
unknown pin400,hash/shape409,body초과413,authority/result불확실503을 그대로 유지한다.
DRAFT_ONLY, canExecute:false/canPublish:false/providerCalled:false/registrationExecuted:false.
별도 AI provider tool 등록·실제 HTTP·게시·보상 권한은 구현하거나 실행하지 않았다.

delta33d87fe…는 별도 제안 버전으로 보존하며 allowlist에 몰래 합치지 않는다.
원본 안내20개/QA 비금전20개/승인 운영보상20개를 같은 집단으로 계산하지 않는다.
QA20개는7가지 원본조건을 반복한다. 현재 승인된 생산보상20종 완료 증거는 없다.

## UI·UX GPT 인계

최신 화면은 아직 미승인이다. 화면/레이아웃/CSS/테마/장면을 수정하지 않는다.
API의 성공·실패·UNCONFIRMED와 fresh proof+immutable payload/key 재시도 계약,
서버 처분·원금/보상 분리·GUIDE 참여불가·DRAFT_ONLY를 UI 인계 계약으로 제공한다.
디자인 제작이 서버 규칙·경제 승인·원장 완료 판단을 대체하지 않는다.

## 이번 작업에서 실행하지 않은 것

source guard/parser/fixture build/구문/type/lint/test/Python/Docker/SQL/HTTP/Auth/
Worker/provider/CI 전부0. 운영DB·지급·stage/commit/push/PR/Merge/배포0.
코드가 안전하게 실행되는지 확인하기 전 백엔드 완료나 출시 가능을 선언하지 않는다.

관련 공식 문서는 읽기 전용으로 확인했다:
- https://supabase.com/changelog
- https://supabase.com/docs/guides/api/securing-your-api
changelog.md 조회는 content-type 오류여서 공식HTML로 확인했다.
연결 키나 권한이 존재한다는 이유로 API/DB 작업을 수행하지 않았다.
