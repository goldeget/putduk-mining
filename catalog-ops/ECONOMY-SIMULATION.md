# 경제 시뮬레이션 — 상품 선택과 Tier 규모 분리

기존 Tier-gated concentration simulation은 SUPERSEDED_BY_OWNER_CORRECTION이며 최종 추천에서 제거했다. 과거 evidence/economy-simulation.json은 변경하지 않고 원본 archive도 보존한다. 현재 결과는 schema3의 economy-simulation-results.json과 evidence/owner-economy-simulation.json이다. 실제 지급·서버 정책 활성화·회원 행동·등록 증거가 아니다.

14개 Tier × 25개 상품 = 350개 조건부 비교, Gold/NVIDIA 동일 상품의 14개 Tier 비교, 동일 Tier 내 상품 배율 비교, Tier minimum 원금 규모 vs product modifier, 슬롯별 전체 allocation, user/event/temporary, 최종 cap 한 번을 확인한다. 모든 결과는 BigInt·정확한 rational이다. 시장가격 입력 0, live 정책 확인 false, 실제 effective daily reward null이다.

## 동일 상품의 Tier별 규모

아래는 SSOT 구간의 최소 원금을 사용한 중립 full-allocation 참고 산술이다. Tier별 고유 속도 배율은 미정이며 값 null이다. conditional retention은 표 기본 capacity/rate에 포함하지 않는다. 각 구간 안에서도 실제 남은 원금에 비례하며 대표 최소값을 Tier 고정 capacity로 저장하지 않는다.

| Tier | 기준 인정 원금 (KRW) | Slots | 기본 capacity (micro KRW, exact) | 중립 기본 일일 rate (micro KRW, exact) | 공개 상품 접근         | 고유 Tier speed              |
| ---- | -------------------- | ----- | -------------------------------- | -------------------------------------- | ---------------------- | ---------------------------- |
| L1   | 100,000              | 1     | 15000000000/1                    | 500000000/1                            | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |
| L2   | 500,000              | 1     | 75000000000/1                    | 2500000000/1                           | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |
| L3   | 1,000,000            | 2     | 150000000000/1                   | 5000000000/1                           | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |
| L4   | 3,000,000            | 2     | 450000000000/1                   | 15000000000/1                          | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |
| L5   | 5,000,000            | 2     | 750000000000/1                   | 25000000000/1                          | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |
| L6   | 10,000,000           | 3     | 1500000000000/1                  | 50000000000/1                          | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |
| L7   | 30,000,000           | 3     | 4500000000000/1                  | 150000000000/1                         | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |
| L8   | 50,000,000           | 3     | 7500000000000/1                  | 250000000000/1                         | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |
| L9   | 100,000,000          | 4     | 15000000000000/1                 | 500000000000/1                         | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |
| L10  | 300,000,000          | 4     | 45000000000000/1                 | 1500000000000/1                        | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |
| L11  | 500,000,000          | 5     | 75000000000000/1                 | 2500000000000/1                        | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |
| L12  | 1,000,000,000        | 5     | 150000000000000/1                | 5000000000000/1                        | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |
| L13  | 3,000,000,000        | 5     | 450000000000000/1                | 15000000000000/1                       | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |
| L14  | 5,000,000,000        | 5     | 750000000000000/1                | 25000000000000/1                       | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |

L1 minimum 100,000원과 L2 minimum 500,000원을 비교하면 기본 capacity는 5배다. 조건부 중립 참고에서 L2 Gold 1.00의 일일 rate / L1 NVIDIA 1.10은 50/11이다. 낮은 Tier가 빠른 상품을 고른다는 이유로 높은 원금의 capacity를 넘게 만들지 않는다. product modifier는 capacity를 늘리지 않는다.

그러나 L1 upper 499,999원 NVIDIA와 L2 lower 500,000원 Gold의 중립 참고 rate를 비교하면 L1이 약 1.10배다. 고유 Tier base speed 계약이 없으므로 모든 경계에서 높은 Tier의 속도 우위가 훨씬 크다고 검증할 수 없다. 이 결과를 숨기지 않는다. “Tier base economics primary”의 Owner 방향은 확정이지만 고유 Tier speed/derive rule은 TIER_SPEED_CONTRACT_REQUIRED다. 값을 발명하거나 상품을 다시 잠가 해결하지 않는다.

## 같은 Tier에서 modifier와 슬롯 영향

Gold 1.00과 NVIDIA 1.10은 같은 기본 capacity를 사용한다. 중립 기본 속도·full allocation·실제 modifier 적용 범위가 확정된다는 가정에서 base cap 도달 시간은 각각 30일과 300/11일이다. 실제 time-to-cap은 Tier speed·effect/retention scope·중간 조건 변경·allocation이 미정이라 UNKNOWN이다. 참고 시간을 회원 지급 약속으로 쓰지 않는다.

NVIDIA/Gold 50:50 allocation은 weighted modifier 1.05이며 global capacity는 그대로다. 2·3·4·5 슬롯은 별도 capacity를 생성하지 않는다. 전체 배분 ≤10000bps, 현재 Tier의 슬롯 이하가 필요하다. 슬롯 감소 후 기존 배분 유지/정지 규칙은 PRIMARY_CONTRACT_REQUIRED다.

## user/event/temporary와 final cap

product×user×event×temporary를 exact rational로 모두 곱한 뒤 final1.50 cap을 한 번 적용한다. 1.20×1.15×1.10×1.00=1.518 → 1.50이다. 1.10×1.20×1.25×0.80=1.32이고 중간1.50 절단을 먼저 하면 잘못된1.20이 된다. 낮은 modifier는 순서 검증용 사례이며 새 프로모션 제안이 아니다.

cap은 상대 modifier에 적용한다. 원금 기반 Tier 절대 기본 rate나 entitlement 자체를 1.50로 제한하지 않는다. retention 적용 portion과 authoritative boundary는 별도 Primary 계약이다. 1.00–1.10 추천은 현재 문서 band 안이지만 상품별 값/효과 scope는 승인 전이다. 1.12/1.18은 비교용이며 기존 문서 band 변경 승인도 필요하다. 같은 moderate stack에서 cap 초과 상품 수는 0/0/11이다.

## 핵심 질문의 검증 결과

- 인정 원금 증가 → 기본 capacity와 동일 상품·동일 조건의 중립 절대 기본 rate 증가: SSOT 산술에서 PASS.
- 동시 운영 능력: 1→2→3→4→5, 비감소 stepwise이며 일부 Tier는 동일 slots.
- retention: 별도 조건, 비감소 bps와 plateau, 확정 지급 포함 금지.
- 고유 Tier base speed가 증가하고 모든 인접 Tier 경계에서 product modifier보다 더 중요함: TIER_SPEED_CONTRACT_REQUIRED / UNKNOWN.
- 상품 잠금으로 채굴 규모를 늘려야 함: 필요 없음. 상품별 접근 목록은 공개 상품에 대해 동일하다.

속도만 보는 선택에서 높은 modifier 그룹에 대한 선호 위험은 여전히 남으며 실제 concentration은 UNKNOWN이다. 새로운 Tier-gated concentration 결과를 만들거나 균형이 입증됐다고 주장하지 않는다.
