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

type SubscriptionInput = {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
};
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

const epoch = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const snapshotSchema = z.strictObject({
  operation: z.literal("SNAPSHOT"),
  authSessionId: uuid,
  endpointEpoch: epoch,
  subscribed: z.boolean(),
});
const permitSchema = z.strictObject({
  operation: z.literal("ISSUE"),
  authSessionId: uuid,
  endpointEpoch: epoch,
  intentId: uuid,
  permitId: uuid,
});
const endpointReceiptSchema = receiptSchema.extend({
  endpointEpoch: epoch,
  intentId: uuid,
  permitId: uuid.nullable(),
});
export type PushEndpointInput =
  | { operation: "SNAPSHOT"; endpoint: string }
  | {
      operation: "ISSUE";
      subscription: SubscriptionInput;
      expectedEpoch: number;
      intentId: string;
      userAgent: string;
    }
  | {
      operation: "REGISTER";
      subscription: SubscriptionInput;
      expectedEpoch: number;
      intentId: string;
      permitId: string;
      userAgent: string;
    }
  | { operation: "REVOKE"; endpoint: string; intentId: string };
/** All DB JSON is untrusted until operation/session/intent/epoch are matched. */
export function validatePushEndpointResult(
  value: unknown,
  input: PushEndpointInput,
  authSessionId: string,
) {
  if (input.operation === "SNAPSHOT") {
    const r = snapshotSchema.safeParse(value);
    return r.success && r.data.authSessionId === authSessionId ? r.data : null;
  }
  if (input.operation === "ISSUE") {
    const r = permitSchema.safeParse(value);
    return r.success &&
      r.data.authSessionId === authSessionId &&
      r.data.intentId === input.intentId &&
      r.data.endpointEpoch === input.expectedEpoch
      ? r.data
      : null;
  }
  const r = endpointReceiptSchema.safeParse(value);
  if (!r.success) return null;
  const v = r.data;
  if (
    v.authSessionId !== authSessionId ||
    v.intentId !== input.intentId ||
    v.operation !== input.operation ||
    v.subscribed !== (input.operation === "REGISTER") ||
    v.scope !==
      (input.operation === "REGISTER" ? "CURRENT_SESSION" : "CURRENT_ENDPOINT")
  )
    return null;
  if (
    input.operation === "REGISTER"
      ? v.subscriptionId === null ||
        v.endpointEpoch !== input.expectedEpoch + 1 ||
        v.permitId !== input.permitId
      : v.subscriptionId !== null || v.permitId !== null
  )
    return null;
  return v;
}
export async function applyPushEndpoint(
  identity: PushIdentity,
  input: PushEndpointInput,
) {
  const sub =
    input.operation === "ISSUE" || input.operation === "REGISTER"
      ? input.subscription
      : null;
  const result = await createSupabaseAdminClient().rpc(
    "member_push_endpoint_command",
    {
      p_user_id: identity.userId,
      p_auth_session_id: identity.authSessionId,
      p_operation: input.operation,
      p_endpoint:
        sub?.endpoint ?? ("endpoint" in input ? input.endpoint : null),
      p_p256dh: sub?.keys.p256dh ?? null,
      p_auth_secret: sub?.keys.auth ?? null,
      p_expires_at: sub?.expirationTime
        ? new Date(sub.expirationTime).toISOString()
        : null,
      p_user_agent: "userAgent" in input ? input.userAgent.slice(0, 512) : null,
      p_expected_epoch: "expectedEpoch" in input ? input.expectedEpoch : null,
      p_intent_id: "intentId" in input ? input.intentId : null,
      p_permit_id: "permitId" in input ? input.permitId : null,
    },
  );
  if (result.error) {
    const m = result.error.message;
    return {
      ok: false as const,
      code: /PUSH_SUBSCRIPTION_OWNERSHIP_CONFLICT/.test(m)
        ? "PUSH_SUBSCRIPTION_CONFLICT"
        : /PUSH_REVOKE_SUPERSEDED/.test(m)
          ? "PUSH_REVOKE_SUPERSEDED"
          : /PUSH_(EPOCH_STALE|PERMIT_EXPIRED|PERMIT_INVALID|INTENT_MISMATCH)/.test(
                m,
              )
            ? "PUSH_INTENT_STALE"
            : /PUSH_(ACTIVE_SESSION_REQUIRED|SESSION_REVOKED)/.test(m)
              ? "PUSH_SESSION_REQUIRED"
              : "PUSH_SUBSCRIPTION_UNAVAILABLE",
    };
  }
  const receipt = validatePushEndpointResult(
    result.data,
    input,
    identity.authSessionId,
  );
  return receipt
    ? { ok: true as const, receipt }
    : { ok: false as const, code: "PUSH_SUBSCRIPTION_UNAVAILABLE" };
}
