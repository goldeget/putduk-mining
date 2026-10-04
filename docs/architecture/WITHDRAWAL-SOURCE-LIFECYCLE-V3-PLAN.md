# Withdrawal Source Lifecycle V3 재개 계획

- 전체 V3 상태: **PROPOSED / NOT ACTIVATED**
- 작은 안전 차단안: **SOURCE IMPLEMENTED / DB·RUNTIME NOT VERIFIED**
- 검증된 채굴 수익 생산자: **VERIFIED EARNED WRITER NOT CONNECTED**
- 조사·작성일: 2026-10-04 KST
- 기준: 이 저장소의 현재 migration, 실제 route/reader, 승인된 V1 정책
- 대상: `goldeget/putduk-mining`, Supabase `osrmyjgmpdspdcwqjwuv`

이 문서는 조사된 결함, 작성된 안전 차단 소스와 다음 구현 순서를 고정한다. DB 설치,
명령 실행, 원격 상태, 사용자 자금 또는 기능·제품 완료를 입증하지 않는다.
기존 WS04를 변경하거나 경제 엔진을 활성화하는 문서가 아니다.
기존 applied migration과 보호된 provenance source는 수정하지 않는다.

## 1. 승인된 동작과 현재 결함

승인 근거는 `docs/product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md:103`과
`docs/product/economy-v1-approved-2026-10-03.json`이다.

| 사용자 동작 | 허용 출처 | 보존 조건 |
| --- | --- | --- |
| 채굴 수익 출금 | VERIFIED `MINING_REWARD`만 | PRINCIPAL/BONUS 자동 대체·혼합 금지 |
| 명시적 원금 회수 | `PRINCIPAL`만 | 원금 변화 이후 Tier/Capacity/Speed 재평가 |
| START 첫 출금 | 원본 START conversion의 BONUS | 무입금, 최대 5,000원, 수수료 0, 원본 conversion 한 번 |
| 미래 수수료 | 해당 출금과 같은 bucket만 | 새 승인 정책 버전 소비, 다른 출처 대납 금지 |

V1 platform fee 0은 초기 승인 정책 값이다. 미래 운영자가 새 정책 버전으로
숫자를 변경할 수 있으므로 일반 경제 수수료를 함수의 영구 상수로 복제하지
않는다. START의 무입금·최대 5,000원·무수수료 계약은 별도로 보존한다.

**안전 차단 전 소스에서 확인한 P1:** 현대 일반 출금은 채굴 수익이 아니라 전체
KRW 사용 가능액을 예약한다. 입금 원금만 있는 회원도 다른 조건이 맞으면 일반
출금이 가능하다. 아래 신규 migration은 이 생성 경로를 닫는다. DB 적용·실행
검증을 수행하지 않았으므로 실제 배포 상태가 고쳐졌다고 주장하지 않는다.

- `20260927120300_ws04_destination_and_request_commands.sql:99`의
  `available_krw_balance`는 wallet 순액에서 열린 출금 amount+fee를 뺀다.
- 같은 파일 `:439`의 공통 writer는 `:535`에서 이 총액만 검사한다.
  source confirmation, source coverage, verified reward 잔여액 검사가 없다.
- `app/api/v1/withdrawals/intents/route.ts`는 source/preview proof 없이 준비한다.
  `app/api/v1/withdrawals/hold/route.ts:9`도 method/destinationId/amountKrw만
  받고 기존 logical hold에 전달한다. 조사 시점의 hold schema는 strict가 아니었다.
  안전 차단 묶음의 HTTP 입력·한국어 복구 처리는 별도 owner의 구현 범위다.
- `app/(product)/wallet/withdraw/page.tsx:395`는 전체 available KRW를 폼에
  전달한다. 이 숫자는 채굴 수익 출금 가능액의 증거가 아니다.
