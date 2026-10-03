# PUTDUK MINING V1 — 사용자 승인 경제 운영값

상태: **OWNER APPROVED / NEW DECISION / IMPLEMENTATION REQUIRED**

2026-10-03 현재 사용자가 직접 제공한 초기 운영 정책이다. 과거 저장소에서
발견한 사실이 아니다. 이 문서와 인접 JSON은 승인 증거와 초기 정책 데이터이며,
실행 중인 서버·DB·정산·운영 화면의 구현 완료 증거가 아니다. 원격 Supabase,
Cloudflare, 배포, 실제 지급은 기존 별도 단계 잠금을 유지한다.

기존 최종 아키텍처의 경제 숫자 미정 상태는 이 결정의 범위에서 해소된다.
수치는 React/worker 코드 상수로 복제하지 않고 versioned 서버 정책으로 읽는다.
운영자는 Admin Economy Control Center에서 DRAFT → preview → APPROVED →
PUBLISHED → effective_from 순서로 새 버전을 발행한다. 이미 끝난 정산을
다시 쓰거나 소급 적용하지 않는다.

## 원금과 등급

계산 기준은 잔여 **Eligible Funding Principal**이다. 누적 승인 입금액을
사용하지 않는다. 실제 승인 KRW 입금, 실제 수신 확인 후 KRW 원금으로 지급한
USDT-TRC20 입금, 명시적인 principal correction만 포함한다.
signup/welcome/event/referral/promotion/mining/admin bonus는 제외한다.
BONUS와 MINING_REWARD는 PRINCIPAL이 아니다.

최소 활성 원금은 100,000원이다. 미만은 입금·보유가 가능하지만
FUNDING_BELOW_MINIMUM이며, 이상이 되는 순간 Tier와 entitlement를 활성화한다.
원금 회수는 인정 원금을 줄인다. 채굴 수익 출금은 원금을 바꾸지 않는다.

| Tier | 원금 하한 | 원금 상한 | 기본 bps | 유지 혜택 bps | 최대 bps | Slot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| L1 STARTER | 100,000 | 499,999 | 1500 | 1500 | 3000 | 1 |
| L2 STARTER+ | 500,000 | 999,999 | 1500 | 1600 | 3100 | 1 |
| L3 ACTIVE | 1,000,000 | 2,999,999 | 1500 | 1700 | 3200 | 2 |
| L4 ADVANCED | 3,000,000 | 4,999,999 | 1500 | 1800 | 3300 | 2 |
| L5 PRO | 5,000,000 | 9,999,999 | 1500 | 1900 | 3400 | 2 |
| L6 PREMIUM | 10,000,000 | 29,999,999 | 1500 | 2000 | 3500 | 3 |
| L7 PREMIUM+ | 30,000,000 | 49,999,999 | 1500 | 2100 | 3600 | 3 |
| L8 ELITE | 50,000,000 | 99,999,999 | 1500 | 2200 | 3700 | 3 |
| L9 ULTRA | 100,000,000 | 299,999,999 | 1500 | 2300 | 3800 | 4 |
| L10 ULTRA+ | 300,000,000 | 499,999,999 | 1500 | 2400 | 3900 | 4 |
| L11 PRIVATE | 500,000,000 | 999,999,999 | 1500 | 2500 | 4000 | 5 |
| L12 PRIVATE+ | 1,000,000,000 | 2,999,999,999 | 1500 | 2500 | 4000 | 5 |
| L13 PRIVATE ELITE | 3,000,000,000 | 4,999,999,999 | 1500 | 2500 | 4000 | 5 |
| L14 PRIVATE ELITE+ | 5,000,000,000 | 제한 없음 | 1500 | 2500 | 4000 | 5 |

상한은 50억원에서 끝내지 않는다. 금액은 충분한 범위의 bigint 계열이며
더 큰 금액도 schema 변경 없이 처리한다. Funding Tier와 rank-01~06 시각 자산은 별개다.

## 채굴과 원금 유지 혜택

모든 Tier의 기본 30일 Capacity는 원금의 15.00%(1500bps)다.
100,000원 → 15,000원, 1,000,000원 → 150,000원,
100,000,000원 → 15,000,000원이다. 유지 혜택은 별도 조건부 portion이다.

기본 portion은 실제 서버 진행에 따라 정상 정산·확정한다. 유지 portion은
해당 principal lot이 cycle 종료 시점까지 유지되어야 최종 자격을 충족한다.
UI는 `기본 채굴`과 `원금 유지 혜택`을 구분하고 유지 혜택을 이미 확정된 돈처럼
표시하지 않는다. 추가 입금은 각각 별도 lot/effective_at을 보존하며 기존 lot의
age를 초기화하지 않는다.

첫 실채굴 활성 시 30일 cycle anchor를 생성한다. 추가입금·회수·등급 변경·
이벤트·Capacity 증가가 anchor/end를 변경하지 않는다. reset은 cycle_end에서만 한다.
추가입금 확정 즉시 principal revision → Tier → entitlement → Capacity → Speed →
Scene profile을 갱신하되 새 원금은 effective_at 이후만 반영한다.

