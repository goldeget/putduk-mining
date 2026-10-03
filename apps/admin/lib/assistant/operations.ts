import "server-only";

import { z } from "zod";
import { OPERATOR_DRAFT_LIFETIME_MS } from "@/lib/assistant/draft";

import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { usdtDepositDraftInput } from "@/lib/deposits/usdt-confirm-input";

/** These are reads and drafts. There is deliberately no executor here. */
export const ADMIN_ASSISTANT_OPERATIONS = Object.freeze({
  "usdt-deposit-pending": Object.freeze({
    label: "USDT 입금 대기",
    href: "/deposits/usdt",
    allowedRoles: HIGH_IMPACT_ROLES,
    schema: z.strictObject({ task: z.literal("usdt-deposit-pending") }),
  }),
  "usdt-deposit-draft": Object.freeze({
    label: "USDT 입금 확인 초안",
    href: "/deposits/usdt",
    allowedRoles: HIGH_IMPACT_ROLES,
    command: "confirm_usdt_manual_deposit",
    commandFamily: ADMIN_COMMAND_FAMILIES.DEPOSIT_CONFIRM,
    schema: usdtDepositDraftInput.extend({
      task: z.literal("usdt-deposit-draft"),
    }),
  }),
});

export const adminAssistantInput = z.discriminatedUnion("task", [
  ADMIN_ASSISTANT_OPERATIONS["usdt-deposit-pending"].schema,
  ADMIN_ASSISTANT_OPERATIONS["usdt-deposit-draft"].schema,
]);

export { OPERATOR_DRAFT_LIFETIME_MS };