- `20261003081200_money_source_credit_provenance.sql:430`은 모든 KRW 출금을
  unconnected로 센다. 이 view는 읽기 모델이며 신청을 막는 gate가 아니다.

이 문서에서 migration 파일명은 `supabase/migrations/`, DB fixture 파일명은
`supabase/tests/database/`를 기준으로 한다. 행 번호는 조사 시점의 소스 근거다.

## 2. 현재 정확한 명령 서명

다음은 실제 소스에서 확인한 서명이다. request/release/finalize의 UUID 반환값은
각각 withdrawal ID / release journal ID / finalize journal ID다.

```text
public.request_krw_withdrawal(
  p_user_id uuid, p_destination_id uuid,
  p_amount_krw bigint, p_idempotency_key text
) returns uuid

public.request_usdt_withdrawal(
  p_user_id uuid, p_destination_id uuid,
  p_amount_krw bigint, p_idempotency_key text
) returns uuid

app_private.request_withdrawal_with_hold(
  p_user_id uuid, p_destination_id uuid, p_amount_krw bigint,
  p_expected_destination_type text, p_idempotency_key text,
  p_welcome_reward_conversion_id uuid DEFAULT NULL
) returns uuid

app_private.post_withdrawal_hold(
  p_user_id uuid, p_withdrawal_id uuid, p_amount_atomic bigint,
  p_idempotency_key text, p_request_id uuid
) returns uuid

public.release_withdrawal_hold(
  p_withdrawal_id uuid, p_actor uuid, p_reason text,
  p_idempotency_key text, p_disposition text
) returns uuid

public.finalize_withdrawal_ledger(
  p_withdrawal_id uuid, p_actor uuid, p_idempotency_key text
) returns uuid

public.prepare_withdrawal_logical_request(
  p_user_id uuid, p_method text, p_amount_krw bigint,
  p_policy_id uuid, p_policy_version integer,
  p_destination_fingerprint text, p_destination_id uuid DEFAULT NULL
) returns jsonb

public.hold_withdrawal_logical_request(
  p_user_id uuid, p_idempotency_key text, p_method text,
  p_destination_id uuid, p_amount_krw bigint
) returns uuid

public.resolve_withdrawal_logical_request(
  p_user_id uuid, p_action text DEFAULT 'RECOVER',
  p_idempotency_key text DEFAULT NULL, p_withdrawal_id uuid DEFAULT NULL
) returns jsonb

public.create_welcome_reward_withdrawal_request(
  p_user_id uuid, p_conversion_id uuid, p_withdrawal_policy_id uuid,
  p_destination_id uuid, p_idempotency_key text, p_request_id uuid
) returns uuid
```

request/private hold의 정의는 `20260927120300...sql:43/:439/:641/:664`,
release/finalize 최신 본문은 `20261002230000_krw_deposit_journal_integrity.sql:811/:966`,
logical은 `20260930052429_withdrawal_logical_lifecycle.sql:53/:166/:217`,
dedicated START는 `20260927120400_ws04_withdrawal_lifecycle_commands.sql:555`다.
public money command의 기존 service-only execute, SECURITY INVOKER,
fixed search path를 유지한다. request alias/overload, USDT wallet,
별도의 mutable money writer를 만들지 않는다.

## 3. 먼저 적용할 작은 안전 차단안

전체 V3 전에 새 일반 hold를 명시적으로 닫는 안전 migration은 가능하다.
이는 source lifecycle 구현이나 일반 출금 완료를 뜻하지 않는다.

### 3.1 변경할 함수와 guard 위치

기존 `app_private.request_withdrawal_with_hold`의 동일 서명 본문만 새 migration으로
교체한다. 기존 migration은 변경하지 않는다.

1. 현재 SafeMode와 기본 입력 검사를 유지한다.
2. `:474–480`의 기존 owner+key request가 있으면 원본 ID 복구를 유지한다.
   이 단계에서 과거 request에 새 source를 추정하지 않는다.
