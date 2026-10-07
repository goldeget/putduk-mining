"""Apply the Owner access correction to offline catalog artifacts only.

Historical exact-byte evidence is immutable under evidence/superseded-tier-gate.
No backend, money writer, network request, registration or publication.
"""
import hashlib
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SUPERSEDED = "SUPERSEDED_BY_OWNER_CORRECTION"
ANCHOR = "783732492e70c312b33640e07ee0d8ffad68c3e5"


def read(name):
    return json.loads((ROOT / name).read_text())


def write(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def doc(name, value):
    (ROOT / name).write_text(value.strip() + "\n")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    archive = read("evidence/superseded-tier-gate/manifest.json")
    for record in archive["files"]:
        assert digest(REPO / record["archive_path"]) == record["sha256"]
    policy_path = REPO / "docs/product/economy-v1-approved-2026-10-03.json"
    policy = json.loads(policy_path.read_text())
    source = {
        "path": str(policy_path.relative_to(REPO)),
        "sha256": digest(policy_path),
        "policy_version": policy["policyVersion"],
        "document_approval": policy["approvalState"],
        "live_publication_status": "UNKNOWN_NO_SERVER_RECEIPT",
        "effective_from": None,
        "tiers": policy["tiers"],
        "base_capacity_rate_bps": policy["baseCycleRateBps"],
        "cycle_days": policy["cycleDays"],
        "micro_krw_per_krw": policy["microKrwPerKrw"],
    }
    economy = read("product-economy-proposal.json")
    launch = read("launch-catalog-proposal.json")
    economy.update({
        "schema_version": 3,
        "recommendation": "POLICY_A_OPEN_PRODUCT_CHOICE_TIER_MINING_POWER_PRODUCT_MODIFIER_SECONDARY",
        "product_access_policy": "ALL_ELIGIBLE_MEMBERS",
        "tier_base_speed_status": "TIER_SPEED_CONTRACT_REQUIRED",
        "policy_version_change_reasons": ["NON_DEFAULT_MODIFIER_SCOPE_AND_EFFECTIVE_BOUNDARY_UNRESOLVED", "TIER_SPEED_CONTRACT_REQUIRED"],
        "owner_access_direction": "CONFIRMED_BY_OWNER_CORRECTION_NOT_RUNTIME_ACTIVATED",
        "supersedes_head": ANCHOR,
    })
    removed = {"minimum_funding_tier", "minimum_eligible_principal", "unlock_policy", "eligibility_status"}
    for package in [economy, launch]:
        for p in package["products"]:
            for key in removed:
                p.pop(key, None)
            p["product_access_policy"] = "ALL_ELIGIBLE_MEMBERS"
            p["access_condition"] = "AUTHORITATIVE_PUBLISHED_AVAILABLE_PRODUCT_AND_ELIGIBLE_MEMBER"
            p["tier_capacity"] = "INHERITED"
            if package is economy:
                p["risk_flags"] = [r for r in p["risk_flags"] if r != "HIGH_THRESHOLD_ACCESSIBILITY_REVIEW"]
                p["speed_rationale_ko"] = "PUTDUK 내부 운영 modifier의 " + p["proposed_product_speed_multiplier"] + " 제안. 시장 수익률과 무관하며 상품 접근을 원금 단계로 제한하지 않는다. Tier 기본 경제가 우선이고 상품 modifier는 보조다. 같은 Tier의 낮은 배율 선택에 속도상 불리함은 남는다."
    write("product-economy-proposal.json", economy)
    write("launch-catalog-proposal.json", launch)
    old = read("product-tier-eligibility.json")
    old.update({"status": SUPERSEDED, "active": False, "use_in_final_proposal": False, "superseded_by": "PRODUCT-ACCESS-POLICY.md", "historical_source_head": ANCHOR})
    old["downgrade"]["status"] = SUPERSEDED
    for p in old["products"]:
        p["eligibility_status"] = SUPERSEDED
    write("product-tier-eligibility.json", old)
    profiles = [{
        "proposal_id": p["proposal_id"], "slug": p["slug"],
        "product_access_policy": "ALL_ELIGIBLE_MEMBERS",
        "tier_capacity": "INHERITED", "market_linked": False,
        "availability_requirement": "AUTHORITATIVE_PUBLISHED_AND_AVAILABLE",
        "current_effective_wave": "HOLD", "effective_selection_available": False,
        "product_tier_lock": False, "tier_downgrade_locks_product": False,
    } for p in economy["products"]]
    access = {
        "schema_version": 1,
        "status": "OWNER_DIRECTION_CONFIRMED_NOT_RUNTIME_ACTIVE",
        "owner_evidence": "catalog-ops/evidence/owner-product-access-correction.txt",
        "owner_evidence_sha256": digest(ROOT / "evidence/owner-product-access-correction.txt"),
        "owner_original_evidence": "catalog-ops/evidence/owner-product-access-correction.txt.gz",
        "owner_original_sha256": hashlib.sha256(gzip.decompress((ROOT / "evidence/owner-product-access-correction.txt.gz").read_bytes())).hexdigest(),
        "owner_readable_copy_line_endings": "LF_NORMALIZED_ORIGINAL_BYTES_LOSSLESS_GZIP",
        "product_access_policy": "ALL_ELIGIBLE_MEMBERS",
        "tier_product_access": "ALL_PUBLISHED_PRODUCTS",
        "all_eligible_members_definition": "Authoritative eligible member; independent account/security/product-publication guards still apply. Funding Tier never selects a product subset.",
        "current_live_catalog": "LIVE_DB_UNKNOWN",
        "effective_published_proposal_count": 0,
        "enforced_in_runtime": False,
        "products": profiles,
        "selection_is_mining_authorization": False,
        "member_eligibility_authority": "EXISTING_SERVER_CONTRACT",
        "trial": "PUTDUK_START_SEPARATE_NO_FUNDING_PREREQUISITE_FOR_ELIGIBLE_FIRST_WITHDRAWAL",
        "superseded_models": ["minimum_funding_tier_per_product", "product_unlock_by_tier", "NVIDIA_ONLY_L13", "SPACEX_ONLY_L14", "PRODUCT_INELIGIBILITY_ON_TIER_DOWNGRADE", "PAUSE_BECAUSE_PRODUCT_TIER_INELIGIBLE"],
        "superseded_status": SUPERSEDED,
        "superseded_manifest": "catalog-ops/evidence/superseded-tier-gate/manifest.json",
    }
    write("product-access-policy.json", access)
    engine_sources = ["domain/mining/economy-policy.ts", "domain/mining/funding-entitlement.ts", "docs/architecture/MONEY-SOURCE-PROVENANCE.md", "tests/unit/funding-entitlement.test.ts"]
    model = {
        "schema_version": 1,
        "status": "OFFLINE_SSOT_ANALYSIS_NOT_RUNTIME_POLICY",
        "source_policy": source,
        "source_evidence": [{"path": p, "sha256": digest(REPO / p)} for p in engine_sources],
        "product_access": "ALL_PUBLISHED_PRODUCTS",
        "tier_base_speed_status": "TIER_SPEED_CONTRACT_REQUIRED",
        "tier_base_speed_multiplier": None,
        "approved_distinct_tier_speed_rule": None,
        "neutral_derived_rate": "EligiblePrincipal * microKrwPerKrw * baseCycleRateBps / (10000 * cycleDays), full allocation, default effects; read-only reference, not a distinct tier multiplier or payout forecast.",
        "global_capacity": {
            "scope": "GLOBAL_CYCLE", "formula": "EligiblePrincipal * microKrwPerKrw * baseCycleRateBps / 10000",
            "principal_source": "REMAINING_ELIGIBLE_PRINCIPAL_EXCLUDING_REWARD_BONUS_TRIAL_AND_ACTIVE_PRINCIPAL_HOLD",
            "product_multiplier_changes_capacity": False, "slots_multiply_capacity": False,
            "allocation_maximum_total_bps": policy["allocation"]["maximumTotalBps"],
        },
        "retention": {
            "formula": "EligiblePrincipal * microKrwPerKrw * tier.retentionBonusBps / 10000",
            "status": "SEPARATE_CONDITIONAL_QUALIFICATION_REQUIRED",
            "included_in_base_capacity": False, "included_in_settlement_ready": False,
            "product_modifier_scope": "PRIMARY_CONTRACT_REQUIRED",
        },
        "tiers": [{
            "tier": t["code"], "name": t["name"],
            "minimum_eligible_principal_krw": t["minimumPrincipalKrw"],
            "maximum_eligible_principal_krw": t["maximumPrincipalKrw"],
            "slots": t["slots"], "retention_bonus_bps": t["retentionBonusBps"],
            "base_speed_multiplier": None, "base_speed_status": "TIER_SPEED_CONTRACT_REQUIRED",
            "derived_rate_status": "EXACT_NEUTRAL_REFERENCE_FROM_EXISTING_PREVIEW_ONLY",
            "capacity": "INHERITED_GLOBAL_PRINCIPAL_PROPORTIONAL",
            "product_access": "ALL_PUBLISHED_PRODUCTS",
            "effective_reward_scaling": "PRINCIPAL_PROPORTIONAL_BASE_REFERENCE_CONDITIONAL_RETENTION_SEPARATE_TIER_SPEED_UNRESOLVED",
        } for t in policy["tiers"]],
        "downgrade": {
            "action": "KEEP_PRODUCT_SELECTION_REEVALUATE_FUTURE_TIER_ECONOMICS",
            "locks_product": False, "pause_for_product_access": False,
            "automatic_substitution": False, "reset": False,
            "principal_withdrawal_hold": "PAUSE_NOT_RESET",
            "slot_reduction_policy": "PRIMARY_CONTRACT_REQUIRED",
            "slot_resolution": None,
            "effective_boundary": "AUTHORITATIVE_SERVER_CONDITION_CHANGE_INSTANT_NOT_CLIENT_CLOCK",
            "when_capacity_below_used": "STOP_NEW_ACCRUAL_NO_CLAWBACK_NO_RESET",
            "catch_up": False,
            "preserves": ["VERIFIED_LEDGER", "MEMBER_HISTORY", "MINING_AGE", "CURRENT_CYCLE", "USED_GLOBAL_CAPACITY", "EXACT_FRACTIONAL_CARRY"],
        },
        "modifier_pipeline": ["ELIGIBLE_PRINCIPAL", "FUNDING_TIER", "TIER_BASE_MINING_SPEED_CONTRACT_REQUIRED", "TIER_CAPACITY_ENTITLEMENT", "PRODUCT_SELECTION_ALL_PUBLISHED_PRODUCTS", "PRODUCT_SPEED_MODIFIER", "USER_EVENT_TEMPORARY_MODIFIERS", "FINAL_1_50_CAP_ONCE", "REWARD_PRODUCER", "PENDING", "SETTLEMENT", "VERIFIED"],
        "final_cap_scope": "RELATIVE_COMBINED_PRODUCT_USER_EVENT_TEMPORARY_MODIFIERS_NOT_ABSOLUTE_KRW_RATE_OR_TIER_CAPACITY",
        "modifier_runtime_status": "EFFECT_SCOPE_UNRESOLVED",
        "required_primary_contracts": ["TIER_SPEED_CONTRACT_REQUIRED", "SLOT_REDUCTION_ALLOCATION_POLICY_REQUIRED", "NON_DEFAULT_MODIFIER_PORTION_AND_BOUNDARY_REQUIRED", "LIVE_POLICY_RECEIPT_REQUIRED"],
        "production_ready": False,
    }
    write("tier-mining-power-model.json", model)
    for filename in ["PRODUCT-TIER-ELIGIBILITY.md", "TIER-PROGRESSION-ANALYSIS.md"]:
        historical = (ROOT / "evidence/superseded-tier-gate" / filename).read_text()
        doc(filename, "# SUPERSEDED_BY_OWNER_CORRECTION\n\n아래는 과거 기록이며 최종 추천 또는 구현 요구로 사용하지 않는다. Owner가 상품별 최소 Funding Tier·해금·Tier 하향에 따른 상품 잠금/PAUSE를 폐기했다. 현재 기준은 PRODUCT-ACCESS-POLICY.md와 TIER-MINING-POWER-MODEL.md다. 원본 SHA256은 evidence/superseded-tier-gate/manifest.json에 보존한다.\n\n---\n\n" + historical)
    # Mutating historical generators must not recreate the superseded model.
    for filename in ["finalize-catalog.py", "report-finalize.py", "tier-content-delta.py", "build-catalog.py", "build-content.py", "build-registration.py"]:
        path = ROOT / filename
        text = path.read_text()
        if "OWNER_CORRECTION_GENERATOR_GUARD" not in text:
            guard = '\n# OWNER_CORRECTION_GENERATOR_GUARD\nfrom pathlib import Path as _OwnerPath\nif __name__ == "__main__" and (_OwnerPath(__file__).parent / "product-access-policy.json").exists():\n    raise SystemExit("SUPERSEDED_BY_OWNER_CORRECTION: use owner-correction.py; do not regenerate the rejected Tier access model or overwrite reviewed evidence")\n'
            # Guard before imports/side effects, after an optional module docstring.
            offset = text.find('"""', 3) + 3 if text.startswith('"""') else 0
            path.write_text(text[:offset] + guard + text[offset:])
    update_content()
    copies = read("product-copy.json")
    for p in copies:
        p["body_ko"] = p["body_ko"].replace("선택 가능 여부와 적용 조건은 실제 공개된 상품 안내에서 확인하세요.", "공개된 테마는 이용 가능한 회원 누구나 고를 수 있습니다. 테마 선택은 원금 단계로 제한하지 않습니다. 채굴 규모와 동시에 운영할 수 있는 수는 남은 인정 원금의 조건에 따라 달라집니다. 실제 적용 상태는 상품과 채굴 안내에서 확인하세요.")
    write("product-copy.json", copies)
    write("evidence/owner-correction-status.json", {
        "status": "OWNER_CORRECTION_APPLIED_OFFLINE", "source_head": ANCHOR,
        "historical_files_preserved": len(archive["files"]), "history_rewritten": False,
        "active_product_count": len(profiles), "product_access_policy": "ALL_ELIGIBLE_MEMBERS",
        "tier_speed": "TIER_SPEED_CONTRACT_REQUIRED", "slot_downgrade": "PRIMARY_CONTRACT_REQUIRED",
        "research": "UNCHANGED_13_VERIFIED_31_PARTIAL_11_UNKNOWN",
        "registration": "BLOCKED_COMMAND_NOT_FOUND", "runtime_changed": False,
        "production_changed": False, "member_ui_changed": False,
    })


def update_content():
    # Keep stable editorial slugs and immutable original drafts in the archive.
    replacements = {
        "events-reading": ("공개된 테마를 자유롭게 살펴보기", "공개된 테마는 이용 가능한 회원 누구나 고를 수 있어요. 원금 단계가 특정 테마를 잠그지는 않아요. 장면과 설명을 먼저 읽어 보세요.\n\n채굴 규모와 동시에 운영할 수 있는 수는 남은 인정 원금의 조건에 따라 달라집니다. 장면만으로 받을 금액을 판단하지 마세요. 이 안내를 읽기 위해 입금하거나 테마를 바꿀 필요는 없습니다. 추가 보상은 없습니다."),
        "faq-choices": ("원금 단계가 낮아도 모든 공개 테마를 고를 수 있나요?", "네. 이용 가능한 회원은 공개된 테마를 원금 단계와 관계없이 고를 수 있습니다. 특정 기업이나 코인 테마를 고르기 위해 원금 단계를 높일 필요는 없습니다. 동시에 운영할 수 있는 수와 채굴 규모는 별도의 이용 조건을 따릅니다. 공개 전인 테마나 운영 중단된 테마는 선택 대상으로 안내하지 않습니다."),
        "faq-unlock": ("새 테마는 언제 선택할 수 있나요?", "정식으로 공개되고 운영 중인 테마는 이용 가능한 회원 누구나 선택할 수 있습니다. 더 높은 원금 단계에 도달해야 특정 테마가 열리는 방식이 아닙니다. 공개 준비 중인 이름이나 장면은 선택 완료를 뜻하지 않습니다. 실제 공개 안내를 확인해 주세요."),
        "faq-principal": ("채굴 규모를 정하는 원금에 보상과 보너스도 포함되나요?", "채굴 규모의 기준은 확인된 남은 인정 원금입니다. 채굴보상·보너스·체험 금액은 따로 관리하며 원금으로 자동 합산하지 않습니다. 원금 회수 검토로 보류된 금액도 현재 이용 조건에 영향을 줄 수 있습니다. 이 조건이 특정 공개 테마를 잠그지는 않습니다."),
        "faq-downgrade": ("원금을 회수하면 선택 중인 테마가 잠기나요?", "원금 단계가 내려갔다는 이유만으로 선택한 공개 테마가 잠기거나 다른 테마로 바뀌지는 않습니다. 이후 채굴 규모와 동시에 운영할 수 있는 수는 새 조건으로 확인합니다. 운영 수 조정이 필요한 경우 확인된 안내를 따르세요. 이미 확정된 지갑 기록과 이용 이력은 보존합니다."),
        "faq-hold": ("원금 회수 보류가 풀리면 처음부터 시작하나요?", "처음부터 다시 시작하지 않습니다. 원금 회수 보류 중 채굴이 일시 멈추더라도 이용 이력·채굴 기간·주기·확정 기록은 보존합니다. 해제 뒤에는 실제 적용 조건과 진행 상태를 다시 확인합니다. 멈춘 시간의 보상을 자동으로 추가하지 않습니다. 안내가 없으면 고객지원에 문의해 주세요."),
        "faq-top": ("테마의 속도와 원금 단계의 채굴 규모는 무엇이 다른가요?", "테마는 장면과 개성을 제공하고 내부 운영 정책에 따른 속도 조건을 가질 수 있습니다. 채굴 규모와 동시에 운영할 수 있는 수는 남은 인정 원금을 기준으로 따로 정합니다. 빠른 테마를 골랐다고 주기 한도가 늘어나는 것은 아닙니다. 기업의 시세·배당·성과가 채굴보상을 결정하지 않습니다."),
        "notices-selection": ("공개된 테마 선택 안내", "이용 가능한 회원은 공개되고 운영 중인 테마를 원금 단계와 관계없이 선택할 수 있습니다. 특정 테마를 고르기 위해 입금액을 늘릴 필요는 없습니다.\n\n원금 단계는 채굴 규모와 동시에 운영할 수 있는 수 등 이용 조건에 영향을 줍니다. 상품의 장면과 속도 조건은 그와 구분해서 확인해 주세요.\n\n공개 전인 테마는 선택 대상으로 안내하지 않습니다. 테마 선택이 어렵다면 같은 신청을 반복하지 말고 고객지원으로 알려 주세요."),
        "notices-condition-change": ("남은 원금 변경에 따른 채굴 이용 안내", "남은 인정 원금이 달라지면 이후 채굴 규모와 동시에 운영할 수 있는 수를 다시 확인합니다. 원금 단계가 내려갔다는 이유로 선택한 공개 테마를 잠그거나 다른 테마로 자동 변경하지 않습니다.\n\n원금 회수 검토 중에는 채굴이 일시 멈출 수 있습니다. 이미 확정된 지갑 기록과 이용 이력·채굴 기간·주기는 보존합니다.\n\n동시에 운영 중인 수의 조정이 필요한 경우 확인된 안내를 따르세요. 조정 방식이 확인되지 않았으면 임의로 종료하거나 재시작하지 말고 고객지원에 문의해 주세요."),
        "notices-new-groups": ("새로운 공개 테마 안내", "새로운 주제의 테마를 준비하고 있습니다. 정식 공개 전에는 선택 가능한 상품으로 안내하지 않습니다. 공개되고 운영 중인 테마는 이용 가능한 회원 누구나 원금 단계와 관계없이 선택할 수 있습니다.\n\n테마 이름과 장면은 실제 자산의 매수나 소유, 기업·운용사와의 제휴를 뜻하지 않습니다. 시세나 배당으로 채굴보상을 정하지 않습니다. 실제 공개 안내와 상품 설명을 확인해 주세요."),
        "notices-policy-guide": ("채굴 이용 정책 변경 안내 양식", "변경 내용: {{approved_change_summary}}\n적용 시각: {{effective_at_kst}}\n대상: {{approved_audience}}\n\n채굴 규모·동시 운영 수·적용 조건의 변경 내용과 시각을 안내합니다. 원금 단계가 특정 공개 테마의 선택을 제한하지 않습니다.\n\n이미 확정된 지갑 기록과 이용 이력은 보존합니다. 원금 회수 보류 중에는 채굴이 일시 멈출 수 있습니다. 변경 내용을 이해하기 어려우면 적용 안내를 확인한 뒤 고객지원에 문의해 주세요."),
        "notifications-unlock": ("새 테마가 공개되었습니다", "새로 공개된 테마를 살펴보세요. 이용 가능한 회원은 원금 단계와 관계없이 선택할 수 있어요. 이 알림은 추가 보상을 뜻하지 않아요."),
        "notifications-condition-change": ("채굴 이용 조건을 확인해 주세요", "남은 원금 변경에 따른 채굴 규모와 동시 운영 수 안내가 있어요. 선택한 공개 테마는 원금 단계 때문에 잠기지 않아요."),
        "notifications-pause": ("채굴 진행 안내가 있습니다", "채굴 진행에 확인이 필요한 내용이 있어요. 앱에서 현재 상태와 다음 안내를 읽어 주세요."),
        "notifications-policy": ("채굴 이용 정책 안내가 있습니다", "적용 전 확인할 안내가 있어요. 변경 내용과 적용 시각을 공지에서 읽어 주세요."),
        "support-unlock": ("공개 테마 선택 문의", "이용 가능한 회원은 공개되고 운영 중인 테마를 원금 단계와 관계없이 고를 수 있습니다. 원금 단계를 높여야 특정 테마가 열리는 방식은 아닙니다. 문의하신 테마의 공개 상태와 계정 이용 상태를 확인하겠습니다. 어느 화면에서 어떤 안내가 보이는지 알려 주세요."),
        "support-pause": ("원금 회수 보류 또는 채굴 조건 변경 문의", "선택한 공개 테마는 원금 단계가 내려갔다는 이유로 잠기지 않습니다. 원금 회수 검토 상태와 현재 채굴 이용 상태를 확인하겠습니다. 보류 중 일시 멈추더라도 이미 확정된 지갑 기록과 이용 이력은 보존합니다. 동시에 운영할 수 있는 수의 조정이 필요하면 확인된 절차를 안내하겠습니다."),
        "support-resume": ("보류 해제 뒤 재개 안내", "보류가 해제되면 현재 적용 조건과 진행 상태를 다시 확인합니다. 기존 기록을 지우거나 멈춘 시간의 보상을 자동 추가하지 않습니다. 원금 단계 때문에 테마를 바꾸도록 요구하지 않습니다. 현재 화면의 안내를 알려 주시면 확인된 다음 절차를 설명해 드리겠습니다."),
    }
    changed = []
    for path in (ROOT / "content-delta").glob("*additions.json"):
        rows = json.loads(path.read_text())
        for row in rows:
            slug = row.get("slug", "")
            key = slug.removeprefix("catalog-tier-")
            if key not in replacements:
                continue
            title, body = replacements[key]
            storage = row.get("storage", row)
            storage["title_ko"] = title
            if "summary_ko" in storage:
                storage["summary_ko"] = title if key.startswith("notices-") else body.split("\n")[0]
            if "body_markdown" in storage:
                storage["body_markdown"] = body
            if "body_ko" in storage:
                storage["body_ko"] = body
            meta = row["metadata"]
            if key.startswith("events-"):
                meta["body_markdown"] = body
                meta["card_title_ko"] = title
                meta["notification_copy"] = "공개된 테마를 살펴보세요. 추가 보상은 없습니다."
            meta.pop("tier_policy_status", None)
            meta.pop("requires_authoritative_eligibility_event", None)
            meta["owner_access_policy"] = "ALL_ELIGIBLE_MEMBERS"
            meta["historical_draft_status"] = SUPERSEDED
            meta["historical_draft_head"] = ANCHOR
            meta["requires_authoritative_event"] = "PUBLISHED_AVAILABLE_PRODUCT_AND_MEMBER_ELIGIBILITY" if key.endswith("unlock") or key.endswith("new-groups") else "EXISTING_AUTHORIZED_CONDITION_OR_NOTICE_EVENT_NO_PRODUCT_TIER_UNLOCK"
            if "trigger_evidence" in meta:
                meta["trigger_evidence"] = "실제 catalog 공개 또는 원금/HOLD/승인 정책 적용 event와 readback 확인. Tier 상품 해금 event를 만들거나 추측하지 않음. opt-in/dedup/receipt 필수."
            if "operator_note_ko" in row:
                row["operator_note_ko"] = "승인된 읽기 화면에서 실제 공개·계정·HOLD·채굴 조건 확인. 원금 단계별 상품 잠금/대체 선택 안내 금지. slot 조정 계약 미정이면 Primary에 이관. 돈 수정·임의 재개·소급 보상 약속 금지."
            changed.append(slug)
        write(str(path.relative_to(ROOT)), rows)
    summary = read("content-delta/tier-delta-summary.json")
    summary["access_model"] = "ALL_ELIGIBLE_MEMBERS"
    summary["historical_tier_gate_status"] = SUPERSEDED
    summary["corrected_existing_draft_slugs"] = changed
    summary["stable_slugs_are_editorial_identifiers_not_tier_unlock_events"] = True
    write("content-delta/tier-delta-summary.json", summary)


if __name__ == "__main__":
    main()
