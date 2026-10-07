"""Render the current Owner-corrected offline review documents, not runtime UI."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
read = lambda name: json.loads((ROOT / name).read_text())
frac = lambda r: f"{r['numerator']}/{r['denominator']}"


def doc(name, value):
    (ROOT / name).write_text(value.strip() + "\n")


def main():
    economy = read("product-economy-proposal.json")
    launch = read("launch-catalog-proposal.json")
    power = read("tier-mining-power-model.json")
    simulation = read("economy-simulation-results.json")
    candidates = {p["proposal_id"]: p for p in read("product-candidates.json")["candidates"]}
    launch_map = {p["proposal_id"]: p for p in launch["products"]}
    matrix = "| Product | Grade | Personality | Product Speed Modifier | Product Access | Tier Capacity | Market Linked | Policy Status | Scene Status |\n|---|---|---|---|---|---|---|---|---|\n"
    for p in economy["products"]:
        l = launch_map[p["proposal_id"]]
        matrix += f"| {p['product_name_hint_ko']} | {p['grade']} | {p['personality_ko']} | {p['proposed_product_speed_multiplier']} | ALL_ELIGIBLE_MEMBERS | INHERITED | false | PROPOSED_NOT_APPROVED | {'SPEC_REQUIRED + ' if 'SCENE_SPEC_REQUIRED' in l['scene_requirements'] else ''}DESKTOP/MOBILE/BROWSER_QA_REQUIRED |\n"
    doc("PRODUCT-ECONOMY-MATRIX.md", """# 상품 경제 비교 — 열린 상품 선택

Owner correction이 상품 접근 모델의 최신 기준이다. 상품별 최소 Funding Tier, 원금 문턱, Tier 해금은 최종 제안에 없다. P0 6개 + P1 19개는 조건부 출시 제안이며 실제 공개된 25개라는 뜻이 아니다. 전부 effective HOLD, approved modifier null, 시장 연동 false다. 공개·운영 중인 상품은 모든 eligible member가 선택한다.

Grade/personality는 가상 상품 편집·경험 분류다. 기업의 투자등급·수익률·손실 위험 등급이 아니다. Tier 기본 경제가 우선이며 상품 modifier는 보조다. 하나의 global cycle capacity를 상품이나 슬롯 수로 곱하지 않는다. 법무·공식 신원·Scene·command 검증 조건은 그대로다.

""" + matrix)
    tier_table = "| Tier | Eligible Principal (KRW) | Slots | Base Speed / Derived Speed Status | Capacity / Entitlement | Product Access | Retention (conditional bps) |\n|---|---|---|---|---|---|---|\n"
    for t in power["tiers"]:
        upper = t["maximum_eligible_principal_krw"]
        amount = f"{int(t['minimum_eligible_principal_krw']):,}–{int(upper):,}" if upper else f"{int(t['minimum_eligible_principal_krw']):,} 이상"
        tier_table += f"| {t['tier']} {t['name']} | {amount} | {t['slots']} | TIER_SPEED_CONTRACT_REQUIRED / 중립 기준 유도 가능 | 인정 원금 × SSOT baseCycleRateBps / 10000, GLOBAL_CYCLE | ALL_PUBLISHED_PRODUCTS | {t['retention_bonus_bps']} |\n"
    doc("TIER-MINING-POWER-MODEL.md", """# Funding Tier 채굴 규모 모델

상품 선택은 열려 있고, 채굴 규모는 Tier의 경제 조건을 따른다. 인정 원금 → Funding Tier → Tier 기본 속도 → capacity/entitlement → 공개 상품 선택 → 상품 modifier → user/event/temporary modifiers → 최종 1.50 cap 한 번 → Reward Producer → Pending → Settlement → Verified 순서다.

실제 SSOT는 `docs/product/economy-v1-approved-2026-10-03.json`이다. 14개 구간·slots·retention 값을 그대로 읽었다. 문서 승인과 실제 live publication은 별개이며 server receipt/effective timestamp는 UNKNOWN이다. source SHA256과 read-only engine/test/provenance 해시는 tier-mining-power-model.json에 있다.

