import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getPublicEnv } from "@/lib/env/public";
import { readBoundedJsonBody } from "@/lib/api/request-body";
import { apiError, apiSuccess } from "@/lib/api/http";
export const dynamic = "force-dynamic";
const input = z.strictObject({ digit: z.string().regex(/^[1-8]$/) });
export async function POST(request: Request) {
  if (
    request.headers.get("origin") !==
    new URL(getPublicEnv().NEXT_PUBLIC_APP_URL).origin
  )
    return apiError({
      code: "ORIGIN_DENIED",
      message: "같은 사이트에서 다시 시도해 주세요.",
      status: 403,
    });
  const identity = await getVerifiedIdentity();
  if (!identity)
    return apiError({
      code: "UNAUTHENTICATED",
      message: "다시 로그인해 주세요.",
      status: 401,
    });
  const body = await readBoundedJsonBody(request, 256);
  const parsed = input.safeParse(body.ok ? body.value : null);
  if (!parsed.success)
    return apiError({
      code: "INVALID_BIRTH_DIGIT",
      message: "뒷자리 첫 숫자 한 자리만 입력해 주세요.",
      status: 400,
    });
  const { data, error } = await createSupabaseAdminClient().rpc(
    "complete_workroom_birth_digit",
    {
      p_user_id: identity.userId,
      p_digit: parsed.data.digit,
      p_request_id: randomUUID(),
    },
  );
  if (error) {
    const recorded = error.message.includes("BIRTH_DIGIT_ALREADY_RECORDED");
    const mismatch = error.message.includes("BIRTH_DIGIT_CENTURY_MISMATCH");
    return apiError({
      code: recorded
        ? "BIRTH_DIGIT_ALREADY_RECORDED"
        : mismatch
          ? "BIRTH_DIGIT_CENTURY_MISMATCH"
          : "BIRTH_DIGIT_UNCONFIRMED",
      message: recorded
        ? "이미 등록된 숫자는 변경할 수 없습니다."
        : mismatch
          ? "등록된 생년월일과 맞는 숫자인지 확인해 주세요."
          : "저장 결과를 확인하지 못했습니다. 다시 시도해 주세요.",
      status: recorded ? 409 : mismatch ? 400 : 503,
    });
  }
  if (data?.completed !== true || data?.digit !== parsed.data.digit)
    return apiError({
      code: "BIRTH_DIGIT_UNCONFIRMED",
      message: "저장 결과를 다시 확인해 주세요.",
      status: 503,
    });
  return apiSuccess({ completed: true, digit: data.digit });
}
