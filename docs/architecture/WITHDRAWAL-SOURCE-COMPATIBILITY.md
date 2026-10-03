# 출금 자금 출처 호환성 계약

상태: **SPEC_ONLY / SOURCE-AWARE WITHDRAWAL RUNTIME NOT CONNECTED**

작성 기준일: `2026-10-03`. 이 문서는 승인된 원금·자금 출처 구조와 현재
저장소 구현 사이의 차이를 기록한다. 아래의 **승인 불변식**은 기존 계약을
구체화한 것이다. **PROPOSED**로 표시한 입력·저장·잠금 선택은 아직 WS-04의
확정 서명이나 구현이 아니다. 수익률·수수료·등급 구간·운영 한도를 승인하지
않으며, migration 실행·실채굴 활성화·실송금·원격 변경·배포도 승인하지 않는다.
문서 작성이나 CREDIT capture는 기능·제품 완료 증거가 아니다.

## 1. 권위와 범위

근거는 이 저장소의 `AGENTS.md`,
[WS-04](WS-04-DOMAIN-COMMAND-CONTRACT.md),
[Money Source](MONEY-SOURCE-PROVENANCE.md),
[Balanced Ledger](LEDGER-RECONCILIATION.md),
[Entitlement Cycle](MINING-ENTITLEMENT-CYCLE-CONTRACT.md),
[Transactional Outbox](DOMAIN-EVENTS-OUTBOX.md),
[START 첫 출금](../product/TRIAL-WELCOME-WITHDRAWAL.md)과 실제 코드다.
문서의 규칙을 구현 존재로 간주하지 않는다. 이 조사에서는 로컬 파일만
읽었으며 DB·브라우저·CI·원격 상태·후보 SHA를 검증하지 않았다.

송금 수단은 `KRW_BANK` 또는 `USDT_ADDRESS`이고, 출금 회계 통화는 KRW다.
자금 출처는 `PRINCIPAL`, `MINING_REWARD`, `BONUS`,
`OTHER_NON_PRINCIPAL`이다. 수단과 출처는 독립적이다. USDT 송금은 기존 수동
외부 송금 증빙을 사용하며 사용자 USDT 지갑·잔액·자동 환율을 만들지 않는다.
`UNRESOLVED`는 출처 증거 부족을 나타내는 호환성 상태이며 다섯 번째 bucket이 아니다.

금전의 권위는 `ledger_transactions`와 `ledger_entries`다. `wallet_ledger`와
`money_source_movements`는 같은 원본에 연결된 append-only projection이다.
출처별 표시나 채굴 인정 원금을 위한 별도 mutable balance writer를 만들지 않는다.

## 2. 현재 실제 서명과 writer

다음은 migration 파일에서 확인한 현재 정의다. 실제 DB 설치 여부는 미검증이다.
`uuid` 반환값은 request 계열에서 출금 ID, release/finalize에서 journal ID다.

| 이름 | 현재 정확한 인자 순서·타입 | 반환·권한 | 정의 근거 |
| --- | --- | --- | --- |
| `public.request_krw_withdrawal` | `p_user_id uuid, p_destination_id uuid, p_amount_krw bigint, p_idempotency_key text` | `uuid`, `SECURITY INVOKER`, service-only execute | `supabase/migrations/20260927120300_ws04_destination_and_request_commands.sql:641`; revoke/grant `:659` |
| `public.request_usdt_withdrawal` | `p_user_id uuid, p_destination_id uuid, p_amount_krw bigint, p_idempotency_key text` | `uuid`, `SECURITY INVOKER`, service-only execute | 같은 파일 `:664`; revoke/grant `:682` |
| `public.release_withdrawal_hold` | `p_withdrawal_id uuid, p_actor uuid, p_reason text, p_idempotency_key text, p_disposition text` | `uuid`, `SECURITY INVOKER`; `REJECTED`/`CANCELLED` | 최신 본문 `supabase/migrations/20261002230000_krw_deposit_journal_integrity.sql:811`; 현 서명 grant `20260927120700_ws04_release_disposition_and_first_destination.sql:396` |
| `public.finalize_withdrawal_ledger` | `p_withdrawal_id uuid, p_actor uuid, p_idempotency_key text` | `uuid`, `SECURITY INVOKER`; 외부 송금 기록 필수 | 최신 본문 `supabase/migrations/20261002230000_krw_deposit_journal_integrity.sql:966`; grant `20260927120400_ws04_withdrawal_lifecycle_commands.sql:551` |
| `app_private.request_withdrawal_with_hold` | `p_user_id uuid, p_destination_id uuid, p_amount_krw bigint, p_expected_destination_type text, p_idempotency_key text, p_welcome_reward_conversion_id uuid DEFAULT NULL` | `uuid`; 기존 private 공통 writer | `supabase/migrations/20260927120300_ws04_destination_and_request_commands.sql:439` |
| `app_private.post_withdrawal_hold` | `p_user_id uuid, p_withdrawal_id uuid, p_amount_atomic bigint, p_idempotency_key text, p_request_id uuid` | `uuid`; balanced hold journal | 같은 파일 `:43` |

private writer에 이미 존재하는 welcome 인자의 `DEFAULT NULL`은 관측 사실이다.
새 출처 입력을 생략해 generic source로 처리하는 허가가 아니다. 폐기된 4인자
release는 현재 서명으로 사용하지 않는다(`20260927120700...sql:259`).

현재 동작은 다음과 같다.

| 단계 | 실제 구현 | 출처 분리와의 차이 |
| --- | --- | --- |
| 신청 | 공통 writer는 owner+key 기존 요청을 먼저 반환하고, 목적지와 KRW wallet을 `FOR UPDATE`로 잠근다. 정책의 `fee_atomic`을 선택하여 `amount + fee` 총액을 검증·예약한다(`20260927120300...sql:474`, `:482`, `:496`, `:524`, `:573`). | 금액·목적지·정책·출처를 포함한 원본 요청 hash 비교가 없다. source allocation 입력·immutable source snapshot도 없다. |
| hold | 회원 liability DEBIT / hold clearing CREDIT으로 총액 한 번을 posting한다. wallet DEBIT은 아직 없다(`20260927120300...sql:61`, `:86`). `available_krw_balance`는 wallet 순액에서 열린 신청 총액을 뺀다(`:99`). | 총 KRW 사용 가능액만 보호한다. 출처별 잔여액·예약액·인정 원금·정산 경계는 연결하지 않는다. |
| release | 요청 row를 잠그고 기존 release journal을 반환한다. 외부 송금 뒤 해제를 거절한다. amount+fee 전체를 clearing DEBIT / liability CREDIT으로 reversal하고 요청 상태·outbox·audit link를 기록한다(`20261002230000...sql:843`, `:852`, `:855`, `:872`, `:906`, `:913`, `:928`, `:944`). | 원본 source 배분 복구와 release 시점 이후 entitlement 복구가 없다. 현재 retry는 다른 disposition/reason을 원본 hash와 비교하지 않는다. |
| finalize | 요청과 wallet을 잠그고 기존 journal을 반환한다. 외부 송금 존재와 상태를 확인한 뒤 clearing DEBIT / payout cash CREDIT, wallet DEBIT, 완료 상태·영수증·outbox·audit link를 기록한다(`20261002230000...sql:994`, `:1003`, `:1010`, `:1029`, `:1060`, `:1066`, `:1085`, `:1112`, `:1127`). | 어떤 source를 최종 소비했는지 연결하지 않는다. 원금 reserve와 finalize를 함께 차감하면 이중 원금 차감이 발생하므로 새 projection은 별도 효과 규칙이 필요하다. |

