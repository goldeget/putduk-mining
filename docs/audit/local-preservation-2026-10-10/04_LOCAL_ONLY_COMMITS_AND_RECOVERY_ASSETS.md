# 로컬 전용 커밋·Recovery 자산 (1차, 2026-10-10)

## 로컬 전용 커밋 (origin 미반영)

- **`git log --all --not --remotes=origin --oneline`**: **66** commits
- 전체 목록: `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\exports\local-only-commits.txt`

### 패턴 (상위 샘플)

1. **`refs/codex/snapshots/*`** — Codex worktree archive 스냅샷 (4건)
2. **`codex/local-cloud-recovery-*`** 계열 — finance / provider / integration / admin-content-pwa (bundle에 ref 보존)
3. **`rehearsal/local-only-not-for-push`**, **`local/pr38-followup-*`**, **`local/pr40-ci-log-mask`** 등 명시적 로컬 브랜치
4. **`wave/*`**, **`rc1/*`**, **`repair/pr38-lane-*`** — 병합 전 레인 커밋 다수

## Recovery 워크트리

| 기대 경로 | 실측 |
| --- | --- |
| `C:\Users\PC\.codex\worktrees\putduk-local-recovery-integration\putduk-mining` | **없음** |

**대체 증거**: `putduk-mining-all.bundle`에 recovery 브랜치 tip 및 로컬 전용 커밋 포함. 워킹 디렉터리 스냅샷은 **미백업**.

## 브랜치 tip vs GitHub (선행 커밋 수)

| 브랜치 | `origin/develop..` | `origin/main..` | 비고 |
| --- | ---: | ---: | --- |
| `codex/backend-review-r2-ci-20261009` | 81 | — | PR #72, worktree clean |
| `codex/product-ai-navigation` (desktop) | — | 319 | 원격 브랜치는 tracking; main 대비 큰 분기 |
| `develop` (로컬 ref) | 0 (ahead) | — | tip `494cfa5`는 **behind 18** (stale checkout) |

## Stash

```
stash@{0}: On develop: agent: root drift off develop (E2E local)
```

별도 patch export **완료** — 아래 「Stash export (Phase 2 prep)」 참조.

## Push 누락·upstream 없음 브랜치 (Phase 2 prep)

- **정본 CSV**: [`04_UNPUSHED_BRANCHES.csv`](04_UNPUSHED_BRANCHES.csv) — **78** branches (upstream 없음 · origin 대비 ahead · upstream `[gone]`)
- **F: 미러**: `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\exports\04_UNPUSHED_BRANCHES.csv`
- `no_upstream` 행의 `ahead` = `git rev-list --count <branch> --not --remotes=origin`
- upstream 있는 `ahead` = `git rev-list --left-right --count upstream...branch` (로컬 fetch 시점 기준, **fetch 미실시**)

## Stash export (Phase 2 prep)

| 아티팩트 | 위치 |
| --- | --- |
| `stash-0.patch` | `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\exports\` |
| `stash-0.metadata.txt` | 동일 (SHA256·stat·`stash@{0}` ref) |

`stash pop` / `drop` **미실시**.

## 후속 Phase 제안

1. recovery 브랜치 각 tip에서 `git archive` 또는 bundle ref list 교차표
2. parallel/* dirty 248파일의 브랜치별 중복 diff 클러스터링
3. 로컬 전용 66커밋 중 push 후보 vs 폐기 후보 분류
