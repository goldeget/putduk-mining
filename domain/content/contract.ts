import { z } from "zod";

export const CONTENT_CTA_ROUTES = [
  "/home",
  "/start",
  "/mining",
  "/wallet",
  "/wallet/deposit",
  "/wallet/withdraw",
  "/products",
  "/events",
  "/notifications",
  "/menu",
  "/menu/account",
  "/menu/notifications",
  "/support",
  "/login",
  "/about",
  "/faq",
  "/status",
  "/changelog",
  "/",
] as const;
const text = (max: number) => z.string().trim().min(1).max(max);
const time = z.iso.datetime({ offset: true }).nullable();
const base = {
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100),
  title: text(120),
  summary: text(500),
  body: text(20000),
  ctaLabel: text(80),
  ctaRoute: z.enum(CONTENT_CTA_ROUTES),
  audience: z.literal("MEMBERS"),
  segment: z.literal("ALL_MEMBERS"),
};
export const eventContentSchema = z
  .object({
    ...base,
    title: text(100),
    cardTitle: text(100),
    rewardMode: z.literal("NONE"),
    participation: text(2000),
    exclusion: text(2000),
    startsAt: time,
    endsAt: time,
  })
  .strict();
export const noticeContentSchema = z
  .object({
    ...base,
    publishedAt: time,
    expiresAt: time,
    isPinned: z.boolean(),
  })
  .strict();
export type EventContent = z.infer<typeof eventContentSchema>;
export type NoticeContent = z.infer<typeof noticeContentSchema>;
export type LiveopsContent = EventContent | NoticeContent;
export const contentKindSchema = z.enum(["EVENT", "NOTICE"]);
export const contentOperationSchema = z.enum([
  "CREATE_DRAFT",
  "UPDATE_DRAFT",
  "PREVIEW",
  "APPROVE",
  "PUBLISH",
  "CANCEL",
  "ARCHIVE",
]);
export const contentStateSchema = z.enum([
  "DRAFT",
  "PREVIEWED",
  "APPROVED",
  "PUBLISHED",
  "CANCELLED",
  "ARCHIVED",
]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const contentCommandSchema = z
  .object({
    operation: contentOperationSchema,
    kind: contentKindSchema,
    contentId: z.uuid().nullable(),
    expectedRevision: z.uuid().nullable(),
    expectedDigest: digest.nullable(),
    payload: z.unknown().nullable(),
    reason: text(500).min(10),
    stepUpToken: z.string().min(16).max(512),
    confirmation: z.literal("CONFIRM_LIVEOPS_CONTENT"),
  })
  .strict()
  .superRefine((input, ctx) => {
    const invalid = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (input.operation === "CREATE_DRAFT") {
      if (input.contentId || input.expectedRevision || input.expectedDigest)
        invalid("New draft must not claim an existing receipt");
    } else if (
      !input.contentId ||
      !input.expectedRevision ||
      !input.expectedDigest
    )
      invalid("Exact prior receipt required");
    if (
      input.operation === "CREATE_DRAFT" ||
      input.operation === "UPDATE_DRAFT"
    ) {
      const result = (
        input.kind === "EVENT" ? eventContentSchema : noticeContentSchema
      ).safeParse(input.payload);
      if (!result.success) invalid("Unsupported content payload");
      else if (!isSafeContentCopy(result.data)) invalid("Unsafe member copy");
      else if (!hasValidContentWindow(result.data, false))
        invalid("Invalid content window");
    } else if (input.payload !== null)
      invalid("Reviewed operation cannot replace content");
    if (
      (input.kind === "EVENT" && input.operation === "ARCHIVE") ||
      (input.kind === "NOTICE" && input.operation === "CANCEL")
    )
      invalid("Unsupported lifecycle operation");
  });
export const contentReceiptSchema = z
  .object({
    contentKind: contentKindSchema,
    contentId: z.uuid(),
    revisionId: z.uuid(),
    revision: z.number().int().positive(),
    state: contentStateSchema,
    digest,
    snapshot: z.unknown(),
    auditId: z.uuid(),
    outboxId: z.uuid(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      !(
        r.contentKind === "EVENT" ? eventContentSchema : noticeContentSchema
      ).safeParse(r.snapshot).success
    )
      ctx.addIssue({
        code: "custom",
        message: "Content receipt snapshot unconfirmed",
      });
    const parsed = (
      r.contentKind === "EVENT" ? eventContentSchema : noticeContentSchema
    ).safeParse(r.snapshot);
    if (
      parsed.success &&
      ["PREVIEWED", "APPROVED", "PUBLISHED"].includes(r.state) &&
      (!isSafeContentCopy(parsed.data, true) ||
        !hasValidContentWindow(parsed.data, true))
    )
      ctx.addIssue({
        code: "custom",
        message: "Unapproved content schedule/copy",
      });
  });
export type ContentCommand = z.infer<typeof contentCommandSchema>;
export type ContentReceipt = z.infer<typeof contentReceiptSchema>;
export const contentReviewSchema = z
  .object({ items: z.array(contentReceiptSchema) })
  .strict();
export function isSafeContentCopy(payload: LiveopsContent, ready = false) {
  const originalCopy = Object.entries(payload)
    .filter(([key]) =>
      [
        "title",
        "summary",
        "body",
        "ctaLabel",
        "cardTitle",
        "participation",
        "exclusion",
      ].includes(key),
    )
    .map(([, value]) => value)
    .filter((x): x is string => typeof x === "string")
    .join(" ");
  const copy = ready
    ? originalCopy
    : originalCopy.replace(/\{\{[a-z_]+\}\}/g, "");
  return (
    !/<[!/?a-z]|admin\.mining\.putduk\.com|service_role|SUPABASE_SECRET_KEY|(?:^|[^a-z0-9])(?:V1|revision|policy|server|snapshot|internal|architecture)(?:[^a-z0-9]|$)|가상\s*채굴|virtual\s+mining/i.test(
      copy,
    ) &&
    (!ready || !/\{\{|\}\}/.test(copy))
  );
}
export function hasValidContentWindow(payload: LiveopsContent, ready: boolean) {
  if ("startsAt" in payload)
    return (
      (!payload.startsAt && !payload.endsAt && !ready) ||
      Boolean(
        payload.startsAt &&
        payload.endsAt &&
        Date.parse(payload.endsAt) > Date.parse(payload.startsAt),
      )
    );
  return (
    (!ready || Boolean(payload.publishedAt)) &&
    (!payload.expiresAt ||
      !payload.publishedAt ||
      Date.parse(payload.expiresAt) > Date.parse(payload.publishedAt))
  );
}
export const CONTENT_OPERATION_STATE = {
  CREATE_DRAFT: "DRAFT",
  UPDATE_DRAFT: "DRAFT",
  PREVIEW: "PREVIEWED",
  APPROVE: "APPROVED",
  PUBLISH: "PUBLISHED",
  CANCEL: "CANCELLED",
  ARCHIVE: "ARCHIVED",
} as const;
