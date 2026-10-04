# 채굴 권리·용량·주기 계약

상태: **APPROVED STRUCTURE / NUMERIC POLICY NOT APPROVED / RUNTIME NOT CONNECTED**

계약 버전: `2026.10.03-entitlement-cycle-v1`.

이 문서는 2026-10-03 사용자가 승인한 잔여 원금, 사용자별 30일 주기,
용량과 속도의 분리, 변경 시점 이후 구간 계산 구조를 구체화한다. 경제
운영값, 공개 RPC 확장, migration, 채굴 활성화, 원격 변경 또는 배포의
승인이 아니다. 문서 작성은 `FOUNDATION COMPLETE`, `FUNCTIONALLY COMPLETE`,
`PRODUCT COMPLETE`의 증거가 아니다.

## 1. 권위와 기존 계약

승인 원문은 [최종 아키텍처 원문](USER-APPROVED-FINAL-ARCHITECTURE-2026-10-03.txt)이며,
충돌 해석과 실행 순서는 [실행 지도](FINAL-ARCHITECTURE-EXECUTION-MAP.md)를 따른다.
**2026-10-03 사용자 후속 답변**은 같은 주기의 capacity 증가로
`new effective capacity > used`가 되면 자동 재개하는 구조를 직접 승인했다.
이 결정은 원문과 Master의 “소진 뒤 reset까지 항상 정지” 해석을 그
capacity 증가 조건에서 대체한다(superseded). 원문 자체를 수정하지
않으며 수치 정책·DB/runtime 연결·활성화 승인은 계속 별도다.
다음 계약을 함께 적용한다.

- [Master Architecture](PUTDUK-MINING-MASTER-ARCHITECTURE.md): 단일 서버 계산,
  상태, 보안, 완료 증거와 기존 실행 gap.
- [Money Source Provenance](MONEY-SOURCE-PROVENANCE.md): 자금 출처, 잔여
  인정 원금, 원금 hold/release와 호환성.
- [WS-04 Domain Command Contract](WS-04-DOMAIN-COMMAND-CONTRACT.md): 기존
  공개 명령 이름과 자금·권한 경계.
- [Balanced Ledger](LEDGER-RECONCILIATION.md): 원장, 정수 금액, 정정과 대조.
- [Domain Events / Outbox](DOMAIN-EVENTS-OUTBOX.md): 원자적 이벤트, lease,
  retry와 consumer 중복 방지.

현재 문서에 기록된 실행 gap은 `calculateSettlement`의 application/worker
caller 부재와 legacy `record_mining_settlement`의 실행 권한 문제다. 이
계약은 그 helper를 승인된 Funding Engine으로 간주하거나 legacy 명령을
다시 허용하지 않는다. 이 작업에서는 실제 source·DB·worker를 조사하거나
연결하지 않았으므로, 기존 구현의 최신 실행 상태를 추가로 보증하지 않는다.

원문에 든 등급 이름, 등급 개수, 금액, 일일 수익, 용량, 효과 강도는 예시다.
그 예시를 production seed, 기본 운영값, 승인된 등급 목록으로 만들지 않는다.
Funding Tier는 승인된 버전 데이터이며 중립 시각 자산 `rank-01`~`rank-06`,
AI 사용량 quota와 각각 별개다.

## 2. 하나의 계산 권위와 도메인 소유권

Entitlement Engine은 서버 내부의 단일 계산 경계다. 조회, 변경 영향
미리보기, 원금 변경, worker 정산은 동일한 버전 해석·구간 분할·산술을
사용한다. 각 UI, AI, worker, Scene에 별도 공식을 만들지 않는다. 이 이름은
설계 구성요소이며 새 공개 함수나 table 이름의 승인이 아니다.

| 소유 도메인 | 권위와 책임 |
| --- | --- |
| Funding / Money Source | 실제 자금 원본 영수증, 출처별 이동, 현재 인정 원금과 principal revision |
| Economy | 승인된 Tier·상품·loyalty·campaign·override·global control 버전과 적용 시각 |
| Mining / Entitlement | 첫 activation anchor, 주기 식별, 구간, capacity/speed, used와 entitlement revision |
| Settlement | 처리 cursor, earned accrual 영수증, 정산 결과와 원장 참조 |
| Ledger | balanced journal, append-only projection, reversal과 reconciliation |
| Outbox / Jobs | 동일 transaction의 전달 기록, bounded lease, retry와 deduplication |
| Catalog / Presentation | 승인된 상품·Scene mapping과 slot/scene profile 버전 |
| User / Admin UI / AI / Scene | 권한에 맞는 snapshot·preview 표시, 기존 명령 입력과 영수증 설명 |

브라우저 frame, 타이머, 요청 도착 시간, AI 답변, Scene 활동량은 금액·
적용 시점·사용량·주기를 결정하지 않는다. 앱이 닫혀 있어도 서버 처리가
가능해야 한다. 서비스 권한도 임의 회원이나 임의 금액을 처리할 권한으로
확장하지 않는다.

## 3. 입력, 결과와 버전

계산 입력은 다음 사실을 하나의 일관된 서버 읽기에서 확보한다.

