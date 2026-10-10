# 2차 보고 — Phase 2 결정 패키지 (2026-10-10)

**전제:** Phase 2 prep 완료(stash export, unpushed 전수, prunable 물리 스캔 — **prune deferred**).
**본 문서는 결정·계획만 담는다.** staging·commit·push·merge·fetch는 **사용자 승인 전 실행하지 않는다.**

**상태:** 사용자-facing **2차 보고** 초안. 증거는 기존 감사 산출물만 인용.

| 연계 | 경로 |
| --- | --- |
| 1차 요약 | [`01_PHASE1_FIRST_REPORT.md`](./01_PHASE1_FIRST_REPORT.md) |
| 통합 후보 | [`07_SAFE_INTEGRATION_CANDIDATE.md`](./07_SAFE_INTEGRATION_CANDIDATE.md) |
| 분류 정본 | [`03_COMMIT_REQUIRED_VS_NEVER_COMMIT.csv`](./03_COMMIT_REQUIRED_VS_NEVER_COMMIT.csv) · delta [`03_CLASSIFICATION_DELTA.md`](./03_CLASSIFICATION_DELTA.md) |
| worktree·desktop | [`01_WORKTREE_INVENTORY_SUMMARY.md`](./01_WORKTREE_INVENTORY_SUMMARY.md) · [`01_LOCAL_WORKTREE_AND_GIT_INVENTORY.md`](./01_LOCAL_WORKTREE_AND_GIT_INVENTORY.md) |
| 영수증·승인 게이트 | [`08_COMMIT_AND_BACKUP_RECEIPT.md`](./08_COMMIT_AND_BACKUP_RECEIPT.md) |
| UX 갭(연기) | [`13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md`](./13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md) |
| 기능·릴리스 스텁 | [`06_CURRENT_PLATFORM_FEATURE_STATUS.md`](./06_CURRENT_PLATFORM_FEATURE_STATUS.md) · [`11_RELEASE_BLOCKERS_AND_PRODUCTION_GAPS.md`](./11_RELEASE_BLOCKERS_AND_PRODUCTION_GAPS.md) |

---

## 1. 권장 1차 통합 후보: `1490cb7` (PR #72) vs `af14c2f` + cherry

### 권장 **Primary:** PR [#72](https://github.com/goldeget/putduk-mining/pull/72) @ `1490cb7`

| 근거 문서 | 내용 |
| --- | --- |
| [`07_SAFE_INTEGRATION_CANDIDATE.md`](./07_SAFE_INTEGRATION_CANDIDATE.md) | CI worktree **clean**, recovery·backend safeguard 레인, develop 대비 ahead 81(04 스냅샷) |
| [`01_WORKTREE_INVENTORY_SUMMARY.md`](./01_WORKTREE_INVENTORY_SUMMARY.md) | Desktop dirty 25 vs CI clean 0 — merge 시 WIP 혼입 위험 최소 레인 |
| [`01_PHASE1_FIRST_REPORT.md`](./01_PHASE1_FIRST_REPORT.md) | Desktop @ `af14c2f`는 admin-money·audit·루트 초안이 한 트리에 혼재 |
| [`03_COMMIT_REQUIRED_VS_NEVER_COMMIT.csv`](./03_COMMIT_REQUIRED_VS_NEVER_COMMIT.csv) | 전 worktree **96**건 `COMMIT_REQUIRED` — 대부분 **소유 parallel/lane worktree**; desktop 제품 10건은 **별 wave** |

