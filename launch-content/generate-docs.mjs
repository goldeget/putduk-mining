import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPackage, validatePackage } from "./validate.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const bundle = loadPackage();
const validation = validatePackage(bundle);
if (validation.status !== "PASS_DRAFT_ONLY")
  throw new Error(JSON.stringify(validation.errors));
const directory = path.join(root, "docs");
fs.mkdirSync(directory, { recursive: true });
const names = {
  events: "출시 이벤트",
  notices: "출시 공지",
  faq: "자주 묻는 내용",
  "support-macros": "고객지원 답변",
  notifications: "Push·앱 안 알림",
  "incident-templates": "장애 안내",
};
for (const [kind, items] of Object.entries(bundle.collections)) {
  const lines = [
    `# ${names[kind]} — 검토용 초안 ${items.length}개`,
    "",
    "게시·발송·경제 정책 승인이 아닙니다. 변수는 실제로 확인한 값으로 채우고 운영자 검토를 받아야 합니다.",
    "",
  ];
  for (const item of items) {
    const m = item.metadata;
    const title = item.storage.title_ko ?? item.title_ko;
    const body =
      item.storage.body_markdown ??
      item.storage.body_ko ??
      m.body_markdown ??
      item.body_ko;
    lines.push(
      `## ${title}`,
      "",
      `내부 slug: ${item.slug}`,
      "",
      body,
      "",
      `CTA: ${m.cta.label} → ${m.cta.route}`,
      `대상: ${m.audience}${m.segment ? ` / ${m.segment}` : ""}. 승인: ${m.approval.status}. 경제: ${m.economy.impact} / ${m.economy.policy_status}.`,
      "",
    );
    if (kind === "events")
      lines.push(
        `카드 제목: ${m.card_title_ko}`,
        `시작 조건: ${m.start_condition}`,
        `종료 조건: ${m.end_condition}`,
        `기간: 승인 전 미지정 (Asia/Seoul 안내 / UTC 저장)`,
        `참여: ${m.participation}`,
        `제외·제한: ${m.exclusion}`,
        `배너·Scene: ${m.scene_brief}`,
        `알림: ${m.notification_copy}`,
        `KPI: ${m.kpi.definition}. ${m.kpi.measurement}. 목표값은 승인 전 미지정.`,
        `운영자 메모: ${m.operator_note}`,
        `취소·롤백: ${m.rollback}`,
        `abuse/risk: ${m.abuse_risk}`,
        "",
      );
    if (m.variables.length)
      lines.push(`확인 후 채울 변수: ${m.variables.join(", ")}`, "");
    if (m.operator_note && kind !== "events")
      lines.push(`운영자 메모: ${m.operator_note}`, "");
    if (m.trigger_evidence)
      lines.push(
        `발송 전 실제 증거: ${m.trigger_evidence}`,
        `전달 정책: ${m.delivery_policy}`,
        `중복 방지: ${m.deduplication}`,
        "",
      );
  }
  fs.writeFileSync(path.join(directory, `${kind}.md`), `${lines.join("\n")}\n`);
}
console.log("Generated six complete operator content documents.");
