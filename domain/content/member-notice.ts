import { z } from "zod";

import { CONTENT_CTA_ROUTES } from "./contract";

const noticeCtaFields = {
  cta_label_ko: z
    .string()
    .max(80)
    .refine((value) => value.trim().length > 0)
    .nullable()
    .optional()
    .default(null),
  cta_route: z.enum(CONTENT_CTA_ROUTES).nullable().optional().default(null),
  content_revision_id: z.uuid().nullable().optional().default(null),
};
const noticeCtaSchema = z
  .object(noticeCtaFields)
  .superRefine((value, context) => {
    const values = [
      value.cta_label_ko,
      value.cta_route,
      value.content_revision_id,
    ];
    if (
      values.some((field) => field !== null) &&
      values.some((field) => field === null)
    )
      context.addIssue({
        code: "custom",
        message: "Incomplete notice source binding",
      });
  });

export function readMemberNoticeCta(
  notice: unknown,
): { label: string; route: (typeof CONTENT_CTA_ROUTES)[number] } | null {
  const parsed = noticeCtaSchema.safeParse(notice);
  if (
    !parsed.success ||
    parsed.data.cta_label_ko === null ||
    parsed.data.cta_route === null ||
    parsed.data.content_revision_id === null
  )
    return null;
  return { label: parsed.data.cta_label_ko, route: parsed.data.cta_route };
}

/** Published RLS projection; the member page authenticates separately. No private receipts are read. */
export const memberNoticeSchema = z
  .object({
    id: z.uuid(),
    slug: z
      .string()
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title_ko: z.string().min(1).max(120),
    summary_ko: z.string().min(1).max(500),
    body_markdown: z.string().min(1).max(20000),
    status: z.literal("PUBLISHED"),
    published_at: z.iso.datetime({ offset: true }),
    expires_at: z.iso.datetime({ offset: true }).nullable(),
    is_pinned: z.boolean(),
    ...noticeCtaFields,
  })
  .superRefine((value, context) => {
    if (!noticeCtaSchema.safeParse(value).success)
      context.addIssue({
        code: "custom",
        message: "Incomplete notice source binding",
      });
  });

/** A small text-only Markdown subset. HTML, links and scripts stay inert text. */
export function noticeTextBlocks(body: string): Array<{
  kind: "heading" | "paragraph" | "list";
  lines: string[];
}> {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .filter((part) => part.trim())
    .map((part) => {
      const lines = part.trim().split("\n");
      const first = lines[0] ?? "";
      if (lines.length === 1 && /^#{1,3}\s/.test(first)) {
        return { kind: "heading", lines: [first.replace(/^#{1,3}\s+/, "")] };
      }
      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        return {
          kind: "list",
          lines: lines.map((line) => line.replace(/^[-*]\s+/, "")),
        };
      }
      return { kind: "paragraph", lines };
    });
}