""" + tier_table + """

## 확인 가능한 기본 규모와 미정 속도

SSOT에 별도의 Tier base speed multiplier 필드나 서로 다른 Tier 속도 배율 derive rule은 없다. 모든 Tier의 값은 null / TIER_SPEED_CONTRACT_REQUIRED다. 같은 배율 1.00을 새 Tier 승인값으로 채우거나 retentionBonusBps를 속도 배율로 바꾸지 않는다.

기존 read-only funding-entitlement preview는 중립 효과에서 `principal × microKrwPerKrw × baseCycleRateBps / 10000`의 기본 global cycle capacity를 만들고, full allocation의 기본 일일 기준은 그 capacity / cycleDays다. 현재 승인 문서는 1500bps와 30일을 사용한다. 이는 문서·preview 산술 근거이며 새 수익률·실제 지급 보장·live 보상 예상이 아니다. 비기본 modifier 효과는 현재 EFFECT_SCOPE_UNRESOLVED다.

인정 원금은 누적 입금액이 아니라 출처가 확인된 남은 원금이다. 채굴보상·Bonus·체험·active principal HOLD 금액을 포함하지 않는다. 같은 조건에서 원금이 늘면 중립 절대 기본 rate와 capacity는 비례 증가한다. slot 수는 1→2→3→4→5로 비감소하지만 모든 Tier마다 증가하지는 않는다. retention bps도 plateau가 있으며 별도 조건 충족 전에는 settlement-ready 기본 보상에 더하지 않는다.

상품 modifier 1.00–1.10은 PUTDUK 내부 운영 제안이며 시장 수익률이 아니다. 기본 capacity는 modifier와 무관하다. Tier별 고유 speed 효과와 retention portion 적용 범위는 Primary 계약이 필요하다. `final 1.50`은 product×user×event×temporary의 상대 modifier를 정확히 곱한 뒤 한 번 제한한다. 절대 KRW rate나 큰 Tier의 원금·capacity를 1.50으로 잘라내는 규칙이 아니다.

## Tier 하향과 원금 HOLD

Tier가 내려가도 선택한 공개 상품 자체를 잠그거나 교체하지 않는다. 서버 조건 변경 시각 이후의 base speed·capacity·slots·future accrual만 새 Tier 기준으로 재평가한다. 상품 접근권 때문에 PAUSE하지 않는다.

원금 withdrawal HOLD = PAUSE_NOT_RESET을 유지한다. history / eligible age / current cycle / used capacity / fractional carry / verified ledger를 보존한다. 감소한 capacity보다 이미 사용량이 커도 과거 확정 금액을 회수하거나 reset하지 않으며 새 accrual만 한도 내에서 제한한다. 정지 시간 catch-up이나 자동 상품 대체는 없다.

slot 감소 시 어떤 기존 allocation을 유지·정지할지는 PRIMARY_CONTRACT_REQUIRED다. 이 제안은 속도순·생성순 등 임의 선택 규칙을 만들지 않는다. 한도를 초과한 allocation은 실제 권위의 처리가 확인될 때까지 승인 가능 상태로 주장하지 않는다. 일반 계정 자격·safe mode·publication/availability guard는 독립적으로 유지한다.
""")
    doc("PRODUCT-ACCESS-POLICY.md", """# 상품 접근 정책 — Owner correction

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
""")
    comparison_table = "| Tier | 기준 인정 원금 (KRW) | Slots | 기본 capacity (micro KRW, exact) | 중립 기본 일일 rate (micro KRW, exact) | 공개 상품 접근 | 고유 Tier speed |\n|---|---|---|---|---|---|---|\n"
    for t in simulation["tiers"]:
        comparison_table += f"| {t['tier']} | {int(t['reference_eligible_principal_krw']):,} | {t['slots']} | {frac(t['base_capacity_micro_krw'])} | {frac(t['neutral_daily_base_micro_krw'])} | ALL_PUBLISHED_PRODUCTS | TIER_SPEED_CONTRACT_REQUIRED |\n"
    doc("ECONOMY-SIMULATION.md", """# 경제 시뮬레이션 — 상품 선택과 Tier 규모 분리

