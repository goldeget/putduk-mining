import { z } from "zod";

/** A draft and a human submission share input validation, never confirmation. */
export const usdtDepositDraftInput = z.strictObject({
  depositId: z.uuid(),
  creditedKrw: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{0,14}$/),
  reason: z.string().trim().min(10).max(500),
});

export const usdtDepositConfirmInput = usdtDepositDraftInput.extend({
  confirmation: z.literal("CONFIRM_USDT_DEPOSIT"),
});