중간 변경의 추가 entitlement는 새 조건의 effective_at~cycle_end 값에서
기존 조건의 같은 기간 값을 뺀 차이다. 과거 보상 소급과 종료 직전 전체 30일
Capacity 지급은 금지한다. used가 Capacity를 소진했어도 유효 Capacity가 used보다
커지면 그 시각부터 차이만 자동 재개한다. anchor/end/used는 유지하며 과거 정지
시간에 소급 보상을 주지 않는다. pause/safe mode/자격 제한을 우회하지 않는다.

Speed Boost는 속도만 바꾸고 Capacity를 늘리거나 소진을 풀지 않는다.
Capacity Boost는 한도를 늘리며 새 remaining이 생기면 재개할 수 있다.
정산·채굴 수익 출금은 cycle used를 다시 채우거나 비우지 않는다.

## 상품·캠페인·운영자 조정

모든 기본 상품의 초기 경제 multiplier는 1.00x(10000 multiplier bps)다.
한국/미국주식, ETF, 금, 은, BTC, ETH와 다른 승인 crypto에 같은 원칙을 적용한다.
이는 상품 카탈로그 또는 ETF 상품을 추가 승인하는 결정이 아니다. 실제 시세는
채굴 보상 계산에 사용하지 않는다. 상품은 Scene, identity, allocation, 이벤트
대상을 결정한다.

새 Product Rule은 version/effective_from을 가지고 발행한다. V1 일반 범위는
0.90x~1.10x이다. 사용자 Global Cycle Capacity는 하나이며, 한 상품에 최대100%,
모든 allocation 합은 최대100%다. 50%+30%+20%는 가능하지만 50%+50%+50%는
불가하다. 상품/slot 수가 전체 Capacity를 복제하지 않는다.

Capacity campaign은 단일 최대+10%, 동시 합 최대+20%다. Speed campaign은
단일 최대1.25x, 동시 최종 최대1.50x다. 초기 boost는 없다. 이 ceiling은 새
Economy Policy Version으로만 변경한다. User override는 초기1.00x, 일반 범위
0.80x~1.20x이며 운영자 audit/reason/step-up을 요구한다. 과거 보상 소급 변경은 금지다.

## 고정소수와 이월

금융 계산에 JavaScript number/float를 사용하지 않는다. wallet/ledger는 정수 KRW,
내부 채굴은 bigint의 1 KRW = 1,000,000 micro-KRW다. rate는 integer bps로 저장한다.
정산은 whole KRW만 credit하고 1원 미만은 reward_carry로 보존한다.
12.73원 → 12원 credit + 0.73원 carry이며 다음 accrual에 합산한다.
미만 값을 버리지 않고 cycle reset에도 carry를 삭제하지 않는다.

## 출금 출처·수수료·USDT

일반 `채굴 수익 출금`은 VERIFIED MINING_REWARD만 사용한다.
`원금 회수`는 PRINCIPAL만 사용하며 Tier/Capacity/Speed를 재계산한다.
Bonus는 별도 Bonus 정책을 따른다. 다른 source로 자동 대체하거나 principal을
몰래 소비하지 않는다. 기존 START의 무입금·최대5,000원·무수수료는 유지한다.

V1 KRW입금, USDT-TRC20입금 platform conversion, mining, KRW채굴수익 출금,
principal 회수의 platform fee는 모두0원이다. 블록체인 외부 network fee는
principal에 넣지 않는다. 향후 fee는 새 Versioned Fee Policy로 명시한다.
수익 출금 fee는 MINING_REWARD, 원금 회수 fee는 PRINCIPAL에서만 차감한다.
Bonus fee를 principal로 대신 내지 않는다. 같은 bucket이 부족하면 거절한다.

USDT는 TRC20 수동 입금이다. 요청 → 송금 → TXID 제출 → 관리자의 실제 수신
확인 → received USDT와 적용 KRW 확인 → principal credit 승인 순서다.
인정 원금/등급/Capacity를 갱신하고 필요 시 채굴을 자동 재개한다.
사용자 USDT wallet이나 USDT mining reward는 만들지 않는다.

## 서버 권위와 구현 관문

서버가 최종 계산한다. 브라우저·Scene·AI는 principal/Tier/Capacity/Speed/
pending/verified/preview 결과만 읽으며 공식이나 보상 계산을 소유하지 않는다.
관리자는 Tier threshold, base/retention rate, 상품 multiplier, campaign limits,
user override, slot, fee policy를 새 버전으로 바꿀 수 있어야 한다.

이 결정으로 원금 기준, 등급 구간, 최소 원금, 30일 cycle, base/retention/total
Capacity, 상품 기본 multiplier/allocation/slot, campaign/override ceiling,
fixed-point/rounding/carry, 출금 출처 분리, V1 platform fee/future fee source,
USDT-TRC20 principal 처리를 APPROVED로 갱신한다. 이 항목 때문에 구현을
보류하지 않는다. 새 경제 활성화에는 이 정확한 승인 policy version을 사용하며
임의 수치 변경이나 legacy 권한 재활성화로 engine 연결을 대신하지 않는다.