- 대상 회원과 현재 소유·계정 상태, source reconciliation/coverage 상태.
- `Eligible Funding Principal`, 원본 source 영수증과 principal revision.
- 첫 principal activation anchor, 현재 주기, 주기 경계와 처리 cursor.
- 승인·적용된 Tier 및 Economy Rule 버전, Product Rule 버전.
- 적용된 loyalty, campaign, 사용자 override, global control와 채굴 상태 버전.
- 기존 earned accrual, used capacity, 정산 참조와 직전 entitlement revision.
- 승인된 slot/Scene presentation mapping과 profile 버전.
- 단일 평가 기준인 `Current Server Time`.

결과는 Tier와 그 버전, 현재 speed, 현재 cycle capacity, used/remaining,
slot count, scene profile과 그 버전, cycle state, entitlement revision,
주기 시작·종료·다음 경계, 평가 기준 서버 시각을 함께 제공한다. 정수
금액은 API에서 decimal string으로 전달한다. 없는 정책이나 미분류 출처를
0, 낮은 등급 또는 임의 기본값으로 표시하지 않는다.

entitlement revision은 단순 UI 요청 횟수가 아니다. principal, 주기,
경제 정책, 상품, override, 상태, earned accrual/used 등 결과를 바꾸는 authoritative 변경을
식별한다. 같은 revision의 서버 시각별 평가 결과는 평가 시각과 cursor를
함께 보존한다. snapshot에는 모든 입력 버전의 참조 또는 검증 가능한
digest가 있어야 하며 새 principal과 이전 Tier/capacity를 섞어 반환하지 않는다.

각 command는 최신 revision을 잠금 아래 재검증한다. 미리보기 이후 원금·
정책·시각·상태가 달라지면 변경된 영향을 다시 계산하고 필요한 확인을
갱신한다. 과거 snapshot, 과거 preview, 오래된 worker lease가 현재 권리를
덮어쓸 수 없다. 같은 논리 명령의 retry는 원래 영수증을 반환하며 이전
revision을 다시 적용하지 않는다.

## 4. 첫 활성화와 사용자별 30일 주기

주기 anchor는 회원의 **첫 Principal activation**에서 한 번만 생성한다.
신청, 미승인 입금, USDT 전송 제출, 가입, START, 보너스 또는 화면 방문은
Principal activation이 아니다. 실제 출처가 확인된 원금과 승인된 activation
조건이 있어야 한다. 정확한 최초 활성화 조건과 과거 회원의 anchor 처리에는
아래 미결 gate가 적용된다.

`cycle_started_at`은 첫 anchor를 의미하는 계약상 개념이다. 현재 schema에
같은 이름의 column이 존재한다고 주장하거나 다른 schema 별칭을 추가하지
않는다. anchor 정정은 별도 승인·감사 계약 없이는 허용하지 않는다.

주기는 anchor에서 30일 간격으로 이어지는 반개방 구간 `[start, end)`이다.
server UTC-aware instant로 저장하고 V1 화면은 `Asia/Seoul`로 표시한다.
일반 입금일, 달력월, 로그인일 또는 worker 실행일로 시작점을 옮기지 않는다.
정확한 30일 시간 연산·timestamp precision은 버전 계약으로 명시한 뒤 실행한다.

- 추가입금은 현재 주기의 남은 기간만 바꾼다. 새 30일을 지급하지 않는다.
- 원금 hold·회수·전액 회수·release·재입금도 anchor를 보존한다.
- 수익·보너스 출금, 정산, 상품 이동, 화면 재접속은 주기를 reset하지 않는다.
- 주기 종료 instant는 다음 주기의 시작이다. 경계의 변경은 다음 구간에 적용한다.
- 정상 reset은 새 주기의 used를 시작한다. 이전 pending/verified 보상과 원장
  영수증을 없애지 않는다. 이전 보상을 다음 주기의 신규 사용량으로 다시 세지 않는다.
- worker가 늦거나 여러 주기 동안 앱이 닫혀 있어도 anchor 기준 경계를
  복원한다. 작업 실행 시각에서 새 주기를 시작하지 않는다. 처리할 elapsed
  interval은 주기마다 나누며 미사용 capacity 자체를 지급하지 않는다.
  미사용 용량의 이월 여부는 미결이며 자동 이월을 구현하지 않는다.

전액 회수 중 주기 진행, 비활성 기간의 earned eligibility, 재개와 누락
구간 처리는 승인된 상태 정책을 따라야 한다. anchor 불변이라는 이유로
비활성 기간에 보상을 지급하는 추론은 허용하지 않는다.

## 5. Capacity와 Speed

Capacity는 해당 주기에 허용된 총 monetary accrual 한도이고, speed는
적격 시간 동안 그 용량을 채우는 속도다. 둘은 서로 다른 정책 출력이다.

- speed boost는 speed만 바꾼다. capacity를 조용히 늘리지 않는다.
- capacity boost는 capacity만 바꾼다. speed를 조용히 늘리지 않는다.
- 둘 다 바꾸려면 승인된 버전 정책에 두 효과를 명시한다.
- 상품·slot·Scene 변경이 자동으로 경제 효과를 갖지는 않는다. 승인된
  Product Rule 또는 별도 정책이 해당 효과를 명시해야 한다.
- loyalty, campaign, override와 global control은 적용 scope, 우선순위,
  기간, cap 의미가 있는 버전 데이터여야 한다. 중복 multiplier를 곱하는
  관행을 정책 대신 쓰지 않는다.

