# PUTDUK Admin release lane — Primary 인수

통합 대상은 `develop`입니다. `main`은 초기 문서 스캐폴드입니다. 이 변경은 Admin 코드 검토·통합 후보이며 **전체 Admin 제품 출시 완료를 의미하지 않습니다**. 공유 기능과 실제 인증·DB 검증은 아래 gate를 완료해야 합니다.

## 기준과 범위

- 저장소: `goldeget/putduk-mining`
- 브랜치: `parallel/admin-release`
- 구현 기준: `origin/develop` = `0a7e95ba8bf55539fe32fd6f4654ee49a0be226d`
- `origin/main` = `fbea85eebf1084bfc02bf1c452392b20f2f497ce`; develop이 420 commits 앞섬
- 첫 구현 체크포인트: `4d1c341ac3f858e235e2d26804cb048648dec9c3`
- 변경 범위: `apps/admin/**`, Admin 전용 authenticated E2E 3개와 기존 Admin browser fixture
- member `app/**`, 금융 엔진, ledger/withdrawal 실행, migrations, RLS, 공용 API 계약, lockfile은 변경하지 않음

## 구현된 동작

홈은 원화 입금 대기까지 실제 조회하며, 조회 실패 → 안전 모드 → 거래·작업 예외 → 출금 → 본인 확인 → 입금 순으로 다음 행동을 안내합니다. 안내가 우선 대기열을 가리지 않도록 배치했습니다. 작업 체크는 이 화면의 메모리 표시이며 서버 완료·서비스 정상 판정이 아닙니다.

회원은 UUID 입력 대신 등록 이름의 정확 일치 검색과 최근 20명 목록에서 선택합니다. 기존 회원 상세와 금전 표시를 재사용하고, 조회된 회원 맥락을 사실·판단 참고·추천·미확인으로 나눕니다. 신규 목록은 운영자·고객 지원 역할만 서버에서 조회할 수 있습니다.

| 화면 | 현재 실제 기능 | 남은 연결 |
| --- | --- | --- |
| `/operations/events` | 기존 행사 일정·상태 조회, 편집 가능한 안내 초안 | 승인된 행사 게시·예약·예산 명령 |
| `/operations/notices` | 기존 공지 조회, 미리보기 후 복사하는 초안 | 승인된 발행·예약·취소 명령 |
| `/operations/notifications` | 전달 시도·상태 기록 조회 | 승인된 발송·재시도·수신 확인 |
| `/operations/support` | 회원·거래 확인 안내, 답변 초안 | 실제 접수함·답변 저장·발송 |
| `/operations/ledger` | 기존 확정 거래 목록과 회원 연결 | 상세 금액·잔액·영수증을 연결한 최소 조회 계약 |
| `/operations/mining` | 실제 세션 상태·정산 시각과 회원 연결 | 실제 서버 실행·정산 정상 여부의 통합 검증 |
| `/operations/audit` | 실제 작업·대상 종류·기록된 운영 권한·시각 | 필요한 별도 감사 drilldown 계약 |
| `/operations/analytics` | 최근 24시간 가입·이용 기록 건수 | 고유 이용자·전환·추이의 승인된 집계 계약 |
| `/operations/system` | 상태 보고·자동 작업·격리 기록 | 실제 health·heartbeat·복구 명령 연결 |

모든 신규 조회는 이름 있는 고정 테이블·최소 열, 최신 20건, 정확 건수, 8초 제한을 사용합니다. 알 수 없는 상태는 확인 필요로 남기고, 실패·누락·불일치 응답을 0건으로 바꾸지 않습니다. 지원 접수함은 연결되지 않았다고 표시합니다. 외부 모델에 회원·금전·위험·감사 원문을 보내지 않습니다.

기존 입출금 승인, TOTP, 서버 명령과 최종 금액 미리보기는 재사용합니다. 신규 유사 입금 표시는 현재 대기 목록의 같은 회원·통화/네트워크·정확한 금액을 비교하며, 중복 이체를 확정하거나 자동 반려하지 않습니다. 예외 증거는 알려진 항목만 한국어로 보여주고, unsafe number·낯선 payload·식별자는 해석하지 않습니다. 원본 증거와 예외 저장 명령은 바꾸지 않았습니다.

