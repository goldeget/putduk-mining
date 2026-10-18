# E2E 에이전트·개발자 워크플로

사람과 AI 에이전트가 동일하게 따르는 **authenticated Playwright** 검증 절차다.
Browser foundation(`pnpm test:e2e`, `playwright.config.ts`)과 분리되어 있다.
실행 계층(FAST / FOCUSED / FULL)은 `docs/quality/WS-05-EXECUTION-CONTRACT.md`와 같다.

Cursor 규칙: `.cursor/rules/putduk-e2e-agent-verification.mdc` (`alwaysApply: true`)

## 목표

- 1건 실패 때문에 **현재 후보의 전체 authenticated inventory** 를 반복 돌리지 않는다.
- triage → **실패·변경 spec만** 재실행 → merge/CI 직전 **full 1회**.
- DB reset과 full E2E를 한 흐름에 묶지 않는다.

## 단계표

| 단계 | 누가 | 할 일 | 허용 명령 |
| --- | --- | --- | --- |
| 0. 준비 | 사람/에이전트 | `supabase start`, env capture, public 3000 / admin 3100 기동 | WS-05 stack |
| 1. FAST | 에이전트 | typecheck, lint, unit/worker | `pnpm typecheck`, `pnpm lint`, `pnpm test:web` 등 |
| 2. FOCUSED | 에이전트 | 변경·실패 spec만 | 아래 «좁은 재실행» |
| 3. triage | 에이전트 | trace, screenshot, 마지막 failing test 이름 기록 | 읽기 전용 |
| 4. 수정 | 에이전트 | 제품/코드 수정 (테스트 우회 금지) | — |
| 5. 재검증 | 에이전트 | 실패 spec + `--last-failed` | `auth:last-failed`, `auth:file`, `auth:grep`, domain 스크립트 |
| 6. FULL | merge/CI 직전 | authenticated 전체 1회 | `pnpm test:e2e:auth:full` |
| 7. evidence | 필요 시 | 스크린샷·리포트 보관 | `test-results/`, `D:\PUTDUK-MINING-QA\…` |

## 좁은 재실행 (npm)

`package.json` — 모두 `playwright.authenticated.config.ts` 기준.

| 스크립트 | 용도 | 예시 |
| --- | --- | --- |
| `test:e2e:auth:last-failed` | Playwright `--last-failed` | `pnpm test:e2e:auth:last-failed` |
| `test:e2e:auth:file` | 단일·여러 spec 파일 (chromium) | `pnpm test:e2e:auth:file -- tests/e2e/authenticated/first-krw-withdrawal.spec.ts` |
| `test:e2e:auth:grep` | 제목/태그 grep (chromium) | `pnpm test:e2e:auth:grep -- --grep "출금"` |
| `test:e2e:auth:one` | chromium + 경로 (기존) | `pnpm test:e2e:auth:one -- tests/e2e/authenticated/<파일>.spec.ts` |
| `test:e2e:auth:smoke` … | domain FOCUSED (기존) | WS-05 표 참고 |
| `test:e2e:auth:full` | FULL regression | merge 직전 1회 |

**주의:** `auth:file`, `auth:grep`, `auth:one`은 `--` 뒤 인자 없이 실행하면 chromium 프로젝트 **전체**가 수집된다.

## GitHub CI (wall-clock hybrid)

**필수 기준:** PR workflow **≤ 20분**, 목표 약 10분. 최초 실행의 `created_at`부터 workflow 종료까지 대기·공유 빌드·후속 job·증거 저장을 모두 포함한다. 가장 느린 단일 job 시간으로 대신하지 않는다. 전체 authenticated suite는 이 20분 예산 밖이다. Cursor rule: `.cursor/rules/putduk-ci-wall-clock.mdc`.

`CI completeness and 20-minute budget`이 병렬로 시작해 현재 시도에서 필수 품질 job 10개를 확인한다. 18분 30초에도 남은 검사가 있으면 종료 여유를 확보하기 위해 취소하고 실패로 기록한다. 일반 취소가 응답하지 않으면 force cancel한다. 최종 workflow 종료 시간도 별도로 확인한다. 전체 재실행은 해당 시도의 시작부터 측정하고, 일부 실패 job만 재실행해 이전 시도의 성공을 합치는 방식은 완료 증거로 인정하지 않는다.

네 Playwright CI 계층은 `--fail-on-flaky-tests`를 적용한다. retry는 원인 조사에 사용하지만 첫 실패 후 retry 성공은 CI 통과로 인정하지 않는다. 실제 TOTP·권한·DB 결과 검사는 유지한다.