earned accrual은 적용 speed의 eligible elapsed 결과와 해당 주기의
remaining capacity를 모두 넘지 않아야 한다. 정확한 단위·분모·반올림·
cap 적용 순서는 아직 승인되지 않았다. remaining은
`max(effective capacity - used, 0)`이며, downgrade 후 used가 capacity보다
큰 사실은 원본 값으로 보존한다. used를 capacity에 맞춰 줄이지 않는다.

용량이 소진되면 `CYCLE_COMPLETE`로 신규 monetary accrual을 멈춘다.
downgrade 시 `used >= new capacity`이면 `CAPACITY_EXHAUSTED`로 추가
accrual을 멈춘다. 기존 earned/pending/verified 보상은 유지한다. 예정된
정산은 기존 자격과 정산 안전 모드에 따라 처리할 수 있지만 새 보상을
만들거나 used를 비우지 않는다.

2026-10-03 사용자 후속 승인에 따라, 같은 주기에서 추가입금·Tier 상승·
Capacity Boost 등 승인된 capacity 증가가 발생하면 서버가 새로운
effective capacity를 계산한다. `new effective capacity > used`이면
`remaining = new effective capacity - used`이며,
`CAPACITY_EXHAUSTED`/`CYCLE_COMPLETE`에서 capacity 상태를 `ACTIVE`로
자동 재개한다. 새 capacity가 used 이하이면 remaining은 0이고 소진을
유지한다. Speed Boost만으로는 capacity가 늘지 않으며 remaining이
0인 상태를 재개하지 못한다.

이 전이는 reset이 아니다. anchor와 기존 `cycle end`/next reset은
절대 바뀌지 않는다. capacity 변경 자체는 이미 기록한 used와
earned/pending/verified reward를 바꾸지 않는다. 소진 시점부터 증가의
`effective_at`까지는 신규 accrual이 0이었던 구간으로 보존하며 재개 뒤
과거 시간을 backfill하지 않는다. 새 earned accrual은 `effective_at`
이후의 적격 구간에서만 수락한다.

capacity 상태와 실행 권한·운영 상태는 별도다. capacity가 `ACTIVE`로
전환되어도 관리자 pause, safe mode, KYC 또는 eligibility stop을
해제하지 않는다. 해당 제한이 남아 있으면 monetary accrual은 계속
멈춘다. 정상 next reset은 최초 anchor에서 정한 원래 cycle end에만
발생한다. 이 구조 승인은 실제 자동 재개 runtime이 연결되었다는 증거가 아니다.

## 6. 자금 변경과 미래 구간

인정 원금은 `PRINCIPAL`의 실제 잔여 적격 금액이다. lifetime deposit,
`MINING_REWARD`, `BONUS`, START 전환 또는 무료 지급으로 Tier를 올리지
않는다. USDT 수신은 기존 수동 확인 명령의 실제 KRW 원금 credit에
연결하며 USDT 잔액이나 자동 환율을 만들지 않는다.

| 원본 변화 | Entitlement 효과 |
| --- | --- |
| 승인된 실제 원금 credit / 명시적 principal correction | 원본 effective instant 이후 원금·Tier·speed·capacity를 재평가 |
| 원금 source hold / reserve | 예약된 원금을 그 instant부터 제외하고 미래 권리를 낮춤 |
| 원금 hold release | release instant부터 원금을 복구하고 미래 권리를 재평가; hold 기간 보상 소급 지급 금지 |
| 원금 hold finalize | 이미 제외된 원금을 다시 차감하지 않음; withdrawal 영수증에 연결 |
| 원금 debit / reversal | 승인된 원본·적용 시점을 따라 미래 권리를 변경; 과거 reward 자동 취소 금지 |
| 채굴 수익 / 보너스 credit·hold·출금 | 원금·Tier·anchor 불변; 별도 승인 정책 효과가 있으면 그 버전만 적용 |
| 출처 미분류 / 기존 generic 출금 | source를 추정하지 않음; 관련 채굴 활성화·계산을 안전하게 거절하고 호환성 예외로 기록 |

출금 금액·수수료의 source 배분은 기존 계약의 immutable snapshot을
사용한다. 수수료를 임의로 원금에서 빼거나 부족분을 다른 source로
바꾸지 않는다. 원금이 달라지는 source 효과와 principal revision은
원본 journal/도메인 영수증, 적용 instant, 논리 키로 연결한다.

release 등 승인된 원금 복구로 capacity가 증가하는 경우도 동일한
`new effective capacity > used` 재개 판정을 사용한다. 원금 복구는
anchor reset이나 hold/소진 기간의 과거 보상 복구가 아니다.

원금·정책 변경 command와 worker는 동일 회원의 권리·cursor를 직렬화한다.
잠금 순서는 구현 설계에서 고정해 deadlock과 반대 순서 처리를 검증한다.
변경 command는 경계 직전 구간을 기존 버전으로 보존한 뒤 새 principal
revision과 이후 구간을 생성한다. 원금 capture, 구간 경계와 revision
기록은 동일 transactional 사실로 연결되어야 한다. background refresh가
늦어도 worker가 오래된 권리로 경계를 넘어 계산할 수 없어야 한다.

