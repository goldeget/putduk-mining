# 경제 모델 비교와 단일 추천

추천: **Policy A + Tier gate + inherited global capacity + product speed / 1.00–1.10**. 모든 값은 승인 전이며 runtime 적용/운영 수익 근거가 아니다.

| Model | 속도                                     | Capacity                    | 결론                                                         |
| ----- | ---------------------------------------- | --------------------------- | ------------------------------------------------------------ |
| A     | 상품별 1.00–1.10, Tier별 accessible pool | 승인 Tier global cycle 상속 | 단일 추천; gate/effect scope 새 policy 승인 필요             |
| B     | 상품별 차이                              | 상품마다 별도 capacity      | payable ceiling을 바꾸므로 추천하지 않음; 구현/등록하지 않음 |
| C     | 모두 1.00, 성격만 다름                   | 승인 Tier global cycle 상속 | 속도 우위 제거 비교용; 최종 추천 아님                        |

| 제안 Band | 최단 base-cap 도달: 정규화 | 최종 1.50 headroom | 중간 modifier cap 적용 상품 수 | 승인 문서 band 변경 |
| --------- | -------------------------- | ------------------ | ------------------------------ | ------------------- |
| 1.00–1.10 | 300/11일                   | 15/11              | 0                              | False               |
| 1.00–1.12 | 375/14일                   | 75/56              | 0                              | True                |
| 1.00–1.18 | 1500/59일                  | 75/59              | 11                             | True                |

1.10은 승인 문서 product 0.90–1.10 안에 있지만 아직 non-default effect scope/자격 contract가 없어 활성화할 수 없다. 1.12와 1.18은 기존 band도 바꾸므로 별도의 POLICY_VERSION_CHANGE_REQUIRED. Grade/기업 유명세/시세는 경제 근거가 아니다. 두 개 50% slot에서 1.10과 1.10을 선택해도 rate=1.10, 한도=global100, 200이 아니다. 세부 비교는 TIER-PROGRESSION-ANALYSIS.md와 JSON을 읽는다.

제품×사용자×이벤트×임시 효과는 정확한 유리수 곱 후 최종 한 번 1.50 제한 제안. 기존 campaign 15000 cap이 전체 scope 구현을 입증하지 않는다. 1.20×1.15×1.10=1.518→1.50이며, 1.18×1.20×1.25×0.80은 중간 cap 없이 1.416으로 유지해야 한다. Primary가 portion/priority/effective interval/source changes와 안전한 정산 연결을 검증해야 한다. 이 lane은 backend·ledger를 수정하지 않는다.
