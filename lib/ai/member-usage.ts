import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const decimalInteger = z.string().regex(/^\d+$/);
const providerUsage = z.object({
  attemptCount: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  inputTokens: decimalInteger.nullable(),
  outputTokens: decimalInteger.nullable(),
  costMicroUsd: decimalInteger.nullable(),
  reservedCostMicroUsd: decimalInteger,
});
const ownProviderUsage = z.object({
  nvidia: providerUsage,
  free: providerUsage,
  paid: providerUsage,
  memberPaidEnabled: z.boolean(),
  memberPaidCapMicroUsd: decimalInteger.nullable(),
});

/** Canonical service-only projection; private budget rows are never exposed. */
export async function readOwnProviderUsage(
  supabase: SupabaseClient,
  userId: string,
) {
  const { data, error } = await supabase.rpc("read_ai_provider_usage", {
    p_user_id: userId,
  });
  const result = ownProviderUsage.safeParse(data);
  if (error || !result.success) throw new Error("AI_USAGE_UNAVAILABLE");
  return result.data;
}

export type MemberAiQuota = {
  used: number;
  limit: number;
  nextAvailableAt: string | null;
};

/** Same rolling windows and all admitted statuses as begin_ai_request_v2.
 * Counts are exact, never inferred from a paginated transcript or tokens. */
export async function readOwnAiQuota(
  supabase: SupabaseClient,
  input: {
    userId: string;
    observedAtMs: number;
    windowMs: number;
    limit: number;
  },
): Promise<MemberAiQuota> {
  const start = new Date(input.observedAtMs - input.windowMs).toISOString();
  const end = new Date(input.observedAtMs).toISOString();
  const countResult = await supabase
    .from("ai_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.userId)
    .gte("created_at", start)
    .lte("created_at", end);
  if (
    countResult.error ||
    countResult.count === null ||
    !Number.isSafeInteger(countResult.count) ||
    countResult.count < 0
  )
    throw new Error("AI_USAGE_UNAVAILABLE");
  const used = countResult.count;
  if (used < input.limit)
    return { used, limit: input.limit, nextAvailableAt: null };
  // If a limit was lowered, one expiry may not be enough. Select the exact
  // request whose expiry makes the rolling count lower than the current cap.
  const index = used - input.limit;
  const expiry = await supabase
    .from("ai_requests")
    .select("created_at")
    .eq("user_id", input.userId)
    .gte("created_at", start)
    .lte("created_at", end)
    .order("created_at", { ascending: true })
    .range(index, index)
    .maybeSingle();
  const time = Date.parse(expiry.data?.created_at ?? "");
  if (expiry.error || !Number.isFinite(time))
    throw new Error("AI_USAGE_UNAVAILABLE");
  return {
    used,
    limit: input.limit,
    nextAvailableAt: new Date(time + input.windowMs + 1).toISOString(),
  };
}