응답 지연, retry, job claim 시각은 원래 effective instant를 바꾸지 않는다.
이미 처리한 cursor 이전의 뒤늦은 원본, 누락된 출처, 허용되지 않은 과거
적용은 자동 재계산하지 않고 조사·승인된 정정 경로로 보낸다. 정상 원금
변경을 과거 reward reversal로 재해석하지 않는다.

## 7. Segment와 남은 기간 Proration

하나의 계산 interval은 주기 경계, 원금 revision, Tier/Economy Rule,
Product Rule, loyalty, campaign, override, global control, 채굴 상태 및
적격성 변경의 모든 effective boundary에서 나눈다. 각 segment는
`[start, end)`와 입력 버전·원본 영수증·principal·결과 digest를 보존한다.
시작 boundary는 새 상태를 사용하고 끝 boundary는 다음 segment에 속한다.

원금 변경이 시각 `t`에 발생하면 `t` 이전의 earned result를 새 Tier로
재작성하지 않는다. 현재 capacity 수정은 같은 주기 종료까지의 **새
권리와 이전 권리의 차이**만 반영한다.

```text
남은 기간 차이 = 새 조건의 entitlement(t, cycle end)
               - 기존 조건의 entitlement(t, cycle end)

수정 cycle capacity = 직전 cycle capacity + 남은 기간 차이
```

이는 기간과 효과를 분리하는 승인 구조이며 실제 rate·분모·산술 함수를
선택하는 식이 아니다. 두 entitlement 평가는 같은 server time, 주기
종료, 승인 버전과 계산 engine을 사용한다. upgrade는 남은 기간 차이만
추가하고 downgrade는 남은 기간 차이만 줄인다. 다음 정상 주기는 그때
유효한 조건의 전체 주기 권리를 사용한다.

이 차이는 capacity entitlement의 변경만 평가한다. speed-only 변경은
capacity 차이가 0이며 이후 eligible elapsed의 속도만 바뀐다. speed를
곱한 예상 수익을 capacity의 정의로 대체하지 않는다. capacity 증가가
재개를 허용하더라도 증가분은 `effective_at`부터 cycle end까지의 새
조건과 기존 조건 entitlement 차이만이다. 소진 이력이나 남은 시간이
새 full-cycle 권리를 만드는 이유가 되지 않는다.

Capacity Boost는 실제 이벤트 적용 기간에도 같은 proration을 사용한다.
효과의 미래 시간창은 `effective_at` 이후이며 이벤트 종료와 cycle end를
넘지 않는다. 시작·종료·정책 변경은 segment boundary로 남긴다. 이미
지나간 이벤트 기간이나 소진 구간에 bonus capacity/reward를 소급
부여하지 않는다. 기간 구조는 승인되었지만 정확한 산술·단위·반올림·
cap 수치는 아직 승인되지 않았다.

순차 변경은 직전 확정 revision을 기준으로 각각 처리한다. 추가입금,
hold, release 또는 반복 preview마다 full-cycle capacity를 다시 더하지
않는다. 구간별 반올림으로 쪼개기·합치기가 금액을 부풀릴 수 없도록
정밀도·잔여값 처리·cap 순서를 승인하고 검증한다.

같은 instant에 여러 차원의 변경이 발생하면 하나의 일관된 경계와 입력
version set으로 평가해야 한다. 동일 scope의 겹치는 rule window,
중복 version/effective time, 해결되지 않은 동시 변경 순서는 거절한다.
어떤 차원이 우선하는지 arbitrary database read order로 결정하지 않는다.

## 8. Earned / Pending / Verified와 Used

used capacity는 해당 주기의 **earned monetary accrual을 한 번만** 센다.
pending은 해당 earned result가 아직 정산되지 않은 상태이며, verified는
동일 결과의 정산 완료 상태다. 두 개의 reward가 아니다.

1. 서버가 적격 segment의 earned accrual을 수락할 때 대상 회원·주기·
   segment 범위·입력 버전·논리 키를 immutable 도메인 영수증으로 남긴다.
   그 수락과 used 변경은 원자적이어야 한다.
2. 정산은 그 영수증을 참조해 기존 balanced `MINING_REWARD` journal,
   append-only wallet/source projection, 정산 결과와 versioned outbox를
   한 transaction에 연결한다. 같은 영수증을 다시 수익으로 수락하지 않는다.
3. pending 감소와 verified 증가가 같은 reward 이동인지 연결할 수 있어야
   한다. used 증감은 없고 원금·Tier·capacity·주기 anchor도 바뀌지 않는다.
4. 수익 출금은 wallet/source만 변경한다. 이번 주기의 used를 줄이거나
   capacity를 다시 열지 않는다.

조회는 금전 writer가 아니다. 아직 수락되지 않은 elapsed accrual의
as-of projection이 필요하면 동일 engine으로 계산하고, 확정 영수증과
구분해야 한다. 이를 persisted used에 반복 더하거나 임의 pending으로
게시하지 않는다. 실제 snapshot에서 committed/미처리 구간을 어떻게
명시할지와 기존 pending 상태를 어떤 영수증에 연결할지는 구현 전 gate다.

