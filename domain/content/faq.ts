import { z } from "zod";

export const ORIGINAL_FAQ_SOURCE_DIGEST =
  "4f0b01d18c82ceb6e477eabe72446afc76abd63d5bd82450e9bbc5799fc8533b";
export const FAQ_MAX_SERIALIZED_BYTES = 65536;
const text = (max: number) => z.string().trim().min(1).max(max);
const time = z.iso.datetime({ offset: true });
export const faqEntrySchema = z.strictObject({
  stableEntryId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  question: text(200),
  answer: text(4000),
});
const entries = z
  .array(faqEntrySchema)
  .min(1)
  .max(100)
  .refine(
    (rows) =>
      new Set(rows.map((row) => row.stableEntryId)).size === rows.length,
    { message: "Duplicate FAQ entry identifier" },
  );

export function isBoundedFaqPayload(payload: unknown) {
  try {
    // JSONB renders one space after each object colon and list separator.
    // Key order does not affect byte size; FAQ payloads have no numeric values.
    const jsonbText = (value: unknown): string | undefined => {
      if (Array.isArray(value)) return `[${value.map(jsonbText).join(", ")}]`;
      if (value && typeof value === "object")
        return `{${Object.entries(value)
          .map(([key, entry]) => `${JSON.stringify(key)}: ${jsonbText(entry)}`)
          .join(", ")}}`;
      return JSON.stringify(value);
    };
    const serialized = jsonbText(payload);
    return (
      typeof serialized === "string" &&
      new TextEncoder().encode(serialized).byteLength <=
        FAQ_MAX_SERIALIZED_BYTES
    );
  } catch {
    return false;
  }
}

export const faqContentSchema = z
  .strictObject({
    slug: z.literal("member-faq"),
    title: text(140),
    summary: text(600),
    audience: z.literal("MEMBERS"),
    segment: z.literal("ALL_MEMBERS"),
    locale: z.literal("ko-KR"),
    entries,
    sourceDigest: z.literal(ORIGINAL_FAQ_SOURCE_DIGEST),
    publishedAt: time.nullable(),
    expiresAt: time.nullable(),
  })
  .refine(isBoundedFaqPayload, { message: "FAQ payload exceeds byte limit" })
  .refine(
    (row) =>
      !row.expiresAt ||
      Boolean(
        row.publishedAt &&
        Date.parse(row.expiresAt) > Date.parse(row.publishedAt),
      ),
    { message: "Invalid FAQ publication window" },
  );

export type FaqContent = z.infer<typeof faqContentSchema>;

/** Member projection only: no draft, audit, admin, source path or grant fields. */
export const memberFaqSchema = z
  .strictObject({
    contentId: z.uuid(),
    revisionId: z.uuid(),
    revision: z.number().int().positive(),
    title: text(140),
    summary: text(600),
    locale: z.literal("ko-KR"),
    audience: z.literal("MEMBERS"),
    entries,
    publishedAt: time,
    expiresAt: time.nullable(),
    sourceDigest: z.literal(ORIGINAL_FAQ_SOURCE_DIGEST),
  })
  .refine(
    (row) =>
      isBoundedFaqPayload({
        slug: "member-faq",
        title: row.title,
        summary: row.summary,
        audience: row.audience,
        segment: "ALL_MEMBERS",
        locale: row.locale,
        entries: row.entries,
        sourceDigest: row.sourceDigest,
        publishedAt: row.publishedAt,
        expiresAt: row.expiresAt,
      }),
    { message: "FAQ payload exceeds byte limit" },
  )
  .refine(
    (row) =>
      !row.expiresAt || Date.parse(row.expiresAt) > Date.parse(row.publishedAt),
    { message: "Invalid FAQ publication window" },
  );
export type MemberFaq = z.infer<typeof memberFaqSchema>;
