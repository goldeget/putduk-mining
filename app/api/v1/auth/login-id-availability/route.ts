import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { getPublicEnv } from "@/lib/env/public";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  loginId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{3,19}$/),
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
  if (!parsed.success) {
    return apiError({
      code: "INVALID_LOGIN_ID",
      message: "아이디 형식을 확인해 주세요.",
      status: 400,
    });
  }

  let data: unknown;
  let failed = false;
  try {
    const admin = createSupabaseAdminClient();
    const result = await admin.rpc("is_login_id_available", {
      p_login_id: parsed.data.loginId,
    });
    data = result.data;
    failed = Boolean(result.error) || typeof data !== "boolean";
  } catch {
    failed = true;
  }

  if (failed) {
    return apiError({
      code: "LOGIN_ID_CHECK_FAILED",
      message: "아이디를 확인하지 못했어요.",
      status: 503,
    });
  }

  return apiSuccess({ available: data as boolean });
}