### 공유 production build (`e2e-app-build`)

1. `e2e-app-build`에서 **1회** `pnpm build` (회원 + `apps/admin`). `Application gates`의 일반 build 검증과 구분한다.
2. artifact `e2e-next-production`: `.next`, `apps/admin/.next` (repo 상대 경로).
3. 소비 job: **Authenticated smoke gates** 1 lane, **typography-protected** (병렬 가능).

### PR authenticated smoke

- PR CI의 브라우저 회원 검사는 job `Authenticated smoke gates` 하나다. WS-05 focused set만 실행한다: `public-admin-boundary`, `admin-session-totp`, `first-krw-withdrawal`, `first-usdt-withdrawal`, `withdrawal-negative-guards` (chromium)와 `success-visual-evidence` (visual-evidence).
- 관측 hint 합은 약 150초다. Supabase 준비까지 포함해 lane 하나는 약 8–10분을 목표로 한다. 4 lane 이하이며 현재는 1 lane이다.
- `needs: [webserver-lifecycle, e2e-app-build]`. isolated `supabase start` + `db:reset`, prebuilt artifact, **`E2E_NEXT_START=1`**, `--fail-on-flaky-tests`.
- Application job의 `node scripts/ci-authenticated-shards-201.mjs --verify-only`는 전체 inventory의 12 lane 배정 계획만 검사한다. PR에서 전체 브라우저 suite를 실행하지 않는다.

### release full authenticated suite

- `.github/workflows/ci-full-e2e.yml`은 `develop`, `main`, `release/**` push와 `workflow_dispatch`에서 전체 inventory를 12 lane으로 실행한다. pull_request에서는 실행하지 않는다.
- `scripts/ci-authenticated-shards-201.mjs i/12`가 `TIMING_HINTS`로 각 파일·브라우저 조합을 통째로 배분하고, 누락·중복·예상 밖 test를 거절한다. 현재 테스트는 각각 정확히 한 번 실행된다.
- lane job timeout은 **60분**, Playwright step 상한은 **50분**이다. 20분 PR 예산과 18분 30초 취소는 이 workflow에 적용하지 않는다.
- 이 workflow가 그 release SHA에서 green이기 전에는 production deployment를 하지 않는다. Run `39127210925`의 브라우저 시간 합은 약 9519초였고, 12·14·16·18·24 lane은 모두 20분 PR 예산 안에 끝내지 못했다.
- Playwright browser cache는 `actions/cache@v5`, key `~/.cache/ms-playwright`.
- authenticated config의 기본 CI reporter는 `line`이다. scheduler는 목록을 JSON으로 수집하고 실제 실행에 `line`과 outcome reporter를 사용한 뒤 `playwright-report/ci-shard-evidence/`에 민감한 원문을 제외한 plan·coverage·execution 증거를 저장한다. `github` reporter는 사용하지 않는다. slow 상한은 `reportSlowTests: { max: 5, threshold: 480_000 }` (`9cfc2ef`).
- 실제 TOTP 대기, 개별 테스트 시간, assertion, retry는 유지한다. 시간 초과·취소는 실패이며 일부 검사를 통과로 바꿀 수 없다. 12 lane을 넘기지 않는다.

### worker와 후보 출처 증거

- worker JSON reporter는 실제 실행을 `test-results/worker/vitest.json`에 저장한다. `assert-worker-report.mjs`는 현재 step 이후의 시작 시각, 비어 있지 않은 결과, 합계 일치, 모든 test 통과를 확인한다. 실패·skip·todo는 전체 worker gate 통과가 아니다.
- 업로드할 `test-results/worker/report.json`에는 source/run identity, test 수, 파일, test 이름 hash, status, duration만 담는다. 원문 오류·console·env·payload는 보관하지 않는다. `worker-runtime` 업로드는 이 파일이 없으면 실패한다.
- PR CI는 head와 base를 결합한 synthetic merge checkout을 검증할 수 있다. source SHA와 candidate head SHA, parent SHA, run/attempt를 함께 기록한다. dirty local tree는 로컬 증거로만 기록하며 commit SHA 검증으로 확대하지 않는다.
- 모든 job 종료 뒤 전체 20분 예산과 필수 artifact를 다시 확인한다. 이전 SHA의 green run은 현재 변경분이나 develop 병합 뒤의 검증을 대신하지 않는다.

### typography-protected