현재 hold→release에는 wallet CREDIT을 추가하지 않는다. hold가 wallet DEBIT을
쓰지 않기 때문이다. finalize의 기존 wallet DEBIT은 실제 완료의 projection이며,
원금 entitlement에서 reserve를 다시 차감할 이유가 아니다. 두 회계 표현을 혼동하지 않는다.

## 3. CREDIT capture의 정확한 한계

`supabase/migrations/20261003081200_money_source_credit_provenance.sql`의 현재
`public.money_source_movements` table은 다섯 movement kind를 열거하지만,
`app_private.assert_money_source_credit`의 `p_move.movement_kind <> 'CREDIT'`
조건은 `MONEY_SOURCE_COMMAND_NOT_CONNECTED`로 거절한다.
지원되는 실제 credit 원본은 새 KRW 승인 입금, 수동 USDT→KRW 승인 입금,
START 전환뿐이다. enum/check에 `RESERVE`가 있다는 사실은 실행 연결 증거가 아니다.

현재 `public.money_source_summaries`는 `app_private.money_source_credit_verified`로
확인된 principal CREDIT 합만 계산하고,
KRW `withdrawal_requests`를 상태 구분 없이 전부 `unconnected_withdrawals`로
센다(view의 `w` lateral query와 `coverage`/`eligible_principal_atomic` CASE).
하나라도 미연결 원본이 있으면
`coverage = UNRESOLVED`, `eligible_principal_atomic = NULL`이다. 취소된 generic
신청도 source 증거가 자동 생기지 않는다. 이 conservative coverage를 `0`, 총 wallet
잔액 또는 lifetime deposit으로 대체하지 않는다.

현재 `public.money_source_movements`의 unique 단위는
`(ledger_transaction_id, source_bucket, movement_kind)`와 wallet/event별 같은
단위다. 따라서 같은 bucket의 원금액과 수수료를
두 개의 동일 kind movement로 INSERT하는 설계는 현 제약과 맞지 않는다.
**PROPOSED**: 신청 snapshot에서 두 배분을 별도로 보존하고, movement는 해당
bucket의 `amount portion + fee portion` 합을 한 row로 연결한다. 구체적인 저장
필드·영수증 검증·제약은 후속 WS-04 확장에서 확정해야 한다.

관리자 표시의 현재 parser도 `COMPLETE` 원금이 입금 CREDIT 합과 같음을 검사한다
(`apps/admin/app/(control)/members/_lib/money-source-display.ts`의
`snapshotSchema.superRefine`, `eligible_principal_atomic !== principal` 검사).
원금 reserve/release가 연결되면 이 검사는 잔여 인정 원금 의미와 충돌한다.
view·parser·표시 계약을 함께 버전 확장해야 하며, parser만 느슨하게 하여 해결하지 않는다.
같은 파일의 `presentMemberMoneySources`는 누적·미확정 채굴 수익을 항상
"확인 필요"로 표시한다. source `COMPLETE`는 posted money coverage이며,
미posting earned/pending accrual의 부재나 채굴 수익 전체 coverage를 뜻하지 않는다.

이 CREDIT migration과 표시 helper는 현재 병렬 검토 중인 로컬 후보다. 위 근거는
함수/view/조건 identity로 고정하고 유동적인 줄 번호로 설치·완료를 주장하지 않는다.
후속 최종 후보 SHA와 파일 digest에서 해당 조건·원본 receipt coverage를 재검증한다.

이 문서는 CREDIT migration 또는 그 pgTAP 파일을 수정하지 않는다.
CREDIT capture·원본 영수증 검증은 별도 작업 단위이고, source-aware 출금은 미연결이다.

## 4. 4인자 서명 유지와 필수 논리 출처 확인

**최종 추천: 기존 `public.request_krw_withdrawal`과
`public.request_usdt_withdrawal`의 4인자 서명을 그대로 유지한다.**
두 명령의 논리 key가 서버에 확정된 immutable source confirmation을 식별하고,
그 확인을 같은 hold transaction에서 반드시 검증·소비하도록 의미를 확장한다.
정확한 confirmation shape·저장 필드·다음 record version·오류·TTL은 후속 WS-04에서
확정한다. 이 추천은 아직 DB/runtime 구현이나 새로운 canonical schema가 아니다.

이 방식은 source 입력 생략을 허용하는 default가 아니다. **미준비 일반 직접
caller는 새 hold를 만들 수 없다.** owner+key와 일치하는 필수 확인 원본이 없거나
출처가 불명확하면 거절한다. public 신규 alias, source 자동 선택, source default,
old/new overload 병존은 도입하지 않는다. 검토했던 request의 단일 5인자 변경안은
기존 논리 key로 같은 필수 확인을 식별할 수 있어 최종 추천으로 채택하지 않았다.

### 4.1 실제 논리 계약이 제공하는 기반

아래는 `supabase/migrations/20260930052429_withdrawal_logical_lifecycle.sql`에서
확인한 **현재 서명**이며, source-aware 미래 서명이 아니다.

| 현재 함수 | 정확한 인자 순서·타입·현재 default | 반환·근거 |
| --- | --- | --- |
| `public.prepare_withdrawal_logical_request` | `p_user_id uuid, p_method text, p_amount_krw bigint, p_policy_id uuid, p_policy_version integer, p_destination_fingerprint text, p_destination_id uuid DEFAULT NULL` | `jsonb`; `:53` |
| `public.hold_withdrawal_logical_request` | `p_user_id uuid, p_idempotency_key text, p_method text, p_destination_id uuid, p_amount_krw bigint` | `uuid`; `:166` |
| `public.resolve_withdrawal_logical_request` | `p_user_id uuid, p_action text DEFAULT 'RECOVER', p_idempotency_key text DEFAULT NULL, p_withdrawal_id uuid DEFAULT NULL` | `jsonb`; `:217` |

