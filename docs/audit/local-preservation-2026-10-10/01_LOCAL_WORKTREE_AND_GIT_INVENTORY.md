# 로컬 워크트리·Git 인벤토리 (2026-10-10)

## 범위·방법

- **단일 Git 저장소**: `C:\Users\PC\Desktop\putduk-mining` (`--git-common-dir` = `.git`)
- **원격**: `https://github.com/goldeget/putduk-mining.git` (fetch dry-run·`ls-remote`로 확인)
- **스캔**: `git worktree list --porcelain` 전체 + 사용자 지정 경로(데스크톱·`.worktrees`·`.codex\putduk-local-recovery-integration`) 존재 여부
- **원본 변경 없음** (read-only inventory)

## 디스크·보존 매체

| 드라이브 | 여유 | 비고 |
| --- | --- | --- |
| C: | **약 1.12 GB** | 전체 워킹 트리 풀 복사 위험 |
| D: (`ESD-USB`, FAT32) | **약 19.5 GB** | `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\` 보존 루트 |

## 워크트리 요약

| 항목 | 값 |
| --- | --- |
| `git worktree list` 등록 수 | **84** |
| `git status` 스캔 성공 | **75** (경로 없음·prunable·`.git` 깨짐 **9**) |
| 전체 변경 파일 행 (porcelain) | **266** (= 수정·스테이지 등 **248** + 미추적 **18**) |
| Stash | **1** (`stash@{0}`: develop drift) |

### 등록 위치 분류

1. **데스크톱 루트** — `codex/product-ai-navigation` @ `af14c2f` (dirty **25**)
2. **`.worktrees\`** — **59** (CI·wave·rc1·pr38·lane 등)
3. **`.cursor\worktrees\`** — **24** (parallel/* 제품 레인 등)
4. **고아/깨짐** — prunable 또는 디렉터리 없음 **9** (`admin-product-a7913be5`, `ws04-*`, `ws05-*` 등)

### GitHub 브랜치 tip (2026-10-10 조회)

| ref | SHA | 사용자 스냅샷 일치 |
| --- | --- | --- |
| `origin/main` | `fbea85e` | 예 |
| `origin/develop` | `0a7e95b` | 예 |
| PR #72 head `codex/backend-review-r2-ci-20261009` | `1490cb7` | 예 (draft, open) |

### 주요 로컬 HEAD

| 워크트리 | 브랜치 | HEAD | dirty |
| --- | --- | --- | --- |
| Desktop | `codex/product-ai-navigation` | `af14c2f` | 25 |
| `.worktrees\backend-review-r2-ci-20261009` | `codex/backend-review-r2-ci-20261009` | `1490cb7` | 0 |
| `.worktrees\parallel-closure-20261002-2217` | `codex/parallel-closure-20261002-2217-integration` | `7d77c27` | 41 |
| `.cursor\worktrees\putduk-pc-*` | `parallel/*-product` | (각각) | 1–11 |

### 로컬 `develop` vs 원격

- 로컬 브랜치 `develop` → `494cfa5` (**origin/develop 대비 18커밋 뒤**)
- 데스크톱 checkout은 `codex/product-ai-navigation` (main ancestor 관계는 별도)

## Recovery 경로 (Phase 0)

| 경로 | 상태 |
| --- | --- |
| `C:\Users\PC\.codex\worktrees\putduk-local-recovery-integration\putduk-mining` | **不存在** |
| Git 브랜치 `codex/local-cloud-recovery-*` 등 | bundle·로컬 ref에 **존재** (커밋만, 해당 워크트리 없음) |

## 상세 기계 판독

- `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\exports\worktree-inventory.csv`
- `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\exports\desktop-git-status.txt` / `desktop-git-diff.patch`
- `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\exports\ci-worktree-git-status.txt`

## 정리 권고 (읽기 전용 결론)

- `git worktree prune` **는 사용자 승인 전 실행하지 않음** — 다만 고아 9건은 인벤토리 노이즈
- C: 여유 공간 확보 전 대용량 복사·빌드 자제