3. 원본이 없는 경우 `p_welcome_reward_conversion_id IS NULL`인 새 일반 request를
   verified source producer와 withdrawal lifecycle coverage 미연결을 나타내는
   명시적 도메인 오류로 거절한다.
4. guard는 `:482`의 destination `FOR UPDATE`보다 앞에 놓는다.
   request, hold journal, outbox, receipt를 만들기 전이어야 한다.
5. non-NULL 값도 신뢰하지 않는다. 원본 conversion의 owner·CONVERTED·실제 금액,
   승인 qualification과 원본 BONUS/WELCOME_REWARD CREDIT의 journal·wallet·outbox
   완전성을 검증한 실제 START만 진행한다.

오류 이름은 `WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE`이며 SQLSTATE는
`55000`이다. route에서 안전한 한국어 복구 안내로 대응한다. source 부재를 영구 금액
상수 0이나 가짜 sourceComplete=true로 표현하지 않는다.

이 작은 안은 새 advisory/row lock, 뒤늦은 source INSERT trigger, confirmation,
risk, receipt 변경을 추가하지 않는다. 따라서 새 lock order나 deadlock 경로를
도입하지 않는다. logical wrapper의 기존 lock은 유지하고, guard 예외는
같은 DB 호출을 rollback한다. 기존 락 자체가 교착하지 않는다는 새 실행 증거를
이 설계만으로 주장하지 않는다.

일반 public request 4인자는 welcome 인자에 NULL을 전달하므로 우회할 수 없다.
새 principal 회수도 열지 않는다. 관리자 설정, PUBLISHED policy, 일반 CREDIT만으로
guard를 해제하면 안 된다. verified earned producer와 V3 lifecycle의 구현·검증 후
별도 migration으로 재개한다.

기존 owner+key 조기 return은 material hash를 비교하지 않는 알려진 부족이다.
작은 안에서는 기존 복구를 보존하고, V3에서 원본 입력 일치 검사를 추가한다.
복구 return은 새 money effect를 만들지 않는다.

### 3.2 START 예외는 실제 dedicated flow에만 적용

일반 route에 welcome/source 인자를 받지 않는다. private의 non-NULL 값 자체를
새 자격 증명으로 취급하거나 임의 service caller의 합성 conversion을 허용하지 않는다.

기존 dedicated command는 원본 conversion owner·CONVERTED 상태를 FOR UPDATE로
확인하고, 정수 양수 amount, 최대 5,000원, 기존 conversion 출금 부재, verified
destination·보호 시간, welcome enabled·fee 0 policy를 확인한 뒤 private writer를
호출한다(`20260927120400...sql:588–648`). conversion은 기존 KYC/anti-abuse
qualification과 balanced TRIAL_REWARD_CONVERSION·WELCOME_REWARD wallet CREDIT의
결과다. 현재 브라우저 일반 request는 이 dedicated 인자를 선택할 수 없다.
private writer도 동일 owner·CONVERTED·금액과 승인 qualification version을 읽고,
원본 BONUS/WELCOME_REWARD CREDIT의 journal·wallet ID·금액을 대조한다. 기존
`app_private.money_source_credit_verified`로 보호된 원본 complete receipt를 확인한다.
신규 lock 없이 SELECT만 사용하며 dedicated command의 기존 lock을 보존한다.

작은 차단안은 START에 입금 조건, 일반 MINING_REWARD 조건, 일반 경제 최소 원금을
추가하지 않는다. 정상 START의 새 hold·release·finalize와 원본 retry를 유지한다.
source lifecycle의 완전성이 미연결인 점은 완료 상태로 바꾸지 않는다.

### 3.3 작성된 안전 차단 소스와 검사 경계

`20261004100000_withdrawal_verified_source_guard.sql`은 기존 private writer 한 개를
동일 서명으로 교체한다. owner/key 원본 복구 뒤·첫 destination lock 앞의 일반
거절 및 START 원본 증거 검사 외에는 원래 본문을 그대로 보존한다. 새 권한, alias,
trigger, lock, source movement, 정책 숫자, production flag를 만들지 않는다.
원금 회수도 열지 않는다.