기존 `withdrawal_logical_requests`는 현재 schema version 2, random key primary key,
owner·method·amount·policy ID/version·destination fingerprint와 mutable lifecycle
binding을 보존한다(`:4`–`:23`). pending owner partial unique index가 탭 간
다른 미완료 의도를 막고(`:26`), prepare/hold/resolve는 같은
`withdrawal-logical:` owner advisory transaction lock과 record row lock을 사용한다
(`:69`, `:177`, `:230`). raw destination/cipher는 record에 보관하지 않는다.

현재 prepare는 위 입력들의 충돌을 거절하고 동일 의도에는 원래 key를 반환한다.
hold는 key·owner·method·destination·amount를 확인한 뒤 4인자 money RPC를 호출한다
(`:181`, `:204`, `:206`). hold와 `withdrawal_id`/`OUTCOME_UNCERTAIN` binding은
같이 commit한다(`:209`). resolve는 이미 생긴 withdrawal을 확인하고 나서
CONFIRM/CANCEL/REJECT를 처리하므로 취소 경합이 실제 hold를 지우지 않는다(`:241`).

**기존 lifecycle `CONFIRMED`는 출금 생성 뒤 정확한 withdrawal ID에 대한 브라우저
acknowledgement다(`:245`–`:250`). 출금 전 source confirmation과 같은 뜻으로
재사용하지 않는다.** 새 source 확인은 PREPARED/DESTINATION_REGISTERED 단계에
있어야 하며, money 생성 후 OUTCOME_UNCERTAIN→CONFIRMED 복구 의미는 보존한다.

### 4.2 mandatory confirmation의 생성·소비

1. 기존 prepare 흐름에서 사용자가 확인한 amount-source와 fee-source 배분을
   명시적으로 받는다. 서버가 현재 policy·fee·잔여 source·preview revision을
   검증하고 key에 고정된 immutable confirmation과 canonical hash를 작성한다.
   SQL NULL·빈 확인·unknown version/field·합계 불일치·source 부족은 거절한다.
   미래 prepare의 입력 서명은 WS-04에서 하나로 확정하고 overload/default로
   source를 선택하지 않는다. fee·Tier·경제 결과는 서버 권위다.
2. 등록 전 fingerprint와 등록 뒤 destination ID는 같은 원본 identity에 묶는다.
   binding 시 source payload/hash를 다시 만들거나 교체하지 않는다. 보호 시간으로
   미완료 의도가 취소된 경우에는 기존 resolve로 money 부재를 먼저 확인하고,
   새 preview·확인·key를 준비한다. 무조건 새 key를 발급하는 복구는 없다.
3. `request_*`는 4인자로 받은 owner·key·method·destination·amount와 서버 확인의
   일치를 검사한다. hold 중 record를 잠그고 source/fee/policy/revision을 재검증하여,
   확인→withdrawal→journal→source→event/audit 연결과 lifecycle binding을 같은
   transaction에 commit한다. confirmation 소비는 원본 삭제·교체가 아니라
   한 withdrawal에 귀속시키는 것이다. source 실패 시 전체 rollback한다.
4. guard는 public wrapper에만 두지 않는다. 공통
   `app_private.request_withdrawal_with_hold`에서 모든 호출 경로에 강제한다.
   해당 private writer도 service-role execute grant가 존재한다
   (`supabase/migrations/20260927120900_ws05_worker_service_role_grants.sql:33`).
   일반 경로는 검증된 논리 확인 원본이 필수이고, START는 아래의 명시 conversion
   원본이 필수다. raw service 호출·private 호출도 총 KRW만으로 예약할 수 없다.
5. START wrapper는 실제 CONVERTED conversion CREDIT 원본의 BONUS 금액과 기존
   fee 0을 검증하여 conversion identity+요청 key에 고정된 같은 immutable 배분
   계약을 충족한다. 이는 generic caller의 default/fallback이 아니다. 기존
   conversion-bound wrapper의 같은 transaction과 공통 private validator를 사용하며,
   funding record·PRINCIPAL 잔액·일반 source 선택을 요구하지 않는다. START를 일반
   pending row와 결합하는 구체 저장 방식·ack 복구는 후속 WS-04에서 정한다.
6. release/finalize는 현재 인자 목록·반환 의미를 유지하고 요청에 고정된 원본
   배분만 소비한다. 이 단계에서 source를 새로 입력·선택하거나 확인 hash를 바꾸지 않는다.

### 4.3 회원 직렬화와 replay hash

공통 member serialization을 현재 논리 lock보다 먼저 적용하고 prepare·hold·
direct request·START·release/finalize·관련 credit/correction·settlement worker가
같은 잠금 순서를 따른다. 현재 owner pending unique/index와 exact key 조회는
보존한다. 구체 lock identity/order와 경제 effective clock은 후속 계약에서 확정한다.

확인 hash는 owner·command/record version·method·destination fingerprint·amount와
배분·서버 fee와 fee 배분·policy ID/version·확인 revision을 고정한다. source가
다른 입력은 prepare의 동일 의도 비교와 immutable guard에서 거절한다. 4인자
request는 다른 source를 payload로 덮어쓸 수 없으며 key가 원래 확인을 식별한다.
HTTP가 원래 확인 digest를 전달할 때도 이를 서버 원본과 비교하며, 클라이언트 hash만
믿거나 unknown source field를 조용히 버리지 않는다.

committed retry는 원래 key·확인 hash·withdrawal 배분의 일치를 먼저 확인하고
원본 결과를 반환한다. 현재 source available가 줄었거나 policy/TTL이 바뀌었다고
새 money effect를 만들거나 최초 effective instant를 갱신하지 않는다.
uncommitted 새 hold만 현재 정책·source·revision·유효성을 다시 검사한다.
같은 회원에게 나중 의도가 있어도 old key 조회는 old 원본을 반환해야 한다.

current v2 record에 source가 없으면 미래 version으로 추정 upgrade하지 않는다.
미완료 record는 실제 withdrawal 부재를 resolve로 확인한 뒤 새 확인을 준비한다.
이미 commit된 legacy record는 read/recovery·UNRESOLVED 경로를 보존하고 source
COMPLETE나 새 hold의 자격으로 재해석하지 않는다. 현재 record의 기존 TTL은 관측
사실일 뿐 미래 confirmation TTL·version을 이 문서가 확정하지 않는다.

### 4.4 확정·구현 순서

WS-04에 4인자 유지와 **필수 server confirmation 소비 precondition**을 먼저
기록하고, 새 migration에서 기존 함수 본문·논리 record·immutable guard를 확장한다.
기존 request 서명·grant를 변경하거나 폐기하지 않는다. prepare/hold/resolve의
필요한 명시 입력 확장은 각 이름의 유일한 서명·record version으로 확정한다.
`DROP ... CASCADE` 의존성 우회나 새 public money writer는 사용하지 않는다.

