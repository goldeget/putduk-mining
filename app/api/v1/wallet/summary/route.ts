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
    .from("wallet_balance_snapshots")
    .select("*")
    .eq("user_id", identity.userId)
    .order("currency");

  if (error) {
    return apiError({
      code: "WALLET_UNAVAILABLE",
      message: "자산 정보를 불러오지 못했습니다.",
      status: 503,
    });
  }

  return apiSuccess({ accounts: data });
}
