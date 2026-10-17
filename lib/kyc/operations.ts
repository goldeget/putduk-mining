import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  KYC_UUID,
  sameKycPayload,
  type KycDocumentPayload,
} from "@/domain/kyc/evidence";
import { getVerifiedMemberSession } from "@/lib/auth/verified-member-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function getVerifiedKycIdentity() {
  const identity = await getVerifiedMemberSession();
  if (!identity) return null;
  const live = await createSupabaseAdminClient()
    .from("kyc_active_member_sessions")
    .select("id")
    .eq("id", identity.authSessionId)
    .eq("user_id", identity.userId)
    .maybeSingle();
  if (live.error) throw new Error("KYC_SESSION_UNCONFIRMED");
  if (!live.data) return null;
  return identity;
}

export class KycConflict extends Error {}
export type KycReceipt = {
  request_payload: unknown;
  result_id: string | null;
  completed_at: string | null;
  resolution: "CASE_CLOSED" | null;
};

/** The service-only RPC locks owner before receipt for both claim and rebind. */
export async function claimKycOperation(
  db: SupabaseClient,
  input: {
    userId: string;
    authSessionId: string;
    operation: "OPEN" | "SUBMIT";
    requestId: string;
    payload: KycDocumentPayload | Record<string, never>;
  },
): Promise<KycReceipt> {
  const result = await db.rpc("claim_kyc_operation", {
    p_user_id: input.userId,
    p_operation: input.operation,
    p_request_id: input.requestId.toLowerCase(),
    p_auth_session_id: input.authSessionId,
    p_request_payload: input.payload,
  });
  if (result.error) {
    if (result.error.message.includes("KYC_IDEMPOTENCY_CONFLICT"))
      throw new KycConflict("KYC_IDEMPOTENCY_CONFLICT");
    throw new Error(result.error.message);
  }
  const receipt = result.data as
    | (Partial<KycReceipt> & {
        user_id?: unknown;
        operation?: unknown;
        request_id?: unknown;
      })
    | null;
  if (
    !receipt ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    receipt.user_id !== input.userId ||
    receipt.operation !== input.operation ||
    receipt.request_id !== input.requestId.toLowerCase() ||
    !sameKycPayload(receipt.request_payload, input.payload) ||
    !(receipt.result_id === null || confirmedKycId(receipt.result_id)) ||
    !(receipt.resolution === null || receipt.resolution === "CASE_CLOSED") ||
    !(
      receipt.completed_at === null ||
      (typeof receipt.completed_at === "string" &&
        Number.isFinite(Date.parse(receipt.completed_at)))
    ) ||
    (receipt.result_id !== null && receipt.resolution !== null) ||
    (receipt.result_id !== null || receipt.resolution !== null) !==
      (receipt.completed_at !== null)
  )
    throw new Error("KYC_CLAIM_UNCONFIRMED");
  return receipt as KycReceipt;
}

export function confirmedKycId(value: unknown): value is string {
  return typeof value === "string" && KYC_UUID.test(value);
}
export function isKycConflict(error: unknown) {
  return (
    error instanceof KycConflict ||
    (error instanceof Error &&
      error.message.includes("KYC_IDEMPOTENCY_CONFLICT"))
  );
}
