# Funding Tier 채굴 규모 모델

상품 선택은 열려 있고, 채굴 규모는 Tier의 경제 조건을 따른다. 인정 원금 → Funding Tier → Tier 기본 속도 → capacity/entitlement → 공개 상품 선택 → 상품 modifier → user/event/temporary modifiers → 최종 1.50 cap 한 번 → Reward Producer → Pending → Settlement → Verified 순서다.

실제 SSOT는 `docs/product/economy-v1-approved-2026-10-03.json`이다. 14개 구간·slots·retention 값을 그대로 읽었다. 문서 승인과 실제 live publication은 별개이며 server receipt/effective timestamp는 UNKNOWN이다. source SHA256과 read-only engine/test/provenance 해시는 tier-mining-power-model.json에 있다.

| Tier               | Eligible Principal (KRW)    | Slots | Base Speed / Derived Speed Status                  | Capacity / Entitlement                                  | Product Access         | Retention (conditional bps) |
| ------------------ | --------------------------- | ----- | -------------------------------------------------- | ------------------------------------------------------- | ---------------------- | --------------------------- |
| L1 STARTER         | 100,000–499,999             | 1     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 1500                        |
| L2 STARTER+        | 500,000–999,999             | 1     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 1600                        |
| L3 ACTIVE          | 1,000,000–2,999,999         | 2     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 1700                        |
| L4 ADVANCED        | 3,000,000–4,999,999         | 2     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 1800                        |
| L5 PRO             | 5,000,000–9,999,999         | 2     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 1900                        |
| L6 PREMIUM         | 10,000,000–29,999,999       | 3     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 2000                        |
| L7 PREMIUM+        | 30,000,000–49,999,999       | 3     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 2100                        |
| L8 ELITE           | 50,000,000–99,999,999       | 3     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 2200                        |
| L9 ULTRA           | 100,000,000–299,999,999     | 4     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 2300                        |
| L10 ULTRA+         | 300,000,000–499,999,999     | 4     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 2400                        |
| L11 PRIVATE        | 500,000,000–999,999,999     | 5     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 2500                        |
| L12 PRIVATE+       | 1,000,000,000–2,999,999,999 | 5     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 2500                        |
| L13 PRIVATE ELITE  | 3,000,000,000–4,999,999,999 | 5     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 2500                        |
| L14 PRIVATE ELITE+ | 5,000,000,000 이상          | 5     | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | 2500                        |

## 확인 가능한 기본 규모와 미정 속도

SSOT에 별도의 Tier base speed multiplier 필드나 서로 다른 Tier 속도 배율 derive rule은 없다. 모든 Tier의 값은 null / TIER_SPEED_CONTRACT_REQUIRED다. 같은 배율 1.00을 새 Tier 승인값으로 채우거나 retentionBonusBps를 속도 배율로 바꾸지 않는다.

기존 read-only funding-entitlement preview는 중립 효과에서 `principal × microKrwPerKrw × baseCycleRateBps / 10000`의 기본 global cycle capacity를 만들고, full allocation의 기본 일일 기준은 그 capacity / cycleDays다. 현재 승인 문서는 1500bps와 30일을 사용한다. 이는 문서·preview 산술 근거이며 새 수익률·실제 지급 보장·live 보상 예상이 아니다. 비기본 modifier 효과는 현재 EFFECT_SCOPE_UNRESOLVED다.

인정 원금은 누적 입금액이 아니라 출처가 확인된 남은 원금이다. 채굴보상·Bonus·체험·active principal HOLD 금액을 포함하지 않는다. 같은 조건에서 원금이 늘면 중립 절대 기본 rate와 capacity는 비례 증가한다. slot 수는 1→2→3→4→5로 비감소하지만 모든 Tier마다 증가하지는 않는다. retention bps도 plateau가 있으며 별도 조건 충족 전에는 settlement-ready 기본 보상에 더하지 않는다.

상품 modifier 1.00–1.10은 PUTDUK 내부 운영 제안이며 시장 수익률이 아니다. 기본 capacity는 modifier와 무관하다. Tier별 고유 speed 효과와 retention portion 적용 범위는 Primary 계약이 필요하다. `final 1.50`은 product×user×event×temporary의 상대 modifier를 정확히 곱한 뒤 한 번 제한한다. 절대 KRW rate나 큰 Tier의 원금·capacity를 1.50으로 잘라내는 규칙이 아니다.

## Tier 하향과 원금 HOLD

Tier가 내려가도 선택한 공개 상품 자체를 잠그거나 교체하지 않는다. 서버 조건 변경 시각 이후의 base speed·capacity·slots·future accrual만 새 Tier 기준으로 재평가한다. 상품 접근권 때문에 PAUSE하지 않는다.

원금 withdrawal HOLD = PAUSE_NOT_RESET을 유지한다. history / eligible age / current cycle / used capacity / fractional carry / verified ledger를 보존한다. 감소한 capacity보다 이미 사용량이 커도 과거 확정 금액을 회수하거나 reset하지 않으며 새 accrual만 한도 내에서 제한한다. 정지 시간 catch-up이나 자동 상품 대체는 없다.

slot 감소 시 어떤 기존 allocation을 유지·정지할지는 PRIMARY_CONTRACT_REQUIRED다. 이 제안은 속도순·생성순 등 임의 선택 규칙을 만들지 않는다. 한도를 초과한 allocation은 실제 권위의 처리가 확인될 때까지 승인 가능 상태로 주장하지 않는다. 일반 계정 자격·safe mode·publication/availability guard는 독립적으로 유지한다.
