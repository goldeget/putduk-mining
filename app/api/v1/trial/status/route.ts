import { getVerifiedIdentity } from "@/lib/auth/session";
import { apiError, apiSuccess } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  }

  const { data, error } = await identity.supabase
    .from("trial_account_snapshots")
    .select("*")
    .eq("user_id", identity.userId)
    .maybeSingle();

  if (error) {
    return apiError({
      code: "TRIAL_STATUS_UNAVAILABLE",
      message: "체험 상태를 불러오지 못했습니다.",
      status: 503,
    });
  }

  return apiSuccess({ trial: data });
}