기존 Tier-gated concentration simulation은 SUPERSEDED_BY_OWNER_CORRECTION이며 최종 추천에서 제거했다. 과거 evidence/economy-simulation.json은 변경하지 않고 원본 archive도 보존한다. 현재 결과는 schema3의 economy-simulation-results.json과 evidence/owner-economy-simulation.json이다. 실제 지급·서버 정책 활성화·회원 행동·등록 증거가 아니다.

14개 Tier × 25개 상품 = 350개 조건부 비교, Gold/NVIDIA 동일 상품의 14개 Tier 비교, 동일 Tier 내 상품 배율 비교, Tier minimum 원금 규모 vs product modifier, 슬롯별 전체 allocation, user/event/temporary, 최종 cap 한 번을 확인한다. 모든 결과는 BigInt·정확한 rational이다. 시장가격 입력 0, live 정책 확인 false, 실제 effective daily reward null이다.

## 동일 상품의 Tier별 규모

아래는 SSOT 구간의 최소 원금을 사용한 중립 full-allocation 참고 산술이다. Tier별 고유 속도 배율은 미정이며 값 null이다. conditional retention은 표 기본 capacity/rate에 포함하지 않는다. 각 구간 안에서도 실제 남은 원금에 비례하며 대표 최소값을 Tier 고정 capacity로 저장하지 않는다.

""" + comparison_table + """

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
""")
    doc("ECONOMY-MODEL-COMPARISON.md", """# 경제 모델 비교 — Owner correction 적용

현재 추천은 Policy A + OPEN PRODUCT CHOICE + Tier mining power + inherited global capacity + secondary product modifier, 1.00–1.10이다. 기존 Policy A + Tier gate는 SUPERSEDED_BY_OWNER_CORRECTION이다.

| 모델 | 현재 판단 | 이유 |
|---|---|---|
| A: 열린 상품 접근 + 공통 global capacity + product modifier | 조건부 추천 | Owner 방향에 맞음. Tier speed/effect 계약과 상품값 승인은 미정 |
| B: 상품별 capacity 차등 | 추천하지 않음 | 상품이 원금 기반 지급 한도를 바꾸며 승인되지 않음 |
| C: 모든 상품 modifier1.00, personality 중심 | 비교안만 | 임의 적용하지 않음. Owner는 modifier 유지 가능 |
| 과거 Tier별 상품 해금 | SUPERSEDED_BY_OWNER_CORRECTION | 상품 선택은 열려 있으며 Tier는 채굴 규모를 정함 |

