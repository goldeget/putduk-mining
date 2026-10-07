# 실제 이미지 제작 순서

현재 상태: **CREATIVE BRIEFS READY / APPROVED LAUNCH CATALOG UNKNOWN / ACTUAL IMAGES UNRUN**.
이미지 22장을 만들어 본 결과가 아니라 11개 저장소 후보에 대한 생산 대기열이다.
GPT Image Generation은 creative draft 검토용으로 시작할 수 있다. 실제 출시 등록은 catalog/법무/시각/런타임 gate 이후다.

## Wave 1 — provisional first-view + fidelity reference

P0 확정 목록은 UNKNOWN. 아래 P1 후보 순서는 seed display_order/featured/trial flag와 기존 art의 검토 효율을 근거로 제안한다.
운영자가 승인 목록에서 제외하면 해당 제작을 보류한다. 승인 없는 상품을 회원에게 활성화하지 않는다.

| UUID | 코드 / 이름 | 제작 근거 |
| --- | --- | --- |
| 30000000-0000-4000-8000-000000000001 | 005930 삼성전자 테마 | seed order=1, featured=true, trial_available=true; 현재 별도 art 없음 |
| 30000000-0000-4000-8000-000000000002 | 000660 SK하이닉스 테마 | 유일한 승인 family 방향을 실제 새 비율/portrait 품질 기준으로 비교 가능 |
| 30000000-0000-4000-8000-000000000003 | AAPL 애플 테마 | seed featured=true, US 첫 후보; foundry/HBM와 다른 precision identity 필요 |
| 30000000-0000-4000-8000-000000000006 | XAU 골드 테마 | seed featured=true, commodity 세계의 재료/정련 차별화 |
| 30000000-0000-4000-8000-000000000008 | BTC 비트코인 테마 | seed featured=true, crypto 첫 후보; hash forge 차별화 |

5개 × desktop/mobile = 10 prompts. flag는 DRAFT proposal이며 실제 출시 hero 승인이나 mining 선택 증거가 아니다.

## Wave 2 — remaining repository candidates, enabled status UNKNOWN

| UUID | 코드 / 이름 | 핵심 차별화 |
| --- | --- | --- |
| 30000000-0000-4000-8000-000000000004 | MSFT 마이크로소프트 테마 | multi-hall cloud atrium, optical bridges |
| 30000000-0000-4000-8000-000000000005 | NVDA 엔비디아 테마 | copper cold plate, coolant, GPU rack canyon |
| 30000000-0000-4000-8000-000000000007 | XAG 실버 테마 | silver crystal, electrorefining; gold furnace와 다름 |
| 30000000-0000-4000-8000-000000000009 | ETH 이더리움 테마 | optical validator prism and spatial node graph |
| 30000000-0000-4000-8000-000000000010 | BNB BNB 테마 | ceramic multi-lane routing switchyard |
| 30000000-0000-4000-8000-000000000011 | XRP XRP 테마 | two-terminal relay bridge |

6개 × desktop/mobile = 12 prompts. 모두 출시 시 selectable하다고 주장하지 않는다.

## Wave 3 — 확인된 future/disabled 목록 없음

확정 UUID 없음. 실제 future/disabled 후보는 운영자 snapshot이 제공되면 새 감사 후 추가한다.
AUTO_MOBILITY, ENERGY_OIL, FINANCE_CAPITAL, BIO_HEALTH, CONSUMER_RETAIL, ETF_BASKET 등의
제품 없는 registry seam만 보고 가짜 상품을 만들지 않는다. Tesla도 이 wave에 몰래 추가하지 않는다.

## 한 상품의 실제 생산 절차

1. inventory 신원/출처와 운영자 승인 대상 여부를 확인한다. 미승인이라면 preview draft로만 기록한다.
2. 해당 desktop prompt의 positive/negative/composition/safe zone 조건을 모두 함께 전달한다.
3. raw lossless output의 actual tool/time/version/hash를 기록하고 acceptance checklist로 직접 평가한다.
4. 약한 material/space/hero 또는 generic swap이면 실패 원인을 prompt regeneration_reasons에 붙이고 다시 생성한다.
5. desktop와 같은 story의 전용 portrait prompt를 실행한다. 단순 중앙 crop으로 hero와 경로를 지우지 않는다.
6. 두 master를 비교하고 실제 pixels 기준 anchor/target/safe zone을 다시 측정한다. 제안 좌표는 측정 증거가 아니다.
7. 법무/브랜드와 operator review를 각각 남긴다. production approval은 이미지 생성 그 자체가 아니다.
8. Primary에게 reviewed asset bundle을 전달한다. 현재 승인 clean master는 덮어쓰지 않는다.

생성 tool은 이미지 내 실제 financial state를 만들지 않는다. 모든 숫자/상태는 Primary의 실제 React/HTML과 정본 read model이 표시한다.
현재 재생성 0은 이미지 품질 합격이 아니라 아직 실패작을 평가하지 않았다는 뜻이다.
