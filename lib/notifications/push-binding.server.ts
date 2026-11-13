import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getVerifiedMemberSession } from "@/lib/auth/verified-member-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type PushIdentity = {
  supabase: SupabaseClient;
  userId: string;
  authSessionId: string;
};
export type PushBindingOperation =
  "REGISTER" | "REVOKE" | "LOGOUT_LOCAL" | "LOGOUT_GLOBAL";
const uuid = z.uuid();
const receiptSchema = z.strictObject({
  subscribed: z.boolean(),
  operation: z.enum(["REGISTER", "REVOKE", "LOGOUT_LOCAL", "LOGOUT_GLOBAL"]),
  scope: z.enum(["CURRENT_SESSION", "CURRENT_ENDPOINT", "LOCAL", "GLOBAL"]),
  authSessionId: uuid,
  receiptId: uuid,
  subscriptionId: uuid.nullable(),
});

/** Verified signed claims and Auth user must identify exactly the same session owner. */
export async function getVerifiedPushIdentity(): Promise<PushIdentity | null> {
  return getVerifiedMemberSession();
}

/** Pure strict validator also used by no-network unit tests. */
export function validatePushBindingReceipt(
  value: unknown,
  input: {
    operation: PushBindingOperation;
    authSessionId: string;
  },
) {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) return null;
  const receipt = parsed.data;
  const expectedScope = {
    REGISTER: "CURRENT_SESSION",
    REVOKE: "CURRENT_ENDPOINT",
    LOGOUT_LOCAL: "LOCAL",
    LOGOUT_GLOBAL: "GLOBAL",
  }[input.operation];
  if (
    receipt.operation !== input.operation ||
    receipt.authSessionId !== input.authSessionId ||
    receipt.scope !== expectedScope ||
    receipt.subscribed !== (input.operation === "REGISTER") ||
    (input.operation === "REGISTER"
      ? receipt.subscriptionId === null
      : receipt.subscriptionId !== null)
  )
    return null;
  return receipt;
}

export async function applyPushBinding(
  identity: PushIdentity,
  input: { operation: "LOGOUT_LOCAL" | "LOGOUT_GLOBAL" },
) {
  const result = await createSupabaseAdminClient().rpc(
    "apply_member_push_binding",
    {
      p_user_id: identity.userId,
      p_auth_session_id: identity.authSessionId,
      p_operation: input.operation,
      p_endpoint: null,
      p_p256dh: null,
      p_auth_secret: null,
      p_expires_at: null,
      p_user_agent: null,
    },
  );
  if (result.error)
    return {
      ok: false as const,
      code: result.error.message.includes("PUSH_ENDPOINT_RETIRED")
        ? "PUSH_ENDPOINT_RETIRED"
        : result.error.message.includes("PUSH_SUBSCRIPTION_OWNERSHIP_CONFLICT")
          ? "PUSH_SUBSCRIPTION_CONFLICT"
          : /PUSH_(ACTIVE_SESSION_REQUIRED|SESSION_REVOKED)/.test(
                result.error.message,
              )
            ? "PUSH_SESSION_REQUIRED"
            : "PUSH_SUBSCRIPTION_UNAVAILABLE",
    };
  const receipt = validatePushBindingReceipt(result.data, {
    operation: input.operation,
    authSessionId: identity.authSessionId,
  });
  return receipt
    ? { ok: true as const, receipt }
    : { ok: false as const, code: "PUSH_SUBSCRIPTION_UNAVAILABLE" };
}

export { validatePushEndpointResult } from "./push-endpoint-command.server";
import {
  applyPushEndpoint as applySharedEndpoint,
  type PushEndpointInput,
} from "./push-endpoint-command.server";
export type { PushEndpointInput } from "./push-endpoint-command.server";
export async function applyPushEndpoint(
  identity: PushIdentity,
  input: PushEndpointInput,
) {
  return applySharedEndpoint(identity, input, createSupabaseAdminClient());
}
