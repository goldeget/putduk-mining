# 경제 모델 비교 — Owner correction 적용

현재 추천은 Policy A + OPEN PRODUCT CHOICE + Tier mining power + inherited global capacity + secondary product modifier, 1.00–1.10이다. 기존 Policy A + Tier gate는 SUPERSEDED_BY_OWNER_CORRECTION이다.

| 모델                                                        | 현재 판단                      | 이유                                                           |
| ----------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| A: 열린 상품 접근 + 공통 global capacity + product modifier | 조건부 추천                    | Owner 방향에 맞음. Tier speed/effect 계약과 상품값 승인은 미정 |
| B: 상품별 capacity 차등                                     | 추천하지 않음                  | 상품이 원금 기반 지급 한도를 바꾸며 승인되지 않음              |
| C: 모든 상품 modifier1.00, personality 중심                 | 비교안만                       | 임의 적용하지 않음. Owner는 modifier 유지 가능                 |
| 과거 Tier별 상품 해금                                       | SUPERSEDED_BY_OWNER_CORRECTION | 상품 선택은 열려 있으며 Tier는 채굴 규모를 정함                |

SSOT의 기본 capacity와 중립 절대 rate는 인정 원금에 비례한다. 상품 modifier는 capacity를 바꾸지 않는다. 고유 Tier base speed 규칙은 TIER_SPEED_CONTRACT_REQUIRED이며 높은 Tier의 모든 경계 우위를 자동 가정하지 않는다. PRODUCT-ACCESS-POLICY.md와 TIER-MINING-POWER-MODEL.md가 현재 기준이다.