`withdrawal_verified_source_guard.sql`은 실제 deposit command의 원금, 미분류
MINING_REWARD label, 실제 START BONUS의 일반 신청 거절을 검사하도록 작성했다.
public 양쪽 4인자, logical hold, 최종 private writer의 신규 효과가 없음을 검사한다.
다른 회원·PENDING·미확인 conversion과 원본과 다른 금액은 private START도 거절한다.
정상 START는 기존 conversion/qualification 결과로 양쪽 방법의 5,000원·fee0·무입금
hold를 만들고 원본 복구, 송금 후 release 금지, finalize/release의 한 번 효과를
검사한다. provenance는 UNRESOLVED로 남기며 source lifecycle을 완성한 척하지 않는다.

historical 자료의 canonical 원문은
`supabase/test-fixtures/historical-held-withdrawal.sql`이다. migration에 설치하지
않고 `pg_temp`에만 존재한다. PostgreSQL owner만 실행하며 일반·인증·service 역할의
execute를 회수한다. 원본 request, 기존 balanced `post_withdrawal_hold`, outbox와
receipt를 같은 테스트 transaction에 만든다. wallet CREDIT, verified source, 과거
writer 권한 복구는 없다. 이는 과거 처리 shape의 테스트 자료이며 실제 과거 처리나
검증된 채굴 수익이 있었다는 증거가 아니다.

DB test container의 상대 파일 loader가 확인되지 않아 네 SQL suite는 이 원문을
transaction 안에 동일하게 포함한다. `tests/unit/withdrawal-verified-source-guard.test.ts`가
네 복제본의 원문 일치, rollback, 11개 생성 지점과 기존 plan/assert 수를 검사한다.
worker는 같은 PostgreSQL owner 연결에서 canonical fixture를 읽고 만들며 연결이
끝나면 임시 함수가 사라진다. 그 전 실제 service request의 거절·효과 없음, 그 후
원본 public RPC 복구와 UNRESOLVED, 기존 finalize/no-resend를 검사한다.

이 단위 검사는 신규 guard를 제외한 private writer 전체 원문 일치도 확인한다.
Node source 검사 10개, DB를 쓰지 않는 worker lease 검사 4개, 대상 엄격 TypeScript,
ESLint·Prettier·기존 변경 diff 검사는 통과했다. DB/worker 실제 실행, 두 세션 경합,
브라우저, CI는 이 작성 단계에서 실행하지 않았다. 작은 guard의 소스 작성은 전체
V3 활성화, 일반 수익 출금 완료 또는 제품 완료의 증거가 아니다.

### 3.4 CI4에서 발견한 검사 자료 경계 수정

2026-10-04 CI4의 DB 검사에서 세 가지 자료 결함이 확인됐다. shared helper를
`supabase/tests/` 아래에 두어 독립 pgTAP suite로 수집한 오류는 위 canonical
경로로 이동해 해결한다. 원문 SHA-256은
`4de90b385f94f9583b272738ffecb9a301127a543283acabe07e7c40d3b9db1f`로 동일하다.
네 rollback-only SQL suite의 inline 원문과 owner-only 의미는 바뀌지 않는다.

guard suite의 기존 목적지 fingerprint는 UUID와 method를 붙인 값이었다.
실제 `prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid)`는
목적지의 64자리 lowercase hex identity를 읽으므로 시험 identity를 SHA-256
hex로 만든다. 7인자의 위치와 실제 목적지 binding은 유지한다.

