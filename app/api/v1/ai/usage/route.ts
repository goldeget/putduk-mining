import { matchesAiPresentationOwner } from "@/domain/ai/presentation-owner";
import { readOwnAiQuota, readOwnProviderUsage } from "@/lib/ai/member-usage";
import { apiError, apiSuccess } from "@/lib/api/http";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const identity = await getVerifiedIdentity();
  if (!identity)
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  if (!matchesAiPresentationOwner(request.headers, identity.userId))
    return apiError({
      code: "AI_SESSION_CHANGED",
      message: "로그인 상태가 바뀌었어요. 다시 확인해 주세요.",
      status: 409,
    });
  try {
    const env = getServerEnv();
    const observedAtMs = Date.now();
    const [rolling24h, rollingMinute, providerAttempts] = await Promise.all([
      readOwnAiQuota(identity.supabase, {
        userId: identity.userId,
        observedAtMs,
        windowMs: 86_400_000,
        limit: env.AI_MAX_REQUESTS_PER_DAY,
      }),
      readOwnAiQuota(identity.supabase, {
        userId: identity.userId,
        observedAtMs,
        windowMs: 60_000,
        limit: env.AI_MAX_REQUESTS_PER_MINUTE,
      }),
      readOwnProviderUsage(createSupabaseAdminClient(), identity.userId),
    ]);
    return apiSuccess({
      ownerId: identity.userId,
      observedAt: new Date(observedAtMs).toISOString(),
      rolling24h,
      rollingMinute,
      providerAttempts,
    });
  } catch {
    return apiError({
      code: "AI_USAGE_UNAVAILABLE",
      message: "사용량을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      status: 503,
    });
  }
}