SSOT의 기본 capacity와 중립 절대 rate는 인정 원금에 비례한다. 상품 modifier는 capacity를 바꾸지 않는다. 고유 Tier base speed 규칙은 TIER_SPEED_CONTRACT_REQUIRED이며 높은 Tier의 모든 경계 우위를 자동 가정하지 않는다. PRODUCT-ACCESS-POLICY.md와 TIER-MINING-POWER-MODEL.md가 현재 기준이다.
""")
    catalog_table = "| 상품 | Asset | 계획 Wave | 실제 신원 | 실제 공개 | Product access (if published) |\n|---|---|---|---|---|---|\n"
    for p in economy["products"]:
        c = candidates[p["proposal_id"]]
        catalog_table += f"| {p['product_name_hint_ko']} | {c['asset_class']} | {c['proposed_wave']} | {c['identity_status']} | HOLD / LIVE_DB_UNKNOWN | ALL_ELIGIBLE_MEMBERS |\n"
    doc("PRODUCT-CATALOG-PROPOSAL.md", "# 조건부 출시 카탈로그 — Owner correction\n\nP0 6개 + P1 19개, 총25개 조건부 제안이다. 후보55개: VERIFIED13/PARTIAL31/UNKNOWN11. 공식 신원·법무·Scene·등록 검증은 그대로 필요하다. 상품별 최소 Tier/해금은 없다. Grade·modifier 값은 아직 승인 전이고 모든 effective wave는 HOLD다.\n\n" + catalog_table)
    doc("LAUNCH-WAVE-PLAN.md", "# 조건부 공개 계획\n\nP0 6 / P1 19 / P2 24 / HOLD4 / REJECT2, 일정 미정이다. 기존 신원·법무·정책·command·LOCAL readback/render/rollback·Scene QA entry gates를 유지한다. 이 gate는 운영자의 공개 준비 검증이며 회원 Funding Tier별 상품 잠금이 아니다.\n\nP0는 신원 VERIFIED만, P1 PARTIAL은 공식 상세 확인 전 공개 금지다. 현재 실제 effective wave는 모든 후보 HOLD이고 LIVE DB는 UNKNOWN이다. 공개·운영 중인 모든 상품의 product_access_policy는 ALL_ELIGIBLE_MEMBERS다. 원금 Tier가 상승했다고 특정 상품이 해금되거나, 하향했다고 선택 상품이 잠기지 않는다.\n\n상세는 launch-wave-plan.json / PRODUCT-CATALOG-PROPOSAL.md / PRODUCT-ACCESS-POLICY.md를 읽는다.")
    doc("PRODUCT-COPY.md", "# 상품 원고 — DRAFT / 열린 상품 선택\n\n아래는 승인·등록·발송 전 원고다. 상품 speed 제안을 실제 적용값으로 안내하지 않는다. 원금 단계별 테마 잠금이 없음을 명시한다.\n\n" + "\n\n".join(f"## {p['title_ko']}\n\n{p['body_ko']}\n\nCTA: {p['cta']['label']} → {p['cta']['route']}" for p in read("product-copy.json")))
    mapping = (ROOT / "evidence/superseded-tier-gate/CONTRACT-MAPPING.md").read_text().split("## 새 Tier metadata의 정확한 Primary 요구")[0]
    mapping = mapping.replace("새 Tier gate와 미정 효과 scope 때문에", "미정 효과 scope와 Tier speed 계약 때문에")
    doc("CONTRACT-MAPPING.md", mapping + """

## Owner correction 이후 Primary 요구

1. 공개·사용 가능 catalog와 eligible member를 기존 server 권위에서 확인한다. 상품별 최소 Funding Tier, product unlock, Tier 하향 상품 PAUSE 계약은 만들지 않는다. 과거 PRODUCT-TIER-ELIGIBILITY 요구는 SUPERSEDED_BY_OWNER_CORRECTION이다.
2. Funding SSOT에 없는 Tier base speed / derive rule은 TIER_SPEED_CONTRACT_REQUIRED다. 기존 원금 기반 capacity·중립 rate·slots·별도 retention 근거를 유지하면서 정확한 Tier speed 계약을 Owner와 Primary가 확정한다. slot/product별 capacity 증식은 금지한다.
3. Tier 하향 후 상품 선택은 유지한다. 조건 변경 시각 이후 Tier economics만 재평가한다. slot 감소 시 유지·정지 allocation 선택은 PRIMARY_CONTRACT_REQUIRED다. 이 lane은 임의 우선순위·자동 대체·reset을 제안하지 않는다.
4. 원금 withdrawal HOLD PAUSE_NOT_RESET, history/eligible age/cycle/used/carry/verified ledger 보존, capacity below used의 새 accrual 제한을 검증한다. 실제 시각·source revision·policy receipt는 서버만 결정한다.
5. product/user/event/temporary의 portion·적용 시각·scope와 cap once를 기존 engine에 연결한다. Tier base economics는 먼저 결정하며 final1.50는 상대 modifier에 적용한다. retention에 임의 배율을 적용하거나 절대 Tier rate를1.50으로 clamp하지 않는다.
6. safe member projection은 공개 테마 선택과 채굴 규모/슬롯 조건을 구분한다. 공개·HOLD·서버 eligibility 확인 없이 알림을 보내지 않는다. 과거 stable slug의 unlock 단어는 편집 ID일 뿐 Tier unlock event가 아니다.

현재 JSON은 offline proposal metadata이며 runtime registration DTO가 아니다. 이 lane은 기존 권위·schema·API·engine·UI를 바꾸지 않는다.
""")
    doc("TIER-CONTENT-DELTA.md", """# 운영 콘텐츠 수정 — 상품 접근 Owner correction