historical request의 hold retry는 이미 commit된 원본 UUID를 바로 반환한다.
logical state를 갱신하는 동작은 기존 `resolve_withdrawal_logical_request`의
`RECOVER`다. logical suite는 이 실제 명령으로 원본을 재결합한 뒤 기존
`OUTCOME_UNCERTAIN`과 원장·outbox·receipt 한 번 효과를 그대로 검사한다.
상태 기대를 낮추거나 production writer·권한을 변경하지 않는다. 이 수정의
DB 실행·재실행 CI 성공은 아직 별도 검증 대상이다.

## 4. 기존 fixture와 승인 정책의 불일치

`withdrawal_logical_lifecycle.sql:27–29`는 실제 deposit command로 100,000 KRW를
입금하고, `:34`의 일반 1,000 KRW prepare 뒤 `:55/:74`의 일반 hold 성공을
기대한다. verified MINING_REWARD producer가 없는 자료다. 현재 총 KRW 동작의
fixture이며 승인된 source 정책의 증거가 아니다.

안전 차단 전 DB SQL에는 다음 **4개 파일, 11개 fresh general 성공 생성 지점**이 있었다.
이는 생성 지점 수이며 관련 assert/retry/negative 검사 총수가 아니다.

| DB fixture | fresh general 성공 생성 지점 | 유지할 후속 검증 |
| --- | --- | --- |
| `ws04_security_money_workers.sql` | `:183/:357/:407/:529` (4) | balanced hold, cancel/reject, manual send, finalize/no-resend, 권한 |
| `withdrawal_logical_lifecycle.sql` | `:55/:74` (2) | owner/key, destination binding, TTL, 원본 복구, 별개의 정당한 intent |
| `legacy_withdrawal_entrypoint_closure.sql` | `:161/:164` (2) | legacy execute 차단, modern service-only, 송금 후 ledger-only retry |
| `krw_deposit_journal_integrity.sql` | `:811/:985/:1090` (3) | 원본 audit/idempotency/journal/outbox, release/finalize 완전성 |

원금 fixture로 새 일반 출금을 성공시키는 기대는 명시적 거절로 바꾼다.
후속 lifecycle 검사를 삭제하지 않는다. 과거 commit된 source-less request의 원본
receipt를 재현하는 **명시적 historical fixture**와 새 일반 거절 fixture를 분리한다.
historical seed는 test-only 자료이며 verified MINING_REWARD 증명이 아니다.
guard 우회용 실서비스 command alias, 과거 writer의 권한 부활, 무제한 source INSERT는 금지다.

추가 영향은 실제 `tests/worker/runtime-evidence.test.ts:677`의 request RPC와
`tests/e2e/authenticated/withdrawal-p1-recovery.spec.ts`,
`withdrawal-negative-guards.spec.ts` 등의 hold HTTP 호출이다. 이 11개를 전체 suite의
변경 수로 주장하지 않는다. 특히 가로챈 HTTP 응답과 실제 RPC 성공 기대를 구분한다.
SQL/worker runtime 검사는 작성 시점에 실행하지 않았다. Node source 검사는 3.3에
별도로 기록하며 runtime 검사와 구분한다.

## 5. 전체 V3의 prepare 계약 제안

다음은 **PROPOSED**이며 기존 WS04에 등록·구현되지 않았다.
구현 전에 WS04와 route/DB caller를 같은 atomic batch에서 갱신한다.

```text
public.prepare_withdrawal_logical_request(
  p_user_id uuid, p_method text, p_amount_krw bigint,
  p_policy_id uuid, p_policy_version integer,
  p_destination_fingerprint text, p_destination_id uuid,
  p_source_confirmation jsonb
) returns jsonb
```

source confirmation은 필수이고 destination ID는 명시 NULL을 허용한다.
기존 7인자의 source 생략 진입점을 제거하여 서명 하나로 만든다. 기존 서명을
overload/default로 남기지 않는다. public request 4인자, hold 5인자,
release/finalize 서명은 보존하고 owner+key의 원본 confirmation을 내부에서 읽는다.

V3 confirmation은 다음 의미를 고정한다.

