import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { getVerifiedIdentity } from "@/lib/auth/session";

const paramsSchema = z.object({ notificationId: z.uuid() });

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ notificationId: string }> },
) {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  }

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return apiError({
      code: "INVALID_NOTIFICATION",
      message: "알림 정보를 확인해 주세요.",
      status: 400,
    });
  }

  const { data, error } = await identity.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data.notificationId)
    .eq("user_id", identity.userId)
    .is("read_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return apiError({
      code: "NOTIFICATION_READ_FAILED",
      message: "읽음 상태를 저장하지 못했어요.",
      status: 503,
    });
  }

  return apiSuccess({ notificationId: data?.id ?? parsed.data.notificationId });
}
