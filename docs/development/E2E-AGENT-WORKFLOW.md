# E2E 에이전트·개발자 워크플로

사람과 AI 에이전트가 동일하게 따르는 **authenticated Playwright** 검증 절차다.
Browser foundation(`pnpm test:e2e`, `playwright.config.ts`)과 분리되어 있다.
실행 계층(FAST / FOCUSED / FULL)은 `docs/quality/WS-05-EXECUTION-CONTRACT.md`와 같다.

Cursor 규칙: `.cursor/rules/putduk-e2e-agent-verification.mdc` (`alwaysApply: true`)

## 목표

- 1건 실패 때문에 **full regression(약 186 tests)** 을 반복 돌리지 않는다.
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

**필수 기준:** 전체 CI 실행 **≤ 20분**. 최초 실행의 `created_at`부터 workflow 종료까지 대기·공유 빌드·후속 job·증거 저장을 모두 포함한다. 가장 느린 단일 job 시간으로 대신하지 않는다. Cursor rule: `.cursor/rules/putduk-ci-wall-clock.mdc`.

`CI completeness and 20-minute budget`이 병렬로 시작해 현재 시도에서 필수 품질 job 17개를 확인한다. 18분 30초에도 남은 검사가 있으면 종료 여유를 확보하기 위해 취소하고 실패로 기록한다. 일반 취소가 응답하지 않으면 force cancel한다. 최종 workflow 종료 시간도 별도로 확인한다. 전체 재실행은 해당 시도의 시작부터 측정하고, 일부 실패 job만 재실행해 이전 시도의 성공을 합치는 방식은 완료 증거로 인정하지 않는다.

네 Playwright CI 계층은 `--fail-on-flaky-tests`를 적용한다. retry는 원인 조사에 사용하지만 첫 실패 후 retry 성공은 CI 통과로 인정하지 않는다. 실제 TOTP·권한·DB 결과 검사는 유지한다.

### 공유 production build (`e2e-app-build`)

1. workflow당 **1회** `pnpm build` (회원 + `apps/admin`).
2. artifact `e2e-next-production`: `.next`, `apps/admin/.next` (repo 상대 경로).
3. 소비 job: **authenticated** 8-shard matrix, **typography-protected** (병렬 가능).

### authenticated shard

- PR CI는 authenticated 186 tests를 **8-way `--shard=i/8`** matrix job으로 병렬 실행한다 (`Authenticated product gates (1/8)` … `(8/8)`). chromium·mobile-chrome 프로젝트를 모두 포함한다.
- `needs: [webserver-lifecycle, e2e-app-build]` — shard마다 isolated `supabase start` + `db:reset`은 유지한다.
- Playwright 전 **artifact download**; step env **`E2E_NEXT_START=1`** → `playwright.authenticated.config.ts`는 **next start only** (CI `next dev` 금지).
- branch protection / required checks는 예전 단일 job 이름 `Authenticated product gates` 대신 **위 여덟 job을 모두** 등록해야 한다.
- shard 합집합은 로컬 `pnpm test:e2e:auth:full` 과 동일하다. CI에서는 `pnpm exec playwright test --config playwright.authenticated.config.ts --shard=i/8` 로 넘긴다 (`pnpm run … -- --shard` 는 CI에서 shard가 무시될 수 있음).
- Playwright browser cache는 `actions/cache@v5`, key `~/.cache/ms-playwright` (workflow `ci.yml`).
- CI authenticated config는 **`reporter: "line"`만** 쓴다. `github` reporter와 `reportSlowTests` slow warning은 Run Summary·check annotation 노이즈를 만든다. slow 상한은 `reportSlowTests: { max: 5, threshold: 480_000 }` 이며 `exactOptionalPropertyTypes` 때문에 `undefined`를 넘기지 않고 CI일 때만 spread로 병합한다 (`9cfc2ef`).
- shard job 한도는 **19분**, 실행 step 한도는 **18분**이며 전체 감시기는 대기·빌드 시간을 포함한 더 이른 마감도 적용한다. 실제 TOTP 대기, 개별 테스트 시간, assertion, retry는 유지한다. 시간 초과·취소는 실패이며 일부 검사를 통과로 바꿀 수 없다. 속도는 prebuilt + next start + 8-way 병렬 실행으로 확보한다.

### typography-protected

- `needs: [e2e-app-build]` — 동일 artifact download.
- Playwright webServer step env **`E2E_PREBUILT_APPS=1`** → `scripts/typography-protected-servers.mjs`는 member/admin **build 생략**, next start만.

### job 의존 (요약)

```text
e2e-app-build ─┬─► authenticated (×8, needs webserver-lifecycle)
               └─► typography-protected
(parallel) application, database, browser, worker, typography-public, …
(parallel) ci-budget ─► 전체 job 완료·시간 판정 / 미완료 시 취소
```

### PR #39 검증 run 증거 (review/pr38-cde4b203)

| run ID | head SHA | conclusion | 비고 |
| --- | --- | --- | --- |
| `36963225127` | `048e882` | success | 단일 authenticated job baseline (~67m wall) |
| `36973023878` | `ad0d147` | success | 8-shard, 16 job 전부 success, wall ~16m |
| `36975011504` | `2f349c9` | cancelled | merge queue 우선 취소 + Application gates TS (`reportSlowTests`); 후속 `9cfc2ef` |
| `36975512027` | `9cfc2ef` | success | **최종 green**, check annotation **0건**, wall ~16m |

로컬 검증·문서·CI truth는 worktree `local/pr38-followup-20261001` / remote `review/pr38-cde4b203` 기준이다. 루트 `develop` 체크아웃의 uncommitted Playwright diff는 merge 전까지 동기화하지 않는다.

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