HTTP·browser·직접 service caller·fixture도 같은 후보에서 필수 준비 경로로
전환한다. 4인자 보존은 미전환 caller의 기존 금전 동작 보존이 아니다.
old app 복귀 시 source 없는 새 hold가 거절되고 원래 receipt/recovery가 남는지,
START가 무입금으로 동작하는지 별도로 검증한다. rollout/rollback 상세는 미결이다.

## 5. amount와 fee의 immutable source capture

다음은 승인 불변식이다. 배분 구조의 구체적인 column 이름·JSON 이름은 미확정이다.

- 금액 배분 합은 `withdrawal_requests.amount_atomic`과 정확히 같아야 한다.
  수수료 배분 합은 서버가 선택한 versioned policy의 `fee_atomic`과 같아야 한다.
  두 합을 더한 source 총액은 hold journal의 DEBIT/CREDIT 총액과 같아야 한다.
- source별 금액은 정수 KRW atomic이며 음수·fraction·float·overflow를 거절한다.
  같은 source를 중복 기재하거나 숨겨진 배분을 추가하지 않는다. fee 0의 표현도
  schema에 명시한다. API는 decimal string, 계산은 bigint/정확한 decimal을 사용한다.
  현재 bigint DB 범위와 HTTP의 15자리 범위를 조용히 넓히지 않는다.
- 각 source의 사용 가능액은 검증된 원본에서 계산하고 기존 미완료 예약을 반영한다.
  총 KRW가 충분해도 선택 source가 부족하면 거절한다. 부족분을 다른 bucket으로
  옮기거나 fee를 자동으로 PRINCIPAL에서 차감하지 않는다.
- 실행 snapshot에는 owner, destination identity/fingerprint, method, amount·fee,
  각각의 source 배분, policy ID/version, confirmation digest, source coverage/revision,
  principal·entitlement 기준 revision, server 평가 시각과 실제 effective instant가
  연결되어야 한다. 이후 hold/request/journal/event/audit 영수증 ID를 같은 사실로 연결한다.
- snapshot과 source 영수증은 immutable이다. 목적지·금액·수수료·배분·정책 변경은
  재미리보기와 새 확인이 필요하다. 불확실한 기존 요청을 브라우저에서 초기화하고
  새 key로 덮어쓰는 방식은 사용하지 않는다.
- mixed-source 허용 범위와 사용자 선택 UX는 아직 미결이다. mixed allocation을
  구현하려면 네 bucket별 amount/fee를 모두 명시해야 하며 자동 waterfall은 금지다.
  어떤 수단도 원금을 강제 source로 선택하지 않는다.

현재 finalize journal은 amount+fee를 합쳐 기존 payout cash로 posting한다
(`20261002230000...sql:1026`, `:1060`). fee의 별도 수익 계정·외부 지급·반환
처리 세부 정책을 이 문서가 새로 정하지 않는다. source 배분은 fee 회계 정책의
대용물이 아니며, `WD-FEE-ACCOUNTING`에서 기존 journal 의미와 함께 검토해야 한다.

## 6. reserve·release·finalize와 시간 경계

| source 효과 | 인정 원금·채굴 효과 | 보존해야 하는 원본 |
| --- | --- | --- |
| `PRINCIPAL` RESERVE | 금액과 fee 중 명시적으로 PRINCIPAL에 배분된 합만 hold effective instant부터 제외한다. | 원본 confirmation·hold journal·source movement·principal revision |
| `MINING_REWARD`/`BONUS`/`OTHER_NON_PRINCIPAL` RESERVE | 선택된 출처의 available만 예약한다. 원금·Tier·cycle anchor·used는 불변이다. | 동일 hold의 해당 source 배분 |
| RELEASE | 원본 reserve 배분 그대로 한 번 복구한다. 원금 배분은 release effective instant 이후 권리만 복구한다. | reserve와 연결된 reversal journal·disposition·reason·release event/audit |
| FINALIZE | reserve를 소비 완료로 닫는다. 원금은 hold에서 이미 제외되었으므로 다시 차감하지 않는다. | hold·allocation snapshot·external send·finalize journal·wallet DEBIT·완료 event/audit |
| REVERSE/정정 | 승인된 원본 증거·적용 시점·별도 정정 명령을 따른다. | 원본 거래 참조, 승인·reason·새 balanced journal과 새 immutable 영수증 |

출처 projection의 금전 잔여액과 예약 가능액, 채굴 인정 원금은 서로 다른
표현이다. FINALIZE row를 기록하는 것이 `CREDIT - RESERVE - FINALIZE`라는
이중 차감식을 허가하지 않는다. movement fold와 reservation terminal-state
계약은 구현 전 확정·대사해야 한다. 현 summary의 단순 CREDIT 합은 재사용하지 않는다.

원금 변경 명령과 settlement worker는 동일 회원의 source·entitlement·cursor를
직렬화한다. 현재 일반 요청의 destination→wallet 잠금, logical owner advisory lock,
release의 request row lock, finalize의 request→wallet lock만으로는 공통
entitlement boundary를 증명할 수 없다. **PROPOSED**: shared member serialization을
먼저 획득하고 논리 요청/출금, 목적지, wallet, source/entitlement 기록에 대한
공통 잠금 순서를 정한다. 현재 명령·입금·정정·worker가 같은 순서를 따르는지
확인하기 전에는 구체적인 lock key·SQL을 확정하지 않는다.

경계 시각 `t`까지의 `[previous cursor, t)`는 이전 승인 버전으로 보존하고,
`t` 이후의 segment에 새 원금을 사용한다. anchor와 기존 cycle end, 이미 받은
earned/pending/verified, used를 재작성하지 않는다. command가 source·경계·revision을
원자적으로 연결해야 하며, 늦은 background refresh가 이전 Tier로 `t`를 넘어
정산할 수 없어야 한다. 정확한 clock 함수·precision·동일 instant 순서·late event
처리는 미결이다. DB statement 시각을 승인된 경제 boundary로 자동 채택하지 않는다.

release는 hold 기간 보상을 소급 지급하지 않는다. 승인된 capacity 증가가
`new effective capacity > used`이면 같은 주기의 남은 용량으로 재개할 수 있지만,
safe mode·admin pause·KYC/eligibility stop을 해제하지 않는다. 수익 출금은 used를
비우거나 채굴 주기를 reset하지 않는다. 운영값·원본 coverage가 없으면 임의 Tier,
rate, capacity나 0 fallback으로 계산을 활성화하지 않는다.

## 7. server preview·확인·idempotency·권한

preview는 서버의 동일한 버전 해석·산술·경계 규칙을 조회로 평가한다.
금액·fee 배분, 현재/예상 인정 원금과 Tier·power·capacity·remaining, 적용 예정
시점과 영향 이유를 하나의 일관된 결과로 반환한다. 정책 미설정과 출처 확인 필요는
각각의 제한으로 반환한다. private 공식·risk/KYC logic은 응답에 포함하지 않는다.

