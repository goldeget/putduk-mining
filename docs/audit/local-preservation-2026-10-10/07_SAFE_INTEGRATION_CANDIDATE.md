# 2차 보고 준비 — 안전 통합 후보 (2026-10-10)

Phase 0–1 증거 기준. **제품 코드·원격 push는 본 문서 범위 밖.**

## 권장 1순위: PR #72 @ `1490cb7`

| 항목 | 내용 |
| --- | --- |
| 브랜치 | `codex/backend-review-r2-ci-20261009` |
| HEAD | `1490cb7bad365e26a8ee1c771d7ff86df6eded7d` |
| Worktree | `.worktrees/backend-review-r2-ci-20261009` — **clean** |
| PR | [#72](https://github.com/goldeget/putduk-mining/pull/72) → `develop`, OPEN |
| develop 대비 | ahead **81** (04 문서 스냅샷) |

**선정 이유**

- 유일하게 CI 레인 worktree가 **dirty 없음** — merge 충돌·WIP 혼입 위험 최소.
- recovery·backend safeguard 통합 의도가 PR 제목과 일치.
- D: `ci-worktree-1490cb7/`에 diff export 보존.

## 비권장(당장 base): Desktop @ `af14c2f` + dirty

| 항목 | 내용 |
| --- | --- |
| 브랜치 | `codex/product-ai-navigation` |
| HEAD | `af14c2fb6ec9a40306613757b1f14625ce8d388f` |
| Dirty | modified 11, untracked 14 (1차 보고) |
| main 대비 | ahead **319** — 장기 분기, develop 직통 merge 부적합 |

**리스크**

- Admin money·E2E·audit 문서가 한 worktree에 섞여 있어 **레인 불명** 커밋 위험.
- parallel/* 와 기능 중복 diff 가능 (전 worktree dirty 248).

## Merge·통합 리스크

1. **로컬 `develop` stale** — tip `494cfa5`가 `origin/develop` 대비 **behind 18** (04). develop checkout으로 merge하면 오래된 base 위에서 작업할 수 있음. 통합 전 `fetch` + develop fast-forward 또는 PR base만 신뢰.
2. **Recovery path 부재** — `C:\Users\PC\.codex\worktrees\putduk-local-recovery-integration\putduk-mining` **없음**. recovery는 bundle ref + D: tip export만 존재; 워킹 트리 복원 없이 PR #72만으로 coverage 주장 금지.
3. **parallel/* scatter** — `parallel/admin-*`, `parallel/wallet-product` 등 다수 브랜치 + `.cursor/worktrees/putduk-pc-*` dirty. #72 merge 후에도 product lane은 **브랜치별 PR** 필요.
4. **로컬 전용 66 commits** — origin 미반영 (04). push/폐기 분류 전 develop에 대량 merge 금지.
5. **C: 디스크 ~1.1GB** — 통합 전 full build·중복 bundle 금지 (STORAGE-POLICY).

## 권장 Phase 2 순서 (커밋 전)

1. PR #72 CI green 확인 (사용자 승인 후 push/merge).
2. Desktop admin-money 변경을 **소유 parallel 브랜치**로 cherry-pick 또는 lane worktree에서 PR 분리.
3. `develop` ref를 origin과 동기화한 뒤 rebase/merge 계획 수립.
4. Recovery 4브랜치 — bundle에서 checkout 검증 또는 `git archive` (워크트리 경로 복구 실패 전제).
5. Classifier·03 CSV — `supabase/migrations/*service_role*` NEVER → REVIEW 수정 반영 (NEVER 5→2).

## 증거 교차

- **2차 보고 결정 패키지:** [`14_PHASE2_DECISION_PACKAGE.md`](./14_PHASE2_DECISION_PACKAGE.md)
- 영수증: `08_COMMIT_AND_BACKUP_RECEIPT.md`
- 브랜치·recovery: `04_LOCAL_ONLY_COMMITS_AND_RECOVERY_ASSETS.md` · unpushed 전수: `04_UNPUSHED_BRANCHES.csv`
- UI/UX·모션 갭(R4): [`13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md`](13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md)
- 분류: `03_COMMIT_REQUIRED_VS_NEVER_COMMIT.csv`
- 저장: `STORAGE-POLICY.md`
