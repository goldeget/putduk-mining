import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { getVerifiedIdentity } from "@/lib/auth/session";

const preferenceSchema = z
  .object({
    events_enabled: z.boolean().optional(),
    marketing_enabled: z.boolean().optional(),
    mining_enabled: z.boolean().optional(),
    service_enabled: z.boolean().optional(),
    wallet_enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  }

  const parsed = preferenceSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError({
      code: "INVALID_NOTIFICATION_PREFERENCES",
      message: "알림 설정을 확인해 주세요.",
      status: 400,
    });
  }

  const { data, error } = await identity.supabase
    .from("notification_preferences")
    .update(parsed.data)
    .eq("user_id", identity.userId)
    .select(
      "mining_enabled, wallet_enabled, events_enabled, service_enabled, marketing_enabled, web_push_enabled",
    )
    .single();

  if (error) {
    return apiError({
      code: "NOTIFICATION_PREFERENCES_UNAVAILABLE",
      message: "알림 설정을 저장하지 못했습니다.",
      status: 503,
    });
  }

  return apiSuccess({ preferences: data });
}