preview 자체는 principal, anchor, segment, cursor, used, journal, audit command
receipt 또는 outbox를 쓰지 않는다(`MINING-ENTITLEMENT-CYCLE-CONTRACT.md:355`–`:368`).
실제 확인 receipt는 확정 실행의 transaction에서 작성하는 방향이다.
stateless 서버 proof와 기존 lifecycle record의 활용 방식, proof TTL·revocation·
canonical digest는 **PROPOSED / WD-PREVIEW-PROOF**이며 아직 선택하지 않았다.
새 preview public RPC 이름이나 preview 전용 balance writer를 만들지 않는다.

명령은 member serialization 아래 최신 source·policy·권한·revision을 재검증한다.
미리보기 이후 관련 원금·정책·배분이 달라졌으면 실행하지 않고 재확인한다.
UI/AI가 preview의 예상 보상 금액을 authoritative 실행 금액으로 보내지 않는다.
응답 지연·retry·lease 획득 시각으로 최초 effective instant를 바꾸지 않는다.

요청의 canonical hash는 command version, owner, method, destination identity,
amount, amount-source allocation, fee와 fee-source allocation, policy identity,
확인한 source/entitlement revision과 확인 digest를 묶어야 한다. key만 같다고
다른 출처를 이전 성공으로 반환하지 않는다. 같은 logical key+동일 확정 입력은
같은 receipt를 반환하고 효과를 한 번만 적용한다. 같은 key+다른 입력은 거절하며
기존 원본은 보존한다. 새로운 preview를 만들었다고 기존 불확실 요청을 교체하지 않는다.
hash serialization과 버전·key scope는 `WD-HASH`에서 확정한다.

release/finalize의 hash도 operation, withdrawal ID, actor, 원본 allocation digest,
disposition/reason 등 해당 명령의 의미를 고정해야 한다. 현재 journal key 충돌 뒤
기존 ID 조회·요청의 early return만으로 source-aware replay 계약이 완성되지 않는다.
복구 retry는 원래 결과를 확인하며 다른 출금·배분·취소 의미로 key를 재사용하지 않는다.

현재 관리자 HTTP는 `requireAdminCommand`와 `WITHDRAWAL_OPERATOR` step-up을
소비한다(`apps/admin/app/api/v1/admin/withdrawals/command/route.ts:58`, `:81`).
실제 폼 action은 `prepareMoneyAttempt` 이후 `requireHighImpactPrincipal`을 거친다
(`apps/admin/app/(control)/withdrawals/krw-bank/actions.ts:128`, `:130`, `:190`, `:192`).
server gate는 origin, 최신 identity/role·AAL, admin session, one-use step-up을
검사한다(`apps/admin/app/(control)/_lib/command-gate.ts:57`). 이 경계를 유지한다.
step-up은 현재 command family/session에 묶여 있으며 amount/source hash에
묶인 proof라고 단정하지 않는다(`apps/admin/lib/auth/step-up.ts:32`). 입력 변경 후
기존 확인을 재사용할 수 없도록 별도 confirmation binding이 필요하다.

회원 목적지 변경의 password/reauth·fingerprint·protection은 별도 보호다
(`lib/security/withdrawal-destination-reauth.server.ts:258`). 그 토큰을 source
선택·원금 회수 권한으로 재해석하지 않는다. source-aware 신청에 추가 member
step-up이 필요한 조건·방식은 `WD-MEMBER-CONFIRM`의 미결 사항이다. 공개 browser
RPC 권한을 늘리지 않으며 owner는 검증된 세션에서 도출한다. 조회·preview·명령·
RLS에서도 교차 회원 접근을 거절한다. AI/도우미는 조회·초안만 만들고 기존
서버 명령과 사람이 확인한 권한 경계를 사용한다.

## 8. 같은 transaction의 journal·source·event·audit

확정된 명령의 domain 상태, balanced journal, 해당 wallet projection,
immutable allocation, 검증된 source movement, principal/entitlement boundary·
revision·cursor 효과, audit와 versioned outbox는 같은 DB transaction의 사실이어야
한다. source/event/audit/receipt 중 필요한 하나라도 실패·누락되면 전체를 rollback한다.
API 성공 뒤 source를 나중에 덧붙이거나 source capture 실패를 무시하지 않는다.

각 movement는 **그 business effect의 원래 outbox event ID**와 journal·도메인
영수증을 검증하여 연결한다. retry에서 임의 새 event를 만들어 source receipt로
사용하지 않는다. RELEASE는 hold 원본과 reversal 관계를 검증하고 FINALIZE는
외부 송금과 원본 hold의 동일 owner·currency·amount·allocation을 검증해야 한다.

현재 `WITHDRAWAL_REQUESTED.v1`, `WITHDRAWAL_HOLD_RELEASED.v1`,
`WITHDRAWAL_COMPLETED.v1`은 출처 배분과 revision의 required 계약이 아니다.
required field나 의미 변경은 event version 확장이 필요하다
(`DOMAIN-EVENTS-OUTBOX.md:56`–`:62`). 정확한 새 event schema/version과 consumer
전환은 `WD-EVENT-VERSION`에서 결정한다. 기존 v1을 소급 재작성하거나
기존 event와 별개로 두 번째 money effect를 만들지 않는다.

외부 송금은 기존 수동 운영 증빙이다. DB transaction 밖의 실제 은행/체인
송금과 source posting을 하나의 원자적 transaction이라고 주장하지 않는다.
`EXTERNAL_SENT_RECORDED` 이후 RELEASE는 계속 금지다. 그 뒤의 응답 유실·
오류는 ledger finalize·원본 조회·운영 복구로 처리하고 재송금을 지시하지 않는다.

대사는 journal↔wallet↔allocation↔source reserve/terminal↔event↔audit↔
principal revision/정산 경계를 비교해야 한다. 불일치는 조사 큐로 보낸다.
금액 또는 이력의 자동 repair는 하지 않는다.

## 9. legacy와 START 보존

설치 이전 generic 요청, 이미 HELD/EXTERNAL_SENT_RECORDED/COMPLETED인 요청,
취소·거절된 요청, 미연결 credit/debit·보정·reversal은 원본 증거 없이 네 bucket에
나누지 않는다. 현재 금액·총 잔액·입금일·관리자 기억·"수익부터 차감" 규칙으로
backfill하지 않는다. 원본 journal/wallet/audit/request/event를 수정·삭제하지 않는다.

`UNRESOLVED` 회원은 원본 ID와 부족한 증거를 보여주는 호환성 예외로 남긴다.
관련 채굴 원금 계산·활성화는 거절한다. 이미 외부 송금된 legacy 건의 기존
finalize 복구를 source 신규 기준으로 영구 봉쇄하거나, 반대로 generic 처리를
성공시켜 source coverage를 COMPLETE로 만드는 결정을 이 문서가 내리지 않는다.
`WD-LEGACY-RECOVERY`에서 source 계산은 미해결로 유지하면서 기존 실제 지급
사실을 안전하게 마무리할 명시 운영 경로와 승인 증거를 확정해야 한다.

