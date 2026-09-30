import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { isActiveMemberNotification } from "@/domain/notifications/member-inbox";

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

  const now = new Date();
  const { data: existing, error: loadError } = await identity.supabase
    .from("notifications")
    .select("id, read_at, expires_at")
    .eq("id", parsed.data.notificationId)
    .eq("user_id", identity.userId)
    .maybeSingle();

  if (loadError) {
    return apiError({
      code: "NOTIFICATION_READ_FAILED",
      message: "읽음 상태를 저장하지 못했어요.",
      status: 503,
    });
  }

  // 다른 사용자 행은 RLS로 보이지 않으므로 존재하지 않음과 동일하게 처리한다.
  if (!existing) {
    return apiError({
      code: "NOTIFICATION_NOT_FOUND",
      message: "알림을 찾을 수 없어요.",
      status: 404,
    });
  }

  if (!isActiveMemberNotification(existing, now)) {
    return apiError({
      code: "NOTIFICATION_EXPIRED",
      message: "이 알림은 더 이상 확인할 수 없어요.",
      status: 410,
    });
  }

  if (existing.read_at) {
    return apiSuccess({
      notificationId: existing.id,
      alreadyRead: true,
    });
  }

  const { data, error } = await identity.supabase
    .from("notifications")
    .update({ read_at: now.toISOString() })
    .eq("id", existing.id)
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

  return apiSuccess({
    notificationId: data?.id ?? existing.id,
    alreadyRead: false,
  });
}
