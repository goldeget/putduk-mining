# Codex 연속 작업 상태

기록일: 2026-10-03 KST. 상태: **IN_PROGRESS / NOT RELEASE READY**.

## 권한과 기준

- 소스·Git: `C:\Users\PC\Desktop\putduk-mining`.
- 원격: `https://github.com/goldeget/putduk-mining.git`만 허용.
- 검증 결과·임시 파일: 실행마다 새 `D:\PUTDUK-MINING-QA\codex-...` 폴더. D:는 `ESD-USB`, FAT32.
- 사용자가 2026-10-03 커밋·push·PR·develop 병합·CI 완료를 승인했다. 필수 검사나 보호 규칙을 우회하지 않는다.
- 원격 Supabase, Cloudflare, DNS, 배포, 실송금은 기존 잠금을 유지한다.
- 시작 HEAD/develop: `0a5ea7e5a66f801d59d82147629cf6caa9f85ffe`.
- PR #41 push run `37092611992`는 위 병합 SHA에서 success로 확인됐다. PR 전용 Exact diff integrity는 skip이고 다른 16개 job은 success였다. 확인 시각: 2026-10-03 12:39:37 KST.
- develop ruleset `24403592`: strict 필수 검사 16개, 승인 수 0, bypass 없음, force push/삭제 차단. merge queue는 사용하지 않는다.

## 첫 변경 범위

1. Windows QA 결과·로그·TEMP를 D:로 보낸다. source/origin/volume을 확인하고 기존 수정 파일 hash를 비교한다. 단위 검사 worker는 둘로 제한한다.
2. 관리자 송금·안전 모드 검토 시각을 한국 시간 입력에서 UTC로 변환한다. 잘못된 날짜는 작업 확인을 소비하기 전에 거절한다.
3. USDT 입금 성공은 실제 입금·원장·지갑의 연결과 금액이 맞을 때만 표시한다. 다른 금액, 누락, 조회 실패, 응답 끊김은 성공으로 표시하지 않는다. 원화 RPC 인자는 정수 문자열로 전달한다.
4. START 남은 시간의 “이내” 문구는 올림한다. 서버 보상이나 자격 계산은 바꾸지 않는다.

기존 public RPC 이름·권한·원장·outbox 모델을 유지한다. DB 승인 명령 자체의 USDT payload 재시도 보강은 후속 변경이다.

## 로컬 증거

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

## 다음 순서

- 첫 PR: 정확한 head의 모든 CI job 확인 → develop 정상 병합 → 병합 SHA push CI 확인. push/merge 전 fsck·누락 객체·정확한 origin을 검증한다.
- USDT DB 승인: 같은 키의 다른 payload, 다른 입금과 충돌한 키, 동시 승인, 원장·지갑·audit·outbox 일치. 새 migration만 사용하고 공유 테스트 DB를 초기화하지 않는다. 일회용 CI DB에서 검증한다.
- 운영자 공통 명령과 운영 도우미: 현존 명령을 재사용하고 별도 AI 지급 코드를 만들지 않는다. 간단한 입력·대상·시점·미리보기·확인 UI를 기본으로 한다. AI는 초안·설명·조회만 하고 운영자의 최종 실행은 같은 권한·작업 확인·명령 경계를 지난다. 기존 문서의 P2 운영 AI 표현과 이번 요구의 차이는 후속 계약 변경에서 함께 정리한다.
- 원금/정책/상품 → 서버 실채굴 정산 → outbox/worker 소비자 → 관리자/AI → 실제 데이터에 연결된 Scene·연출 → 제품 수준의 화면·접근성·성능 증거 순으로 닫는다.
- 경제 수치, 추천 수령자 등 미결 정책, 비주얼 master 승인, staging/production 대상은 임의로 확정하거나 활성화하지 않는다. 이 조건에 의존하지 않는 구현·검증은 계속한다.

기준 계약: `WS-04-DOMAIN-COMMAND-CONTRACT.md`, `LEDGER-RECONCILIATION.md`, `DOMAIN-EVENTS-OUTBOX.md`, master architecture, visual/motion/Visual Lab, `GIT-CI-CD-POLICY.md`, `DEFINITION-OF-DONE.md`. 현재 저장소에 없는 보고서나 과거 다른 구현을 추측해서 보충하지 않는다.