- owner, 무작위 logical key, 명시 action/source, amount와 fee.
- method, 등록 전 destination fingerprint, 등록 후 destination ID.
- withdrawal policy ID/version과 effective economy publication/revision/digests.
- source coverage/revision과 관련 balance/entitlement revision.
- exact epoch microseconds의 서버 평가 시각, expiry, canonical digest.
- 승인된 source 원본 참조. principal 개방 시 원본 lot와 예약 배분.

Browser는 action/amount/목적지와 opaque preview/confirmation ID만 전달한다.
서버/DB가 원본 receipt, 현재 policy/revision을 검증하고 canonical confirmation
body/digest를 만든다. client가 만든 배분·hash는 권위가 아니다.
private formula/source map, 승인 원본문서, server secrets를 client에 보내지 않는다.
JSON은 versioned/strict이고 금액·revision·µs는 exact integer/string이다.

prepare는 money를 움직이지 않는다. bind는 원본 source/hash를 다시 만들거나
교체하지 않고 목적지 identity를 결합한다. hold는 lock 아래 최신 revision을
재검증하고 confirmation→request→journal→source→event/audit를 같은 transaction에
고정한다. source 실패/stale이면 전체 rollback한다. expiry/policy 변경을 이유로
기존 key를 자동 회전시키지 않는다. 확인 소비는 원본 삭제·교체가 아니라 한
withdrawal에 원본 confirmation을 귀속시키는 것이다.

## 6. 기존 pending과 historical recovery

- V2 pending에 money가 없으면 기존 resolve로 원본 상태를 확인하고 안전한
  cancel/reject 후 새 V3 preview·명시 확인·key를 준비한다.
- V2 pending에 withdrawal이 있으면 owner/key/request ID의 원본 복구를 유지한다.
  expiry, 새 policy, 이후 pending을 이유로 두 번째 hold를 만들지 않는다.
- 과거 일반 request의 source를 추정하지 않는다. 취소된 요청도 포함하여 미확인
  경력을 자동 COMPLETE로 바꾸거나 history를 backfill하지 않는다.
- EXTERNAL_SENT_RECORDED 후 재송금·release를 금지하고 원본 receipt에 따른
  ledger-only finalize/retry를 보존한다. source 미확인으로 송금된 처리를 일괄
  차단하여 원장 완료를 못 하게 만들지 않는다.
- 전체 V3의 historical branch는 실제 introduced epoch와 원본 receipt로 구분한다.
  source 부재만으로 새 request를 historical로 인정하지 않는다.

작은 차단안은 release/finalize/external-send 본문을 바꾸지 않는다.
전체 source-aware 교체 전에 위 역사 호환 분기를 계약으로 고정한다.

## 7. 전체 구현의 serialization과 시각

작은 차단안에는 새 lock이 없다. 다음은 전체 V3/engine writer 도입을 위한
제안이며 현재 구현된 계약으로 주장하지 않는다.

1. policy를 고정하는 명령은 기존 economy-policy shared lock을 먼저 획득한다.
2. 고정 namespace/key의 **member money serialization을 첫 member lock**으로
   획득한다. row-trigger의 늦은 지점에서 획득하지 않는다.
3. 필요한 logical/domain/request, destination, wallet/source cursor를 모든 명령에서
   고정 순서로 획득한다. 복수 원본 source/lot row도 명시된 순서로 처리한다.
4. deposit/request ID에서 owner를 알아야 하면 초기 읽기 후 member lock을 얻고
   row를 다시 읽어 owner/terminal 상태를 검증한다. request row를 먼저 잠근 뒤
   member lock을 얻어 deposit과 반대 순서로 만들지 않는다.

대상은 KRW approval, USDT confirmation, START conversion, prepare/bind/hold/resolve
관련 경로, private hold, external-send, release/finalize, 미래 earned writer/correction이다.
producer마다 다른 member key를 만들지 않는다. helper를 추가한다면 명시된 private
serialization helper 하나이며 별도의 public money command alias가 아니다.