START 첫 출금은 conversion-bound 기존 경로를 보존한다.
`create_welcome_reward_withdrawal_request`는 CONVERTED 원본을 잠그고 최대
`5000` KRW atomic, conversion별 한 신청, welcome-compatible 무수수료 정책을
검사하여 같은 private hold writer를 사용한다
(`supabase/migrations/20260927120400_ws04_withdrawal_lifecycle_commands.sql:555`,
`:588`, `:599`, `:606`, `:626`, `:641`). funding 선행 조건은 추가하지 않는다.

**PROPOSED**: 해당 wrapper는 실제 검증된 START conversion CREDIT의 `BONUS`
원본으로 amount 배분을 명시하고 현재 계약의 fee 0을 snapshot에 보존하여
공통 source-aware writer에 전달한다. 이것은 generic 출처 default가 아니다.
현재 CREDIT guard가 기록하는 START 원본과 동일 conversion을 검증해야 한다.
기존 START source가 UNRESOLVED이면 입금을 요구하지 않고 명시적인 복구 경로로
보낸다. 최대 5,000원, trial/real 분리, KYC/anti-abuse와 공유 IP 단독 거절 금지,
동일인 1회·무입금 첫 출금의 계약을 모두 보존한다.

## 10. 실제 사용자·관리자 코드의 영향

| 현재 seam과 코드 근거 | 후속 변경이 필요한 내용 |
| --- | --- |
| `components/product/withdrawal-form.tsx:211`, `:295`, `:326`, `:702` | 현재 총 available·fee와 "전액"을 계산하고 method/amount/policy/destination만 snapshot한다. source별 선택·사용 가능액, amount/fee 배분, server preview와 원금 회수 영향 확인을 추가한다. 전액 버튼도 명시 선택 source를 넘지 않아야 한다. |
| `lib/wallet/withdrawal-logical-request.ts:20`, `:51`, `:101` | 기존 v2 durable record·strict parser·저장 read-back 계약에 새 confirmation version/digest를 반영한다. 기존 로컬 기록을 임의 source로 upgrade하지 않는다. old-record 복구와 owner 변경을 fail-closed로 처리한다. 민감 목적지·공식·step-up token은 browser storage에 넣지 않는다. |
| `app/api/v1/withdrawals/intents/route.ts:13`, `:102`; `hold/route.ts:9`, `:48` | 현재 HTTP에는 source 필드가 없다. confirmed source 입력과 policy/revision binding을 확장하고 unknown/누락 입력을 거절한다. 명령에서 다시 검증하고 prepared key·원본 복구를 보존한다. |
| `supabase/migrations/20260930052429_withdrawal_logical_lifecycle.sql:4`, `:53`, `:166` | 논리 record·pending owner 직렬화는 method/amount/policy/fingerprint만 비교한다. source 변경도 충돌로 처리하도록 확장하고 outcome uncertainty·TTL·acknowledgement를 보존한다. |
| `app/(product)/wallet/withdraw/page.tsx:131`, `:149`, `:309`, `:456` | 총 KRW/hold 외에 출처별 safe projection·확인 필요를 표시하고 요청 이력에 원금 회수/수익/보너스와 fee 배분을 설명한다. unknown를 0으로 표시하지 않는다. START 첫 출금 영역은 독립적으로 유지한다. |
| `apps/admin/app/(control)/withdrawals/krw-bank/forms.tsx:29`, `:83`, `:117`; `usdt/forms.tsx:29`, `:98`, `:133` | 실제 송금 기록·원장 확정·거절/취소 폼은 source를 선택하지 않는다. 이미 확정된 배분과 source coverage·원금 영향·복구 상태를 read-only로 보여주고 원래 receipt를 확인한다. 관리자가 완료 단계에서 배분을 고치지 않는다. |
| 같은 두 method의 `actions.ts`; `apps/admin/app/api/v1/admin/withdrawals/command/route.ts:137`, `:154` | 기존 송금/해제/완료 RPC, step-up·confirm·reason·logical key·offline gate를 유지한다. source digest/현재 state 재검증과 정확한 결과 확인을 연결한다. 전송 성공을 source 완료로 간주하지 않는다. |
| `apps/admin/app/(control)/members/_lib/money-source-display.ts`의 `snapshotSchema`와 `presentMemberMoneySources` | CREDIT-period 표시와 누적 입금 통계, 실제 원금 회수·현재 인정 원금·source별 잔여/예약액을 구분하는 계약으로 확장한다. source COMPLETE를 미posting earned/pending 부재로 해석하지 않는다. display helper가 출처 선택·Tier·금전 writer를 맡지 않는다. |
| `app/api/v1/withdrawals/route.ts:175` | 아직 legacy `create_withdrawal_request` 호출 코드가 존재한다. 현재 form은 hold 경로를 쓰지만, route 존재 자체는 source-aware 연결이 아니다. 실제 revoke/접근·caller를 재검증하고 source 없는 우회 writer로 사용되지 않도록 전환 계획을 확정한다. |

다음은 저장소의 request/prepare/hold/resolve/private-writer 이름 검색과 실제
fixture 읽기로 확인한 전환 범위다. 4인자 요청 호출의 인자는 유지하되, 그 전에
**원본 source를 가진 확인을 준비하고 반환된 논리 key를 사용**해야 한다.
단순히 source field를 추가하거나 hardcoded 기존 key를 그대로 쓰는 변경으로는 부족하다.

