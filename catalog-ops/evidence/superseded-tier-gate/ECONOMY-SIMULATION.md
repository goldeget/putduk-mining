# 오프라인 Tier-aware 시뮬레이션

`node catalog-ops/economy-simulate.mjs`는 JSON의 25개 proposal/승인 SSOT/Tier profiles를 읽어 3 bands × 14 tiers를 계산한다. BigInt 정수 bps와 numerator/denominator, fractional carry/최종 cap 로직을 사용한다. capacity normalized100, 실제 KRW 예측 없음. 매 Tier의 eligible IDs/선택 수/top/평균/spread/시간차이/headroom/다음 해금/slot/cap 인센티브를 저장한다.

| 제안 Band | 최단 base-cap 도달: 정규화 | 최종 1.50 headroom | 중간 modifier cap 적용 상품 수 | 승인 문서 band 변경 |
| --------- | -------------------------- | ------------------ | ------------------------------ | ------------------- |
| 1.00–1.10 | 300/11일                   | 15/11              | 0                              | False               |
| 1.00–1.12 | 375/14일                   | 75/56              | 0                              | True                |
| 1.00–1.18 | 1500/59일                  | 75/59              | 11                             | True                |

기존 108개 baseline regression은 8f68be2의 exact 입력으로 보존했으며 새 연구/Tier 검증은 현재 입력으로 별도 실행한다. 소스 해시·실제 인용·SEC row·P0 상태·상속 자격·하향 PAUSE·duplicate/invalid tier·원화 문턱 금지·cap headroom을 검증한다. PASS_OFFLINE_SIMULATION은 정책 승인, live publication, wallet verified 금액, 실제 browser 렌더, 제품 완료를 뜻하지 않는다.