정산 실패·notification 실패·lease 만료·retry는 accepted reward를 새로
생성하지 않는다. 통상 downgrade는 기존 reward를 삭제하지 않는다.
실제 오류/부정으로 인한 reward 정정은 별도의 승인된 reversal/정정
명령과 원본 참조, audit, reconciliation을 요구하며 used 보정 정책을
임의로 추론하지 않는다.

## 9. 명령·Worker·원장·Outbox 연결

기존 공개 이름을 유지한다. 이 문서는 아래 명령의 payload를 변경하거나
별칭을 추가하지 않는다.

- 원금 credit은 기존 KRW approval 경계와
  `public.confirm_usdt_manual_deposit`의 실제 승인 영수증을 소비한다.
- 원금 예약은 `public.request_krw_withdrawal`,
  `public.request_usdt_withdrawal`의 source-aware 계약 확장이 필요하다.
- release는 `public.release_withdrawal_hold`, 완료는
  `public.finalize_withdrawal_ledger`를 따른다. 외부 송금 기록 이후 release
  금지와 retry 시 외부 재송금 금지를 그대로 유지한다.
- due work와 event claim은 기존 `public.claim_system_jobs`,
  `public.claim_outbox_events`의 계약을 사용한다.
- 대조는 `public.run_financial_reconciliation`을 유지한다. 불일치를
  자동 수정하거나 새 원장·queue 서비스를 만들지 않는다.

source-aware withdrawal, entitlement write, settlement 실행 권한 또는
receipt 연결이 부족하면 WS-04의 검토된 계약 확장과 **새 migration**으로
연결한다. 구 command의 금액만 보고 provenance를 추정하거나 legacy
`record_mining_settlement`에 권한을 되돌려 우회하지 않는다. 기존 applied
migration을 수정하지 않는다.

정상 worker 처리에는 다음 경계가 모두 필요하다.

1. bounded lease로 대상 work를 claim하고 trusted job 원본·회원·주기·
   cursor·expected revision·입력 digest를 확인한다. worker가 받은 금액을
   그대로 게시하지 않는다.
2. 현재 safe mode, 소유권, source coverage, 승인된 rule과 상태를
   transaction 안에서 재검증하고 회원 처리 순서를 직렬화한다. 기존
   accepted reward의 정산은 원래 영수증과 입력 버전을 사용하며 현재
   Tier/rate로 금액을 다시 계산하지 않는다.
3. 단일 서버 시각으로 미처리 interval을 나누어 동일 engine으로 계산한다.
   reward 논리 키는 회원·주기·처리 interval·입력 버전의 business effect에
   안정적으로 연결한다. retry마다 새 random key를 만들지 않는다.
4. accrual 수락에서는 earned receipt/used와 그 audit/outbox를, 정산에서는
   기존 earned receipt의 완료 상태·정산 결과·balanced journal/projection과
   audit/outbox를 각각 원자적으로 반영한다. 같은 batch에서 결합하더라도
   reward 수락은 한 번이다. 이미 accepted된 pending의 정산은 used를
   다시 늘리지 않는다. 처리 cursor는 해당 성공한 business effect와 함께
   전진한다. rollback은 그 effect의 부분 기록을 남기지 않는다.
5. 성공 영수증으로 job을 완료한다. worker가 commit 뒤 죽어도 retry는
   같은 영수증을 확인한다. lease를 잃은 worker는 완료·cursor 변경에
   실패하며 늦은 결과로 새 revision을 덮어쓰지 못한다.

lease와 처리 batch의 수치 한도, timeout, fencing 수단, 장기 backlog 처리
크기는 운영 설계와 성능 증거가 있어야 한다. lease의 존재 자체는 금전
중복 방지의 대체물이 아니다. database uniqueness/직렬화/idempotency가
같은 business effect를 막아야 한다.

domain mutation 뒤 비동기 작업이 있으면 같은 transaction에 outbox를
쓴다. 기존 `MINING_SETTLEMENT_COMPLETED.v1` 등 canonical 이벤트를
재사용하되 required 의미나 단위를 바꾸는 payload 확장은 새 이벤트
버전 검토를 거친다. 이 문서에서 새로운 이벤트 type을 발명하지 않는다.
consumer는 `(consumer_name, event_id)`로 효과를 중복 방지한다.
backoff·dead letter·audited replay는 원본 키와 digest를 보존한다.
notification 또는 Scene 전달이 실패해도 money를 다시 게시하지 않는다.

## 10. Preview와 실행의 일치

추가입금, 원금 회수, release, 정책 변경의 preview는 실제 engine의
평가 입력에 가정된 prospective 변경만 넣는다. 기준 principal/revision,
평가 server time, 현재 주기, 적용 예정 instant, 정책 버전과 가정임을
명시한다. 새 principal, Tier, speed, capacity, used/remaining, slot,
scene profile, 상태와 영향 이유를 같은 결과 계약으로 반환한다.

preview는 principal, anchor, 구간, cursor, used, ledger, audit command
receipt 또는 outbox를 쓰지 않는다. 아직 activation되지 않은 회원은
가정된 activation time을 표시할 뿐 실제 anchor를 만들지 않는다.
정책이 없거나 출처가 불명확하면 그 한계를 반환한다. 미리보기를 위해
임의 정책을 활성화하거나 production 결과처럼 금액을 보이지 않는다.

