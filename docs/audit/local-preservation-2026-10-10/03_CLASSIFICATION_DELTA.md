# 03 분류 카운트 delta (2026-10-10)

| 시점 | COMMIT_REQUIRED | REVIEW | NEVER | PRESERVE_OUTSIDE |
| --- | ---: | ---: | ---: | ---: |
| Phase 1 초기 (ps1/mjs 휴리스틱) | 96 | 163 | 5 | 2 |
| Phase 1 후속 (mjs 재실행) | 96 | **166** | **2** | 2 |

**변경 사유**: `supabase/migrations/*service_role*` 파일명 3건 — NEVER_COMMIT 오분류 → REVIEW_BEFORE_COMMIT (`_scripts/classify-uncommitted.ps1` / `.mjs` 동기화).

**NEVER 2건 잔존** (당시 휴리스틱 결과): `tests/unit/ci/secret-mask-and-target.test.ts`, `supabase/tests/database/service_role_image_default_floor.sql` (마이그레이션 경로 아님).

## 2026-10-10 실행 정정

메타 감사 A08. 위 표의 NEVER 2건은 그 실행의 기록이다. 보안·데이터베이스 테스트는 파일명에 `secret` 또는 `service_role` 이 있어도 `NEVER_COMMIT` 으로 제외하지 않는다. `_scripts/classify-uncommitted.ps1` 와 `.mjs` 를 그렇게 고쳤다. 과거 CSV 는 재생성하지 않았다.