- `needs: [e2e-app-build]` — 동일 artifact download.
- Playwright webServer step env **`E2E_PREBUILT_APPS=1`** → `scripts/typography-protected-servers.mjs`는 member/admin **build 생략**, next start만.

### job 의존 (요약)

```text
e2e-app-build ─┬─► Authenticated smoke gates (needs webserver-lifecycle)
               └─► typography-protected
(parallel) application, database, browser, worker, typography-public, …
(parallel) ci-budget ─► PR job 10개 완료·20분 판정 / 미완료 시 취소
push develop|main|release/** ─► ci-full-e2e.yml authenticated ×12 (60분 job)
```

### PR #39 검증 run 증거 (review/pr38-cde4b203)

| run ID | head SHA | conclusion | 비고 |
| --- | --- | --- | --- |
| `36963225127` | `048e882` | success | 단일 authenticated job baseline (~67m wall) |
| `36973023878` | `ad0d147` | success | 8-shard, 16 job 전부 success, wall ~16m |
| `36975011504` | `2f349c9` | cancelled | merge queue 우선 취소 + Application gates TS (`reportSlowTests`); 후속 `9cfc2ef` |
| `36975512027` | `9cfc2ef` | success | **최종 green**, check annotation **0건**, wall ~16m |

위 표는 PR #39 당시의 역사적 baseline이다. 현재 후보는 실제 checkout과 최신 inventory를 사용한다. 과거 branch/worktree나 test 수를 현재 출처·합격 증거로 대신하지 않는다.

## 허용 / 금지

### 허용

- 실패한 spec만 반복 (횟수는 합리적 범위; hung 규칙 준수).
- 동일 SHA에서 authenticated **full 최대 2회** (1차 baseline + 수정 후 최종 1회).
- `db:reset` 후 **focused / last-failed / 단일 file** 만 실행.
- PowerShell 로그: `pnpm test:e2e:auth:file -- … 2>&1 \| Tee-Object -FilePath D:\PUTDUK-MINING-QA\run.log -Append`

### 금지

- 1건 실패마다 `test:e2e:auth:full` 반복.
- `pnpm db:reset` 직후 곧바로 full E2E (stack·seed·env 안정 전).
- assertion 완화, `test.skip`, `test.only`, spec 삭제로 green 만들기.
- 동일 SHA에서 full **3회째** (사용자 또는 CI 승인 없이).
- push, merge, 원격 CI (명시 승인 전).
- production coupling이 UNKNOWN인 원격 작업. GitHub hook/app/배포 정책을 확인할 수 없으면 안전으로 간주하지 않는다. live 영향이 가능한 작업은 정확한 대상·SHA·효과에 대한 사람의 명시 승인이 필요하다 (`GIT-CI-CD-POLICY.md`).
- PowerShell `pnpm … *> log.txt` 만 켜 두고 **block_until_ms / Tee-Object 없이** 장시간 방치.

## hung 판정

다음이 **동시에** 10분 이상이면 hung으로 본다.

- `test-results/` 및 터미널 로그 **크기·줄 수 무증가**
- Node/Playwright CPU 사용 **idle에 가까움**

조치: 프로세스 중단 → 마지막 running test 이름, PID, 로그 tail 50줄, `test-results/` 하위 trace 경로 기록 → triage(단계 3)로 복귀. **무한 대기 금지.**

## evidence 경로 예