확정 실행은 그 순간의 현재 state와 server time으로 재검증한다. UI와 AI는
preview 금액을 실행 금액으로 보내지 않고 기존 command 입력을 준비한다.
AI는 조회·설명·draft만 제공하며 원금·규칙·보상을 변경하지 않는다.
관리자 변경은 기존 role/AAL2/step-up, reason, confirm, idempotency,
audit를 사용한다. 일반 UI와 도우미를 위한 두 번째 money writer는 없다.

## 11. Slot·Scene·사용자 경험 경계

slot count와 scene profile은 engine output에 연결된 승인된 presentation
버전이다. Scene family, 상품 mapping, anchor, 효과 profile은 기존
registry와 공통 `MiningLiveStage`를 사용한다. Funding Tier별 Stage나
경제 공식을 복제하지 않는다. slot이 단순 시각 요소인지 실제 채굴
동시성 권리인지, 상품 간 capacity 배분은 수치·의미 승인 전 미결이다.

profile은 version ID와 적용 revision을 전달한다. client가 받는 값은
허용된 표시·효과 지시와 공개 사실뿐이다. private 공식·risk/KYC logic,
server secret 또는 production source map을 전달하지 않는다. profile
intensity나 사용자 기기 성능이 monetary speed를 바꾸지 않는다.

장면은 원본 master의 재질·조명·공간감과 canonical Visual Lab의 premium
품질을 따라야 한다. 허술한 평면 scene, generic dashboard와 placeholder
HUD는 최종 결과로 허용하지 않는다. 새 사용자 Capacity UI나 큰 시각 변경은
**imagegen 목업 이미지를 먼저** 만들고 직접 검토한 뒤 구현한다. 목업은
구도·정보 우선순위의 증거이며 경제 수치 승인이나 실제 기능 증거가 아니다.

runtime은 scene master raster, bounded transparent motion canvas,
접근 가능한 HTML HUD/controls의 세 계층이다. 금액·한글·버튼은 raster에
구워 넣거나 canvas 전용으로 만들지 않는다. generated lossless master와
검토된 runtime derivative/manifest를 분리한다.

capacity 확장·Tier/profile 변경·소진 뒤 재개 cue는 변경된 서버 snapshot
revision을 받은 뒤 실제 capacity, used, remaining, Tier, cycle state,
scene profile만 표현한다. preview나 local timer로 먼저 재개하거나
capacity 증가를 새 채굴 수익으로 표현하지 않는다. 기존 영수증 없는
capacity 변화 자체에는 monetary reward cue를 붙이지 않는다.

monetary cue는 별도의 실제 earned reward 영수증에 연결된 서버 snapshot
신규 earned delta에서만 발생한다.
pending→verified는 동일 reward의 settlement cue로 연결하며 새 수익을
두 번 보여주지 않는다. 같은 event/revision replay, 오래된 snapshot,
reconnect는 monetary cue를 중복 생성하지 않는다. 서버 결과가 없는
타이머·random·frame 기반 금액은 금지한다.

`CYCLE_COMPLETE`/`CAPACITY_EXHAUSTED`는 money flow를 멈추고 기존
보상·ambient·서버 경계 countdown과 가능한 preview를 유지한다.
승인된 capacity 증가가 서버에서 `ACTIVE`를 반환하면 같은 주기의
남은 권리를 표현한다. 관리자/안전 모드/KYC/적격성 제한이 남아 있으면
그 중지 사실을 보존하고 실제 money flow를 재생하지 않는다.
권한 없음, source 확인 필요, 정책 미설정, offline, stale, 오류와 실제
소진은 서로 다른 사실이다. raw enum이나 내부 revision/engine 표현을
사용자 문구로 노출하지 않는다. 한국어는 짧고 한 화면에 한 메시지로
설계하며 최상위 원금·현재 등급·오늘 채굴·용량·다음 등급 정보를
모바일에서도 이해할 수 있게 한다.

renderer는 effect 수·해상도·frame budget을 capability별로 제한한다.
offscreen/hidden/reduced motion에서는 motion을 멈추고 정적 fallback과
HTML 조작을 유지한다. 작은 기기는 품질 profile을 낮출 수 있으나
경제 결과·접근성·핵심 정보를 줄이지 않는다. 실제 rendered screenshots,
canonical 비교, reduced-motion review, FPS/long-task/memory/bundle 및
LCP/CLS/INP 측정 없이 premium 품질이나 성능 완료를 선언하지 않는다.
quantitative renderer budget은 측정·승인해야 하며 이 문서에서 숫자를
만들지 않는다.

## 11A. 자격 기초 조회

이 절은 30일 cycle, segment, proration, 소진 재개, settlement, worker를
구현하지 않는다. 서비스 권한 조회
`app_private.read_funding_entitlement_foundation(uuid)`만 자격 계산을 읽는다.

인정 원금은 W1 principal lot의 남은 금액 합이다. 누적 입금, BONUS,
MINING_REWARD로 등급을 계산하지 않는다. policy의 최소 원금 미만은
`FUNDING_BELOW_MINIMUM`이며 등급을 켜지 않는다. 이상이면 발행된 policy row의
등급 구간, base rate, 그 구간의 retention rate를 읽는다. 코드에 등급 숫자를
두 번째 원본으로 두지 않는다. base entitlement와 retention entitlement는
분리한다. retention은 `UNCONFIRMED`이며 확정 잔액이 아니다. 이 조회는 원장
credit을 만들지 않는다.

