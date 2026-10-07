"""Continue the researched package with non-active Tier/economy proposals.

Reads the approved repository document and existing draft. Never writes any
application, financial policy, source ledger, SceneRegistry or remote record.
"""
# OWNER_CORRECTION_GENERATOR_GUARD
from pathlib import Path as _OwnerPath
if __name__ == "__main__" and (_OwnerPath(__file__).parent / "product-access-policy.json").exists():
    raise SystemExit("SUPERSEDED_BY_OWNER_CORRECTION: use owner-correction.py; do not regenerate the rejected Tier access model or overwrite reviewed evidence")

import collections
import copy
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parent


def read(name):
    return json.loads((ROOT / name).read_text())


def write(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


# Ordered pairs determine editorial progression, not an investment valuation.
STAGES = [
    [("gold", "1.00"), ("silver", "1.01"), ("spy", "1.01"), ("kb-financial", "1.01")],
    [("lg-electronics", "1.03"), ("schd", "1.03")],
    [("apple", "1.04"), ("naver", "1.04")],
    [("hyundai-motor", "1.05"), ("microsoft", "1.05")],
    [("lg-energy-solution", "1.06"), ("amazon", "1.06")],
    [("samsung-electronics", "1.07"), ("soxx", "1.07")],
    [("ethereum", "1.08"), ("alphabet-a", "1.08")],
    [("qqq", "1.09"), ("solana", "1.09")],
    [("bitcoin", "1.09")],
    [("sandisk", "1.09")],
    [("sk-hynix", "1.10"), ("tesla", "1.10")],
    [("rocket-lab", "1.10")],
    [("nvidia", "1.10")],
    [("spacex", "1.10")],
]
NEW = {
    "lg-electronics": ("DEVICE_LINK", "생활 기기 연결형", "서로 다른 생활 기기 모듈 검사실", "은색·청록", "무표식 가전 모듈 사이의 짧은 상태 신호", "한국 생활 산업 분산"),
    "spacex": ("ORBITAL_LINK", "궤도 연결형", "궤도 통신 장치 점검 공간", "짙은 청색·백색", "고정된 통신 모듈을 잇는 국소 검사광", "우주 통신 주제 분산"),
}


if __name__ == "__main__":
    policy_path = REPO / "docs/product/economy-v1-approved-2026-10-03.json"
    policy_bytes = policy_path.read_bytes()
    policy = json.loads(policy_bytes)
    candidates, waves = read("product-candidates.json"), read("launch-wave-plan.json")
    economy, launch, copies = read("product-economy-proposal.json"), read("launch-catalog-proposal.json"), read("product-copy.json")
    old_e = {p["slug"]: p for p in economy["products"]}
    old_l = {p["slug"]: p for p in launch["products"]}
    old_c = {p["proposal_id"]: p for p in copies}
    for p in candidates["candidates"]:
        if p["slug"] in NEW:
            p["previous_proposed_wave"] = "P2_LATER" if p["slug"] == "lg-electronics" else "HOLD"
            p["proposed_wave"] = "P1_LAUNCH_EXPANSION"
            p["classification_reason_ko"] = "현재 공식 근거를 읽은 후 조건부 출시 제안에 승격. 생활 기기/우주 통신 장면 대비를 추가하며 미확인 상장 세부·법무·정책·Scene gate는 계속 HOLD."
        elif p["slug"] == "meta":
            p["previous_proposed_wave"] = "P1_LAUNCH_EXPANSION"
            p["proposed_wave"] = "P2_LATER"
            p["classification_reason_ko"] = "SEC 신원은 확인했으나 정보/연결 테마와의 중복 및 25개 출시 제작 부담을 고려해 후속 편성 제안. 실제 기업의 투자 등급 판단이 아니다."
        elif p["proposed_wave"] == "P0_LAUNCH_CORE" and p["identity_status"] != "PUBLIC_MARKET_VERIFIED":
            p["previous_proposed_wave"] = "P0_LAUNCH_CORE"
            p["proposed_wave"] = "P1_LAUNCH_EXPANSION"
            p["classification_reason_ko"] = "현재 공식 신원 세부 확인이 PARTIAL이므로 P0 확정 후보에서 P1 조건부 조사로 이동. 전체 25개 품질 제안에는 유지하지만 확인 전 공개 금지."
    cmap = {p["slug"]: p for p in candidates["candidates"]}
    eligibility, rows_e, rows_l, rows_c = [], [], [], []
    for ordinal, stage in enumerate(STAGES, 1):
        for slug, speed in stage:
            p = cmap[slug]
            assert p["proposed_wave"] in ("P0_LAUNCH_CORE", "P1_LAUNCH_EXPANSION")
            e = copy.deepcopy(old_e.get(slug, old_e["naver"]))
            l = copy.deepcopy(old_l.get(slug, old_l["naver"]))
            c = copy.deepcopy(old_c.get(p["proposal_id"], next(iter(old_c.values()))))
            bps = int(speed.replace(".", "")) * 100
            grade = "C" if bps <= 10200 else "B" if bps <= 10500 else "A" if bps <= 10800 else "S"
            e.update(proposal_id=p["proposal_id"], slug=slug, product_name_hint_ko=p["name_hint_ko"],
                     proposed_wave=p["proposed_wave"], grade=grade, proposed_product_speed_multiplier=speed,
                     proposed_product_speed_bps=bps, approved_product_speed_multiplier=None,
                     minimum_funding_tier=f"L{ordinal}", minimum_eligible_principal="DERIVED_FROM_TIER",
                     unlock_policy="FUNDING_TIER", existing_policy_compatibility="WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED",
                     speed_rationale_ko=f"가상 카탈로그의 선택 폭을 단계적으로 늘리는 {speed} 제안. 시장가격·배당·기업 실적과 무관하다. 동일 단계 및 상위 풀의 비슷한 속도 선택지를 유지하며 capacity는 증가시키지 않는다.",
                     policy_version_change_required=True,
                     risk_flags=["PROPOSAL_NOT_ACTIVE", "NON_DEFAULT_EFFECT_SCOPE_UNRESOLVED", "LOWER_PRODUCT_SPEED_ONLY_DOMINANCE", "HIGH_THRESHOLD_ACCESSIBILITY_REVIEW", "LEGAL_BRAND_REVIEW_REQUIRED"])
            if slug in NEW:
                personality, ko, scene, color, motion, role = NEW[slug]
                e.update(mining_personality=personality, personality_ko=ko, catalog_role=role)
                keywords = [scene, color, motion]
            else:
                keywords = old_l[slug]["scene_keywords"]
            l.update(proposal_id=p["proposal_id"], slug=slug, planned_wave=p["proposed_wave"],
                     display_order=len(rows_l) + 1, public_identity=p["identity_status"],
                     scene_family_proposal=keywords[0], scene_keywords=keywords,
                     minimum_funding_tier=f"L{ordinal}", minimum_eligible_principal="DERIVED_FROM_TIER",
                     eligibility_status="PROPOSED_NOT_APPROVED", selection_available=False)
            if p["repo_status"] == "NOT_IN_REPOSITORY" and "SCENE_SPEC_REQUIRED" not in l["scene_requirements"]:
                l["scene_requirements"].insert(0, "SCENE_SPEC_REQUIRED")
            if slug in NEW:
                c.update(proposal_id=p["proposal_id"], slug=f"copy-{slug}", title_ko=p["name_hint_ko"] + " 테마",
                         short_description_ko=keywords[0] + "을 살펴보는 가상 채굴 테마예요.",
                         body_ko=f"{p['name_hint_ko']}에서 떠올린 이미지를 가상 채굴 장면으로 표현한 테마입니다. {keywords[0]}에서 {keywords[2]}을 살펴보세요. 실제 기업 시설을 재현했다는 뜻은 아닙니다.\n\n테마 이름은 실제 주식·ETF·금속·코인의 매수나 소유를 뜻하지 않습니다. 시세나 배당이 채굴보상을 결정하지 않습니다. 해당 기업·운용사와의 제휴를 뜻하지 않습니다.\n\n채굴 속도와 주기 한도는 서로 다른 조건입니다. 장면의 움직임이 금액을 확정하지 않습니다. 선택 가능 여부는 공개된 상품 안내를 확인하고, 금액은 지갑의 확정 기록을 확인해 주세요.",
                         personality_help_ko=e["personality_ko"] + ": " + keywords[2] + ". 추가 보상을 뜻하지 않아요.",
                         scene_keywords=keywords, asset_class_help_ko="한국 기업에서 떠올린 테마" if slug == "lg-electronics" else "미국 기업에서 떠올린 테마")
            why = f"편집 제안의 {ordinal}번째 선택 단계에 배치. {e['catalog_role']}와 장면 난이도를 함께 고려했으며 시세·기업가치·예상 수익을 근거로 하지 않았다."
            eligibility.append(dict(proposal_id=p["proposal_id"], slug=slug, product_name_ko=p["name_hint_ko"],
                                    minimum_funding_tier=f"L{ordinal}", minimum_eligible_principal="DERIVED_FROM_TIER",
                                    intended_minimum_funding_tier=f"L{ordinal}", lower_tier_exception=None,
                                    unlock_policy="FUNDING_TIER", eligibility_status="PROPOSED_NOT_APPROVED",
                                    effective_selection_available=False,
                                    approved_minimum_funding_tier=None, why_this_tier_ko=why,
                                    available_in_tiers=[f"L{i}" for i in range(ordinal, 15)],
                                    progression_purpose_ko="今 단계에서도 선택지를 유지하고 다음 단계의 새로운 산업 장면을 소개한다.".replace("今", "현재"),
                                    unlock_copy_ko="이용 조건이 확인되면 이 테마를 선택할 수 있어요. 지금 선택할 수 있는 다른 테마도 살펴보세요.",
                                    next_unlock_copy_ko="이용 조건이 달라지면 새 테마가 보일 수 있어요. 먼저 현재 선택 가능한 테마의 설명을 확인해 주세요.",
                                    downgrade_behavior="PAUSE_INELIGIBLE_SELECTION_FORWARD_ONLY",
                                    eligibility_policy_version_required=True, approved_eligibility_policy_version=None,
                                    effective_from=None, policy_receipt_required=True,
                                    version_change_reason="NEW_PRODUCT_TIER_GATE_AND_NON_DEFAULT_EFFECT_SCOPE",
                                    blocked_until=["PUBLIC_IDENTITY_DETAILS", "USER_POLICY_APPROVAL", "AUTHORITATIVE_BACKEND_GATE", "LEGAL_BRAND_REVIEW", "SCENE_AND_COMMAND_QA"]))
            rows_e.append(e); rows_l.append(l); rows_c.append(c)
    economy.update(schema_version=2, recommended_band=dict(minimum="1.00", maximum="1.10", step="0.01"),
                   recommendation="POLICY_A_PLUS_TIER_GATE_PLUS_INHERITED_GLOBAL_CAPACITY_PLUS_PRODUCT_SPEED",
                   products=rows_e, grade_bands_bps={"C": [10000, 10200], "B": [10300, 10500], "A": [10600, 10800], "S": [10900, 11000]},
                   comparison_bands=[dict(minimum="1.00", maximum=b, status="PROPOSED_NOT_APPROVED", policy_band_change_required=b != "1.10") for b in ("1.10", "1.12", "1.18")],
                   policy_version_change_required=True, policy_version_change_reasons=["NEW_FUNDING_TIER_PRODUCT_GATE", "NON_DEFAULT_MODIFIER_SCOPE_AND_EFFECTIVE_BOUNDARY_UNRESOLVED"],
                   approved_document_band_change_required=False)
    launch.update(planned_product_count=len(rows_l), products=rows_l)
    for w in waves["waves"]:
        w["products"] = [p["proposal_id"] for p in candidates["candidates"] if p["proposed_wave"] == w["name"]]
    tier_data = dict(schema_version=2, status="PROPOSED_NOT_APPROVED", money_authority="NONE_OFFLINE_PROPOSAL",
                     approved=False, eligibility_policy_version=None, source_policy=dict(path="docs/product/economy-v1-approved-2026-10-03.json",
                     sha256=hashlib.sha256(policy_bytes).hexdigest(), base_sha=candidates["base_sha"], policy_version=policy["policyVersion"],
                     document_approval_state=policy["approvalState"], document_cycle_days=policy["cycleDays"],
                     effective_from=None, live_publication_status="UNKNOWN_NO_SERVER_RECEIPT", tiers=policy["tiers"],
                     principal_definition="REMAINING_ELIGIBLE_FUNDING_PRINCIPAL_EXCLUDING_REWARD_BONUS_TRIAL_AND_ACTIVE_PRINCIPAL_HOLD",
                     capacity_scope="GLOBAL_CYCLE", base_capacity_rate_bps=policy["baseCycleRateBps"], retention="SEPARATE_CONDITIONAL_TIER_CAPACITY_NOT_PRODUCT_MULTIPLICATION"),
                     products=eligibility, trial_policy="PUTDUK_START_SEPARATE_NOT_IMPLICITLY_GATED_BY_FUNDING_TIER",
                     downgrade=dict(recommended="B", status="PROPOSED_NOT_APPROVED", action="PAUSE_INELIGIBLE_SELECTION_FORWARD_ONLY",
                                    effective_boundary="AUTHORITATIVE_SERVER_CONDITION_CHANGE_INSTANT_NOT_CLIENT_CLOCK",
                                    alternatives=[dict(option="A", action="APPLY_ONLY_AT_NEXT_SESSION_OR_CYCLE", concern="Ineligible selection may accrue before boundary; requires separately authorized grandfathering."),
                                                  dict(option="B", action="PAUSE_INELIGIBLE_SELECTION_FORWARD_ONLY", concern="Member must review eligible replacements; never silently select a substitute."),
                                                  dict(option="C", action="GRACE_PERIOD", concern="No approved duration or budget; do not invent one.")],
                                    reset=False, preserves=["VERIFIED_LEDGER", "MEMBER_HISTORY", "MINING_AGE", "CURRENT_CYCLE", "USED_GLOBAL_CAPACITY", "EXACT_FRACTIONAL_CARRY"],
                                    principal_withdrawal_hold="PAUSE_NOT_RESET", release="FORWARD_REEVALUATE_NO_CATCH_UP",
                                    automatic_substitution=False, confirmation_required=True, safe_mode_precedence=True,
                                    when_capacity_below_used="STOP_NEW_ACCRUAL_NO_CLAWBACK_NO_RESET",
                                    eligible_slots_after_change="REVIEW_AND_CONFIRM_ALLOCATION_WITHIN_NEW_TIER_SLOTS"),
                     registration=dict(status="BLOCKED_COMMAND_NOT_FOUND", generated_ids=[], production=False))
    write("product-candidates.json", candidates); write("product-economy-proposal.json", economy)
    write("launch-catalog-proposal.json", launch); write("launch-wave-plan.json", waves); write("product-copy.json", rows_c)
    write("product-tier-eligibility.json", tier_data)
    matrix = "| 상품 | Grade | 성격 | 속도 제안 | Minimum Tier | Capacity |\n|---|---|---|---|---|---|\n"
    for p in rows_e:
        matrix += f"| {p['product_name_hint_ko']} | {p['grade']} | {p['personality_ko']} | {p['proposed_product_speed_multiplier']} | {p['minimum_funding_tier']} | INHERIT_TIER_CAPACITY |\n"
    (ROOT / "PRODUCT-ECONOMY-MATRIX.md").write_text("# 상품별 경제·자격 제안\n\n추천은 Policy A + Tier gate + inherited global capacity + product speed, 1.00–1.10이다. 모든 값·Tier gate는 PROPOSED_NOT_APPROVED, 승인 배율은 null이다. Grade는 가상 테마 편성 표기이며 투자 평가가 아니다. 제품별 원화 문턱을 쓰지 않고 최소 L-tier에서만 유도한다. 주기 한도는 상품/슬롯마다 생기지 않는다. Tier gate와 효과 범위 때문에 새로운 승인 policy version이 필요하다.\n\n" + matrix)
    (ROOT / "PRODUCT-TIER-ELIGIBILITY.md").write_text("# Funding Tier 상품 자격 제안\n\n승인 JSON의 14단계·최소/최대 인정 원금·slot·retention 값을 read-only로 참조했다. 정책 문서 승인일과 현재 서버 적용 시각은 다르며 live publication/effective_from은 UNKNOWN이다. domain/mining/economy-policy.ts의 검증된 policy receipt와 fundingTierForPrincipal, tests/unit/funding-entitlement.test.ts의 최소/큰 정수/하향 capacity/PAUSE 테스트를 읽었다. 문서만으로 실제 자격 변경을 실행하지 않는다.\n\nTier는 누적 입금액이 아니라 남은 인정 원금이다. 수익·Bonus·체험 잔액은 포함하지 않고 원금 HOLD는 forward 시점부터 제외한다. 회원에게 L 코드·원화 추가 입금 권유를 노출하지 않는다. START 체험/첫 출금의 별도 규칙을 이 제안으로 차단하지 않는다.\n\n상품 25개마다 최소 Tier, DERIVED_FROM_TIER, 사용 가능 단계, 이유, 안내 원고, downgrade 및 policy receipt 요건을 JSON으로 작성했다.\n\n" + matrix + "\n## Tier 하락 추천 B\n\n서버에서 확인한 조건 변경 시각부터 자격을 잃은 선택만 PAUSE한다. 다른 선택은 slot/전체 allocation/한도를 다시 확인해야 한다. 자동 대체·소급 정산·보상 삭제·원장 수정·주기/나이 초기화는 없다. 사용량이 줄어든 한도를 넘으면 추가 발생만 멈춘다. 원금 출금 HOLD는 기존 PAUSE를 우선하며 취소/해제는 이후 시점만 다시 평가한다. 기존 verified ledger, cycle, age, history, 사용량, exact carry를 보존한다. 재개는 올바른 서버 receipt와 회원 확인이 있어야 하며 catch-up을 만들지 않는다.\n\nA 다음 주기 적용은 자격 상실 이후 accrual을 허용할 수 있어 별도 grandfather 승인이 필요하다. C 유예 기간은 승인 기간·예산이 없어서 추천하지 않는다. B도 아직 승인·구현되지 않았고 shared backend는 Primary가 연결해야 한다.\n")
    wave_doc = "# 재검증 후 조건부 25개 출시 편성\n\n실제 공개 수는 0 (repository seed), LIVE_DB_UNKNOWN. P0/P1 편성은 승인/등록 완료가 아니다. 모든 effective wave는 HOLD, 날짜 null이다.\n\n"
    for w in waves["waves"]:
        wave_doc += "## " + w["name"] + "\n\n" + ", ".join(p["name_hint_ko"] for p in candidates["candidates"] if p["proposed_wave"] == w["name"]) + "\n\n"
    wave_doc += "LG전자는 생활 기기 장면과 한국 산업 선택 폭 때문에 P2→P1, SpaceX는 실제 SEC SPCX/Nasdaq 근거와 우주 통신 장면 때문에 HOLD→P1 조건부 승격했다. 주식 종류·현재 상세 상장·법무 확인은 계속 필요하다. Meta는 실제 SEC 신원을 읽었으나 연결 테마 중복/제작 예산으로 P1→P2. 점수는 편집 가설이며 시장 수익 데이터가 아니다. 국내 AI 슬롯 471990은 특정했으나 상세 확인 전 HOLD; 국내 배당 슬롯은 특정 전 HOLD. USDT/USDC 채굴 상품은 REJECT, 입출금 rail 지원 여부를 새로 승인하지 않았다.\n\n25개 중 기존 seed 9개 유지, 신규 16개 SPEC_REQUIRED. 25개 모두 desktop/mobile master와 실제 상품 browser QA가 필요하다. frozen Scene 결과는 읽기만 했다. 법무·자격 정책·효과 범위·catalog command·LOCAL ID/readback/render/rollback 통과 전 어떤 상품도 게시하지 않는다.\n"
    (ROOT / "PRODUCT-CATALOG-PROPOSAL.md").write_text(wave_doc)
    (ROOT / "LAUNCH-WAVE-PLAN.md").write_text(wave_doc + "\n출시 시각은 승인 전 미정이다. 승인된 command로 exact preview → human confirmation → server authorization → audit → local readback/render/rollback 검증 후 Primary가 별도 출시 승인을 받는다. 실패한 gate가 있는 상품은 HOLD. 모든 조건부 상품의 제작·법무 근거가 확보되기 전 동시 공개를 예약하지 않는다.\n")
    (ROOT / "PRODUCT-COPY.md").write_text("# 회원 원고 초안\n\n법무·정책 승인 전 DRAFT, 추가 입금 권유/수익 보장/실제 자산 소유 주장 없음.\n\n" + "\n\n".join("## " + c["title_ko"] + "\n\n" + c["body_ko"] for c in rows_c))
    print(json.dumps({"products": len(rows_e), "tier_count": len(policy["tiers"]), "waves": dict(collections.Counter(p["proposed_wave"] for p in candidates["candidates"]))}))