기존 event21KEEP/5REWRITE/3MERGE/1DROP/ADD10, notice22KEEP/4REWRITE/ADD8 감사 결과는 보존한다. 이전 Tier delta event1/notice4/FAQ6/support3/notification4, 총18개 stable slug는 그대로 유지하면서 원고와 metadata를 수정했다. 합산 additions는 event11/notice12/FAQ22/support11/notification12다.

모든 공개 테마 선택, Tier는 채굴 규모/동시 운영 수, 원금 하향 시 테마 잠금 없음, HOLD PAUSE_NOT_RESET, 이력 보존을 설명한다. Tier 해금·입금 유도·강제 대체 의미와 requires_authoritative_eligibility_event는 제거했다. actual publication/account/HOLD/approved condition event를 기존 권위에서 읽은 경우에만 전달하도록 trigger 요구를 분리한다.

18개 과거 원고가 포함된 원본 additions 파일은 exact HEAD archive에 보존했다. stable slug의 catalog-tier/unlock 문자열은 역사적 편집 ID이며 Tier 해금 계약이 아니다. revised draft metadata가 ALL_ELIGIBLE_MEMBERS와 SUPERSEDED_BY_OWNER_CORRECTION을 기록한다. 현재 원고 모두 DRAFT, 승인 pending, 등록/발송0이다. 상품 modifier·임의 Bonus·원금 문턱을 원고에 넣지 않았다.
""")
    doc("README.md", """# PUTDUK catalog 운영 패키지 — Owner correction 적용

상품 선택은 열려 있고 채굴 규모는 Funding Tier를 따른다. 현재 기준은 PRODUCT-ACCESS-POLICY.md, TIER-MINING-POWER-MODEL.md, PRODUCT-ECONOMY-MATRIX.md, INTEGRATION-HANDOFF.md다. 과거 Tier 상품 해금은 SUPERSEDED_BY_OWNER_CORRECTION이다.

25개 조건부 P0/P1 product access = ALL_ELIGIBLE_MEMBERS, Tier product access = ALL_PUBLISHED_PRODUCTS다. modifier1.00–1.10 제안은 유지하고 approved값은 null이다. 실제 effective wave는 전부 HOLD, LIVE_DB_UNKNOWN이다. 조사 근거13VERIFIED/31PARTIAL/11UNKNOWN은 그대로다. 별도 Tier 기본 속도 계약은 TIER_SPEED_CONTRACT_REQUIRED다.

