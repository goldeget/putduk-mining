import { z } from "zod";

import { usdtDepositDraftInput } from "@/lib/deposits/usdt-confirm-input";

export const OPERATOR_DRAFT_LIFETIME_MS = 300_000;

export const usdtOperatorDraftSchema = z.strictObject({
  task: z.literal("usdt-deposit-draft"),
  command: z.literal("confirm_usdt_manual_deposit"),
  input: usdtDepositDraftInput,
  targetCreatedAt: z.iso.datetime({ offset: true }),
  preparedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  href: z.literal("/deposits/usdt"),
  canExecute: z.literal(false),
});

export type UsdtOperatorDraft = z.infer<typeof usdtOperatorDraftSchema>;

export function usableOperatorDraft(
  value: unknown,
  now = Date.now(),
): UsdtOperatorDraft | null {
  const parsed = usdtOperatorDraftSchema.safeParse(value);
  if (!parsed.success || !Number.isFinite(now)) return null;
  const prepared = Date.parse(parsed.data.preparedAt);
  const expires = Date.parse(parsed.data.expiresAt);
  if (
    expires - prepared !== OPERATOR_DRAFT_LIFETIME_MS ||
    expires <= now ||
    prepared > now + 60_000
  )
    return null;
  return parsed.data;
}

export const usdtPendingSnapshotSchema = z
  .strictObject({
    task: z.literal("usdt-deposit-pending"),
    count: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    oldestAt: z.iso.datetime({ offset: true }).nullable(),
    observedAt: z.iso.datetime(),
    href: z.literal("/deposits/usdt"),
  })
  .refine((value) =>
    value.count === 0 ? value.oldestAt === null : value.oldestAt !== null,
  );

export type UsdtPendingSnapshot = z.infer<typeof usdtPendingSnapshotSchema>;
