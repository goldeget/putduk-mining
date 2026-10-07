# 상품 경제 비교 — 열린 상품 선택

Owner correction이 상품 접근 모델의 최신 기준이다. 상품별 최소 Funding Tier, 원금 문턱, Tier 해금은 최종 제안에 없다. P0 6개 + P1 19개는 조건부 출시 제안이며 실제 공개된 25개라는 뜻이 아니다. 전부 effective HOLD, approved modifier null, 시장 연동 false다. 공개·운영 중인 상품은 모든 eligible member가 선택한다.

Grade/personality는 가상 상품 편집·경험 분류다. 기업의 투자등급·수익률·손실 위험 등급이 아니다. Tier 기본 경제가 우선이며 상품 modifier는 보조다. 하나의 global cycle capacity를 상품이나 슬롯 수로 곱하지 않는다. 법무·공식 신원·Scene·command 검증 조건은 그대로다.

| Product        | Grade | Personality      | Product Speed Modifier | Product Access       | Tier Capacity | Market Linked | Policy Status         | Scene Status                                       |
| -------------- | ----- | ---------------- | ---------------------- | -------------------- | ------------- | ------------- | --------------------- | -------------------------------------------------- |
| 금             | C     | 정제 관찰형      | 1.00                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | DESKTOP/MOBILE/BROWSER_QA_REQUIRED                 |
| 은             | C     | 표면 검사형      | 1.01                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | DESKTOP/MOBILE/BROWSER_QA_REQUIRED                 |
| SPY            | C     | 묶음 균형형      | 1.01                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| KB금융         | C     | 기록 정리형      | 1.01                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| LG전자         | B     | 생활 기기 연결형 | 1.03                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| SCHD           | B     | 묶음 기록형      | 1.03                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| 애플           | B     | 정밀 관찰형      | 1.04                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | DESKTOP/MOBILE/BROWSER_QA_REQUIRED                 |
| NAVER          | B     | 정보 탐색형      | 1.04                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| 현대자동차     | B     | 차례 진행형      | 1.05                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| 마이크로소프트 | B     | 연결 흐름형      | 1.05                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | DESKTOP/MOBILE/BROWSER_QA_REQUIRED                 |
| LG에너지솔루션 | A     | 셀 순서형        | 1.06                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| 아마존         | A     | 경로 정리형      | 1.06                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| 삼성전자       | A     | 정밀 스캔형      | 1.07                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | DESKTOP/MOBILE/BROWSER_QA_REQUIRED                 |
| SOXX           | A     | 묶음 검사형      | 1.07                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| 이더리움       | A     | 구조 연결형      | 1.08                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | DESKTOP/MOBILE/BROWSER_QA_REQUIRED                 |
| 알파벳         | A     | 지식 연결형      | 1.08                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| QQQ            | S     | 묶음 연결형      | 1.09                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| 솔라나         | S     | 나란한 흐름형    | 1.09                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| 비트코인       | S     | 블록 순서형      | 1.09                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | DESKTOP/MOBILE/BROWSER_QA_REQUIRED                 |
| 샌디스크       | S     | 저장 정리형      | 1.09                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| SK하이닉스     | S     | 층별 신호형      | 1.10                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | DESKTOP/MOBILE/BROWSER_QA_REQUIRED                 |
| 테슬라         | S     | 조립 리듬형      | 1.10                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| 로켓랩         | S     | 임무 단계형      | 1.10                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
| 엔비디아       | S     | 연산 흐름형      | 1.10                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | DESKTOP/MOBILE/BROWSER_QA_REQUIRED                 |
| SpaceX         | S     | 궤도 연결형      | 1.10                   | ALL_ELIGIBLE_MEMBERS | INHERITED     | false         | PROPOSED_NOT_APPROVED | SPEC_REQUIRED + DESKTOP/MOBILE/BROWSER_QA_REQUIRED |
