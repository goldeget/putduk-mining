# 저장소 레이아웃 및 드라이브 검증 (2026-10-10)

## 사용자 지시

- C: 여유 약 1.1GB — 대용량 복사·번들 추가 금지.
- D: `ESD-USB` (FAT32) — 기존 QA 규칙 유지.
- F: `KINGSTON` (FAT32) — 2026-10-10부터 보존/감사용 추가 승인.

## 드라이브 검증 (읽기 전용)

| 드라이브 | 레이블 | 파일시스템 | Health | 여유 | QA/백업 적합 |
| --- | --- | --- | --- | --- | --- |
| C: | (없음) | NTFS | Healthy | ~1.15 GB | **부적합** (공간 부족) |
| D: | ESD-USB | FAT32 | Healthy | ~19.17 GB | **적합** (단일 파일 4GB 제한 주의) |
| F: | KINGSTON | FAT32 | Healthy | ~215.11 GB | **적합** (대용량 미러·목업 분산) |

검증 명령: `Get-PSDrive -PSProvider FileSystem`, `Get-Volume -DriveLetter C,D,F`.

## 감사 실행 디렉터리 (타임스탬프 고정)

| 역할 | 경로 |
| --- | --- |
| D: 1차 QA 루트 | `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\` |
| F: 미러·대용량 | `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\` |

### D: 하위

- `putduk-mining-all.bundle` — 전체 ref 번들 (primary)
- `exports/` — git status/diff, worktree 목록, inventory CSV
- `hashes/` — SHA256 영수증
- `desktop-repo/`, `ci-worktree-1490cb7/` — 핵심 worktree 메타·패치
- `recovery-branches-export/` — recovery 브랜치 tip 요약 (worktree 없음, bundle ref만)

### F: 하위

- `mirror/putduk-mining-all.bundle` — D: 번들 2차 사본
- `mirror/hashes/` — 미러 SHA256
- `large-assets/` — 루트 미커밋 목업 ZIP (원본은 C: Desktop repo, 복사만)

## FAT32 정책

- 단일 파일 4GB 미만: 현재 번들 ~343MB — D:·F: 모두 단일 파일로 보관 가능.
- 향후 4GB 초과 시 F:에 분할 번들 또는 추가 미러 경로 사용 (C: 사용 금지).

## D:-only QA 스크립트 (제품 코드 변경 없음)

`scripts/run-qa-on-d.mjs` 및 `docs/development/QA-D-DRIVE.md`는 **D:\PUTDUK-MINING-QA** 아래 실행·산출을 전제로 한다.  
본 감사의 Git/번들/exports는 D:+F:에 직접 기록했으며, E2E/유닛 QA 재실행 시에도 C: 대신 D: (필요 시 F:) 여유를 사용한다.