전역 `이 화면 안내`는 현재 화면의 확인 순서와 주의점을 설명합니다. 운영 요약은 실제 조회 값을 결정적으로 정리합니다. **자연어 모델 AI가 연결된 제품으로 표현하지 않았습니다.** 기존 USDT 운영 초안 흐름은 유지합니다.

글 초안은 미리보기 → 운영자 검토 → 복사까지입니다. 게시·전송 버튼과 성공 상태를 만들지 않았습니다. 편집하면 검토가 해제되며, 5분 만료·연결 끊김·pagehide·기존 운영 세션 무효화 때 지웁니다. 세션 무효화 후 편집을 막고 재인증을 안내합니다. 늦은 clipboard 응답으로 오래된 완료 안내를 복구하지 않습니다. 역할 변경 시 기존 provider의 메모리도 새로 만듭니다.

## 검증 증거

- Node `24.21.0`, pnpm `12.6.0`, Supabase CLI `2.113.0`; frozen lockfile 설치 PASS
- 전체 Admin 단위 검사: 39 files / 346 tests PASS; 마지막 상태·감사 표시 수정 관련 19 tests 추가 검증 PASS
- Admin typecheck, 범위 내 ESLint, production build PASS
- 실제 시스템 Chromium `151.0.7922.173`: 98개 컴포넌트 브라우저 QA PASS
- 화면 폭 320 / 390 / 834 / 1440, Light / Dark, reduced motion, 11개 실제 컴포넌트 화면, 메뉴·화면 안내 키보드 닫기·조회 실패/빈 상태 구분·미리보기·실제 clipboard·편집 무효화·offline 삭제 검증
- 결과: `test-results/admin-release-component-qa/results.json`; 스크린샷 32개와 소스 SHA-256 포함
- 승인된 Visual Lab의 Admin Today 데스크톱 Dark 목업과 실제 Today/공지 스크린샷을 열어 검토했습니다. 우선 작업 배치를 수정했습니다. 픽셀 완전 일치 판정이나 인증된 서비스 화면 검증으로 확대하지 않습니다.

브라우저 fixture는 실제 컴포넌트에 **명시적인 합성 데이터**를 넣습니다. 서버 모듈·명령·외부 요청을 차단하며, 로그인·권한·실제 금융 처리의 E2E 증거가 아닙니다. 공식 Playwright 1.63 bundled Chromium과 Firefox/WebKit은 미검증입니다.

```sh
# 저장소 루트: 고정 Node/pnpm 활성화 후
pnpm --dir apps/admin typecheck
pnpm --dir apps/admin test
pnpm exec eslint apps/admin --max-warnings=0
pnpm --dir apps/admin build

# 별도 터미널에서 Admin 전용 UI fixture 서버
node apps/admin/tests/browser/server.mjs
# 이 Linux 환경에서 검증한 실제 시스템 Chromium
PUTDUK_UI_TEST_EXECUTABLE=/usr/bin/chromium node apps/admin/tests/browser/operator-lane.mjs
```

Primary의 로컬 DB가 준비되면 기존 authenticated runner에서 최소 `admin-today`, `admin-members-product`, `admin-exceptions-product`, `admin-assistant-read-draft`, 영향받은 입금 E2E를 실행해야 합니다. 신규 조회 화면의 실제 역할·권한 취소·미허용 역할·읽기 실패도 검증해야 합니다. 동일 프로젝트의 격리된 로컬 DB만 사용하세요.

## 공유 backend 요구 — Primary 소유

