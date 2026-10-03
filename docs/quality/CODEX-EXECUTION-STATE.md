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

## 첫 PR 병합과 CI 시간 보강

- PR #42: head `59b5a99d72e140d267e46d2947c2bef3c42d5ff1`, run `37096613181` success. 최초 생성 `2026-10-03T04:27:40Z`부터 최종 종료 `04:46:05Z`까지 **18분 25초**. 품질 job 17개는 모두 success였다.
- 병합: `04f5a152390fb54c36574f7593c54561fa122bbf`, 2026-10-03 `04:47:07Z`, develop 정상 merge. 병합 전 fsck·누락 객체·origin 도달성·정확한 head를 확인했다.
- 병합 push CI `37097690478`: **success / POST_MERGE_VERIFIED**. `2026-10-03T04:47:10Z`부터 `05:03:34Z`까지 **16분 24초**. 16개 품질 job success, PR 전용 Exact diff integrity만 skip이다. PR 성공과 post-merge 성공은 별도 증거다.
- PR #42 shard 1 로그에는 KYC 검사 **1 flaky / 24 passed**가 있다. 첫 시도 실패 후 retry로 성공한 상태이며, 무결점이나 출시 완료 증거로 확대하지 않는다. 로그: `D:\PUTDUK-MINING-QA\codex-2026-10-03T04-12-29-350Z-16dabeea\logs\pr42-slowest-shard.log`.
- 원인: KYC 서버 액션이 성공과 함께 대기열을 갱신해 해당 카드가 제거되는데, 결과 메시지가 제거되는 카드 안에 있었다. 후속 변경은 유지되는 대기열 경계에 서버 성공 결과를 표시하고, E2E에서 결과 메시지·카드 제거·DB 상태·성공 스크린샷을 함께 확인한다. 권한·TOTP·명령은 그대로다.
- 사용자의 전체 CI **20분 이내** 요구를 반영한다. 생성부터 대기·빌드·후속 검사·증거 저장을 모두 포함하며 가장 긴 단일 job으로 계산하지 않는다. 새 `ci-budget` job은 전체 품질 job 17개와 정확한 run/attempt/head를 확인한다. 18m30s 미완료는 종료 여유를 확보해 취소·실패 처리한다. 검사 축소·assertion 완화·부분 실행을 성공으로 기록하는 방식은 금지다.
- 후속 CI에서는 네 Playwright 계층에 `--fail-on-flaky-tests`를 적용한다. retry는 진단에 남기지만 첫 실패 후 retry 성공을 green으로 받아들이지 않는다. KYC 결과는 다음 작업을 시작할 때 이전 성공을 지우며, 카드가 먼저 사라진 뒤 서버 응답이 도착해도 유지된다. 최종 focused 4 tests·타입 검사 PASS: `codex-2026-10-03T05-04-07-735Z-58303d45`, `codex-2026-10-03T05-04-15-553Z-d6b8e1d1`. 이번 소유 파일 format/lint는 `codex-2026-10-03T05-01-20-875Z-428cb044`에서 PASS였다. 새 테스트의 React 작성 규칙 오류는 수정 뒤 별도 검사했다.
- 후속 로컬 증거: 전체 회원 65 files / 604 tests PASS (`codex-2026-10-03T04-41-53-399Z-cad95ced`), Git 목록 lint PASS (`codex-2026-10-03T04-41-53-437Z-3a579dd2`), 두 앱 typecheck PASS (`codex-2026-10-03T04-48-59-915Z-674f4869`), KYC 제거 전후 결과 전달 단위 3 tests PASS (`codex-2026-10-03T04-52-25-416Z-30a0669a`). 초기 타입 검사 실패는 선언 파일·테스트 타입을 보완한 뒤 재검증했다. 최종 후보의 CI를 대신하지 않는다.

## 다음 순서

- PR #42 병합 SHA push CI 확인 → CI 20분·KYC 결과 보강 PR의 정확한 head 검증 → develop 정상 병합 → 병합 SHA push CI 확인. 시간 게이트를 develop 필수 검사에 추가하되 기존 strict 검사와 bypass 금지는 유지한다. push/merge 전 fsck·누락 객체·정확한 origin을 검증한다.
- USDT DB 승인: 같은 키의 다른 payload, 다른 입금과 충돌한 키, 동시 승인, 원장·지갑·audit·outbox 일치. 새 migration만 사용하고 공유 테스트 DB를 초기화하지 않는다. 일회용 CI DB에서 검증한다.
- 운영자 공통 명령과 운영 도우미: 현존 명령을 재사용하고 별도 AI 지급 코드를 만들지 않는다. 간단한 입력·대상·시점·미리보기·확인 UI를 기본으로 한다. AI는 초안·설명·조회만 하고 운영자의 최종 실행은 같은 권한·작업 확인·명령 경계를 지난다. 기존 문서의 P2 운영 AI 표현과 이번 요구의 차이는 후속 계약 변경에서 함께 정리한다.
- 원금/정책/상품 → 서버 실채굴 정산 → outbox/worker 소비자 → 관리자/AI → 실제 데이터에 연결된 Scene·연출 → 제품 수준의 화면·접근성·성능 증거 순으로 닫는다.
- 경제 수치, 추천 수령자 등 미결 정책, 비주얼 master 승인, staging/production 대상은 임의로 확정하거나 활성화하지 않는다. 이 조건에 의존하지 않는 구현·검증은 계속한다.

기준 계약: `WS-04-DOMAIN-COMMAND-CONTRACT.md`, `LEDGER-RECONCILIATION.md`, `DOMAIN-EVENTS-OUTBOX.md`, master architecture, visual/motion/Visual Lab, `GIT-CI-CD-POLICY.md`, `DEFINITION-OF-DONE.md`. 현재 저장소에 없는 보고서나 과거 다른 구현을 추측해서 보충하지 않는다.
