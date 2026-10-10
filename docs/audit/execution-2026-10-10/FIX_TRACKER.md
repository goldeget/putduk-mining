# FIX 추적 — 2026-10-10 실행

메타 감사 `PUTDUK_META_AUDIT_20261010.md` 를 현재 HEAD 소스와 대조했다. 즉각적인 P0 운영 사고는 감사 본문이 이미 철회했다. 아래는 그 결론을 FIX-ID 로 나눈 것이다.

집계: 수정 5 · 거짓 2 · 차단 5 · 보류 4 · 이번 범위 밖 3.

| ID | 감사 | 상태 | 파일 | 테스트 |
| --- | --- | --- | --- | --- |
| FIX-A02 | A02 / DB job `LOCAL_DB_HOST_UNRESOLVED` | IMPLEMENTED | `supabase/snippets/resolve_disposable_dblink_host.sql`, `supabase/tests-concurrent/krw_deposit_concurrent_approval.sql`, `usdt_deposit_concurrent_approval.sql`, `safe_mode_concurrent_command.sql`, `supabase/tests/database/acknowledge_reconciliation_mismatch.sql` | `pnpm exec vitest run tests/unit/ci/disposable-dblink-host.test.ts` 통과. 이미 떠 있던 `supabase_db_putduk-mining` 에 함수만 실행하고 rollback. 사설 주소 반환, exit 0. 동시 승인 SQL 은 커밋이 남아 실행하지 않음 |
| FIX-A08 | A08 NEVER 보안 테스트 제외 | IMPLEMENTED | `docs/audit/local-preservation-2026-10-10/_scripts/classify-uncommitted.mjs`, `.ps1`, `03_CLASSIFICATION_DELTA.md` | 같은 vitest 의 분류 테스트 통과. 과거 CSV 는 재생성하지 않음 |
| FIX-A10 | A10 index-only 집계 | IMPLEMENTED | `docs/audit/local-preservation-2026-10-10/_scripts/collect-worktree-inventory.ps1` | 분류 테스트가 `M ` / `A ` 행 포함을 확인. 수집 스크립트는 실행하지 않음 (기존 D: export 를 덮어쓰지 않음) |
| FIX-NEW-003 | NEW-003 MISSING_CLOUD | IMPLEMENTED | `docs/audit/local-preservation-2026-10-10/05_CLOUD_TO_LOCAL_FUNCTIONAL_FIDELITY.md` | 문서 정정. 제품 테스트 없음 |
| FIX-NEW-004 | NEW-004 CSV 행 유실 | IMPLEMENTED | `classify-uncommitted.mjs`, `.ps1` 행 수 불일치 시 중단 | 따옴표 안 줄바꿈·열 불일치·닫히지 않은 따옴표 테스트 통과 |
| FIX-NEW-001 | NEW-001 요구 추적 | OUT_OF_SCOPE_THIS_PASS | 없음 | 프로세스 공백. 제품 결함으로 재현되지 않음 |
| FIX-NEW-002 | NEW-002 P0 정의 | OUT_OF_SCOPE_THIS_PASS | 없음 | 등급 문장 정정. 코드 변경 없음 |
| FIX-NEW-005 | NEW-005 추천 정책 원문 | BLOCKED_USER_APPROVAL | 없음 | 운영 금액·실지급·원격 DB 승인 전 중지. 도메인 상수는 기존 잠금(추천 5,000+5,000, 한도 10,000, 환영 5,000)과 맞음 |
| FIX-NEW-006 | NEW-006 등급 하락 슬롯 | DEFERRED_WITH_REASON | 없음 | `OWNER-PRODUCT-TIER-POLICY-2026-10-07.md` 가 이 트리에 없음. 감사도 서버 부재로 확정하지 않음 |
| FIX-NEW-007 | NEW-007 AI 상담 이관 | DEFERRED_WITH_REASON | 없음 | 연결 단절을 재현하지 못함 |
| FIX-NEW-008 | NEW-008 200 응답 평가 | BLOCKED_USER_APPROVAL | 없음 | 유료 제공자 호출 승인 없음 |
| FIX-NEW-009 | NEW-009 캡처·폰트 | OUT_OF_SCOPE_THIS_PASS | 없음 | 재현 없음. PROPOSED 화면으로 제품을 다시 그리지 않음 |
| FIX-NEW-010 | NEW-010 배포 결합 | BLOCKED_USER_APPROVAL | 없음 | 보호 규칙·웹훅을 바꾸지 않음 |
| FIX-NEW-011 | NEW-011 응답 유실 | DEFERRED_WITH_REASON | 없음 | `COMMAND_FAILED` 이름만으로 중복 지급이 성립하지 않음. 멱등 키 검사는 기존 command gate 에 있음 |
| FIX-A01 | A01 CI 실패 | BLOCKED_USER_APPROVAL | 코드 부분은 FIX-A02 | push 와 CI 재실행 없음. 이번 후보의 전체 workflow 는 다시 측정하지 않음 |
| FIX-A03 | A03 UI 컨테이너 실패 | DEFERRED_WITH_REASON | 없음 | 호스트 불일치를 모든 UI 실패의 원인으로 확대하지 않음. assertion 을 약화하지 않음 |
| FIX-A04 | A04 금융 계약 문서 | BLOCKED_USER_APPROVAL | 없음 | 코드 상수를 소유자 원문 없이 바꾸지 않음 |
| FIX-A12 | A12 PWA 전체 미구현 | FALSE_POSITIVE | 없음 | 감사 본문이 상태 처리 기반은 있다고 정정함 |
| FIX-P0 | 즉각 운영 자금·데이터 사고 | FALSE_POSITIVE | 없음 | 감사 본문이 P0 운영 사고를 철회함. 이 트리에서 새로 재현하지 않음 |

한 번에 실행한 명령:

`pnpm exec vitest run tests/unit/audit/classify-uncommitted.test.ts tests/unit/ci/disposable-dblink-host.test.ts`

결과: Test Files 2 passed, Tests 8 passed (2026-10-10, vitest 5.0.2).
