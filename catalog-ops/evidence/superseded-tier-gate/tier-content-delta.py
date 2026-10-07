"""Append the Tier-specific education delta; preserve the frozen content audit."""
import copy
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent

FAQ = [
    ("choices", "왜 지금 고를 수 있는 테마가 서로 다른가요?", "계정에서 확인된 이용 조건에 따라 선택 가능한 테마가 달라질 수 있습니다. 지금 선택할 수 있는 테마의 설명부터 살펴보세요. 목록에 보인다고 선택이 완료된 것은 아니며, 조건이 아직 확인되지 않았다면 신청을 반복하지 말고 고객지원에 문의해 주세요."),
    ("unlock", "새 테마는 언제 선택할 수 있나요?", "테마가 정식 공개되고 내 이용 조건이 확인된 뒤 선택할 수 있습니다. 공개 알림과 내 계정의 선택 가능 상태는 다를 수 있어요. 조건을 확인 중이라면 기다리거나 고객지원에 문의해 주세요. 안내를 읽는 것만으로 추가 보상이 생기지는 않습니다."),
    ("principal", "테마 이용 조건에 보상과 보너스도 포함되나요?", "상품 이용 단계의 기준은 확인된 남은 원금입니다. 채굴보상과 보너스, 체험 기록은 원금과 따로 구분합니다. 입금 신청 중인 금액이 바로 원금에 반영되는 것은 아닙니다. 원금 회수 요청으로 사용이 보류된 금액도 이용 조건에 영향을 줄 수 있으니 지갑과 상품 안내를 함께 확인해 주세요."),
    ("downgrade", "원금을 회수하면 선택 중인 테마는 어떻게 되나요?", "원금 회수나 이용 조건 변경으로 지금 선택한 테마를 계속 이용하기 어려워질 수 있습니다. 원금 회수 검토 중에는 채굴이 일시 멈출 수 있어요. 이미 확정된 지갑 기록과 이전 이용 이력은 지워지지 않습니다. 조건이 바뀌면 선택 가능한 테마와 현재 상태를 확인하고, 변경 내용을 읽은 뒤 직접 선택해 주세요."),
    ("hold", "원금 회수 보류가 풀리면 처음부터 시작하나요?", "보류 해제는 이전 기록을 지우고 처음부터 시작한다는 뜻이 아닙니다. 실제 확인된 상태와 이용 조건에 따라 이후 진행을 다시 판단합니다. 멈춰 있던 시간의 보상이 자동으로 추가되지는 않아요. 재개 안내가 없거나 계속 멈춰 있다면 고객지원에 문의해 주세요."),
    ("top", "같은 이용 단계에서도 테마마다 다른 점이 있나요?", "여러 테마가 비슷한 진행 조건을 가질 수 있지만 장면의 주제와 안내 방식은 서로 다릅니다. 속도와 주기 한도는 따로 읽어 주세요. 유명한 기업 이름이나 화면의 움직임으로 받을 금액을 판단하지 않습니다. 실제 적용 조건은 공개된 상품 설명에서 확인해 주세요."),
]
NOTICES = [
    ("selection", "선택 가능한 테마를 확인해 주세요", "계정에서 확인된 이용 조건에 따라 선택 가능한 테마가 달라질 수 있습니다. 상품 목록에서 지금 선택할 수 있는 테마와 설명을 확인해 주세요.\n\n새 테마 안내를 보았다는 이유로 선택이나 추가 보상이 완료되지는 않습니다. 확인 중으로 표시되면 같은 신청을 반복하지 말고 고객지원으로 알려 주세요. 입금이나 상품 선택을 서두를 필요는 없습니다.\n\n실제 테마 공개와 이용 조건 변경은 별도의 승인 안내와 적용 시각을 따릅니다."),
    ("condition-change", "이용 조건 변경에 따른 상품 선택 안내", "확인된 남은 원금 등 이용 조건이 바뀌면 선택 가능한 테마도 달라질 수 있습니다. 채굴보상과 보너스는 원금과 따로 관리합니다.\n\n원금 회수 검토 중에는 채굴이 일시 멈출 수 있으며, 일부 테마의 선택 조건이 달라질 수 있습니다. 이미 확정된 지갑 기록과 이용 이력은 지워지지 않습니다. 다른 테마로 자동 변경하지 않고 확인된 선택지를 안내합니다.\n\n적용 내용과 현재 상태를 읽은 뒤 변경을 확인해 주세요. 계속 멈춰 있거나 안내가 보이지 않으면 고객지원에 문의해 주세요."),
    ("new-groups", "새로운 테마군 안내를 읽어 주세요", "새로운 주제의 테마를 준비하고 있습니다. 공개 전에는 선택 가능한 상품으로 안내하지 않으며, 실제 공개와 내 계정의 이용 가능 여부는 따로 확인합니다.\n\n장면과 이름은 실제 자산의 매수나 소유, 기업·운용사와의 제휴를 뜻하지 않습니다. 시세나 배당으로 채굴보상을 정하지 않습니다. 지금 선택할 수 있는 테마의 설명을 먼저 살펴보세요."),
    ("policy-guide", "상품 이용 정책 변경 안내 양식", "변경 내용: {{approved_change_summary}}\n적용 시각: {{effective_at_kst}}\n대상: {{approved_audience}}\n\n상품 선택 조건과 진행 방식이 바뀌는 경우 적용 전 안내합니다. 지금 선택 중인 테마에 영향이 있는지 상품 화면에서 확인해 주세요. 안내만으로 상품 선택이나 추가 보상이 완료되지는 않습니다.\n\n이미 확정된 지갑 기록과 이용 이력은 보존합니다. 원금 회수 보류 중에는 채굴이 일시 멈출 수 있습니다. 안내를 이해하기 어렵다면 변경을 확인하기 전에 고객지원에 문의해 주세요."),
]
NOTIFICATIONS = [
    ("unlock", "테마 선택 안내가 있습니다", "내 계정에서 선택 가능한 테마와 이용 조건을 확인해 주세요. 이 알림은 선택 완료나 추가 보상을 뜻하지 않습니다."),
    ("condition-change", "테마 이용 상태를 확인해 주세요", "이용 조건 변경에 따른 안내가 있습니다. 상품 화면에서 지금 선택 가능한 테마와 진행 상태를 확인해 주세요."),
    ("pause", "채굴 진행 안내가 있습니다", "채굴 진행에 확인이 필요한 내용이 있습니다. 앱에서 현재 상태와 다음 안내를 읽어 주세요."),
    ("policy", "상품 이용 정책 안내가 있습니다", "적용 전 확인할 안내가 있습니다. 변경 내용과 적용 시각을 공지에서 읽어 주세요."),
]
SUPPORT = [
    ("unlock", "테마 선택 조건 문의", "문의하신 테마의 공개 여부와 계정의 선택 조건은 따로 확인합니다. 지금 선택 가능한 테마와 현재 안내를 확인한 뒤 알려 드리겠습니다. 안내만으로 선택이나 추가 보상이 완료되지는 않습니다. 어느 화면에서 어떤 안내가 보이는지 알려 주세요.", "승인된 읽기 화면에서 현재 정책 receipt·catalog 공개·eligibility 상태를 확인. 미확인 조건이나 입금 금액을 제안하지 않음."),
    ("pause", "이용 조건 변경으로 채굴이 멈춘 경우", "이용 조건이 바뀌면서 채굴이 잠시 멈출 수 있습니다. 이미 확정된 지갑 기록과 이전 이용 이력은 지워지지 않습니다. 지금 선택 중인 테마와 원금 회수 검토 상태를 확인하겠습니다. 확인 뒤 이용 가능한 선택지와 다음 절차를 안내해 드리겠습니다.", "PAUSE/HOLD와 최종 승인 상태를 읽기만 함. 원장 수정·임의 재개·소급 보상 약속 금지. 금융 승인과 대체 선택은 정식 권한 흐름 필요."),
    ("resume", "보류 해제 뒤 재개 안내", "보류 해제 뒤에도 이용 조건과 현재 진행 상태를 다시 확인해야 할 수 있습니다. 이전 기록을 지우거나 멈춘 시간의 보상을 자동 추가하는 방식은 아닙니다. 현재 표시된 안내를 확인한 뒤 필요한 선택 절차를 설명해 드리겠습니다.", "정확한 server effective boundary·receipt 확인 전 재개 시각/금액을 말하지 않음. 승인된 대체 선택을 회원이 확인하도록 안내."),
]


