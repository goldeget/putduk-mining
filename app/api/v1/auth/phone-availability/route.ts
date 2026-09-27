import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import {
  isSignupPhoneAvailability,
  normalizeSignupPhone,
} from "@/domain/identity/signup-phone";
import { getPublicEnv } from "@/lib/env/public";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  phone: z.string().trim().min(8).max(32),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(getPublicEnv().NEXT_PUBLIC_APP_URL).origin;
  } catch {
    return apiError({
      code: "AUTH_SERVICE_UNAVAILABLE",
      message: "계정 서비스를 연결하지 못했어요.",
      status: 503,
    });
  }

  if (request.headers.get("origin") !== expectedOrigin) {
    return apiError({
      code: "INVALID_ORIGIN",
      message: "요청을 확인할 수 없습니다.",
      status: 403,
    });
  }

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success || !normalizeSignupPhone(parsed.data.phone)) {
    return apiError({
      code: "INVALID_PHONE",
      message: "휴대폰 번호 형식을 확인해 주세요.",
      status: 400,
    });
  }

  let result: unknown;
  let failed = false;
  try {
    const admin = createSupabaseAdminClient();
    const response = await admin.rpc("signup_phone_availability", {
      p_raw: parsed.data.phone,
    });
    result = response.data;
    failed = Boolean(response.error) || !isSignupPhoneAvailability(result);
  } catch {
    failed = true;
  }

  if (failed) {
    return apiError({
      code: "PHONE_CHECK_FAILED",
      message: "휴대폰 번호를 확인하지 못했어요.",
      status: 503,
    });
  }

  // Enumeration-resistant: only AVAILABLE | UNAVAILABLE, never account fields.
  return apiSuccess({ availability: result as "AVAILABLE" | "UNAVAILABLE" });
}
