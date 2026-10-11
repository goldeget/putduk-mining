# 저장 정책 — 로컬 보존 감사 (2026-10-10)

감사 ID: `audit-2026-10-10-164902`

## 역할 분담

| 드라이브 | 용도 | 금지 |
| --- | --- | --- |
| **C:** | Git working tree, 소형 `docs/audit/` 텍스트 | git bundle·대용량 ZIP 신규 복사, QA 산출물 누적 |
| **D:** (ESD-USB) | Primary QA: 번들, exports, hashes, desktop/ci 스냅샷, recovery tip | 4GB 단일 파일 초과 (FAT32) |
| **F:** (KINGSTON) | 대용량 미러: 번들 2차 사본, 루트 목업 ZIP | 제품 코드·node_modules |

## F: 실물 경로 (증분 포인터)

- 번들 미러: `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\mirror\putduk-mining-all.bundle`
- 해시: `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\mirror\hashes\putduk-mining-all.bundle.sha256.csv`
- 대용량 목업: `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\large-assets\`
- D: primary와 **동일 SHA256** — C:에 추가 344MB 복사 없음

## FAT32

- D:/F: 모두 FAT32. 단일 파일 4GB 미만 유지. 초과 시 F:에 분할 번들만 추가.

## 후속 백업

- 새 타임스탬프 폴더는 `F:\PUTDUK-MINING-QA\audit-<ts>\` 형식.
- 번들 변경 시 D: primary 갱신 후 F: `mirror/` 동기화(또는 해시 포인터만 갱신).