상품 multiplier, slot 수, campaign cap은 이 조회의 출력이 아니다. 부분 원금
회수의 lot 배분은 계속 미정이며 거절한다. 이 조회는 `PRODUCT COMPLETE`가 아니다.

## 12. 호환성과 활성화 미결 Gate

다음 항목은 open finding이다. 기본값·fixture·예시로 결정하지 않으며
관련 실행은 결정과 구현 증거가 있을 때까지 연결하지 않는다.

| Finding | 필요한 결정 또는 증거 | 현재 제한 |
| --- | --- | --- |
| `ENT-ACTIVATION` | 첫 activation의 적격 조건·기준 영수증, 미설정 정책 중 받은 원금의 시작 처리, unresolved 과거 회원 anchor | 입금일·가입일로 anchor 추정 금지 |
| `ENT-TIME` | 30일 경계의 정확한 duration 연산·정밀도, clock 권위, 오늘 채굴의 날짜 경계와 eligible elapsed 정의 | client 시각·요청 시각 사용 금지 |
| `ENT-NUMERIC` | Tier band 경계, base rate와 기간 단위, capacity 정의, product·loyalty·campaign·override/global 우선순위와 수치 | 채굴 활성화·production seed 금지 |
| `ENT-ARITHMETIC` | 정확한 정밀도·분모·rounding·잔여값·cap 순서, downgrade 차감/음수 capacity 처리, 기존 bigint와 journal 범위 정합성 | helper 산술을 승인 정책으로 채택 금지 |
| `ENT-STATE` | 전액 회수·비활성·pause 상태별 accrual/settlement의 상세 전이, 미사용 capacity 이월 여부 | 승인된 동일 주기 capacity 재개 구조 유지; 권한·운영 중지 우회와 자동 이월 금지 |
| `ENT-CONCURRENCY` | 같은 instant의 다중 변경 순서/통합, 회원 잠금 순서와 revision conflict, late effective event 처리 | read order로 경제 결과 결정 금지 |
| `ENT-SOURCE-COVERAGE` | 기존 generic 출금·hold·release·finalize·credit/debit/correction/reversal 원본 coverage와 source reconciliation | 누락 provenance 추정·자동 backfill 금지 |
| `ENT-PENDING-RECEIPT` | 기존 pending과 earned receipt의 연결, used 원자적 수락, 미처리 interval snapshot 의미 | pending을 두 번째 reward로 수락 금지 |
| `ENT-SETTLEMENT-COMMAND` | 기존 command/권한에 맞는 transactional 실행 확장, balanced posting·cursor·outbox 연결 | legacy settlement 권한 복원·새 RPC 별칭 금지 |
| `ENT-REWARD-CORRECTION` | 승인된 reward 정정/reversal에서 used와 cycle attribution을 어떻게 보존하는지 | downgrade를 clawback·used 반환으로 해석 금지 |
| `ENT-SLOT-ALLOCATION` | slot의 의미·한도, 복수 상품 간 speed/capacity 분배와 상품 변경 효과 | 각 상품에 full capacity 중복 지급 금지 |
| `ENT-WORKER-RECOVERY` | batch·lease·fencing·timeout·retry/catch-up 경계, 장애/reconciliation 복구 경로 | lease만 믿은 중복 posting 금지 |
| `ENT-SCENE-PROFILE` | 버전 mapping·asset coverage·device budget·실제 screenshots/performance | 예시 Tier를 production profile seed로 사용 금지 |

기존 원장과 source projection의 설치/coverage 상태는 entitlement 완료가
아니다. 과거 journal·wallet·감사 기록을 수정해 새 계약에 맞추지 않는다.
미연결 종류가 있으면 회원별 확인 필요 상태와 해당 원본을 기록한다.
구 앱과 새 후보의 rollback 호환성, cursor·revision·event version의 혼용
안전성, 기존 trial/START와 무입금 첫 출금 불변을 검증해야 한다.

수치 없는 계약 검증과 draft/preview 설계는 가능하다. 실채굴 활성화에는
모든 관련 finding의 결정, 승인 버전 데이터, source-aware 명령 전체 연결,
정산/worker/원장/outbox 증거와 제품 gate가 필요하다. 원격 Supabase,
Cloudflare, DNS, 배포와 실송금은 별도 승인 경계로 계속 잠겨 있다.

## 13. Acceptance Tests와 필요한 증거

아래는 후속 구현의 필수 acceptance 요구다. 이 문서 작성에서 실행한
test 결과가 아니다. 금액 fixture는 policy 승인으로 게시하지 않으며
경계·불변식 중심으로 테스트한다.

