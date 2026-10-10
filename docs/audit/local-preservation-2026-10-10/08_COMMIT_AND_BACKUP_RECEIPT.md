# 커밋·백업 영수증 (Phase 0)

- **감사 ID**: `audit-2026-10-10-164902`
- **저장소**: `goldeget/putduk-mining` (로컬 `C:\Users\PC\Desktop\putduk-mining`)
- **Phase 0 HEAD (desktop)**: `af14c2fb6ec9a40306613757b1f14625ce8d388f` — `codex/product-ai-navigation`
- **CI worktree HEAD**: `1490cb7bad365e26a8ee1c771d7ff86df6eded7d` — `codex/backend-review-r2-ci-20261009`
- **원본 변경**: 없음 (읽기·export·복사만)

## C: 회피 정책

| 허용 | 금지 |
| --- | --- |
| 소형 텍스트 diff/export를 repo `docs/audit/`에 기록 | C:에 git bundle·ZIP 추가 복사 |
| 기존 working tree 그대로 유지 | C: 대용량 아티팩트 신규 생성 |

## D: 백업 (`D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\`)

| 아티팩트 | 검증 |
| --- | --- |
| `putduk-mining-all.bundle` | `git bundle verify` — **okay**, complete history, 313 refs |
| SHA256 `BA269DCAFE6F7A468CE48190972AB83EC23AB9FF5CB5D2BACF5E30B204CCD2FA` | `hashes/putduk-mining-all.bundle.sha256.csv` |
| `exports/git-status-short.txt`, `git-diff-full.patch`, `git-diff-stat.txt` | desktop 기준 |
| `exports/worktree-inventory.csv` | worktree 84, dirty 합계 modified 248 / untracked 18 |
| `exports/all-uncommitted-files-raw.csv` | 266 file rows |
| `desktop-repo/*`, `ci-worktree-1490cb7/*` | HEAD·status·diff 스냅샷 |
| `recovery-branches-export/*` | 4× `codex/local-cloud-recovery-*` 브랜치 tip |

## F: 백업 (`F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\`)

| 아티팩트 | SHA256 / 검증 |
| --- | --- |
| `mirror/putduk-mining-all.bundle` | D:와 동일 해시; `git bundle verify` **okay** |
| `large-assets/10월4일 퍼뜩목업사진.zip` | `7BF01E26A9011A10B896A91859775295D52CFC78064599D8E76C89DC5FB6549E` |
| `large-assets/퍼뜩채굴 모바일 목업사진.zip` | `08D0B6E93B8060661490D7A238FE90176290598D58CD738430D367075C3FBC37` |
| `exports/stash-0.patch` | SHA256 `B77F8FF54784B8F99B787252F5D801078469AAE697221085EC64DE0D261487B1` (~62KB) |
| `exports/stash-0.metadata.txt` | `stash@{0}` stat·ref |
| `exports/04_UNPUSHED_BRANCHES.csv` | 78행 (repo `docs/audit/...` 동일 내용 미러) |

## Repo 산출물 (`docs/audit/local-preservation-2026-10-10/`)

| 파일 | 설명 |
| --- | --- |
| `02_ALL_UNCOMMITTED_FILES.csv` | raw inventory 복사 |
| `03_COMMIT_REQUIRED_VS_NEVER_COMMIT.csv` | 266행 분류 — **2026-10-10 Phase 1 후속**: COMMIT_REQUIRED 96 · REVIEW **166** · NEVER **2** · PRESERVE_OUTSIDE 2 (delta: `03_CLASSIFICATION_DELTA.md`) |
| `STORAGE-POLICY.md` | C/D/F 역할 (F=번들·ZIP 미러) |
| `07_SAFE_INTEGRATION_CANDIDATE.md` | 2차 보고 — PR #72 vs desktop |
| `14_PHASE2_DECISION_PACKAGE.md` | **2차 보고 결정 패키지** (wave·push·승인·테스트) |
| `06_CURRENT_PLATFORM_FEATURE_STATUS.md` | 기능 상태 스텁 → RELEASE-READINESS-MATRIX |
| `11_RELEASE_BLOCKERS_AND_PRODUCTION_GAPS.md` | 릴리스 블로커 요약 (07+13+ops) |
| `04_UNPUSHED_BRANCHES.csv` | push 누락·no_upstream 브랜치 78 |
| `01_ORPHAN_WORKTREES.md` | prunable 10건 물리 스캔 (prune deferred) |
| `_scripts/collect-worktree-inventory.ps1` | D: exports 생성 |
| `_scripts/classify-uncommitted.mjs` | 분류 정본 (Node, UTF-8) |
| `_scripts/classify-uncommitted.ps1` | PowerShell 동등 규칙 (`supabase/migrations/*service_role*` → REVIEW) |