**결론:** CI·recovery 통합의 **base·첫 merge 대상**은 `codex/backend-review-r2-ci-20261009` @ `1490cb7bad365e26a8ee1c771d7ff86df6eded7d` (**PR #72**).
D: `ci-worktree-1490cb7/` diff export로 오프라인 검증 가능 ([`08`](./08_COMMIT_AND_BACKUP_RECEIPT.md)).

### 비권장(당장 primary base): Desktop @ `af14c2f` + 일괄 merge

| 리스크 | [`07`](./07_SAFE_INTEGRATION_CANDIDATE.md) · [`01`](./01_WORKTREE_INVENTORY_SUMMARY.md) |
| --- | --- |
| 레인 불명 커밋 | dirty 25, `main` 대비 ahead **319** — develop 직통 merge 부적합 |
| 중복·scatter | `.cursor/worktrees/putduk-pc-*` parallel dirty; #72 이후 **브랜치별 PR** 필요 |
| stale develop | 로컬 `develop`이 `origin/develop` 대비 **behind 18** ([`04_LOCAL_ONLY_COMMITS_AND_RECOVERY_ASSETS.md`](./04_LOCAL_ONLY_COMMITS_AND_RECOVERY_ASSETS.md)) |

**대안(2순위):** Desktop admin-money·member 변경은 **`af14c2f`에서 cherry-pick / 소유 lane worktree**로 분리 PR — [`07`](./07_SAFE_INTEGRATION_CANDIDATE.md) Phase 2 순서 2번.

---

## 2. 제안 커밋 wave (staging **전** — 논리 그룹만)

> 카운트·경로 정본: [`03_COMMIT_REQUIRED_VS_NEVER_COMMIT.csv`](./03_COMMIT_REQUIRED_VS_NEVER_COMMIT.csv).
> **아래 wave는 desktop 루트 + parallel lane 방향만 제안**하며, 아직 `git add` 하지 않는다.

### Wave 0 — CI / recovery (Primary integration)

| 항목 | 설명 |
| --- | --- |
| 범위 | PR #72 브랜치에 이미 포함된 81 commits (push gap은 [`04_UNPUSHED_BRANCHES.csv`](./04_UNPUSHED_BRANCHES.csv) — `1490cb7` upstream **ahead 182**) |
| Desktop dirty | **포함하지 않음** |
| 승인 | §6 USER_APPROVAL — merge #72 |

### Wave A — Admin money (desktop, `COMMIT_REQUIRED` 6+4)

| 파일(03 CSV) | 분류 |
| --- | --- |
| `apps/admin/app/(control)/deposits/usdt/page.tsx` | admin USDT 입금 UI |
| `apps/admin/tests/admin-usdt-deposits-canonical.test.ts` | unit |
| `tests/e2e/authenticated/admin-krw-browser-money.spec.ts` | e2e |
| `tests/e2e/authenticated/admin-usdt-browser-money.spec.ts` | e2e |
| `tests/e2e/authenticated/admin-withdrawal-step-up.spec.ts` | e2e |
| `tests/e2e/authenticated/helpers/admin-money-ui.ts` | e2e helper |

**소유 브랜치 후보:** `parallel/admin-deposits` 계열 또는 money lane — desktop에 두지 말고 lane checkout에서 커밋 권장 ([`07`](./07_SAFE_INTEGRATION_CANDIDATE.md)).

### Wave B — Member labels · 운영자 회원/제한 (desktop, `COMMIT_REQUIRED` 4)

| 파일(03 CSV) | 분류 |
| --- | --- |
| `apps/admin/app/(control)/_lib/member-record-labels.ts` | 신규 라벨 lib |
| `apps/admin/tests/member-record-labels.test.ts` | unit |
| `apps/admin/app/(control)/members/page.tsx` | members |
| `apps/admin/app/(control)/restrictions/page.tsx` | restrictions |

**참고:** `.cursor/worktrees/putduk-pc-admin-members` 등 parallel에 **동일 도메인 추가 diff** 다수 — lane PR과 충돌 검토 필요 (03 CSV `putduk-pc-admin-*` 행).

### Wave C — E2E (Wave A와 동일 파일이면 **한 PR에 묶기** 권장)

Wave A의 authenticated money spec 4건. WS-05 **feature batch** 시 `pnpm test:e2e:auth:krw` / `auth:usdt` / 변경 spec `auth:one` 순 ([`docs/quality/WS-05-EXECUTION-CONTRACT.md`](../../quality/WS-05-EXECUTION-CONTRACT.md)).

### Wave D — Docs·감사만 (desktop, 대부분 `REVIEW_BEFORE_COMMIT`)

| 파일(03 CSV) | 권장 |
| --- | --- |
| `docs/audit/local-preservation-2026-10-10/**` | 감사 markdown·CSV — **루트 초안과 분리 커밋** |
| `docs/quality/WS-05-CLOSURE.md` | 품질 closure — intent 확인 후 |
| `AGENTS.md` | REVIEW — boundary 문구만 선별 |

**커밋하지 말 것(同 wave에서 제외):** 루트 `CODEX_HANDOFF.md`, `CURRENT_STATE.md`, `NEXT_STEPS.md`, `PUTDUK_*` 초안·JSON·TXT — 03 `agent audit draft` ([§3](#3-never_commit--preserve_outside_git-요약)).

### Wave E+ — Parallel / lane (`COMMIT_REQUIRED` 잔여 ~86건)

03 CSV 상 `putduk-pc-admin-*`, `parallel-closure-*`, `lane-money-*`, `lane-*` 등 — **wave당 하나의 owning branch + 하나의 Draft PR**. Desktop wave와 **섞지 않음**.

---

## 3. NEVER_COMMIT · PRESERVE_OUTSIDE_GIT 요약

정본: [`03_COMMIT_REQUIRED_VS_NEVER_COMMIT.csv`](./03_COMMIT_REQUIRED_VS_NEVER_COMMIT.csv) · 재분류: [`03_CLASSIFICATION_DELTA.md`](./03_CLASSIFICATION_DELTA.md).

| category | 건수(266 file rows) | 요약 |
| --- | ---: | --- |
| `COMMIT_REQUIRED` | **96** | 제품·테스트·스키마 — lane PR |
| `REVIEW_BEFORE_COMMIT` | **166** | 수동 diff·agent doc·generated·migration `*service_role*` 파일명 등 |
| `NEVER_COMMIT` | **2** | worktree 내 `secret-mask-and-target.test.ts`, `service_role_image_default_floor.sql` — Git 제외·QA 보관 |
| `PRESERVE_OUTSIDE_GIT` | **2** | desktop 루트 목업 ZIP 2, `putduk-sk-hynix-mining-v3-precision.html` — **D:/F: 백업만** ([`08`](./08_COMMIT_AND_BACKUP_RECEIPT.md)) |

---

## 4. Push 전략 — CI Draft PR (develop **직 push 금지**)

| 원칙 | 설명 |
| --- | --- |
| develop 직 push | **하지 않음** — 통합은 PR + CI green 후 merge |
| CI 1차 레인 브랜치명 | `codex/backend-review-r2-ci-20261009` (HEAD `1490cb7`) |
| Draft PR | GitHub에서 **Draft** 유지 가능; green 후 Ready for review |

### PR #72 관계 — 옵션 표

| 옵션 | 브랜치 | PR #72 | develop 동기화 | 장점 | 단점 |
| --- | --- | --- | --- | --- | --- |
| **A (권장)** | `codex/backend-review-r2-ci-20261009` | **기존 #72 유지·갱신** — 동일 브랜치에 push만 | merge 직전 `origin/develop` ff (§6 승인) | 이미 OPEN, clean worktree, 제목·의도 일치 | upstream ahead 182 — push 분량·CI wall-clock 검증 필요 |
| B | `codex/backend-review-r2-ci-20261009-v2` (신규) | #72 **Draft 유지 또는 close** 후 신규 PR | rebase onto 최신 `origin/develop` | base 정리 명확 | PR 번호·리뷰 스레드 분산, 중복 CI |
| C | `integrate/recovery-ci-20261010` (신규) | #72에서 **cherry-pick subset**만 | develop에서 분기 | 최소 diff PR | recovery coverage 누락 위험 ([`07`](./07_SAFE_INTEGRATION_CANDIDATE.md) recovery path 부재) |
| D | Desktop `codex/product-ai-navigation` | #72와 **무관** 별 PR | Wave A–B만 | 제품 money 빠른 반영 | primary integration 아님; 319 ahead 분기 |

**로컬 `develop`:** tip `494cfa5`, `origin/develop` **behind 18** — merge 계획은 **원격 develop을 정본**으로 두고 로컬 ff는 §6 승인 후 ([`04_LOCAL_ONLY_COMMITS_AND_RECOVERY_ASSETS.md`](./04_LOCAL_ONLY_COMMITS_AND_RECOVERY_ASSETS.md)).

---

## 5. Push / merge 직전 로컬 검증 (WS-05)

계약: [`docs/quality/WS-05-EXECUTION-CONTRACT.md`](../../quality/WS-05-EXECUTION-CONTRACT.md).

### 모든 product wave 공통 (FAST)

1. `pnpm typecheck`
2. `pnpm lint`
3. 변경 unit — 예: Wave A `pnpm exec vitest run apps/admin/tests/admin-usdt-deposits-canonical.test.ts` · Wave B `member-record-labels.test.ts` (package.json 스크립트 관례 따름)

### Wave A–C (admin money)

- `E2E_NEXT_START=1` 권장 (로컬 prebuilt 시)
- Stack: `supabase start` → `pnpm db:reset` → `node scripts/capture-local-supabase-env.mjs` → ephemeral `WITHDRAWAL_DATA_KEY`
- Focused E2E (순차):
  - `pnpm test:e2e:auth:one -- tests/e2e/authenticated/admin-krw-browser-money.spec.ts`
  - `pnpm test:e2e:auth:one -- tests/e2e/authenticated/admin-usdt-browser-money.spec.ts`
  - `pnpm test:e2e:auth:one -- tests/e2e/authenticated/admin-withdrawal-step-up.spec.ts`

### PR #72 merge candidate (FULL — **최대 2회**/후보 SHA, 사용자·CI 승인 후)

- `1490cb7` worktree에서: `pnpm test:e2e:auth:full` (또는 `pnpm test:e2e:authenticated`)
- **`pnpm db:reset` 직후 full 연속 3회+ 금지** (E2E agent rule)

### Wave D (docs-only)

- `pnpm typecheck` / `pnpm lint` (markdown-only면 lint 영향 최소 — 실패 시만 수정)

---

## 6. USER_APPROVAL_REQUIRED (08에서 복사)

[`08_COMMIT_AND_BACKUP_RECEIPT.md`](./08_COMMIT_AND_BACKUP_RECEIPT.md) Phase 2 prep 하단과 동일. **체크 전에는 해당 git/원격 작업 금지.**

- [ ] **USER_APPROVAL_REQUIRED** — PR [#72](https://github.com/goldeget/putduk-mining/pull/72) merge
- [ ] **USER_APPROVAL_REQUIRED** — unpushed 브랜치 push ([`04_UNPUSHED_BRANCHES.csv`](./04_UNPUSHED_BRANCHES.csv) 78건 **선별 후**)
- [ ] **USER_APPROVAL_REQUIRED** — 로컬 `develop` ↔ `origin/develop` 동기화 (현재 behind 18)
- [ ] **USER_APPROVAL_REQUIRED** — desktop dirty 레인 분리·커밋 (`codex/product-ai-navigation` @ `af14c2f`)
- [ ] **USER_APPROVAL_REQUIRED** — `git worktree prune` (orphan 10건 — [`01_ORPHAN_WORKTREES.md`](./01_ORPHAN_WORKTREES.md))

---

## 7. Unpushed 브랜치 78건 — push 후보 아님

정본: [`04_UNPUSHED_BRANCHES.csv`](./04_UNPUSHED_BRANCHES.csv) (**78 data rows**, 헤더 제외).

| 관찰 | 의미 |
| --- | --- |
| 대다수 `no_upstream` 또는 대량 `ahead` | **일괄 push 금지** — 레거시 lane·recovery·실험 브랜치 |
| push **후보 1순위** | `codex/backend-review-r2-ci-20261009` (`1490cb7`, upstream ahead **182**) — §4 옵션 A |
| recovery 4브랜치 | 번들 ref만 — 별도 worktree 없음 ([`08`](./08_COMMIT_AND_BACKUP_RECEIPT.md)) |
| `cursor/lane-*`, `parallel/*` | 제품 lane — Wave E+에서 **개별** 판단 |

로컬 전용 commit **66**건 추가 맥락: [`04_LOCAL_ONLY_COMMITS_AND_RECOVERY_ASSETS.md`](./04_LOCAL_ONLY_COMMITS_AND_RECOVERY_ASSETS.md).

---

## 8. UI·UX·모션 — CI wave **이후**로 연기

[`13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md`](./13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md):

- PROPOSED R4/FINAL·RESTORED 번들은 **production truth 아님** — F: `design-review-2026-10-10` 보관.
- [`07`](./07_SAFE_INTEGRATION_CANDIDATE.md) · [`13`](./13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md): **보존·CI 통합 wave 완료 후** UX wave 착수.
- Phase 2 범위: **backend/CI/recovery + admin money lane** — Visual Lab 대비 갭 구현은 [`11_RELEASE_BLOCKERS_AND_PRODUCTION_GAPS.md`](./11_RELEASE_BLOCKERS_AND_PRODUCTION_GAPS.md) 참조.

---

## 9. 권장 사용자 결정 (한 페이지)

1. **Primary merge:** PR #72 @ `1490cb7` (옵션 A) — §6 merge 승인
2. **Desktop product:** Wave A+B(+C)를 lane branch로 분리 — §6 desktop dirty 승인
3. **Push:** #72 브랜치만 선 push — §6 push 승인; 78건 전체 push **거부**
4. **UX:** [`13`](./13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md) deferred — CI green 후 별도 Phase
5. **정리:** worktree prune — §6 별도 승인

---

*생성: Phase 2 prep 이후 2차 보고 패키지. Git mutating 작업 없음.*