def read(kind):
    return json.loads((ROOT / "content-delta" / (kind + ".json")).read_text())


def append(kind, suffix, title, body, variables=(), operator=None):
    rows = read(kind)
    slug = "catalog-tier-" + kind.split("-")[0] + "-" + suffix
    if any(r["slug"] == slug for r in rows):
        return
    row = copy.deepcopy(rows[0]); row["slug"] = slug
    if "storage" in row:
        row["storage"].update(title_ko=title)
        if "slug" in row["storage"]: row["storage"]["slug"] = slug
        if kind == "events-additions":
            row["storage"]["summary_ko"] = body.split("\n")[0]
            row["metadata"].update(body_markdown=body, card_title_ko=title,
                                    participation="안내 읽기만 참여. 입금·상품 변경 불필요", notification_copy=title + " 안내를 읽어 주세요. 추가 보상은 없습니다.")
        elif kind == "notifications-additions": row["storage"].update(body_ko=body, route="/products")
        else: row["storage"].update(body_markdown=body, summary_ko=title)
    else:
        row.update(title_ko=title, body_ko=body)
        if operator: row["operator_note_ko"] = operator
    row["metadata"].update(variables=list(variables), required_phrases=[],
                            cta=dict(label="상품 안내 확인", route="/products"),
                            tier_policy_status="PROPOSED_NOT_APPROVED", requires_authoritative_eligibility_event=True,
                            policy_approval_before_publication=True)
    if kind == "notifications-additions":
        row["metadata"]["trigger_evidence"] = "승인된 정책 적용·catalog 공개·계정 eligibility 상태와 버전별 domain event readback 필요. 해금/HOLD 추측 발송 금지."
    rows.append(row)
    (ROOT / "content-delta" / (kind + ".json")).write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    for suffix, title, body in FAQ: append("faq-additions", suffix, title, body)
    for suffix, title, body in NOTICES:
        append("notices-additions", suffix, title, body,
               variables=("approved_change_summary", "effective_at_kst", "approved_audience") if suffix == "policy-guide" else ())
    for suffix, title, body in NOTIFICATIONS: append("notifications-additions", suffix, title, body)
    for suffix, title, body, note in SUPPORT: append("support-additions", suffix, title, body, operator=note)
    append("events-additions", "reading", "지금 고를 수 있는 테마 살펴보기",
           "상품 화면에서 지금 선택할 수 있는 테마의 설명을 읽어 보세요. 장면의 주제와 이용 조건은 따로 살펴볼 수 있어요.\n\n새 테마는 정식 공개와 내 이용 조건 확인이 끝난 뒤 선택할 수 있습니다. 이름이나 장면만으로 받을 금액을 판단하지 않습니다. 안내 참여를 위해 입금하거나 테마를 바꿀 필요는 없습니다. 추가 보상은 없습니다.")
    summary=dict(status="DRAFT_NOT_REGISTERED", preserves_frozen_event_audit=dict(KEEP=21,REWRITE=5,MERGE=3,DROP=1,ADD=10),
                 preserves_frozen_notice_audit=dict(KEEP=22,REWRITE=4,ADD=8),
                 additional_tier_delta=dict(events=1,notices=4,faq=6,notifications=4,support=3),
                 combined_addition_counts={k:len(read(k)) for k in ("events-additions","notices-additions","faq-additions","notifications-additions","support-additions")},
                 financial_rules_created=False, notification_delivery=False, production=False)
    (ROOT / "content-delta/tier-delta-summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
    text="# Tier 관련 콘텐츠 차이\n\n기존 frozen 이벤트 21 KEEP / 5 REWRITE / 3 MERGE / 1 DROP / 10 ADD, 공지 22 KEEP / 4 REWRITE / 8 ADD의 감사 결론은 보존한다. 이번 추가는 이벤트 1, 공지 4, FAQ 6, 알림 4, 지원 답변 3이다. 새 rule/보상/capacity/입금 권유를 만들지 않았다. 모두 DRAFT이며 실제 정책·상품 공개·회원별 상태 확인 전 게시/발송 금지. 내부 minimum L-tier 코드와 DERIVED_FROM_TIER는 회원 원고에 노출하지 않는다.\n\n"
    for kind in ("events-additions","notices-additions","faq-additions","notifications-additions","support-additions"):
        for row in read(kind):
            if not row["slug"].startswith("catalog-tier-"):continue
            s=row.get("storage",row)
            text+="## "+s["title_ko"]+"\n\n"+(s.get("body_markdown") or s.get("body_ko") or row["metadata"]["body_markdown"])+"\n\n"
    (ROOT / "TIER-CONTENT-DELTA.md").write_text(text)
    print(json.dumps(summary["combined_addition_counts"]))