| 사례 | 수락 조건 |
| --- | --- |
| 첫 activation 경합 | 서로 다른 정상 credit은 각각 보존하고 anchor는 한 개; 같은 원본 retry는 동일 영수증 |
| 추가입금·회수·재입금 | principal/Tier는 바뀌고 원래 anchor·다음 정상 경계는 불변 |
| 원금과 수익/보너스 | 원금 source만 Tier 기준에 반영; 수익·START·보너스 출금으로 원금/used 변화 없음 |
| hold→release | hold 이후 원금 제외, release 이후 복구; hold 기간 reward 소급 추가 없음 |
| hold→finalize / 중복 release | 이중 원금 차감·release 없음; 외부 송금 뒤 release 거절 |
| 주기 마지막 부분의 추가입금 | 남은 entitlement 차이만 적용; full-cycle 보상이나 새 anchor 생성 없음 |
| 반복 변경·preview | 같은 입력/기준 시각은 같은 결과; full capacity 중복 추가와 preview write 없음 |
| segment 경계 | interval start는 새 버전, interval end는 다음 구간; 과거 결과 불변 |
| 정책·상품·상태 동시 변경 | 승인된 일관된 version set; 겹침·모호한 순서·누락 rule 거절 |
| downgrade used와 capacity | `used >= new capacity`이면 신규 accrual 정지; 기존 pending/verified와 used 보존 |
| 소진 후 추가입금/Tier 상승 | 남은 기간 new-old entitlement 차이만 추가; new capacity가 used보다 크면 remaining 차액과 `ACTIVE`; anchor/end/used/기존 reward 불변 |
| 소진 후 Capacity Boost | 실제 이벤트 남은 기간과 cycle end 안에서 proration; new capacity가 used보다 크면 동일 주기 재개; full-cycle 재지급 없음 |
| 수정 capacity가 used 이하 | remaining 0과 소진 유지; capacity 증가 사실만으로 재개하지 않음 |
| 재개 effective boundary | 소진~`effective_at` reward 0 보존; 이후 적격 구간만 수락하고 과거 backfill 없음 |
| 재개와 별도 중지 | capacity는 `ACTIVE`여도 admin pause/safe mode/KYC/eligibility stop 불변; 제한 해제 전 신규 accrual 없음 |
| speed/capacity boost 분리 | speed-only는 cap 불변, capacity-only는 speed 불변; 두 효과는 명시된 버전만 사용 |
| 소진 중 Speed Boost | capacity와 remaining 0 불변; 소진 상태와 money flow 정지 유지 |
| capacity 도달 직전 경합 | 동시 worker/command 합계가 한도를 넘는 새 earned accrual을 수락하지 않음 |
| pending→verified | 같은 earned receipt에 journal 한 번; used 불변; 신규 수익 cue 두 번 없음 |
| 수익 출금·주기 reset | 출금으로 used를 비우지 않음; reset은 새 cycle만 시작하고 기존 reward 유지 |
| offline·여러 경계 catch-up | 브라우저 없이 anchor 기준으로 처리; 주기별 분할·적격성 보존·미사용량 지급/자동 이월 없음 |
| stale preview / snapshot / worker | 현재 revision 재검증; 오래된 결과로 state/cursor 덮어쓰기 불가 |
| capacity/Scene 재개 cue | 새 server snapshot revision 이후 실제 cap/used/remaining/Tier/profile/state만 반영; 별도 reward 영수증 없이 신규 수익 cue 없음 |
| 큰 정수와 직렬화 | bigint/decimal precision 보존; float/unsafe Number 거절; 기존 API 범위 초과 거절 |
| rounding / 분할 안정성 | 승인된 산술에서 interval 재분할·retry로 경제 이익이 생기지 않음 |
| transaction 장애 | 해당 business effect의 source·earned·used·journal·projection·audit·outbox·cursor에 부분 commit 없음 |
| commit 뒤 worker 종료·lease 만료 | 같은 business effect 한 번; lease 잃은 worker 완료 거절; retry는 원본 영수증 |
| outbox 중복·dead letter·replay | consumer 효과 한 번; notification 실패가 money 재지급으로 번지지 않음 |
| 교차 회원·RLS·권한 | 다른 회원 조회·preview·명령 거절; 관리자 최신 role/step-up과 worker 최소 권한 검증 |
| source 미분류·기존 pending | 추정 계산·0 fallback 없음; 회원별 예외/원본 추적과 승인된 복구 |
| reconciliation | earned↔used↔settlement↔journal↔projection↔outbox 대조; 불일치 조사, 자동 금액 repair 없음 |
| 기존 START/입출금 | trial/real 분리와 무입금 첫 출금 정책 유지; 외부 retry 재송금 없음 |
| slot·상품·Scene 버전 | 승인된 mapping 한 개와 revision 연결; 상품별 full cap 중복 없음; 성능 profile은 경제 불변 |
| 실제 사용자 Capacity UI | 목업 선검토 후 실제 backend 연결; 320/390/834/1440, System/Light/Dark, 200% 확대와 loading/empty/error/recovery/unauthorized/offline/stale 상태 |
| Scene와 접근성/성능 | 실제 screenshot/canonical 비교, focus/keyboard/readability/reduced motion, bounded/offscreen/hidden 동작, 측정된 budget과 FPS/long-task/memory/bundle/LCP/CLS/INP |

후속 검증 기록은 정확한 후보 SHA, 정책/version/digest, 입력 원본과
cursor/revision, test 실패·복구, journal/outbox 영수증, 실제 browser 환경과
screenshots 및 성능 측정을 남겨야 한다. 문서·unit fixture·녹색 CI만으로
실채굴 연결이나 `PRODUCT COMPLETE`를 선언하지 않는다.
