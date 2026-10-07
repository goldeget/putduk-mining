# Primary 인계 — 열린 상품 접근 / Tier mining power

CURRENT BRANCH: parallel/catalog-product-ops

BASE SHA: 0a7e95ba8bf55539fe32fd6f4654ee49a0be226d (origin/develop 재확인)

OWNER CORRECTION START: 783732492e70c312b33640e07ee0d8ffad68c3e5

EXACT HEAD: node catalog-ops/verify-handoff.mjs --require-pushed --require-clean과 최종 사용자 보고가 현재 전체 SHA·실제 원격 tip을 기록한다. 역사 rewrite/rebase/merge/PR 없음.

## 최신 정책 방향

Owner가 상품 Tier 잠금 해석을 수정했다. 공개·운영 중인 모든 상품은 모든 eligible member가 선택한다. L1도 공개된 NVIDIA/Tesla/SK hynix/SpaceX/BTC/ETF를 고를 수 있다. Funding Tier는 채굴 기본 경제·global capacity/entitlement·동시 슬롯·원금 규모를 정한다. 상품은 personality/Scene/보조 modifier/경험을 제공한다.

상품별 minimum_funding_tier, Tier product unlock, L13 NVIDIA/L14 SpaceX 제한, downgrade product ineligibility/PAUSE는 SUPERSEDED_BY_OWNER_CORRECTION이다. 28개 exact-byte 과거 파일과 기존 commit/evidence/history를 보존했다. 현재 JSON과 표에는 해당 gate가 없다. 과거 Tier100tests는 historical exact7837324 모델 재현용이며 current Owner 정책 테스트가 아니다.

## 산출물과 실제 한계

| 항목              | 현재 상태                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------- |
| 조건부 출시       | P0 6 + P1 19 =25, effective all HOLD / LIVE_DB_UNKNOWN                                        |
| 상품 접근         | ALL_ELIGIBLE_MEMBERS; 모든 Tier ALL_PUBLISHED_PRODUCTS                                        |
| product economics | 기존25개 personality·grade·1.00–1.10 제안 유지, approved null, market_linked=false            |
| Tier SSOT         | 14개 원금 구간·slot·retention unchanged; 문서 OWNER_APPROVED, live receipt UNKNOWN            |
| Tier base speed   | TIER_SPEED_CONTRACT_REQUIRED, 모든 multiplier null; 원금 기반 중립 절대 rate만 유도           |
| capacity          | 하나의 global cycle, 인정 원금 비례, product/slot multiplier 없음                             |
| retention         | 별도 조건·qualification, base/settlement-ready에 합산하지 않음                                |
| 하향              | 상품 선택 유지, future Tier economics 재평가; slot 감소 배분 PRIMARY_CONTRACT_REQUIRED        |
| HOLD              | PAUSE_NOT_RESET, history/age/cycle/used/carry/verified ledger 보존                            |
| simulation        | 350Tier×product 조건부 비교 + 동일 상품/슬롯/scale/cap once; 실제 보상 값null                 |
| 연구              | 실제97requests/76HTTP200/29identity sources; VERIFIED13/PARTIAL31/UNKNOWN11 unchanged         |
| Scene             | 신규16spec, 모든25desktop/mobile/browser QA 필요; 이미지/registry 변경0                       |
| 원고              | 기존18Tier 관련 draft를 같은 slug로 수정, 공개선택·채굴규모 분리; 등록/발송0                  |
| 등록              | catalog/content approved command NOT_FOUND; LOCAL/readback/render/rollback BLOCKED/UNRUN      |
| 검증              | current Owner tests + 역사 replay + current research, exact TAP/count/exit code 별도 evidence |

인정 원금이 증가하면 같은 상품·조건의 중립 기본 capacity/rate가 증가하고 slots는 비감소 단계로 늘어난다. 고유 Tier speed 필드는 없다. L2 minimum Gold vs L1 minimum NVIDIA의 capacity5배/참고rate50/11만으로 모든 경계의 속도 우위를 주장하지 않는다. L1 upper NVIDIA vs L2 lower Gold에서는 modifier가 작은 원금 차이를 앞설 수 있다. Tier 경제가 우선이라는 Owner 의도를 검증하려면 TIER_SPEED_CONTRACT_REQUIRED를 해결해야 한다. 상품 잠금이나 숫자 발명으로 보완하지 않는다.

## Primary 통합 요구

1. 실제 SSOT·provenance·공개 catalog·member eligibility·policy receipt를 기존 서버 권위에서 연결한다. 상품 Tier gate는 추가하지 않는다. 공식 신원 PARTIAL31/UNKNOWN11·법무/브랜드 gate를 유지하고 확인 전 공개하지 않는다.
2. 고유 Tier base speed/derive rule, absolute rate와 상대 modifier의 경계, portion/retention scope/effective boundary를 확정한다. 값과 정책 version/digest/receipt는 별도 승인 전 null/UNKNOWN이다.
3. Tier 하향 시 선택 상품을 유지하면서 future economics 재평가한다. slot 감소 후 allocation 유지/정지 처리 계약을 정하고 exact server timestamp·source revision·global≤10000bps·사용량/carry/원장 보존을 검증한다. 임의 winner나 자동 대체는 없다.
4. product×user×event×temporary exact 곱 뒤 final1.50 cap을 한 번만 적용한다. Tier 절대 기본 rate/capacity clamp가 아니다. safe mode/HOLD/비자격 guard, no reset/no catch-up, conditional retention 분리를 검증한다.
5. 기존 catalog/content command 및 ETF category·공개 projection·FAQ/macro/body/CTA·delivery 계약 부재를 해결한다. 실제 DTO와 metadata를 구분한다. AI 준비 → 사람 검토 → 정확한 영향 미리보기 → 확인 → 서버 권한 검증 → 감사 원칙을 유지한다.
6. approved command가 생긴 이후에만 isolated LOCAL 실제ID/readback/Member/Admin render/cancel/archive/rollback와 역할·세션·revision/idempotency를 검증한다. Production 등록은 별도 사용자 승인 전 금지다. Scene25개 QA와 member UI/shared engine 변경은 Primary lane에서 수행한다.

세 frozen branch는 Admin f9b454a7c1b86dde1099b6e5a264092118258ead, launch-ops ba9ed931f756488ce4f67f945cffad9552842c09, Scene505e20c097be8de1b5d02bc65a2dcbd054fe56d1을 그대로 보존한다. catalog-ops/** 외 수정 없음. final integration/full CI/출시는 Primary 소유다.

Cloud 시작 지시도 Owner correction으로 교체한다. 기존 install/versions/network/secrets는 보존한다. Save는 runtime apply/Publish가 아니다. 저장 결과와 requires_publish는 evidence/owner-correction-cloud-save.json에 기록한다. 네트워크 조사 범위는 변경하지 않고 이전 응답/blocked 상태를 새 검증 PASS라고 재분류하지 않는다.

READY FOR PRIMARY REVIEW: YES

READY FOR PRODUCTION: NO — Tier speed/slot/effect contracts, official details/legal, approved commands and actual product QA unresolved.
