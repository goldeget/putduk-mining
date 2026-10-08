import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type AttemptStatus =
  | "RESERVED"
  | "DISPATCHED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "UNKNOWN"
  | "NOT_SENT";
const receiptSchema = z
  .object({
    id: z.uuid(),
    status: z.enum([
      "RESERVED",
      "DISPATCHED",
      "SUCCEEDED",
      "FAILED",
      "CANCELLED",
      "UNKNOWN",
      "NOT_SENT",
    ]),
    replay: z.boolean(),
  })
  .passthrough();
export type AttemptReceipt = z.infer<typeof receiptSchema>;
export type ProviderAttemptPort = {
  admitFree: () => Promise<void>;
  reserve: (input: {
    attemptKey: string;
    provider: "nvidia" | "openrouter";
    model: string;
    maxCostMicroUsd: bigint;
    paid: boolean;
  }) => Promise<AttemptReceipt>;
  settle: (input: {
    attemptId: string;
    providerRequestId?: string;
    status: Exclude<AttemptStatus, "RESERVED">;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    costMicroUsd?: bigint | null;
  }) => Promise<AttemptReceipt>;
};

/** Only the canonical DB owner provides budget locks. No process-local counter
 * or guessed cost can substitute for an atomic durable admission receipt. */
export function createProviderAttemptPort(
  supabase: SupabaseClient,
  input: {
    userId: string;
    requestId: string;
    perMinuteLimit: number;
    perDayLimit: number;
  },
): ProviderAttemptPort {
  const call = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error("AI_PROVIDER_ADMISSION_FAILED");
    const receipt = receiptSchema.safeParse(data);
    if (!receipt.success) throw new Error("AI_PROVIDER_AUDIT_UNVERIFIED");
    return receipt.data;
  };
  return {
    async admitFree() {
      const { data, error } = await supabase.rpc(
        "admit_openrouter_free_request",
        {
          p_request_id: input.requestId,
          p_user_id: input.userId,
          p_per_minute_limit: Math.min(input.perMinuteLimit, 5),
          p_per_day_limit: Math.min(input.perDayLimit, 100),
        },
      );
      if (error || !data || data.admitted !== true)
        throw new Error("AI_FREE_POOL_LIMIT");
    },
    reserve(attempt) {
      return call("reserve_ai_provider_attempt", {
        p_user_id: input.userId,
        p_request_id: input.requestId,
        p_attempt_key: attempt.attemptKey,
        p_provider: attempt.provider,
        p_model_key: attempt.model,
        p_max_cost_micro_usd: attempt.maxCostMicroUsd.toString(),
        p_paid: attempt.paid,
      });
    },
    settle(attempt) {
      return call("settle_ai_provider_attempt", {
        p_user_id: input.userId,
        p_request_id: input.requestId,
        p_attempt_id: attempt.attemptId,
        p_provider_request_id: attempt.providerRequestId ?? null,
        p_status: attempt.status,
        p_input_tokens: attempt.inputTokens ?? null,
        p_output_tokens: attempt.outputTokens ?? null,
        p_cached_input_tokens: attempt.cachedInputTokens ?? null,
        p_cost_micro_usd: attempt.costMicroUsd?.toString() ?? null,
      });
    },
  };
}
