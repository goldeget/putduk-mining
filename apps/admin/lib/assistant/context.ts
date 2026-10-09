import { z } from "zod";

export const ASSISTANT_CONTEXT_TOPICS = [
  { value: "dashboard", label: "오늘 확인할 업무" },
  { value: "member", label: "회원 한눈에" },
  { value: "deposits", label: "입금 확인" },
  { value: "withdrawals", label: "출금 확인" },
  { value: "wallet-ledger", label: "회원 지갑과 원금 기록" },
  { value: "mining", label: "회원 채굴 상태" },
  { value: "jobs", label: "실패한 자동 작업" },
  { value: "security", label: "제한과 위험 신호" },
  { value: "audit", label: "최근 운영 기록" },
] as const;

export const assistantContextInput = z.union([
  z.strictObject({
    topic: z.enum([
      "dashboard",
      "deposits",
      "withdrawals",
      "jobs",
      "security",
      "audit",
    ]),
  }),
  z.strictObject({
    topic: z.enum(["member", "wallet-ledger", "mining"]),
    userId: z.uuid(),
  }),
  z.strictObject({
    topic: z.literal("deposit-case"),
    currency: z.enum(["KRW", "USDT"]),
    recordId: z.uuid(),
  }),
  z.strictObject({ topic: z.literal("withdrawal-case"), recordId: z.uuid() }),
]);
export type AssistantContextInput = z.infer<typeof assistantContextInput>;
export type AssistantContextTopic =
  (typeof ASSISTANT_CONTEXT_TOPICS)[number]["value"];

export const ASSISTANT_EVIDENCE_LABELS = {
  FACT: "확인된 사실",
  INFERENCE: "가능성",
  RECOMMENDATION: "권장 행동",
  UNKNOWN: "확인 불가",
} as const;
export type AssistantEvidenceKind = keyof typeof ASSISTANT_EVIDENCE_LABELS;

// Server-selected destinations only. Never accept a supplied URL or arbitrary query.
const uuid = "[a-fA-F0-9-]{36}";
export const assistantSourceHref = z
  .string()
  .regex(
    new RegExp(
      `^(?:/|/exceptions|/restrictions|/kyc|/members(?:\\?id=${uuid}(?:#evidence-(?:money-sources|mining|security))?)?|/deposits/krw(?:/${uuid})?|/deposits/usdt(?:#usdt-deposit-${uuid})?|/withdrawals/(?:krw-bank|usdt))$`,
    ),
  );
const pointSchema = z.strictObject({
  text: z.string().min(1).max(300),
  source: z.strictObject({
    label: z.string().min(1).max(60),
    href: assistantSourceHref,
  }),
});
export const assistantContextReport = z
  .strictObject({
    title: z.string().min(1).max(80),
    observedAt: z.iso.datetime(),
    canExecute: z.literal(false),
    sections: z
      .array(
        z.strictObject({
          kind: z.enum(["FACT", "INFERENCE", "RECOMMENDATION", "UNKNOWN"]),
          points: z.array(pointSchema).max(24),
        }),
      )
      .length(4),
    choices: z
      .array(
        z.strictObject({
          label: z.string().min(1).max(120),
          input: assistantContextInput,
        }),
      )
      .max(20),
  })
  .superRefine((report, context) => {
    if (new Set(report.sections.map((section) => section.kind)).size !== 4)
      context.addIssue({
        code: "custom",
        message: "Evidence sections must be distinct.",
      });
  });
export type AssistantContextReport = z.infer<typeof assistantContextReport>;
export type AssistantContextPoint = z.infer<typeof pointSchema>;

export function memberContextTopic(topic: string): boolean {
  return topic === "member" || topic === "wallet-ledger" || topic === "mining";
}

export function contextReportBuilder(title: string, now: Date) {
  const sections: AssistantContextReport["sections"] = Object.keys(
    ASSISTANT_EVIDENCE_LABELS,
  ).map((kind) => ({ kind: kind as AssistantEvidenceKind, points: [] }));
  const choices: AssistantContextReport["choices"] = [];
  return {
    add(
      kind: AssistantEvidenceKind,
      text: string,
      href: string,
      label: string,
    ) {
      const source = { href: assistantSourceHref.parse(href), label };
      sections
        .find((section) => section.kind === kind)!
        .points.push({ text, source });
    },
    choice(label: string, input: AssistantContextInput) {
      choices.push({ label, input });
    },
    finish() {
      return assistantContextReport.parse({
        title,
        observedAt: now.toISOString(),
        canExecute: false,
        sections,
        choices,
      });
    },
  };
}
