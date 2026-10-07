# SUPERSEDED_BY_OWNER_CORRECTION

아래는 과거 기록이며 최종 추천 또는 구현 요구로 사용하지 않는다. Owner가 상품별 최소 Funding Tier·해금·Tier 하향에 따른 상품 잠금/PAUSE를 폐기했다. 현재 기준은 PRODUCT-ACCESS-POLICY.md와 TIER-MINING-POWER-MODEL.md다. 원본 SHA256은 evidence/superseded-tier-gate/manifest.json에 보존한다.

---

# Tier-aware 선택 폭과 편중 분석

NORMALIZED_INDEX_ONLY, 실제 수익/지급액 예측이 아니다. 승인 SSOT 14단계의 남은 인정 원금 범위와 slot을 그대로 참조했다. 아래 금액은 상품별 문턱이 아니라 정책 참조 표이며 회원 홍보 원고에 사용하지 않는다. live effective_from은 UNKNOWN이다. 각 비교는 해당 Tier의 accessible_product_set에만 적용한다. 모든 회원이 25개 전부 선택한다는 가정은 제거했다.

| Tier | 인정 원금 범위: 승인 SSOT 참조 | Slots | 선택 수 | 신규 테마                       | 최고 속도 | 최고속 선택지                               | 다음 단계 |
| ---- | ------------------------------ | ----- | ------- | ------------------------------- | --------- | ------------------------------------------- | --------- |
| L1   | 100000–499999                  | 1     | 4       | gold, silver, spy, kb-financial | 1.01      | silver, spy, kb-financial                   | L2        |
| L2   | 500000–999999                  | 1     | 6       | lg-electronics, schd            | 1.03      | lg-electronics, schd                        | L3        |
| L3   | 1000000–2999999                | 2     | 8       | apple, naver                    | 1.04      | apple, naver                                | L4        |
| L4   | 3000000–4999999                | 2     | 10      | hyundai-motor, microsoft        | 1.05      | hyundai-motor, microsoft                    | L5        |
| L5   | 5000000–9999999                | 2     | 12      | lg-energy-solution, amazon      | 1.06      | lg-energy-solution, amazon                  | L6        |
| L6   | 10000000–29999999              | 3     | 14      | samsung-electronics, soxx       | 1.07      | samsung-electronics, soxx                   | L7        |
| L7   | 30000000–49999999              | 3     | 16      | ethereum, alphabet-a            | 1.08      | ethereum, alphabet-a                        | L8        |
| L8   | 50000000–99999999              | 3     | 18      | qqq, solana                     | 1.09      | qqq, solana                                 | L9        |
| L9   | 100000000–299999999            | 4     | 19      | bitcoin                         | 1.09      | qqq, solana, bitcoin                        | L10       |
| L10  | 300000000–499999999            | 4     | 20      | sandisk                         | 1.09      | qqq, solana, bitcoin, sandisk               | L11       |
| L11  | 500000000–999999999            | 5     | 22      | sk-hynix, tesla                 | 1.10      | sk-hynix, tesla                             | L12       |
| L12  | 1000000000–2999999999          | 5     | 23      | rocket-lab                      | 1.10      | sk-hynix, tesla, rocket-lab                 | L13       |
| L13  | 3000000000–4999999999          | 5     | 24      | nvidia                          | 1.10      | sk-hynix, tesla, rocket-lab, nvidia         | L14       |
| L14  | 5000000000–∞                   | 5     | 25      | spacex                          | 1.10      | sk-hynix, tesla, rocket-lab, nvidia, spacex | 최종 단계 |

## 선택 폭

L1은 4개, L2–L8은 매 단계 2개 추가, L9–L10은 1개, L11은 2개, L12–L14는 1개 추가다. 모든 단계가 이전 선택을 포함한다. 해금 0인 단계는 없지만 L9/L10 최고속은 이미 L8과 같고 L12–L14도 1.10보다 올라가지 않는다. 마지막 단계의 보상 우위를 새로 만들지 않는다. 최고 단계에는 서로 다른 5개 personality가 같은 최고속으로 배치된다. 실제 산업군은 반도체/메모리·모빌리티·우주에 집중돼 모든 자산군을 고르게 대표한다고 볼 수 없다.

