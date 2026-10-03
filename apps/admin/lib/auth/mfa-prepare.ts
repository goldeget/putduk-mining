import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdminMfaPreparePayload } from "@/lib/auth/mfa-prepare-types";
import { createAdminServerClient } from "@/lib/supabase/server";

async function prepareWithClient(
  supabase: SupabaseClient,
): Promise<AdminMfaPreparePayload> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return {
      status: "session_missing",
      message: "로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.",
    };
  }

  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error || !factors) {
    return {
      status: "retry",
      message: "다중 인증 정보를 불러오지 못했습니다. 잠시 후 다시 시도합니다.",
    };
  }

  const totpFactors = factors.totp ?? [];
  const allFactors = factors.all ?? [];
  const verified = totpFactors.find((factor) => factor.status === "verified");
  if (verified) {
    if (typeof verified.id !== "string" || !verified.id.trim()) {
      return {
        status: "retry",
        message:
          "인증 정보를 확인하지 못했습니다. 연결을 확인한 뒤 다시 시도합니다.",
      };
    }
    return {
      status: "ready",
      mode: "verify",
      factorId: verified.id,
      enrolment: null,
      message: "인증 앱에 표시된 6자리 코드를 입력해 주세요.",
    };
  }

  const staleUnverified = allFactors.filter(
    (factor) => factor.factor_type === "totp" && factor.status === "unverified",
  );
  const cleanup = await Promise.all(
    staleUnverified.map((factor) =>
      supabase.auth.mfa.unenroll({ factorId: factor.id }),
    ),
  );
  if (cleanup.some(({ error: cleanupError }) => cleanupError)) {
    return {
      status: "retry",
      message:
        "이전 인증 앱 등록을 정리하지 못했습니다. 잠시 후 다시 시도합니다.",
    };
  }

  const { data, error: enrollError } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `PUTDUK Admin ${Date.now().toString(36)}`,
    issuer: "PUTDUK MINING",
  });
  if (enrollError || !data || data.type !== "totp") {
    return {
      status: "retry",
      message: "인증 앱 등록을 시작하지 못했습니다. 잠시 후 다시 시도합니다.",
    };
  }

  return {
    status: "ready",
    mode: "enroll",
    factorId: data.id,
    enrolment: {
      id: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    },
    message: "인증 앱에 QR을 등록한 뒤 6자리 코드를 입력해 주세요.",
  };
}

/** SSR·서버 액션 공통: HttpOnly 세션 쿠키로 MFA 등록/검증 준비를 수행한다. */
export async function prepareAdminMfaOnServer(): Promise<AdminMfaPreparePayload> {
  const supabase = await createAdminServerClient();
  try {
    return await prepareWithClient(supabase);
  } catch {
    return {
      status: "retry",
      message:
        "인증 정보를 확인하지 못했습니다. 연결을 확인한 뒤 다시 시도합니다.",
    };
  }
}