| 실제 caller/fixture | 4인자 유지 방식의 변경 범위 |
| --- | --- |
| `supabase/migrations/20260930052429_withdrawal_logical_lifecycle.sql:204`, `:206` | 현재 실행 경로에서 일반 요청 RPC를 호출하는 SQL caller. 호출 4인자는 그대로 두고 prepare의 immutable source 확인과 hash를 같은 transaction에서 검증·귀속한다. 적용된 migration을 수정하지 않고 새 migration에서 해당 함수 본문을 확장한다. |
| `supabase/migrations/20260927120300_ws04_destination_and_request_commands.sql:653`, `:676`; `20260927120400_ws04_withdrawal_lifecycle_commands.sql:641` | 두 public request wrapper와 START wrapper가 공통 private writer를 호출한다. 모든 private 경로에 필수 원본 validator를 강제한다. START는 conversion CREDIT BONUS 배분이며 generic 미준비 경로가 아니다. 기존 정의 파일을 고치지 않는다. |
| `app/api/v1/withdrawals/intents/route.ts:102`; `lib/wallet/withdrawal-client.ts`의 `submitWithdrawalLogicalRequest` | prepare 입력·서버 응답·persisted record validation·재시도 비교에 source confirmation/version/hash를 연결한다. 현재 strict v2 parser는 field 수와 version 2를 고정하므로 미래 version은 명시 분기해야 한다. unknown record를 자동 upgrade하지 않는다. |
| `app/api/v1/withdrawals/hold/route.ts:48`, `intents/route.ts:58`, `:133`; `destinations/route.ts:76`, `:119` | hold·recover/ack·bind가 같은 immutable 확인 원본과 key를 보존하도록 확장한다. 등록 응답 유실에서 fee/source/hash를 다시 만들지 않는다. hold HTTP의 unknown/다른 source 입력을 조용히 무시하지 않는다. |
| `supabase/tests/database/ws04_security_money_workers.sql:183`, `:218`, `:241`, `:357`, `:407`, `:477`, `:529`, `:644` | 현재 직접 요청 호출 8곳. 성공·replay·금액 부족·destination/owner guard 각각에 원본 source 확인을 준비하고 반환 key를 context에 저장한다. `:125`의 raw wallet credit을 source-aware 성공 원금으로 추정하지 않는다. 실제 승인 deposit receipt로 fixture를 구성하거나 의도적 UNRESOLVED 음성 사례로 분리한다. |
| `supabase/tests/database/krw_deposit_journal_integrity.sql:811`, `:985`, `:1090`; welcome 호출 `:1302` | 일반 direct 요청 3곳은 prepare와 returned key를 추가한다. raw/adversarial journal·wallet을 검사하는 기존 사례는 보존하고, source-aware 성공 회원의 미분류 이력과 섞지 않는다. START wrapper 테스트는 conversion CREDIT 연결·fee 0·무입금 불변을 검사한다. |
| `supabase/tests/database/withdrawal_logical_lifecycle.sql:34`, `:55`, `:63`, `:71`, `:76` | prepare fixture와 source version/hash를 확장하고 현재 multi-tab·response loss·TTL·late old key·ack/cancel 경합 단언을 보존한다. source/fee/policy 변경·immutable payload 직접 수정·미준비 direct RPC/private RPC 거절을 추가한다. |
| `tests/worker/runtime-evidence.test.ts:601`, `:676` | 실제 direct service RPC caller. raw wallet CREDIT fixture와 hardcoded request key를 원본 승인 credit→prepare→returned key 흐름으로 전환한다. 원장·외부 송금·worker event의 기존 exactly-once 단언을 약화하지 않고 source/event/audit receipt 수를 추가한다. |
| `components/product/welcome-withdrawal-action.tsx:60`; `app/api/v1/withdrawals/welcome/route.ts:50` | 현재 START는 일반 prepare/hold/resolve를 사용하지 않고 conversion wrapper에 요청한다. 출처 선택은 추가하지 않는다. 매 submit의 새 random key와 conversion별 1회 보장을 고려해 원본 conversion/key/hash 조회·response loss 복구를 연결한다. 일반 lifecycle CONFIRMED를 임의로 자동 설정하지 않는다. |
| `tests/e2e/authenticated/helpers/withdrawal-fixtures.ts:67` | 8개 bare status row는 UI 표시용이며 source-aware 금융 증거가 아니다. legacy/확인 필요 matrix로 명시하거나 실제 준비·hold·terminal 명령으로 별도 source-backed fixture를 만든다. 가짜 source COMPLETE로 보정하지 않는다. |
| `tests/unit/withdrawal-logical-request.test.ts:52`, `:79`, `:647`; `tests/unit/ws04-domain-command-contract.test.ts:27` | strict record·snapshot·hash·다른 source 충돌·storage read-back 단위 fixture를 확장한다. request 이름·4인자 유지와 missing-confirmation 거절을 검사하며 기존 단순 이름 존재 테스트를 실행 연결 증거로 사용하지 않는다. |
| 기존 authenticated withdrawal/recovery/admin E2E와 `helpers/eligibility.ts`의 `readLatestWithdrawal`, `helpers/admin-money-ui.ts`의 `readWithdrawalLedger` | 실제 form의 명시 source/preview/confirmation 단계와 receipt/count 조회를 확장한다. read helper는 source를 선택하거나 원장을 seed하는 writer로 바꾸지 않는다. START 스펙의 deposit row 0 단언을 유지한다. |

사용자에게 내부 bucket/coverage/revision/engine 용어를 그대로 보여주지 않는다.
짧은 한국어로 원금 회수의 영향과 출처 확인 필요를 설명한다. USDT는 KRW 잔액에
대한 출금으로 표현한다. 예시 CTA는 "내용 확인", "출금 요청"이며 최종 copy와
구도는 별도 제품 검토 대상이다. 새 큰 UI 변경은 canonical visual/UX 계약과
imagegen 목업 선검토 요구를 따른다. 실제 구현에는 해당 Next.js local guide도 읽는다.

## 11. DB·동시성·브라우저 acceptance

아래는 **실행하지 않은 후속 필수 테스트**다. 기존 test 파일의 존재는 새 계약
통과 증거가 아니다. fixture 금액·rate·fee는 production 정책 승인으로 게시하지 않는다.

| 층위 | 사례 | 필요한 수락 증거 |
| --- | --- | --- |
| pgTAP | 두 수단 × 네 source; 단일/mixed amount와 fee | owner·원본 receipt 검증, 배분 합=hold 총액, balanced debit=credit, source별 부족 시 다른 source fallback 없음 |
| pgTAP | 같은 key의 source/fee/policy/destination 변경 | 원본 유지, 변경 입력 거절, 동일 입력 retry의 동일 withdrawal/journal/source/event/audit 수와 ID |
| pgTAP | 원금 reserve→release / reserve→finalize | reserve instant부터 인정 원금 제외; release instant부터 복구; finalize에서 두 번째 차감 없음; 기존 wallet/hold projection parity |
| pgTAP | 수익·보너스·기타 출금 | 원금·Tier·anchor·used와 이미 earned/pending/verified 보상 불변; 총 KRW와 source 대사 일치 |
| pgTAP | 잘못된/누락된 source·snapshot·event·audit·journal | 부분 commit 0; 사라진/다른 owner/다른 amount 영수증·중복 kind·mutated allocation 거절 |
| pgTAP | overflow·큰 정수·직렬화·권한 | DB/API 승인 범위 경계, float/fraction 거절; anon/authenticated execute/쓰기 거절; 교차 회원 preview·RLS 거절 |
| pgTAP | legacy·START | arbitrary backfill 없음; UNRESOLVED는 NULL 유지; CONVERTED BONUS 원본 1회, hard ceiling 5000, fee 0·무입금 성공, 기존 welcome 호환 정책·목적지 보호 유지 |
| 실제 다중 DB session | 두 key 동시 PRINCIPAL reserve; reserve vs credit/reversal | 동일 회원 serial order와 원본 별 exactly-once, 합계 잔여/예약이 음수가 되지 않음; 다른 회원은 불필요하게 직렬화되지 않음 |
| 실제 다중 DB session | release vs finalize/external-send; 같은 key double submit | 가능한 한 terminal 결과만 commit; 외부 송금 이후 release 0; journal/source/event/audit 중복 0; deadlock·lock timeout 복구 기록 |
| 실제 다중 DB session | settlement vs reserve/release; stale worker·late event | `[start,t)` 이전 버전과 `[t,end)` 새 버전, cursor/revision 경합 거절, retry 원래 시각 보존, hold 기간 소급 reward 0, used 불변 |
| 실제 Chromium+local DB | source 변경·stale preview·금액/fee 변경·부족 | 새 확인 요구, source-specific 안내·복구, stale client 우회 0; 서버가 확정하기 전 Tier/잔액·성공 cue 선반영 없음 |
| 실제 Chromium+local DB | registration/hold 응답 유실·reload·두 탭·storage 실패·owner 변경 | 같은 원본 source confirmation과 key 복구, count 한 번; storage read-back 실패에서 destination/money effect 0; old v2 record를 임의 배분으로 upgrade하지 않음 |
| 실제 관리자 browser+local DB | 두 수단 송금→완료, 거절/취소, offline·step-up 만료/reuse·현재 role 변경 | 원래 allocation 읽기, 재배분 불가, step-up/confirm gate와 결과 조회, 외부 송금 뒤 재송금·release 없음; 원본 audit/event/source 연결 |
| 제품 gate | 320/390/834/1440, System/Light/Dark, 200% 확대 | loading/empty/validation/error/recovery/success/disabled/unauthorized/offline/stale, focus/keyboard/screen reader/contrast/reduced motion, 실제 screenshot·Visual Lab 비교·회귀·성능 acceptance |