`20260926192203_ws02_foundation_schema.sql:127`의 journal posted_at 기본값은
statement_timestamp()다. 대기 전 시각을 새 경제 effective instant로 사용하지 않는다.
member lock 뒤 clock_timestamp()를 얻고 현재 cursor에 대한 단조성·revision을 검증해
exact µs를 원본에 고정한다. retry는 원본 시각을 유지한다. 같은 µs의 복수 효과는
승인된 revision/sequence 순서로 처리한다. UUID/읽기 순서 또는 JavaScript Date의
ms 절삭으로 경제 순서를 정하지 않는다.

## 8. Source·wallet·lot의 원자적 효과

현재 movement schema는 여러 kind를 열거하지만 실제 guard는 CREDIT3만 허용한다
(`20261003081200...sql:12/:44/:65`). 이를 reserve 구현으로 오인하지 않는다.
새 migration에서 schema/validator/view와 complete guard를 함께 확장한다.
기존 CREDIT 원본 검증, append-only, FORCE RLS, 최소 권한을 보존한다.

| 단계 | 원장·wallet | source/entitlement |
| --- | --- | --- |
| HOLD | liability DEBIT / clearing CREDIT. wallet DEBIT 없음 | amount+fee를 원본 bucket에서 RESERVE. principal만 그 시점부터 제외 |
| RELEASE | clearing DEBIT / liability CREDIT. wallet CREDIT 없음 | 원본 reservation만 복원. principal 권리는 release 이후부터 복원 |
| FINALIZE | clearing DEBIT / payout cash CREDIT + wallet DEBIT | held를 FINALIZE. available principal을 다시 차감하지 않음 |

source movement는 정수 양수이고 fee0에 대한 0 movement를 만들지 않는다.
현재 unique는 journal/source/kind 단위이므로 같은 bucket의 amount+fee는
집계 movement 하나에 고정한다. 원본 credit/lot 참조 배분은 별도 immutable
receipt로 완전성을 검증한다. mutable source balance writer를 추가하지 않는다.

request, confirmation, bucket, 원본 reservation, amount+fee, journal, wallet effect의
유무, outbox, audit, idempotency, terminal once가 맞지 않으면 rollback한다.
HOLD_RELEASED/COMPLETED 등 기존 canonical event를 유지하고, 비동기 outbox consumer
처리만으로 자금 source capture를 나중에 덧붙이지 않는다.

현재 summary의 CREDIT 합·전체 출금 unconnected 집계는 V3 fold로 바꾼다.
관리자 `apps/admin/app/(control)/members/_lib/money-source-display.ts:31`의
현재 principal==누적 입금 조건도 같은 batch에서 version 갱신한다.
누적 입금, available, held, 회수를 구분하고 UNRESOLVED를 숫자 0으로 숨기지 않는다.

principal lot release는 원래 lot age를 보존하고 원본 reservation 범위의 금액만
복구한다. hold 기간 보상을 소급 보충하지 않는다. 순수 FundingForwardChange는
기존 lot 금액 증가를 거절하므로 release를 일반 추가 입금으로 위장하지 않는다.
원본 reservation에 연결된 bounded restore 계약이 필요하다. anchor/cycle/carry를
reset하지 않는다.

## 9. 미연결·미결정 경계

legacy `record_mining_settlement`는 `20260926094853_server_command_functions.sql:532`에
존재하고 `:722`에서 wallet MINING_REWARD를 직접 credit한다. 그러나 승인된 Funding
Engine의 balanced journal/outbox/verified source producer가 아니며 필요한 service
table-write 권한도 회수됐다. 권한을 복구하여 verified earned writer 대신 사용하지 않는다.

