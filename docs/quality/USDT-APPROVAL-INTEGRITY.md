# USDT 수동 입금 승인 무결성

기록일: 2026-10-03. 구현 후보이며, 정확한 후보의 DB·동시 승인·전체 CI 증거가 필요하다. **출시 승인 아님**.

## 유지하는 계약

- `public.confirm_usdt_manual_deposit(uuid,bigint,uuid,text,text) -> uuid`를 그대로 사용한다. 반환값은 실제 `ledger_transactions.id`다.
- USDT 전송은 운영자가 확인하고 승인한 원화 정수 금액을 적립한다. 시세·자동 환산·블록체인 자동 확인·사용자 USDT 잔액은 추가하지 않는다.
- `USDT_MANUAL_DEPOSIT_CONFIRMED.v1`, schema 1과 기존 payload 이름을 유지한다.
- SECURITY INVOKER, `search_path=pg_catalog`, service_role 전용 실행과 현재 운영자 권한 확인을 유지한다. 최종 운영자 작업 확인은 기존 서버 명령 경계가 담당한다.
- 원본 migration은 수정하지 않는다. CLI가 생성한 `20261003051211_usdt_approval_receipt_integrity.sql`만 추가한다. 원격 적용은 별도 단계이며 지금은 동결 상태다.

## 승인과 재시도

입금 행을 먼저 잠근다. 요청 hash는 입금 ID·원화 금액 문자열·정규화한 사유를 묶는다. `app_private.idempotency_keys`의 `usdt_manual_deposit.confirm` scope는 `actor_id IS NULL`인 전역 키를 사용한다. 운영자가 달라도 같은 키로 다른 입금·금액·사유를 보내면 거절한다. 권한은 매번 현재 운영자에게 다시 확인한다.

새 승인에서는 균형 분개 두 줄, 지갑 투영, 입금 승인 상태, 감사와 v1 outbox를 한 트랜잭션으로 만든다. 기존 분개 키를 발견해도 해당 분개를 새 입금에 채택하지 않는다. 지갑·이벤트 키 충돌을 포함해 어느 단계든 실패하면 요청 기록과 앞선 금전 쓰기까지 롤백한다.

이미 승인됐다면 요청액이 실제 승인액과 같아야 한다. 캐시된 결과만 반환하지 않고 분개·회원·원화 계정·승인 금액·지갑 연결·원래 행위자·감사·이벤트 payload·request/correlation 연결을 확인한다. 해당 입금의 분개·지갑 적립·감사·확정 이벤트는 각각 한 개여야 한다. 완전한 이전 영수증은 새 metadata나 backfill 없이 확인할 수 있으며, 기존 키로 다시 요청하면 원래 사유도 같아야 한다.

다른 키로 같은 승인액을 확인한 운영자에게는 원래 영수증을 반환한다. 추가 분개·적립·승인 감사·이벤트를 만들지 않는다. 누락·불일치·부분 승인 상태는 성공이나 자동 복구로 처리하지 않는다. 대사와 운영 검토가 필요하다. 안전 모드는 새 적립을 막으며 검증된 기존 영수증 확인은 허용한다.

새 분개 metadata에는 네트워크·원화 금액 문자열·요청 hash만 남긴다. 전체 주소와 TX는 기존 입금 요청 스냅샷에서 보존하며 분개에 중복 저장하지 않는다.

## 검증 범위

`supabase/tests/database/usdt_approval_receipt_integrity.sql`은 실제 service_role 실행, 균형 분개, 기존 영수증 호환, 전역 요청 키, 변경 payload, 현재 권한, 누락·중복 투영, outbox 불일치, 기존 분개·지갑·이벤트 키 충돌, 원자적 롤백, PROCESSING 요청, 잘못된 입력, 200자 키, JavaScript 안전 정수보다 큰 정수와 안전 모드를 검사한다. 모든 fixtures와 의도적 불일치는 마지막 rollback으로 종료한다. 원장·감사 기록을 삭제하지 않는다.

`supabase/tests-concurrent/usdt_deposit_concurrent_approval.sql`은 공유 suite 뒤에 reset한 CI 일회용 DB에서만 실행한다. 제3 연결이 같은 입금을 잠그고, 서로 다른 두 service_role 연결의 실제 미승인 lock 대기를 확인한 다음 잠금을 풀어 두 승인을 진행한다. 두 요청이 같은 영수증을 반환하고, 금액·분개·지갑·감사·outbox·완료 요청 기록이 일치해야 한다. 별도 연결에서 커밋한 시험 기록은 일회용 DB에 남기며 감사와 원장을 지우지 않는다.

기존 원화 동시 승인 검사도 유지한다. 두 파일의 fixture namespace는 다르다. 이 검사는 동일 CI job 안의 추가 step이며 전체 8개 browser shard와 품질 검사를 축소하지 않는다. 전체 CI 20분 규칙은 그대로 적용된다.

## 증거 상태와 배포 전 확인

현재 이 후보의 SQL 실행을 PASS로 기록하지 않는다. 로컬 runtime이 실행되지 않았다면 그 사실을 남기고, 정확한 후보 SHA의 CI에서 migrations reset·전체 pgTAP·두 동시 승인 파일·schema lint·security advisors와 모든 application/browser gate를 확인한다. PR 및 병합 push CI 모두 전체 20분 이내로 끝나야 한다.

원격 적용 전에는 정확한 Supabase ref와 migration 목록, 기존 영수증의 완전성, outbox 보존 기간과 재시도 요구, 잠금 및 실패 복구 절차를 검토한다. 기존 확정 outbox를 보존하지 않는 보관 정책이 필요해지면 영구 영수증 증거 계약부터 별도로 정리해야 한다. 이 패치는 삭제된 이벤트를 추정하거나 다시 적립하지 않는다. 애플리케이션 rollback만으로 DB 함수를 이전의 약한 승인 동작으로 되돌리지 않는다.
