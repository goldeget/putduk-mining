import { z } from "zod";

/** Authenticated RLS projection only; never reads private review receipts. */
export const memberNoticeSchema = z.object({
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
