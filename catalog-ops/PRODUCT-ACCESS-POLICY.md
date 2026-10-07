# 상품 접근 정책 — Owner correction

정상적으로 공개·운영 중인 모든 상품은 모든 eligible member가 선택한다. Product access = ALL_ELIGIBLE_MEMBERS, Tier의 product access = ALL_PUBLISHED_PRODUCTS다. L1 회원도 공개된 NVIDIA / Tesla / SK hynix / SpaceX / BTC / ETF를 고를 수 있다.

Funding Tier는 특정 주식 상품의 접근권을 정하지 않는다. 기본 채굴 경제·capacity/entitlement·동시 슬롯·원금 기반 규모·승인된 Tier 경제 혜택을 정한다. 상품은 personality·Scene·시각 정체성·상품 speed modifier·경험을 제공한다. 두 축을 분리한다.

## 폐기된 해석과 기록 보존

minimum_funding_tier per product, product unlock by Tier, NVIDIA only L13, SpaceX only L14, downgrade product ineligibility, 상품 Tier 자격 상실에 따른 PAUSE는 모두 SUPERSEDED_BY_OWNER_CORRECTION이다. Owner 정책으로 승인된 적이 없으며 더 이상 최종 추천·통합 요구에 사용하지 않는다.

`product-tier-eligibility.json`, PRODUCT-TIER-ELIGIBILITY.md, TIER-PROGRESSION-ANALYSIS.md는 명시적 비활성 역사 기록이다. 이전 HEAD 783732492e70c312b33640e07ee0d8ffad68c3e5의 28개 원본을 evidence/superseded-tier-gate/에 바이트 그대로 보존했다. manifest가 원본 SHA256을 기록하고 tests가 exact Git 원본과 대조한다. 이전 100개 Tier-gate tests도 그 historical SHA에 고정해서 재현하며 현재 정책 근거로 쓰지 않는다.

## 접근과 실행을 구분

현재 25개는 DRAFT 제안이다. effective wave는 HOLD이며 실제 DB 공개 상태는 LIVE_DB_UNKNOWN이다. 이 문서가 DRAFT 상품을 공개하거나 account 자격을 승인하지 않는다. 공개·사용 가능 상품 snapshot과 eligible member 상태는 기존 서버 권위에서 확인한다. 미공개·retired/paused 상품, 독립 계정/security guard를 Tier 해금으로 오해하지 않는다.

상품 접근이 열려 있어도 채굴 실행은 서버의 minimum principal·현재 eligibility·safe mode·HOLD·slots/allocation·policy receipt를 따라야 한다. 최소 Funding 조건 미충족은 특정 상품의 잠금 규칙이 아니다. PUTDUK START와 eligible 첫 출금의 무입금 원칙은 별도 유지한다.

## 안전한 회원 문구

“공개된 테마는 이용 가능한 회원 누구나 고를 수 있어요. 원금 단계가 특정 테마를 잠그지는 않아요.”

“남은 인정 원금이 달라지면 이후 채굴 규모와 동시에 운영할 수 있는 수를 다시 확인해요. 선택한 공개 테마는 그대로 유지해요.”

“원금 회수 검토 중 채굴이 잠시 멈출 수 있어요. 확정 기록과 이용 이력은 보존해요.”

기존 18개 Tier 관련 콘텐츠의 stable slug를 유지하고 원금 해금/자동 대체 의미를 제거했다. 원고는 아직 DRAFT이며 공개/발송 전 실제 command·대상·시각·human review·readback이 필요하다. 상품 Tier unlock domain event를 새로 만들지 않는다.