### 터미널 562098 (Node classifier + D: desktop-repo + bundle hash)

- `CLASSIFIED=266` — `03`/`02` 갱신
- D: `desktop-repo/`에 루트 미커밋 복사: 목업 ZIP 2, `CURRENT_STATE.md`, `PUTDUK_*`, `putduk-sk-hynix-mining-v3-precision.html` 등 (C: 원본 유지, 복사만)
- D: `putduk-mining-all.bundle` SHA256 **확인**: `BA269DCAFE6F7A468CE48190972AB83EC23AB9FF5CB5D2BACF5E30B204CCD2FA` (F: mirror 동일)

### F: 증분 포인터 (C: 중복 없음)

- 실물: `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\mirror\putduk-mining-all.bundle` (~344MB, KINGSTON FAT32 ~215GB 여유)
- 포인터: `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\STORAGE-POLICY-POINTER.txt` → repo `STORAGE-POLICY.md`
- 감사 보고서 번들: `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\audit-reports-bundle-20261010.zip` — SHA256 `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\hashes\audit-reports-bundle.sha256.txt`
- **audit-reports-bundle 재빌드 (2026-10-10):** `134C4EE02FC3D36AB554874E84D6827066A82B1B172A8B910E8509F3B8C3FC69` — GPT_HANDOFF·GPT_AUDITOR_ATTACHMENT_CHECKLIST 포함 (24 entries); 정본 해시 `F:\...\hashes\audit-reports-bundle.sha256.txt`

## Recovery 브랜치 (로컬 ref, 별도 worktree 없음)

- `codex/local-cloud-recovery-admin-content-pwa`
- `codex/local-cloud-recovery-finance-db`
- `codex/local-cloud-recovery-integration`
- `codex/local-cloud-recovery-provider`

번들에 포함됨; D: `recovery-branches-export/`에 tip 요약만 추가.

## Phase 2 결정 패키지

사용자-facing **2차 보고** 정본: [`14_PHASE2_DECISION_PACKAGE.md`](./14_PHASE2_DECISION_PACKAGE.md) (커밋 wave·push 옵션·WS-05 테스트·§6 승인 게이트).

## Phase 2 prep 체크리스트

- [x] prunable·missing worktree 경로 물리 스캔 → `01_ORPHAN_WORKTREES.md` (prune **deferred**)
- [x] `01_WORKTREE_INVENTORY_SUMMARY.md` — 요약 표 (정본 CSV는 D: exports)
- [x] push 누락·upstream 없음 브랜치 전체 목록 → `04_UNPUSHED_BRANCHES.csv` (+ F: export)
- [x] Stash `stash@{0}` 패치 export → F: `exports/stash-0.patch` (+ metadata; pop/drop 없음)
- [x] `13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md` 존재 확인 · `07` 교차 링크
- [ ] **USER_APPROVAL_REQUIRED** — PR [#72](https://github.com/goldeget/putduk-mining/pull/72) merge
- [ ] **USER_APPROVAL_REQUIRED** — unpushed 브랜치 push (78건 분류·선별 후)
- [ ] **USER_APPROVAL_REQUIRED** — 로컬 `develop` ↔ `origin/develop` 동기화 (현재 behind 18)
- [ ] **USER_APPROVAL_REQUIRED** — desktop dirty 레인 분리·커밋 (`codex/product-ai-navigation` @ `af14c2f`)
- [ ] **USER_APPROVAL_REQUIRED** — `git worktree prune` (orphan 10건 정리)
