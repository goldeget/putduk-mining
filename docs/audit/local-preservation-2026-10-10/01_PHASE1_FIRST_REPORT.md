# 1차 보고 — 로컬 보존 감사 (2026-10-10)

## 요약

Phase 0 백업은 **D: ESD-USB + F: KINGSTON**에 완료했고, C:에는 대용량 쓰기를 하지 않았다. Git 번들은 D: primary·F: mirror 이중 보관이며 해시 일치·`git bundle verify` 통과.

## F: 검증 결론

- **KINGSTON**, FAT32, Healthy, 여유 ~215GB → QA/백업 **적합**
- 목업 ZIP(~92MB 합) 및 번들 미러를 F:에 배치해 D: FAT32 여유(~19GB) 보존

## 인벤토리 스냅샷 (Phase 1 진행 중)

| 항목 | 값 |
| --- | --- |
| Git worktree (등록) | 84 |
| Desktop 브랜치 | `codex/product-ai-navigation` @ `af14c2f` |
| Desktop dirty | modified 11, untracked 14 |
| 전 worktree dirty 합 | modified 248, untracked 18, 파일 행 266 |
| 분류 | COMMIT_REQUIRED 96 · REVIEW **166** · NEVER_COMMIT **2** · PRESERVE_OUTSIDE_GIT 2 (`03_CLASSIFICATION_DELTA.md`) |

### 주요 미커밋 영역 (desktop)

- Admin: USDT 입금, members, restrictions, E2E money/withdrawal specs
- 문서: `AGENTS.md`, `WS-05-CLOSURE.md`, audit `docs/audit/` 신규
- 루트: 에이전트/감사 초안 MD·TXT·JSON, 목업 ZIP 2건 (F:에 복사됨)
- 로컬 rule: `.cursor/rules/putduk-ci-wall-clock.local-before-sync.mdc`

### 병렬 worktree (`.cursor/worktrees/putduk-pc-*`)

- Admin/product 평행 레인 다수에 **dirty** — lane별 PR 정리 필요
- 일부 prunable worktree는 경로만 남고 `.git` 없음 → inventory `Note`/`error` 확인 필요

### CI·recovery

- **1490cb7** worktree: `codex/backend-review-r2-ci-20261009` — D: `ci-worktree-1490cb7/` 패치 export
- **Recovery** 4브랜치: 번들 ref만 존재, D: `recovery-branches-export/` tip 기록

## 리스크

1. **C: 디스크 ~1.1GB** — 빌드·번들·node 캐시 주의
2. **FAT32** — 단일 파일 4GB; 현재 번들 안전, 장기적으로 F: 분할 정책
3. **Worktree sprawl** — 84개 중 상당수 prunable/구 Cursor 경로; 정리 전 merge/PR 우선순위 필요
4. **NEVER_COMMIT 2건** — 비밀 파일명 휴리스틱(테스트·DB test SQL); migration `service_role` 파일명은 REVIEW로 수정

## 다음 (Phase 1 계속)

1. Worktree 표 정리 → `04_WORKTREE_MATRIX.md` (예정)
2. 브랜치별 push/remote 추적 갭
3. Stash·codex snapshot ref 목록
4. 커밋 우선순위: desktop admin-money 변경 vs parallel lane 통합 전략

## 증거 위치

- 상세 영수증: `08_COMMIT_AND_BACKUP_RECEIPT.md`
- 드라이브: `00_STORAGE_LAYOUT_AND_DRIVE_VERIFICATION.md`
- D:/F: 실물: 위 08 문서 경로 표 참조
