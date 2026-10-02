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

## GitHub CI (authenticated shard)

- PR CI는 authenticated 186 tests를 **4-way `--shard=i/4`** matrix job으로 병렬 실행한다 (`Authenticated product gates (1/4)` … `(4/4)`).
- branch protection / required checks는 예전 단일 job 이름 `Authenticated product gates` 대신 **위 네 job을 모두** 등록해야 한다.
- shard 합집합은 로컬 `pnpm test:e2e:auth:full` 과 동일하다. CI에서 `--shard` 는 `pnpm test:e2e:authenticated -- --shard=i/4` 로 넘긴다.

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