| 종류 | 경로 |
| --- | --- |
| Playwright 산출물 | `<repo>/test-results/`, `<repo>/playwright-report/` |
| run별 QA 보관 (승인·D: 확인 후) | `D:\PUTDUK-MINING-QA\20261002-pr38-e2e-triage\screenshots\` |
| 실패 trace | `test-results/<project>-<spec>-chromium/trace.zip` |

## 에이전트 체크리스트 (요약)

1. full을 돌렸는가? → 실패 시 **last-failed / file / grep** 으로 좁혔는가?
2. reset과 full을 같은 명령 체인에 넣지 않았는가?
3. 이번 SHA에서 full 횟수 ≤ 2 인가?
4. skip/only/약화 diff가 없는가?
5. hung 10분 규칙을 지켰는가?

### 2026-10-14 12-lane 대체 근거

기존8lane은R7의확장된256test/97project-file groups에서21분51초로미수락됐다. 실제관측85그룹합6252.317초와준비wholeoffset최대320.120초는숫자재배치만으로20분수락을증명하지못한다. 12개의격리runner·측정기반placement로대체하며21quality+budget22jobs/필수17artifacts를검증한다. 역사적PR39의8lane증거는보존한다. 197보호209/native332를유지하며현재201scheduler의source binding만명시재검토한다. 새후보의실제전체CI가1200초내완료돼야수락한다.

### 2026-10-14 상품 배정 화면 검사 분리

R10 run38472778218의 모바일 상품 배정 단일 검사는 360초 한도로 실패했다.
같은 파일에서 검사 이름만 나누면 scheduler의 file/project 묶음이 유지되므로,
배정된 홈·지갑의 dark/light를 네 개의 독립 spec 파일로 분리한다.
각 파일은 실제 승인·게시·입금·배정을 새 UUID/회원/운영자와 AAL2로 준비한다.
공유 helper는 준비 절차와 화면 검사를 재사용하지만 계정·금융 상태를 공유하지 않는다.

원본 core의 금융·소유자·영수증·재실행·거부 검증과 일반 6행렬 48상태를 유지한다.
분리한 네 spec은 각각 7너비×1테마×4글자배율의 28상태를 검사한다.
48+112=기존 160상태이며, 모든 스크롤 캡처·최소 금액 글자 크기·기하·장면
검증을 유지한다. 256은 이전 후보의 inventory이지 고정 합격 숫자가 아니다.
새 독립 검사가 추가되면 새 inventory와 12개 lane의 합집합·중복 없음·실행 결과를
다시 확인한다. 반복 준비 비용과 각 단위의 실제 시간은 새 후보에서 측정한다.
아직 완료된 시간 관측이 없는 새 단위와 core는 배치용 추정치 360초를 사용한다.
이는 기존 단일 검사 시간 한도를 변경하지 않으며 실제 실행 시간 증거가 아니다.
분리나 시간 추정만으로 20분 수락 또는 제품 완료를 선언하지 않는다.

### 2026-10-18 14-lane 대체 근거

Run `39127210925` / head `aaed733`의 12 lane 브라우저 시간 합은 9519초였다.
균등해도 lane당 793초이고, 18분 30초 전에 끝난 lane은 약 743초였다.
Shard 7은 799초에 테스트를 통과하고 teardown에서 취소됐다.
같은 1200초·18분 30초 취소 기준에서 14 lane으로 나누면 약 714초다.
13 lane은 그 마감보다 여유가 없다. 23 quality job과 budget job, authenticated 14개
artifact를 포함한 19개 필수 artifact를 그 후보의 기준으로 뒀다. 이 14 lane 후보는
수락되지 않았다. 테스트 삭제, timeout 축소, assertion 완화 없이 현재 inventory를
각각 한 번씩 실행한다. 현재 lane 수는 아래 12 lane 복귀다.

### 2026-10-19 12-lane 복귀 근거

Run `39166030715` / head `d2fcf69`의 24 lane은 18분 30초에 failures=0으로 취소됐다.
가장 느린 lane은 GitHub runner를 약 8분 기다렸고, Playwright는 약 8분만 실행했다.
Supabase는 이미 끝나 있었다. 그보다 많은 lane은 대기만 늘린다.
Run `39127210925`의 12 lane은 약 1분 안에 시작했고, 예산은 Playwright 약 581–864초에 쓰였다.
그 배치도 20분 안에 전체 suite를 끝내지 못했다. 예산 1200초와 18분 30초 취소는 PR workflow에 유지한다.
측정된 긴 spec(mockup capture, home catalog, principal withdrawal, notifications)은
서로 다른 lane에 둔다. 21 quality job과 budget job, authenticated 12개 artifact를
포함한 17개 필수 artifact가 현재 기준이다. 테스트 삭제, timeout 축소, assertion
완화 없이 현재 inventory를 각각 한 번씩 실행한다. 이 12 lane PR 배치는 수락되지 않았다. 현재 기준은 아래 분리다.

### 2026-10-19 PR smoke와 release full 분리

Run `39127210925`의 authenticated 브라우저 시간 합은 약 9519초였다.
12·14·16·18·24 lane은 모두 20분 PR 예산 안에 전체 suite를 끝내지 못했다.
PR workflow는 WS-05 focused smoke 한 lane과 기존 비회원 job 10개를 20분 안에 확인한다.
전체 suite는 `ci-full-e2e.yml`의 12 lane, job 60분이다.
`develop`/`main`/`release/**` push와 workflow_dispatch에서만 실행한다.
그 run이 release SHA에서 green이기 전에는 production deployment를 하지 않는다.