후속 DB 테스트는 현재 `supabase/tests/database/ws04_security_money_workers.sql:183`,
`:329`, `:365`, `:529`, `krw_deposit_journal_integrity.sql:811`, `:918`, `:993`,
`withdrawal_logical_lifecycle.sql`, `money_source_provenance.sql`의 원본 money/
logical/credit invariants를 보존하면서 확장해야 한다. 기존 단일 session 순차 retry는
실제 concurrency 증거를 대신하지 못한다. 해당 새 다중 session 테스트는 아직 없다.

브라우저 baseline은 `tests/e2e/authenticated/withdrawal-logical-idempotency.spec.ts:59`,
`withdrawal-p1-recovery.spec.ts`, `withdrawal-destination-reauth.spec.ts`,
`first-krw-withdrawal.spec.ts`, `first-usdt-withdrawal.spec.ts`,
`admin-withdrawal-step-up.spec.ts`, `admin-withdrawals-product.spec.ts`다.
단위 strict record/hash·표시 테스트와 실제 DB/browser 증거를 구분한다.
후속 결과에는 정확한 후보 SHA, migration/file digest, 정책 version/digest,
원본 source·journal·event·audit ID, boundary/cursor/revision, session 경합 순서,
before/after 정수 합계와 실제 screenshot 경로를 남겨야 한다.

## 12. 미결 항목과 다음 구현 단위

| Finding | 상태·필요한 결정/증거 | 허용하지 않는 추론 |
| --- | --- | --- |
| `WD-SIGNATURE` | 선택한 방식: request 4인자 유지 + mandatory immutable logical source confirmation + 공통 private writer 원본 강제 + START 명시 BONUS conversion 원본. 구체 prepare/record/receipt 확장은 후속 WS-04에서 확정 | 미준비 일반 direct hold, alias, default source, old/new overload 병존 |
| `WD-ALLOCATION` | OPEN: mixed-source 허용 범위, fee 배분·0 표현, immutable snapshot와 movement aggregation | reward-first/bonus-first/principal-first 자동 차감 |
| `WD-FEE-ACCOUNTING` | OPEN: 현재 amount+fee journal 의미와 실제 외부 지급·fee account·release 반환 관계 | fixture fee 또는 임의 fee debit 정책 승인 |
| `WD-SOURCE-FOLD` | OPEN: reserve→release/finalize/reverse의 잔여·예약·인정 원금 계산, terminal receipt와 대사 | CREDIT 합 재사용, RESERVE+FINALIZE 이중 차감 |
| `WD-LOCK-BOUNDARY` | OPEN: 공통 member lock/order, clock·precision, settlement cursor/revision와 같은 instant/late event | current statement timestamp/read order가 승인 경제 경계라는 단정 |
| `WD-PREVIEW-PROOF` | OPEN: 읽기 전용 preview와 execution confirmation 연결, proof/digest·TTL·revocation | preview가 ledger/anchor/command receipt를 쓰거나 stale 결과 실행 |
| `WD-HASH` | OPEN: canonical serialization, semantic version·key scope, retry 원본/changed-input 거절 | key-only 반환을 source-aware idempotency로 인정 |
| `WD-MEMBER-CONFIRM` | OPEN: source/원금 회수의 회원 확인·step-up 요구와 destination reauth의 독립 관계 | 목적지 토큰을 원금 실행 승인으로 재사용 |
| `WD-EVENT-VERSION` | OPEN: required source receipt payload의 버전·consumer migration·dedup 계약 | 기존 v1 의미 재작성·source 후처리·중복 money event |
| `WD-LEGACY-RECOVERY` | OPEN: 이미 송금된 legacy finalize 복구, 조사·증거 기반 정정/사후 분류 | 자동 backfill·이력 편집·source COMPLETE 허위 주장·추가 입금 강제 |
| `WD-ROLLOUT` | OPEN: old app/필수 confirmation 의미 전환과 rollback, 모든 직접 service caller·legacy route·private 경로 차단 증거 | 4인자 유지가 미준비 caller의 금전 동작을 보존한다는 단정 |
| `WD-ENTITLEMENT-NUMERIC` | HUMAN_DECISION_REQUIRED: Tier·rate·multiplier·capacity·정확한 arithmetic 등 기존 미결 운영값 | 숫자 기본값·fixture로 실채굴 활성화 |

다음 최소 구현 단위는 **WS-04 명시 확정 → 단일 source-aware request 계약과
immutable allocation/reserve/terminal 검증 → source fold·reconciliation → 공통
member settlement boundary → 기존 logical lifecycle/HTTP·START wrapper의 동시
연결 → 실제 사용자/관리자 preview·확인 → DB/concurrency/browser/제품 gate**다.
한 CREDIT capture PR이나 이 문서만으로 이 사슬이 연결되었다고 보고하지 않는다.

이번 변경은 이 문서 한 파일뿐이다. DB migration·애플리케이션·테스트를 수정하거나
실행하지 않았다. 후속 구현·로컬 검증과 원격 Supabase·Cloudflare·DNS·배포·실송금은
각각의 현재 승인 경계를 다시 확인해야 한다. `PRODUCT COMPLETE`와 출시 준비는 미입증이다.
