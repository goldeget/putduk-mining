import { z } from "zod";

// The existing member-only view has exactly these eight public fields.
// This validates a read; it creates no policy, amount or activation.
export const memberCashEventTermsSchema = z.strictObject({
  event_id: z.uuid(),
  content_revision_id: z.uuid(),
  terms_version: z.number().int().positive(),
  terms_ko: z.string().min(10).max(1000),
  cash_terms_digest: z.string().regex(/^[a-f0-9]{64}$/),
  reward_krw: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .refine((value) => value.length < 19 || value <= "9223372036854775807"),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
});
export type MemberCashEventTerms = z.infer<typeof memberCashEventTermsSchema>;

export function readBoundMemberCashTerms(
  data: unknown,
  eventId: string,
  revisionId: string,
  nowIso: string,
) {
  const parsed = memberCashEventTermsSchema.safeParse(data);
  if (!parsed.success) return null;
  const row = parsed.data,
    now = Date.parse(nowIso);
  if (
    row.event_id !== eventId ||
    row.content_revision_id !== revisionId ||
    !Number.isFinite(now) ||
    Date.parse(row.starts_at) > now ||
    Date.parse(row.ends_at) <= now
  )
    return null;
  return row;
}
