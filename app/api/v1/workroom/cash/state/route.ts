import { apiError, apiSuccess } from "@/lib/api/http";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { readWorkroomCash } from "@/lib/wallet/read-workroom-cash.server";
export const dynamic = "force-dynamic";
export async function GET() {
  const identity = await getVerifiedIdentity();
  if (!identity)
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  const cash = await readWorkroomCash(identity);
  return cash
    ? apiSuccess({ cash })
    : apiError({
        code: "WORKROOM_CASH_UNAVAILABLE",
        message: "실제 잔액을 확인하지 못했습니다.",
        status: 503,
      });
}
