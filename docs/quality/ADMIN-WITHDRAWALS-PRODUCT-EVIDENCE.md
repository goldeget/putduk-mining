# Admin withdrawals product evidence (lane N)

Status: **PARTIAL product evidence — not PRODUCT COMPLETE, not LAUNCH READY**

이 문서는 `parallel/admin-withdrawals-product` 레인의 UI/상태/시각/성능 증거만 기록한다.
WS-06 명령·원장·step-up 경로는 재작성하지 않았다.

## Scope

- `/withdrawals/krw-bank`
- `/withdrawals/usdt`
- loading / empty / query error recovery / offline banner
- theme × viewport screenshots
- keyboard focus outline
- reduced-motion (infinite animation absent)
- bounded route timing JSON (acceptance 아님)
- held queue card UI presence (money finalize 없음)

## Explicit OPEN

- Unsafe fault injection (DB/RPC/network sabotage) — **OPEN**
- Canonical Visual Lab 1:1 admin queue benchmark frames — Visual Lab SCREEN-MATRIX에 관리자 출금 대기열 전용 row가 없어 **HUMAN_DECISION_REQUIRED** (비교 기준 프레임 승인 필요)
- Field Web Vitals / production-device performance acceptance — **OPEN**
- PRODUCT-COMPLETE-MATRIX / RELEASE-READINESS-MATRIX 갱신 — 공유 파일이라 이 레인에서 수정하지 않음 (**SHARED_FILE_REQUEST**)
- `playwright.authenticated.config.ts`에 `admin-withdrawals-product`를 adminSpecs 정규식·mobile ignore에 명시 — **SHARED_FILE_REQUEST** (전체 auth suite에서는 자동 수집됨)

## WS-06

명령 경로(`record_*_external_send`, `finalize_withdrawal_ledger`, `release_withdrawal_hold`, step-up family)는 이 레인에서 **재작성하지 않음**.

## Money / outbox

이 레인 UI 변경은 새 한도·은행 안내·원장 전이를 발명하지 않는다.
USDT 카피는 KRW 잔액 기준 출금이며 회원 USDT 잔액이 아님을 유지한다.

## Tests

- `tests/e2e/authenticated/admin-withdrawals-product.spec.ts`
- 기존 money/step-up 스펙의 금액 단언은 약화하지 않음

## Artifacts

로컬/CI 실행 후:

- `test-results/admin-withdrawals-product/*.png`
- `test-results/admin-withdrawals-product/*-route-timing.json`
