# 안전 모드의 원자적 운영 명령

상태: **구현 후보 / DB·전체 CI 미검증 / PRODUCT COMPLETE 아님**.

`setSafeModeAction`과 기존 `safe_mode_controls`, `audit_logs`, `outbox_events`, `app_private.idempotency_keys`를 재사용한다. 새 public RPC·별칭·도메인 테이블을 만들지 않는다. 경제 수치·외부 환경을 활성화하지 않는다.

## 하나의 트랜잭션

서버 action은 연결 상태·논리 요청 키·입력·한국 시간·현재 상태의 요청 ID를 먼저 검증한다. 유효한 입력도 현재 origin·역할·AAL2·운영 세션·SAFE_MODE 일회용 확인을 반드시 거친다. 서버가 운영자와 현재 역할·추적 요청 ID를 넣어 `SAFE_MODE_ENABLED` 또는 `SAFE_MODE_DISABLED` 감사 행 하나만 삽입한다.

명령 metadata는 `command_version: 1`, `idempotency_key`, `expected_request_id`, `component`, `is_paused`, `review_at`의 닫힌 계약이다. 운영자는 이 구조나 내부 키를 입력하지 않는다. `app_private.apply_safe_mode_audit_command`는 비공개 SECURITY INVOKER trigger이며 현재 DB 역할을 다시 검증한다. 현재 DB 역할과 기록할 역할이 실제 부여된 역할인지 확인한다. 메타데이터에 명령 버전이 없는 과거 감사 기록은 실행하지 않는다.

trigger는 전역 논리 키와 actor·component·pause·정규화된 사유·검토 시각의 절대 시간·이전 요청 ID hash를 묶는다. component별 트랜잭션 잠금으로 최초 생성도 직렬화하고, 현재 `request_id`가 화면에서 본 값과 다르면 전체 변경을 거절한다. 같은 트랜잭션에서 상태·서버 시작 시각·이전/이후 감사 snapshot·`SAFE_MODE_CHANGED.v1`·완료된 요청 키를 기록한다. 감사 insert나 outbox가 실패하면 모두 롤백된다. 별도 상태 upsert 뒤 감사 실패라는 부분 저장 경로를 제거한다.

같은 키·다른 payload나 actor는 거절한다. 같은 요청의 재시도는 실제 원본 감사·control ID·이벤트·hash를 확인하고 감사 insert를 생략한다. 이후 다른 운영 작업이 상태를 바꿔도 과거 요청을 다시 적용하지 않는다. 불완전한 영수증은 자동 복구하거나 성공으로 받아들이지 않는다. action도 실제 감사 영수증을 다시 읽고 actor·대상·pause·hash·상태/요청 연결을 확인한다. 단순 HTTP 성공이나 trigger 누락은 처리 성공이 아니다.

## 운영 화면과 복구

현재 역할에 맞는 쉬운 한국어 양식을 사용한다. 사유·검토 시각을 편집하거나 적용/해제 대상과 상태 버전이 바뀌면 이전 확인과 TOTP 토큰을 지우며 새 논리 요청으로 검토한다. 같은 불확정 요청 재시도는 기존 키를 유지한다. 연결이 끊기면 직접 제출을 막고 재연결 시 자동 전송하지 않는다. 다른 운영 작업으로 상태가 바뀌면 새 화면을 불러와 다시 확인한다.

작업 확인이 소비된 뒤 DB나 응답이 실패하면 현재 상태와 원본 영수증을 확인하고 새 일회용 확인으로 같은 논리 요청을 재시도한다. 응답 실패를 제한 미적용으로 추정하지 않는다. `review_at`는 검토 시각이며 자동 해제 시각이 아니다. 기간이 지났다는 이유로 제한을 자동 해제하지 않는다.

## 증거와 배포 순서

새 migration은 `20261003065443_safe_mode_atomic_audit_command.sql`이다. 기존 migration·과거 감사·원장을 수정하거나 backfill하지 않는다. 새 app action과 이 migration을 한 후보로 검증한다. 향후 승인된 배포에서 migration preflight와 명령 trigger 존재·권한을 확인한 뒤 새 app artifact를 연결한다. 아직 원격 DB apply나 배포 권한은 없다.

pgTAP 후보는 실제 service_role 호출, 단일 상태/감사/이벤트, payload 충돌, 잘못된 역할, 오래된 상태, 잘못된 검토 시각, outbox 실패 전체 롤백, 과거 요청 재시도와 불완전 영수증을 검사한다. 단위 검사는 잘못된 입력이 일회용 확인을 소비하지 않는 것과 별도 상태 write 금지·영수증 실패 거절을 확인한다. 브라우저는 실제 AAL2·TOTP·저장 상태·감사를 확인한다. 검증 실행 결과와 실제 화면·접근성·성능·Visual Lab 증거를 추가하기 전에는 제품 완료로 표기하지 않는다.

## 같은 묶음의 내부 이벤트 소비

새 migration `20261003072238_safe_mode_audit_consumer.sql`은 기존 `complete_outbox_event`의 이름·인자를 유지한다. 워커의 `SAFE_MODE_CHANGED.v1` handler는 envelope를 확인하고, DB 완료 명령은 실제 원본 감사·논리 키·상태 ID·단일 이벤트의 연결을 검증한다. 현재 상태가 뒤에 변경돼도 과거 감사의 처리만 확인하며 예전 pause를 다시 적용하지 않는다.

소비 효과는 기존 `event_consumer_deliveries`의 `operator_safe_mode_audit.v1` 처리 기록 하나다. 원본 검증·중복 없는 처리 기록·outbox 완료는 동일 트랜잭션이며 실제 현재 시각의 lease를 앞뒤로 확인한다. 잘못된 worker·만료 lease·변조 payload·불완전 처리 기록은 성공이 아니다. 같은 이벤트 재전달은 기존 기록을 보존한다. worker에는 이 테이블의 SELECT·INSERT만 추가하며 UPDATE·DELETE는 허용하지 않는다.

이 소비자는 내부 감사 확인이다. 회원 알림·Web Push·새 analytics session·돈·상태 재적용을 만들지 않는다. 다른 outbox 도메인은 실제 소비자가 없으면 계속 실패·복구 대상이다. 단위 7 tests, 실제 pgTAP·등록된 worker의 원본 생성→처리→새 상태 변경→감사된 replay 증거를 하나의 후보에 묶는다. DB·전체 CI 실행은 아직 미검증이다.

운영 화면은 불확정 처리에 현재 상태 새로고침을 제공하고 이전 확인을 지운다. 같은 키의 과거 영수증이면 현재 제한을 다시 적용했다고 표시하지 않고 이미 처리한 작업이라고 설명한다. 운영 도우미는 전체 기능·제품 증거를 확보하기 전 실행 준비 완료 기능으로 등록하지 않는다. 원격 운영은 동결이다.

DB trigger 의미와 권한 검토 기준: [PostgreSQL trigger 문서](https://www.postgresql.org/docs/current/plpgsql-trigger.html), [Supabase trigger 문서](https://supabase.com/docs/guides/database/postgres/triggers).
