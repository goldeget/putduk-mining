import { z } from "zod";

/** Full conversation content is restricted; ordinary Member 360 roles are not inherited. */
export const ADMIN_AI_READ_ROLES = ["SUPER_ADMIN"] as const;
export const ADMIN_AI_PAGE_LIMIT = 50;
export const ADMIN_AI_MESSAGE_LIMIT = 100;
const date = z.iso.datetime({ offset: true });
const status = z.enum([
  "RECEIVED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);
const range = {
  from: date.optional(),
  to: date.optional(),
};
const decimal = z.string().max(40).regex(/^\d+$/);
export const adminAiAttemptSchema = z.object({
  id: z.uuid(),
  status: z.string().min(1).max(40),
  provider: z.enum(["nvidia", "openrouter"]),
  modelKey: z.string().min(1).max(120),
  paid: z.boolean(),
  providerRequestId: z.string().max(200).nullable(),
  upstreamProvider: z.string().max(120).nullable(),
  providerCostNanoUsd: decimal.nullable(),
  chargedCostMicroUsd: decimal.nullable(),
  reservedCostMicroUsd: decimal,
  inputTokens: decimal.nullable(),
  outputTokens: decimal.nullable(),
  cachedInputTokens: decimal.nullable(),
  createdAt: date,
  updatedAt: date,
});
export const adminAiReadInputSchema = z
  .discriminatedUnion("operation", [
    z.strictObject({
      operation: z.literal("SEARCH"),
      query: z.string().min(2).max(80),
    }),
    z.strictObject({
      operation: z.literal("LIST"),
      userId: z.uuid().optional(),
      ...range,
      status: status.optional(),
      cursor: z.strictObject({ updatedAt: date, id: z.uuid() }).optional(),
      limit: z.number().int().min(1).max(ADMIN_AI_PAGE_LIMIT).default(25),
    }),
    z.strictObject({
      operation: z.literal("MESSAGES"),
      userId: z.uuid(),
      conversationId: z.uuid(),
      afterPosition: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(ADMIN_AI_MESSAGE_LIMIT).default(50),
    }),
  ])
  .refine(
    (input) =>
      input.operation !== "LIST" ||
      !input.from ||
      !input.to ||
      Date.parse(input.from) < Date.parse(input.to),
    { message: "INVALID_DATE_RANGE" },
  );
export type AdminAiReadInput = z.infer<typeof adminAiReadInputSchema>;

const usage = z.object({
  requestId: z.uuid(),
  clientMessageId: z.uuid().nullable(),
  status,
  model: z.string().max(120).nullable(),
  provider: z.string().max(40).nullable(),
  upstreamProvider: z.string().max(120).nullable(),
  providerCostNanoUsd: z.string().max(40).regex(/^\d+$/).nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  usageStatus: z.string().max(40).nullable(),
  errorCode: z.string().max(80).nullable(),
  createdAt: date,
  completedAt: date.nullable(),
  attempts: z.array(adminAiAttemptSchema).max(20).default([]),
});
export const adminAiSearchResultSchema = z.object({
  members: z
    .array(
      z.object({
        userId: z.uuid(),
        name: z
          .string()
          .max(80)
          .refine((value) => value.includes("*") || value === "이름 미설정"),
        loginId: z
          .string()
          .max(40)
          .refine((value) => value.includes("*"))
          .nullable(),
        phone: z
          .string()
          .regex(/^•••• \d{4}$/)
          .nullable(),
      }),
    )
    .max(20),
  hasMore: z.boolean(),
});
export const adminAiListResultSchema = z.object({
  conversations: z
    .array(
      z.object({
        id: z.uuid(),
        userId: z.uuid(),
        title: z.string().max(80).nullable(),
        createdAt: date,
        updatedAt: date,
      }),
    )
    .max(ADMIN_AI_PAGE_LIMIT),
  nextCursor: z.object({ updatedAt: date, id: z.uuid() }).nullable(),
});
export const adminAiMessagesResultSchema = z.object({
  conversationId: z.uuid(),
  userId: z.uuid(),
  messages: z
    .array(
      z.object({
        id: z.uuid(),
        authorRole: z.enum(["MEMBER", "ASSISTANT"]),
        bodyText: z.string().min(1).max(8000),
        position: z.number().int().positive(),
        createdAt: date,
        clientMessageId: z.uuid().nullable(),
      }),
    )
    .max(ADMIN_AI_MESSAGE_LIMIT),
  // Usage is attributed by the first MEMBER chunk's client_message_id, never by a guessed time join.
  requests: z.array(usage).max(ADMIN_AI_MESSAGE_LIMIT),
  nextPosition: z.number().int().positive().nullable(),
});
export type AdminAiMessagesResult = z.infer<typeof adminAiMessagesResultSchema>;

/** Preserve ordinary questions/answers byte-for-byte; redact only explicit credentials. */
export function redactAdminAiCredentials(text: string): string {
  return text
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      "[인증값 숨김]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|nvapi-[A-Za-z0-9_-]{12,})\b/g,
      "[비밀값 숨김]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer [비밀값 숨김]")
    .replace(
      /\b(?:SUPABASE_SECRET_KEY|NVIDIA_API_KEY|OPENROUTER(?:_FREE)?_API_KEY|OPENAI_API_KEY|WITHDRAWAL_DATA_KEY|password|비밀번호)\s*[:=]\s*[^\s,;]+/gi,
      (value) => `${value.split(/[:=]/)[0]}: [비밀값 숨김]`,
    );
}

export function formatAdminAiUsd(value: string | null): string {
  if (value === null || !/^\d{1,40}$/.test(value)) return "확인할 수 없음";
  const nano = BigInt(value);
  const whole = nano / 1000000000n;
  const fraction = (nano % 1000000000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `$${whole}${fraction ? `.${fraction}` : ""}`;
}

/** An uncertain provider attempt is distinct from an unsent or failed attempt. */
export function formatAdminAiAttemptStatus(value: string): string {
  const labels: Record<string, string> = {
    RESERVED: "전송 준비",
    DISPATCHED: "전송 시작",
    SUCCEEDED: "완료",
    FAILED: "실패",
    CANCELLED: "취소",
    UNKNOWN: "결과 확인 필요",
    NOT_SENT: "전송하지 않음",
  };
  return labels[value] ?? "처리 상태 확인 필요";
}

export function formatAdminAiTokenCount(value: string | number | null): string {
  return value === null ? "미확인" : String(value);
}

export type AdminAiSearchResult = z.infer<typeof adminAiSearchResultSchema>;
export type AdminAiListResult = z.infer<typeof adminAiListResultSchema>;