`calculateSettlement`는 application/worker caller가 없다. worker registry는 현재
FINANCIAL_RECONCILIATION job과 SAFE_MODE_CHANGED.v1 outbox만 지원한다.
wallet label의 MINING_REWARD 합계, pure preview, PUBLISHED policy, reader 존재는 실제
earned/carry/settlement writer나 출금 가능 source의 증거가 아니다.

**principal 부분 회수의 배분/FIFO는 사용자 답변 대기다.** FIFO·비례·사용자 lot 선택을
임의 결정하지 않는다. lot 보유기간 qualification과 실제 entitlement writer를 포함한
계약이 충족될 때까지 principal hold를 닫는다. 전액 회수 형식으로 미결 정책을 우회하지 않는다.

## 10. 구현·검증 게이트

### 10.1 작은 안전 차단 batch

- 새 migration에서 기존 private writer 동일 서명만 교체한다. guard는 원본 복구
  뒤·destination row lock 앞에 둔다. grant/INVOKER/fixed path/SafeMode를 보존한다.
- 원금만, BONUS만, 미확인 legacy MINING label, 일반 CREDIT, unresolved source의
  새 일반 request를 거절한다. request/journal/wallet/outbox/receipt 증가가 없어야 한다.
- public 4인자 양쪽과 logical 5인자, 최종 private writer 경로를 확인한다.
  member/anon의 service-only 권한 검사를 유지한다.
- 실제 START conversion과 welcome policy로 무입금 KRW/USDT hold, 5,000원 상한,
  fee0, retry, release/finalize를 검증한다. 가짜 reward/source를 만들지 않는다.
- 명시 historical request의 owner+key 복구, 송금 후 no-resend, release 금지,
  ledger-only finalize와 UNRESOLVED 유지를 검증한다.
- 위 4개 DB fixture와 관련 worker/E2E 기대를 조정하되 lifecycle 검사를 삭제하지
  않는다. verified producer 구현 전 새 일반 성공 fixture를 만들지 않는다.

### 10.2 전체 V3 batch

- source/projection/command 원본의 DB 일치와 deferred complete 검사를 추가한다.
- amount+fee 동일 bucket 부족, mixed/fallback 거절, 입력 hash/owner/key 불일치,
  만료/stale preview, policy 변경, unknown/NULL confirmation 거절을 검증한다.
- hold/release/finalize의 원본 한 번 효과와 retry를 검증한다.
  FINALIZE의 두 번째 principal 차감은 없어야 한다.
- outbox/idempotency/receipt 충돌을 일으켜 domain/ledger/wallet/source/audit/outbox/
  entitlement/cursor에 부분 commit이 없는지 확인한다.
- 기존 `money_source_provenance.sql`의 CREDIT3·epoch·위조 거절·deferred rollback
  검사를 유지한다.
- 실제 earned producer가 생산한 positive mining hold만 인정한다.
  verified label이나 fixture 성공을 runtime 완료로 부르지 않는다.

### 10.3 두 세션과 사용자 경험 검증

- 같은 회원의 두 reserve, credit 대 hold, release 대 finalize, external-send 대
  release, policy append 대 stale preview를 실제로 경합시킨다.
- member lock 전후 owner 재검증, 고정 lock order, timeout/deadlock 부재, 동일 µs
  순서, late event/cursor, 오래된 worker 결과 거절을 확인한다.
- START 무입금, 기존 pending/historical 복구, 일반 출금의 확인 필요·부족·재시도를
  authenticated browser에서 확인한다. 내부 오류 이름이나 가짜 available을 표시하지 않는다.
- DB/두 세션/CI/browser 증거를 구분한다. 승인된 저장소 전용 실행 환경과 명시 단계에서
  실행하며 기존 Supabase 실행 block을 우회하지 않는다.

이 문서만으로 migration/remote apply/worker enable/deploy/release를 허가하지 않는다.
root가 구현 owner와 atomic batch를 지정한다. 기존 보호 변경과 reader 5개 파일을 보존한다.
