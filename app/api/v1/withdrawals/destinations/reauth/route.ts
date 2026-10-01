import { apiError, apiSuccess } from "@/lib/api/http";
import {
  getWithdrawalReauthIdentity,
  isWithdrawalReauthOriginAllowed,
  issueWithdrawalDestinationProof,
  withdrawalReauthSchema,
} from "@/lib/security/withdrawal-destination-reauth.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isWithdrawalReauthOriginAllowed(request))
    return apiError({
      code: "ORIGIN_DENIED",
      message: "요청을 다시 확인해 주세요.",
      status: 403,
    });
  const identity = await getWithdrawalReauthIdentity();
  if (!identity)
    return apiError({
      code: "UNAUTHENTICATED",
      message: "다시 로그인해 주세요.",
      status: 401,
    });
  const parsed = withdrawalReauthSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return apiError({
      code: "WITHDRAWAL_REAUTH_FAILED",
      message: "비밀번호와 인증 정보를 다시 확인해 주세요.",
      status: 400,
    });
  try {
    const result = await issueWithdrawalDestinationProof(identity, parsed.data);
    if (!result.ok)
      return apiError({
        code: result.code,
        message:
          result.code === "WITHDRAWAL_REAUTH_MFA_REQUIRED"
            ? "인증 앱의 숫자 6자리를 입력해 주세요."
            : result.code === "WITHDRAWAL_REAUTH_RATE_LIMITED"
              ? "시도가 많아요. 15분 뒤 다시 확인해 주세요."
              : "비밀번호와 인증 정보를 다시 확인해 주세요.",
        status:
          result.code === "WITHDRAWAL_REAUTH_RATE_LIMITED"
            ? 429
            : result.code === "WITHDRAWAL_REAUTH_UNAVAILABLE"
              ? 503
              : 403,
      });
    return apiSuccess({ token: result.token, expiresAt: result.expiresAt });
  } catch {
    return apiError({
      code: "WITHDRAWAL_REAUTH_UNAVAILABLE",
      message: "잠시 후 다시 확인해 주세요.",
      status: 503,
    });
  }
}
