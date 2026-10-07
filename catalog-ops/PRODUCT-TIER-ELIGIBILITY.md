# SUPERSEDED_BY_OWNER_CORRECTION

아래는 과거 기록이며 최종 추천 또는 구현 요구로 사용하지 않는다. Owner가 상품별 최소 Funding Tier·해금·Tier 하향에 따른 상품 잠금/PAUSE를 폐기했다. 현재 기준은 PRODUCT-ACCESS-POLICY.md와 TIER-MINING-POWER-MODEL.md다. 원본 SHA256은 evidence/superseded-tier-gate/manifest.json에 보존한다.

---

# Funding Tier 상품 자격 제안

승인 JSON의 14단계·최소/최대 인정 원금·slot·retention 값을 read-only로 참조했다. 정책 문서 승인일과 현재 서버 적용 시각은 다르며 live publication/effective_from은 UNKNOWN이다. domain/mining/economy-policy.ts의 검증된 policy receipt와 fundingTierForPrincipal, tests/unit/funding-entitlement.test.ts의 최소/큰 정수/하향 capacity/PAUSE 테스트를 읽었다. 문서만으로 실제 자격 변경을 실행하지 않는다.

Tier는 누적 입금액이 아니라 남은 인정 원금이다. 수익·Bonus·체험 잔액은 포함하지 않고 원금 HOLD는 forward 시점부터 제외한다. 회원에게 L 코드·원화 추가 입금 권유를 노출하지 않는다. START 체험/첫 출금의 별도 규칙을 이 제안으로 차단하지 않는다.

상품 25개마다 최소 Tier, DERIVED_FROM_TIER, 사용 가능 단계, 이유, 안내 원고, downgrade 및 policy receipt 요건을 JSON으로 작성했다.

| 상품           | Grade | 성격             | 속도 제안 | Minimum Tier | Capacity              |
| -------------- | ----- | ---------------- | --------- | ------------ | --------------------- |
| 금             | C     | 정제 관찰형      | 1.00      | L1           | INHERIT_TIER_CAPACITY |
| 은             | C     | 표면 검사형      | 1.01      | L1           | INHERIT_TIER_CAPACITY |
| SPY            | C     | 묶음 균형형      | 1.01      | L1           | INHERIT_TIER_CAPACITY |
| KB금융         | C     | 기록 정리형      | 1.01      | L1           | INHERIT_TIER_CAPACITY |
| LG전자         | B     | 생활 기기 연결형 | 1.03      | L2           | INHERIT_TIER_CAPACITY |
| SCHD           | B     | 묶음 기록형      | 1.03      | L2           | INHERIT_TIER_CAPACITY |
| 애플           | B     | 정밀 관찰형      | 1.04      | L3           | INHERIT_TIER_CAPACITY |
| NAVER          | B     | 정보 탐색형      | 1.04      | L3           | INHERIT_TIER_CAPACITY |
| 현대자동차     | B     | 차례 진행형      | 1.05      | L4           | INHERIT_TIER_CAPACITY |
| 마이크로소프트 | B     | 연결 흐름형      | 1.05      | L4           | INHERIT_TIER_CAPACITY |
| LG에너지솔루션 | A     | 셀 순서형        | 1.06      | L5           | INHERIT_TIER_CAPACITY |
| 아마존         | A     | 경로 정리형      | 1.06      | L5           | INHERIT_TIER_CAPACITY |
| 삼성전자       | A     | 정밀 스캔형      | 1.07      | L6           | INHERIT_TIER_CAPACITY |
| SOXX           | A     | 묶음 검사형      | 1.07      | L6           | INHERIT_TIER_CAPACITY |
| 이더리움       | A     | 구조 연결형      | 1.08      | L7           | INHERIT_TIER_CAPACITY |
| 알파벳         | A     | 지식 연결형      | 1.08      | L7           | INHERIT_TIER_CAPACITY |
| QQQ            | S     | 묶음 연결형      | 1.09      | L8           | INHERIT_TIER_CAPACITY |
| 솔라나         | S     | 나란한 흐름형    | 1.09      | L8           | INHERIT_TIER_CAPACITY |
| 비트코인       | S     | 블록 순서형      | 1.09      | L9           | INHERIT_TIER_CAPACITY |
| 샌디스크       | S     | 저장 정리형      | 1.09      | L10          | INHERIT_TIER_CAPACITY |
| SK하이닉스     | S     | 층별 신호형      | 1.10      | L11          | INHERIT_TIER_CAPACITY |
| 테슬라         | S     | 조립 리듬형      | 1.10      | L11          | INHERIT_TIER_CAPACITY |
| 로켓랩         | S     | 임무 단계형      | 1.10      | L12          | INHERIT_TIER_CAPACITY |
| 엔비디아       | S     | 연산 흐름형      | 1.10      | L13          | INHERIT_TIER_CAPACITY |
| SpaceX         | S     | 궤도 연결형      | 1.10      | L14          | INHERIT_TIER_CAPACITY |

## Tier 하락 추천 B

서버에서 확인한 조건 변경 시각부터 자격을 잃은 선택만 PAUSE한다. 다른 선택은 slot/전체 allocation/한도를 다시 확인해야 한다. 자동 대체·소급 정산·보상 삭제·원장 수정·주기/나이 초기화는 없다. 사용량이 줄어든 한도를 넘으면 추가 발생만 멈춘다. 원금 출금 HOLD는 기존 PAUSE를 우선하며 취소/해제는 이후 시점만 다시 평가한다. 기존 verified ledger, cycle, age, history, 사용량, exact carry를 보존한다. 재개는 올바른 서버 receipt와 회원 확인이 있어야 하며 catch-up을 만들지 않는다.

A 다음 주기 적용은 자격 상실 이후 accrual을 허용할 수 있어 별도 grandfather 승인이 필요하다. C 유예 기간은 승인 기간·예산이 없어서 추천하지 않는다. B도 아직 승인·구현되지 않았고 shared backend는 Primary가 연결해야 한다.