1. **게시·발송**: 현재 도메인의 승인된 공지/행사 게시·예약·취소, 알림 발송·재시도 계약이 필요합니다. 현재 상태 readback, 대상·기간·예산 영향 preview, 현재 역할·세션·origin·필요한 step-up, 같은 논리 요청의 idempotency, 실제 영수증·audit·outbox를 일반 UI와 같은 명령으로 연결해야 합니다. 이 lane은 별도 RPC·테이블·자동 지급 코드를 만들지 않았습니다.
2. **지원**: 승인된 지원 채널의 실제 문의 ID·회원 연결·접수 시각·담당/상태·답변 기록을 최소 권한으로 읽는 계약, 답변 저장/발송의 영수증·감사 계약이 필요합니다. 확인되지 않은 접수 건수나 발송 완료를 넣지 않았습니다.
3. **거래·지갑**: 기존 확정 거래와 entry·wallet projection·withdrawal receipt를 연결하는 승인된 최소 조회가 필요합니다. 통화와 금액의 정확한 문자열 단위, 현재 총/가용 잔액, 조회 시각·부분 coverage·권한을 명시해 주세요. 현재 회원의 자금 출처/자격 요약을 전체 실시간 지갑 잔액으로 취급하지 않습니다.
4. **Admin AI**: `docs/architecture/ADMIN-OPERATIONS-ASSISTANT.md`의 기존 registry·prepare·최종 서버 실행 경계를 사용해야 합니다. 추가 도메인의 승인된 이름 있는 조회와 편집 가능한 실제 양식 매핑을 먼저 확정해 주세요. private context는 결정적으로 요약하고, 외부 모델은 승인된 공개 문구·비식별 초안 구조에만 비용·개인정보·품질 gate 후 연결해야 합니다.
5. **집계·관측**: 실제 고유 이용자·전환·추이·최장 대기/SLA, worker heartbeat·stale 기준·복구 명령 계약이 필요합니다. 현재 단순 기록 건수나 과거 정상 보고로 이를 대신하지 않습니다.
6. **실제 권한 검증**: 신규 조회 테이블의 현행 `service_role` grant와 현재 관리자 역할을 로컬 migrations 기준으로 검증해 주세요. 필요한 경우 named minimal read를 Primary가 확정해야 합니다. 이 lane은 grant/RLS/security policy를 변경하지 않았습니다. 조회 거부는 UI에서 확인 필요로 남습니다.

## 남은 환경 및 출시 gate

로컬 Supabase/Docker의 `vfs` layer 등록이 `no space left on device`로 실패했습니다. 원격/production DB를 대체 테스트 대상으로 쓰지 않았습니다. 실제 로그인·권한 취소·금전 승인·DB/RLS E2E와 최종 전체 CI가 BLOCKED입니다.

Cloud setup 설치 스크립트·Secondary Admin 시작 스킬·비밀 아닌 기본 변수 4개·package-manager preset + `cdn.playwright.dev`, `public.ecr.aws` 설정은 draft에 저장했습니다. secret은 추가하지 않았습니다. 저장은 Publish/실제 네트워크 적용이 아닙니다. 최종 사용자 UI의 **Publish 한 단계**가 남아 있습니다. 공식 Chromium 다운로드 차단과 Supabase 디스크 문제를 해결한 뒤 재검증해야 합니다. 자동 설치에서 비밀번호 prompt를 기다리지 않도록 root일 때만 시스템 browser dependency 설치를 실행합니다.

GitHub Git 읽기와 feature push dry-run은 PASS; `api.github.com` 읽기는 현재 Forbidden입니다. CI는 모든 `pull_request`에서 전체 작업을 시작하므로 실제 PR 생성·최종 전체 CI·develop 통합은 Primary가 소유합니다. 아래 제목과 본문으로 PR을 준비할 수 있습니다. production branch push/merge/deploy는 하지 않습니다.

## 준비한 PR

제목: `feat(admin): 초보 운영 화면과 안전한 운영 도우미 연결`

본문: 오늘의 우선 작업, 이름 기반 회원 선택, 9개 역할 제한 조회 화면과 화면별 사용 안내를 추가한다. 기존 입출금 명령을 재사용하며, 정확한 유사 입금 비교·한국어 예외/감사 표시·검토 후 복사하는 메모리 초안과 세션/5분 만료를 적용한다. 조회 실패는 확인 필요로 남긴다. Admin 타입/lint/build 및 단위·실제 컴포넌트 browser 검사는 PASS. 실제 인증/DB E2E, 미구현 공유 명령과 모델 연결, 전체 출시 gate는 이 인수 문서에 명시한다.
