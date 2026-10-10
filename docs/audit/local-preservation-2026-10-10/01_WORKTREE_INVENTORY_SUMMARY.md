# Worktree 인벤토리 요약 (84)

정본 CSV: `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\exports\worktree-inventory.csv`  
상세 서술: `01_LOCAL_WORKTREE_AND_GIT_INVENTORY.md`

| 구분 | 수 | 비고 |
| --- | ---: | --- |
| 등록 worktree | 84 | `git worktree list` |
| status 스캔 성공 | 75 | |
| prunable / 경로 없음 / `.git` 깨짐 | 9 | CSV `Note`·`error:` 참조 |
| Desktop dirty | 25 | `af14c2f` · `codex/product-ai-navigation` |
| CI clean | 0 | `1490cb7` · `.worktrees/backend-review-r2-ci-20261009` |
| `.worktrees/` | 59 | wave·rc1·pr38 등 |
| `.cursor/worktrees/` | 24 | `parallel/*` 제품 레인 |

**깨짐 샘플**: `C:/Users/PC/.cursor/worktrees/admin-product-a7913be5` — not a git repository.

**Phase 2 prep (물리 스캔 완료)**: prunable **10**건 — 경로 없음 3 · `.git` 깨짐 7. 상세 표: [`01_ORPHAN_WORKTREES.md`](01_ORPHAN_WORKTREES.md). `git worktree prune`는 **prune deferred** (사용자 승인 전).
