# Prunable·깨진 worktree 물리 스캔 (Phase 2 prep)

- **일시**: 2026-10-10 (Phase 2 prep)
- **정본**: `git worktree list` · `Test-Path` (경로·`.git` 파일/디렉터리)
- **조치**: `git worktree prune` **미실시** — 사용자 승인 전 **prune deferred**

| 경로 | 브랜치/HEAD | prunable | 경로 존재 | `.git` 유효 | 권장 조치 |
| --- | --- | :---: | :---: | :---: | --- |
| `C:/Users/PC/.cursor/worktrees/admin-product-a7913be5` | `ws04/admin-product` @ `6de4f48` | Y | Y | N | prune deferred (깨짐) |
| `C:/Users/PC/.cursor/worktrees/qa-mining-lang-2058fd17` | `ws04/qa-mining-language` @ `382442d` | Y | Y | N | prune deferred (깨짐) |
| `C:/Users/PC/.cursor/worktrees/user-mining-1a7ce538` | `ws04/user-mining-language` @ `79cff72` | Y | N | — | prune deferred (경로 없음) |
| `C:/Users/PC/.cursor/worktrees/ws04-qa-9e72d1ab` | `ws04/qa-evidence` @ `bdcd385` | Y | N | — | prune deferred (경로 없음) |
| `C:/Users/PC/.cursor/worktrees/ws04-sec-d49b6fc1` | `ws04/security-money-workers` @ `b713843` | Y | Y | N | prune deferred (깨짐) |
| `C:/Users/PC/.cursor/worktrees/ws04-user-41f579b2` | `ws04/user-product` @ `428c8d1` | Y | N | — | prune deferred (경로 없음) |
| `C:/Users/PC/.cursor/worktrees/ws05-admin-2f252574` | `ws05/admin-auth-security` @ `2f2ffdf` | Y | Y | N | prune deferred (깨짐) |
| `C:/Users/PC/.cursor/worktrees/ws05-authvis-13d7086a` | `ws05/authenticated-visual` @ `7e35d89` | Y | Y | N | prune deferred (깨짐) |
| `C:/Users/PC/.cursor/worktrees/ws05-user-wd-b0256ed4` | `ws05/user-first-withdrawal` @ `aa46ccf` | Y | Y | N | prune deferred (깨짐) |
| `C:/Users/PC/.cursor/worktrees/ws05-worker-d678a314` | `ws05/worker-runtime` @ `2e445ce` | Y | Y | N | prune deferred (깨짐) |

## 요약

| 구분 | 수 |
| --- | ---: |
| `git worktree list` prunable 플래그 | 10 |
| Phase 0 CSV “prunable/경로 없음/깨짐” | 9 | (CSV `Note` 집계; 본 스캔은 prunable 10건 전수) |
| 경로 없음 | 3 |
| 경로 있으나 `.git` 없음 (not a git repository) | 7 |

교차: `01_WORKTREE_INVENTORY_SUMMARY.md` · D: `exports/worktree-inventory.csv`