변경 범위는 catalog-ops/** ONLY. shared/backend/member/Admin/Scene/runtime/SSOT/package/lock/workflow 변경 없음. 실제 등록/SQL/RPC/발송/Production 없음. frozen3개 lane 유지.

```sh
source /workspace/.putduk-cloud-tools/activate.sh
python catalog-ops/owner-correction.py
node catalog-ops/economy-simulate.mjs
python catalog-ops/report-owner-correction.py
node catalog-ops/validate.mjs
node --test --test-reporter=tap catalog-ops/validate.test.mjs catalog-ops/research.test.mjs catalog-ops/finalize.test.mjs catalog-ops/owner-correction.test.mjs
git diff --check
node catalog-ops/verify-handoff.mjs --require-pushed --require-clean
```

owner-correction.py는 독립 offline generator이며 DB·network 접근이 없다. 과거 finalize-catalog/report-finalize/tier-content-delta/build generators는 현재 access artifact가 있을 때 종료해서 폐기된 상품 잠금을 다시 만들지 않는다. research-fetch/audit historical generators도 자동 재실행하지 않는다. 추가 공식 조사만 research-extend와 검토된 원본 근거를 사용한다.

과거108개 tests는 exact8f68 SHA, 과거 Tier100개 tests는 exact7837324 SHA를 재현한다. 현재 research6개와 owner-correction tests가 현재 파일을 검증한다. exact counts/exit code는 evidence/owner-correction-test-summary.json, TAP는 evidence/owner-correction-tests.tap에 기록한다. 과거214tests evidence를 현재 모델 통과 증거로 오해하지 않는다.

Node24.21.0/pnpm12.6.0, formatter는 manifest-pinned Prettier3.9.9를 node node_modules/prettier/bin/prettier.cjs로 직접 실행한다. archive는 byte-identity 보존 대상이므로 재포맷하지 않는다. DB/API secret이나 새 dependencies가 필요 없는 workflow다. full CI/실제 DB/browser검증은 Primary 소유다.
""")
    doc("INTEGRATION-HANDOFF.md", """# Primary 인계 — 열린 상품 접근 / Tier mining power

CURRENT BRANCH: parallel/catalog-product-ops

BASE SHA: 0a7e95ba8bf55539fe32fd6f4654ee49a0be226d (origin/develop 재확인)

OWNER CORRECTION START: 783732492e70c312b33640e07ee0d8ffad68c3e5

EXACT HEAD: node catalog-ops/verify-handoff.mjs --require-pushed --require-clean과 최종 사용자 보고가 현재 전체 SHA·실제 원격 tip을 기록한다. 역사 rewrite/rebase/merge/PR 없음.

## 최신 정책 방향

Owner가 상품 Tier 잠금 해석을 수정했다. 공개·운영 중인 모든 상품은 모든 eligible member가 선택한다. L1도 공개된 NVIDIA/Tesla/SK hynix/SpaceX/BTC/ETF를 고를 수 있다. Funding Tier는 채굴 기본 경제·global capacity/entitlement·동시 슬롯·원금 규모를 정한다. 상품은 personality/Scene/보조 modifier/경험을 제공한다.

상품별 minimum_funding_tier, Tier product unlock, L13 NVIDIA/L14 SpaceX 제한, downgrade product ineligibility/PAUSE는 SUPERSEDED_BY_OWNER_CORRECTION이다. 28개 exact-byte 과거 파일과 기존 commit/evidence/history를 보존했다. 현재 JSON과 표에는 해당 gate가 없다. 과거 Tier100tests는 historical exact7837324 모델 재현용이며 current Owner 정책 테스트가 아니다.

## 산출물과 실제 한계

| 항목 | 현재 상태 |
|---|---|
| 조건부 출시 | P0 6 + P1 19 =25, effective all HOLD / LIVE_DB_UNKNOWN |
| 상품 접근 | ALL_ELIGIBLE_MEMBERS; 모든 Tier ALL_PUBLISHED_PRODUCTS |
| product economics | 기존25개 personality·grade·1.00–1.10 제안 유지, approved null, market_linked=false |
| Tier SSOT | 14개 원금 구간·slot·retention unchanged; 문서 OWNER_APPROVED, live receipt UNKNOWN |
| Tier base speed | TIER_SPEED_CONTRACT_REQUIRED, 모든 multiplier null; 원금 기반 중립 절대 rate만 유도 |
| capacity | 하나의 global cycle, 인정 원금 비례, product/slot multiplier 없음 |
| retention | 별도 조건·qualification, base/settlement-ready에 합산하지 않음 |
| 하향 | 상품 선택 유지, future Tier economics 재평가; slot 감소 배분 PRIMARY_CONTRACT_REQUIRED |
| HOLD | PAUSE_NOT_RESET, history/age/cycle/used/carry/verified ledger 보존 |
| simulation | 350Tier×product 조건부 비교 + 동일 상품/슬롯/scale/cap once; 실제 보상 값null |
| 연구 | 실제97requests/76HTTP200/29identity sources; VERIFIED13/PARTIAL31/UNKNOWN11 unchanged |
| Scene | 신규16spec, 모든25desktop/mobile/browser QA 필요; 이미지/registry 변경0 |
| 원고 | 기존18Tier 관련 draft를 같은 slug로 수정, 공개선택·채굴규모 분리; 등록/발송0 |
| 등록 | catalog/content approved command NOT_FOUND; LOCAL/readback/render/rollback BLOCKED/UNRUN |
| 검증 | current Owner tests + 역사 replay + current research, exact TAP/count/exit code 별도 evidence |

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
""")


if __name__ == "__main__":
    main()