L1은 한국 금융/ETF/귀금속, 미국 단일 기업은 L3부터, crypto는 L7부터 열린다. 초기 모든 자산군을 의무 제공하지 않지만 삼성전자(L6)/BTC(L9) 같은 익숙한 테마가 뒤에 있어 입문자 박탈감을 만들 수 있다. 높은 승인 SSOT 원금 구간에서만 새 산업 장면을 제공하는 이 배치는 과도한 입금 유도 위험이 있다. 단계 상승을 홍보/보상 목표로 만들지 않고, 먼저 현재 선택 가능한 상품을 안내한다. OWNER는 접근성·적은 금액의 선택 폭·상품 수/scene 예산을 검토해야 한다. 이 편집 배치는 승인 전이며 gate 확대를 위해 임의 경제 혜택을 붙이지 않는다.

L11–L14는 기존 slot 5/retention 2500bps가 같고 새 테마 외에는 추가 혜택을 주장하지 않는다. 현재 미확인 자료가 있는 P1 조건부 상품을 제거하면 실제 공개 선택 수가 줄어든다. 표는 25개 가정이며 launch-ready 수가 아니다. 자격 미확인·법무·Scene 실패 상품은 여전히 effective HOLD다. 미공개 해금 예고/과장 숫자 노출 금지.

## 구간 비교

| 제안 Band | 최단 base-cap 도달: 정규화 | 최종 1.50 headroom | 중간 modifier cap 적용 상품 수 | 승인 문서 band 변경 |
| --------- | -------------------------- | ------------------ | ------------------------------ | ------------------- |
| 1.00–1.10 | 300/11일                   | 15/11              | 0                              | False               |
| 1.00–1.12 | 375/14일                   | 75/56              | 0                              | True                |
| 1.00–1.18 | 1500/59일                  | 75/59              | 11                             | True                |

비교 modifier는 product × 1.15 user × 1.10 event × 1.05 temporary의 가상 시나리오다. 현재 runtime effect scope를 입증하지 않는다. 1.18은 11개에서 최종 cap에 닿아 이벤트/임시 효과의 추가 여지가 소모된다. 1.10은 기존 승인 band 안이고 최고와 최저의 시간 차이를 좁혀 편중 인센티브를 줄인다. 1.12/1.18은 POLICY_VERSION_CHANGE_REQUIRED이며 1.10도 새로운 Tier gate와 효과 scope 때문에 별도 policy version 승인이 필요하다.

각 Tier/각 band의 최저·최고·평균·평균 대비 최고·시간 차이·headroom·top pool·자산군은 JSON 42행에 유리수로 보존했다. base capacity index는 하나의 global 100이며 product/slot마다 복제되지 않는다. retention은 별도 조건부 승인 항목으로 이 정규화 표에 합치지 않았다.

## 편중 전후

과거 24개 unrestricted 모형의 1.18 NVIDIA 단독 최고는 전체 접근 가능이라는 역사적 가정이었다. 현재 실제 회원 선택 비율이 아니다. 이번에는 L1 top 3, L2–L8 top 2, L9 top 3, L10 top 4, L11 top 2, L12 top 3, L13 top 4, L14 top 5다. 상위 Tier의 NVIDIA 한 개가 속도 면에서 유일한 최선이라는 구조는 제거했다.

그러나 speed-only 모형은 여전히 top pool 전체를 선택하고 낮은 속도 테마를 경제적으로 지배한다. 동점 상품을 균등 선택한다고 가정하면 L14 개별 1/5이나, 이는 측정치도 예측치도 아니다. ACTUAL_USER_CONCENTRATION_UNKNOWN. 무작위 금액·숨은 bonus/capacity·특정 테마 강제·불이익으로 다양성을 만들지 않는다. 출시 뒤 동의된 aggregate 선택/지원/중단 데이터를 보고 별도 수정안을 검토한다.

## 하향 변경

추천 B: 서버의 정확한 조건 변경 시각부터 자격 없는 선택만 PAUSE, 자동 대체 없이 새 slot/allocation을 확인한다. 원금 HOLD는 기존 PAUSE_NOT_RESET 우선이다. cycle/age/verified ledger/history/used/carry는 보존하고 reduced capacity를 넘으면 새 발생만 중지한다. release 뒤 소급 catch-up을 만들지 않는다. 모든 결과는 read-only proposal이고 실제 엔진 변경은 Primary/승인 정책의 권한 흐름으로만 가능하다.
