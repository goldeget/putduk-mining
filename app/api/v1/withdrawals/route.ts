import { apiError } from "@/lib/api/http";
import { getVerifiedIdentity } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Retired callers must recover their original request through the existing
// owner-scoped withdrawal history. This endpoint never creates a new money key.
export async function POST() {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  }

  return apiError({
    code: "LEGACY_WITHDRAWAL_FLOW_RETIRED",
    message:
      "출금 화면에서 정보를 다시 확인해 주세요. 이미 신청했다면 최근 출금 요청에서 결과를 확인해 주세요.",
    status: 409,
  });
}
