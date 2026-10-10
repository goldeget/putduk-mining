# 로컬 커밋과 Draft PR 영수증 — 2026-10-10

메타 감사 5건만 격리 워크트리에서 커밋하고 Draft PR을 열었다. CI는 시작됐으나 이 영수증 시점에는 통과로 기록하지 않는다.

## 기준

- 원격: `https://github.com/goldeget/putduk-mining.git` (fetch/push 모두 일치)
- 데스크톱 HEAD: `af14c2fb6ec9a40306613757b1f14625ce8d388f` (`codex/product-ai-navigation`). 작업 트리는 그대로 두었다.
- 로컬 `develop` fast-forward: `494cfa592bc515ad9d6f5879f5d1fde929e1fd06` → `0a7e95ba8bf55539fe32fd6f4654ee49a0be226d` (`origin/develop`). 체크아웃되어 있지 않아 ref만 이동. merge 없음.
- 워크트리: `C:\Users\PC\Desktop\putduk-mining\.worktrees\ci-dblink-host-20261010` (기존 object DB 공유). C: 여유는 워크트리 전 약 1.29GB, 추적 트리 약 58MB.
- 브랜치: `codex/ci-dblink-host-20261010` → `origin/codex/ci-dblink-host-20261010`. `main`/`develop` push 없음. force 없음.

## 커밋

| SHA | 메시지 |
| --- | --- |
| `923459f5e48e408f114fd9a9ff08261913717cc0` | fix(ci): 동시 금액 검사가 지난 컨테이너 이름 대신 이 세션 주소로 붙게 한다 |
| `d3229c1a8534783b9b682ac86f90301f216443e7` | fix(audit): 보안 테스트를 커밋 후보에 남기고 깨진 CSV는 중단한다 |
| `bc6b584744f94fc7ad314620e719c49b3e00b433` | docs(audit): 실측하지 않은 클라우드 기능 일치를 UNKNOWN으로 적는다 |

HEAD: `bc6b584744f94fc7ad314620e719c49b3e00b433`

## PR

- Draft PR: https://github.com/goldeget/putduk-mining/pull/73
- base `develop` ← head `codex/ci-dblink-host-20261010`
- PR #72 (`codex/backend-review-r2-ci-20261009`) 브랜치는 바꾸지 않았다. 이 PR은 #72의 병합 요청이 아니다. 병합하지 않음. production DB / 원격 Supabase apply 없음.
- CI: https://github.com/goldeget/putduk-mining/actions/runs/38046635208 — 생성 직후 `in_progress` (`pull_request`, 2026-10-10T10:56:08Z). 통과 여부는 아직 없다.

## 커밋한 파일

- `supabase/snippets/resolve_disposable_dblink_host.sql`
- `supabase/tests-concurrent/krw_deposit_concurrent_approval.sql`
- `supabase/tests-concurrent/usdt_deposit_concurrent_approval.sql`
- `supabase/tests-concurrent/safe_mode_concurrent_command.sql`
- `supabase/tests/database/acknowledge_reconciliation_mismatch.sql`
- `tests/unit/ci/disposable-dblink-host.test.ts`
- `docs/audit/local-preservation-2026-10-10/_scripts/classify-uncommitted.mjs`
- `docs/audit/local-preservation-2026-10-10/_scripts/classify-uncommitted.ps1`
- `docs/audit/local-preservation-2026-10-10/_scripts/collect-worktree-inventory.ps1`
- `docs/audit/local-preservation-2026-10-10/03_CLASSIFICATION_DELTA.md`
- `tests/unit/audit/classify-uncommitted.test.ts`
- `docs/audit/local-preservation-2026-10-10/05_CLOUD_TO_LOCAL_FUNCTIONAL_FIDELITY.md`

`05` 문서의 상대 링크(`06`, `11`)는 이번 커밋에 넣지 않았다.

## 명시적으로 제외

데스크톱에 남은 제품·핸드오프 변경:

- `AGENTS.md`
- `apps/admin/app/(control)/deposits/usdt/page.tsx`
- `apps/admin/app/(control)/members/page.tsx`
- `apps/admin/app/(control)/restrictions/page.tsx`
- `apps/admin/tests/admin-usdt-deposits-canonical.test.ts`
- `apps/admin/app/(control)/_lib/member-record-labels.ts`
- `apps/admin/tests/member-record-labels.test.ts`
- `docs/quality/WS-05-CLOSURE.md`
- `next-env.d.ts`
- `tests/e2e/authenticated/admin-krw-browser-money.spec.ts`
- `tests/e2e/authenticated/admin-usdt-browser-money.spec.ts`
- `tests/e2e/authenticated/admin-withdrawal-step-up.spec.ts`
- `tests/e2e/authenticated/helpers/admin-money-ui.ts`
- `.cursor/rules/putduk-ci-wall-clock.local-before-sync.mdc`
- `CODEX_HANDOFF.md`, `CURRENT_STATE.md`, `NEXT_STEPS.md`
- `PUTDUK_AUDIT_V3_1_INTEGRITY.json`
- `PUTDUK_CURSOR_PARALLEL_FULL_AUDIT_V3_1_POSTMERGE.txt`
- `PUTDUK_CURSOR_PARALLEL_IMPLEMENT_CI_MERGE_V4.txt`
- `PUTDUK_META_AUDIT_20261010.md`
- `PUTDUK_MINING_FINAL_INTEGRATED_ARCHITECTURE_V2_UI_UX_2026-10-04.md`
- `putduk-sk-hynix-mining-v3-precision.html`
- 그 외 `docs/audit/` 실행 노트·보존 보고서·CSV (위 5건 파일 제외)

## 테스트

`pnpm exec vitest run tests/unit/audit/classify-uncommitted.test.ts tests/unit/ci/disposable-dblink-host.test.ts` — Test Files 2 passed, Tests 8 passed (2026-10-10, vitest 5.0.2). 동시 승인 SQL과 reconciliation SQL은 이 세션에서 실행하지 않음.

## 후속 수정 — CI run 38046635208

`bc6b584` 의 Application gates / E2E build 는 `classify-uncommitted.mjs` 선언 파일이 없어 TS7016 로 실패했다. Database security gates 는 파일이 커밋되어 있어도 `supabase test db` 의 pg_prove 가 `supabase/tests` 또는 지정 파일의 부모 디렉터리만 마운트해서 `supabase/snippets` 를 열지 못했다.

수정 커밋: `a9363819cfc8e367b44f7161c76e06da3adc11c8`

- `classify-uncommitted.d.mts` 로 `parseCsv` / `categorize` 만 선언했다.
- 같은 바이트의 헬퍼를 `supabase/tests/snippets/resolve_disposable_dblink_host.inc` 와 `supabase/tests-concurrent/resolve_disposable_dblink_host.inc` 에 두고, `\ir` 가 각 마운트 안을 가리키게 했다. `.sql` 이면 pg_prove 가 헬퍼를 테스트로 실행한다.
- 과거 컨테이너 이름 `supabase_db_putduk-mining-clean` 은 되돌리지 않았다.

이 영수증을 적은 시점에는 새 HEAD 의 CI 를 통과로 기록하지 않는다.
