import { cookies } from "next/headers";
import { z } from "zod";

import { recordProductionAnalyticsEvent } from "@/lib/analytics/record-event.server";
import { getPublicEnv } from "@/lib/env/public";
import { SAFE_MODE_MEMBER_COPY } from "@/lib/safe-mode/app-guard";
import { assertComponentActive } from "@/lib/safe-mode/assert-component-active.server";
import { LEGAL_CONSENT_VERSIONS } from "@/lib/trust/legal-content";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordSignupContext } from "@/lib/security/signup-context.server";
import { signupBirthDate } from "@/domain/identity/signup-birth";

export const runtime = "nodejs";

// 약관·방침 본문(/terms, /privacy)과 같은 원천에서 버전을 가져온다.
const SERVICE_TERMS_VERSION = LEGAL_CONSENT_VERSIONS.serviceTerms;
const PRIVACY_VERSION = LEGAL_CONSENT_VERSIONS.privacy;
const MARKETING_VERSION = "MARKETING-KO-2026-09-27";

const signupSchema = z
  .object({
    birthSexDigit: z
      .string()
      .regex(/^[1-8]$/, "뒷자리 첫 숫자 1자리를 확인해 주세요."),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "생년월일을 확인해 주세요."),
    legalName: z
      .string()
      .trim()
      .min(2, "이름을 2자 이상 입력해 주세요.")
      .max(40, "이름은 40자 이하로 입력해 주세요."),
    loginId: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z][a-z0-9_]{3,19}$/,
        "아이디는 영문자로 시작하는 4~20자의 영문 소문자, 숫자, 밑줄만 사용할 수 있어요.",
      ),
    marketingConsent: z.boolean(),
    referralCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^WR-[A-Z0-9]{12,64}$/,
        "담당자에게 받은 추천인 코드를 확인해 주세요.",
      ),
    workroomAcknowledged: z.literal(true, {
      error: "무료 시뮬레이션과 연습 포인트 안내를 확인해 주세요.",
    }),
    password: z
      .string()
      .min(10, "비밀번호는 10자 이상 입력해 주세요.")
      .max(128, "비밀번호는 128자 이하로 입력해 주세요."),
    passwordConfirmation: z.string(),
    phoneE164: z
      .string()
      .regex(/^\+[1-9][0-9]{7,14}$/, "휴대전화 번호를 확인해 주세요."),
    privacyConsent: z.literal(true, {
      error: "개인정보 처리 필수 동의가 필요합니다.",
    }),
    recoveryEmail: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email("복구 이메일을 확인해 주세요.")),
    serviceTermsConsent: z.literal(true, {
      error: "서비스 이용약관 필수 동의가 필요합니다.",
    }),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    message: "비밀번호가 서로 일치하지 않습니다.",
    path: ["passwordConfirmation"],
  })
  .refine(
    (value) => {
      const date = new Date(`${value.dateOfBirth}T00:00:00Z`);
      return (
        Number.isFinite(date.valueOf()) &&
        value.dateOfBirth >= "1900-01-01" &&
        date.toISOString().slice(0, 10) === value.dateOfBirth &&
        date <= new Date()
      );
    },
    { message: "생년월일을 확인해 주세요.", path: ["dateOfBirth"] },
  );

export type SignupResponse = {
  status: "ok" | "error" | "confirmation";
  message: string;
  fieldErrors?: Record<string, string>;
  redirectUrl?: string;
};

function normalizePhone(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  const compact = raw.replace(/[\s()-]/g, "");

  if (/^010\d{8}$/.test(compact)) {
    return `+82${compact.slice(1)}`;
  }

  return compact;
}

export type PhoneAvailabilityResult =
  "AVAILABLE" | "UNAVAILABLE" | "INVALID" | "ERROR";

/** 가입용 휴대전화 사용 가능 여부. 인증이 아니라 사용/이미 사용만 안내한다. */
export async function checkSignupPhoneAvailability(
  rawPhone: string,
): Promise<PhoneAvailabilityResult> {
  const phoneE164 = normalizePhone(rawPhone);
  if (!/^\+[1-9][0-9]{7,14}$/.test(phoneE164)) {
    return "INVALID";
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("signup_phone_availability", {
      p_raw: rawPhone,
    });
    if (error) {
      return "ERROR";
    }
    if (data === "AVAILABLE" || data === "UNAVAILABLE") {
      return data;
    }
    return "ERROR";
  } catch {
    return "ERROR";
  }
}

function toFieldErrors(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !fields[key]) {
      fields[key] = issue.message;
    }
  }
  return fields;
}

function jsonError(
  message: string,
  fieldErrors: Record<string, string> = {},
  status = 400,
): Response {
  return Response.json(
    { status: "error", message, fieldErrors } satisfies SignupResponse,
    { status },
  );
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown) {
  return value === true || value === "on";
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("요청 형식이 올바르지 않습니다.");
  }

  const parsed = signupSchema.safeParse({
    dateOfBirth:
      signupBirthDate(asString(body.dateOfBirth), asString(body.birthSexDigit)) ??
      "",
    birthSexDigit: asString(body.birthSexDigit),
    legalName: asString(body.legalName),
    loginId: asString(body.loginId),
    marketingConsent: asBoolean(body.marketingConsent),
    referralCode: asString(body.referralCode),
    workroomAcknowledged: asBoolean(body.workroomAcknowledged),
    password: asString(body.password),
    passwordConfirmation: asString(body.passwordConfirmation),
    phoneE164: normalizePhone(asString(body.phone)),
    privacyConsent: asBoolean(body.privacyConsent),
    recoveryEmail: asString(body.recoveryEmail),
    serviceTermsConsent: asBoolean(body.serviceTermsConsent),
  });

  if (!parsed.success) {
    return Response.json(
      {
        status: "error",
        message: "입력한 정보를 다시 확인해 주세요.",
        fieldErrors: toFieldErrors(parsed.error),
      } satisfies SignupResponse,
      { status: 400 },
    );
  }

  // 서버에서 안전 모드(GLOBAL, SIGNUP)를 먼저 확인한다. 읽지 못하면 가입을 열지 않는다.
  const signupGate = await assertComponentActive("SIGNUP");
  if (!signupGate.ok) {
    return jsonError(
      signupGate.reason === "PAUSED"
        ? SAFE_MODE_MEMBER_COPY.SIGNUP.paused
        : SAFE_MODE_MEMBER_COPY.SIGNUP.unavailable,
      {},
      503,
    );
  }

  let env: ReturnType<typeof getPublicEnv>;
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    env = getPublicEnv();
    supabase = await createSupabaseServerClient();
  } catch {
    return jsonError(
      "계정 서비스를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      {},
      502,
    );
  }

  let loginIdAvailable: boolean | null = null;
  let availabilityFailed = false;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("is_login_id_available", {
      p_login_id: parsed.data.loginId,
    });
    loginIdAvailable = typeof data === "boolean" ? data : null;
    availabilityFailed = Boolean(error) || loginIdAvailable === null;
  } catch {
    availabilityFailed = true;
  }

  if (availabilityFailed) {
    return jsonError(
      "아이디를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      {},
      502,
    );
  }
  if (!loginIdAvailable) {
    return Response.json(
      {
        status: "error",
        fieldErrors: { loginId: "다른 아이디를 선택해 주세요." },
        message: "입력한 정보를 다시 확인해 주세요.",
      } satisfies SignupResponse,
      { status: 400 },
    );
  }

  const phoneAvailability = await checkSignupPhoneAvailability(
    parsed.data.phoneE164,
  );
  if (phoneAvailability === "ERROR") {
    return jsonError(
      "휴대전화 번호를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      {},
      502,
    );
  }
  if (phoneAvailability === "INVALID" || phoneAvailability === "UNAVAILABLE") {
    return Response.json(
      {
        status: "error",
        fieldErrors: {
          phoneE164:
            phoneAvailability === "INVALID"
              ? "휴대전화 번호를 확인해 주세요."
              : "이미 사용된 번호예요. 다른 번호를 입력해 주세요.",
        },
        message: "입력한 정보를 다시 확인해 주세요.",
      } satisfies SignupResponse,
      { status: 400 },
    );
  }

  let signupResult: Awaited<ReturnType<typeof supabase.auth.signUp>>;
  try {
    signupResult = await supabase.auth.signUp({
      email: parsed.data.recoveryEmail,
      password: parsed.data.password,
      options: {
        data: {
          date_of_birth: parsed.data.dateOfBirth,
          birth_sex_digit: parsed.data.birthSexDigit,
          legal_name: parsed.data.legalName,
          login_id: parsed.data.loginId,
          marketing_granted: parsed.data.marketingConsent,
          marketing_version: MARKETING_VERSION,
          phone_e164: parsed.data.phoneE164,
          privacy_granted: true,
          privacy_version: PRIVACY_VERSION,
          recovery_email: parsed.data.recoveryEmail,
          service_terms_granted: true,
          service_terms_version: SERVICE_TERMS_VERSION,
          signup_source: "PUBLIC_V1",
          referralCode: parsed.data.referralCode,
          workroomAcknowledged: parsed.data.workroomAcknowledged,
        },
        emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent("/workroom")}`,
      },
    });
  } catch {
    return jsonError(
      "가입을 완료하지 못했어요. 입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.",
      {},
      502,
    );
  }

  const { data, error } = signupResult;

  if (error || !data.user) {
    return jsonError(
      "가입을 완료하지 못했어요. 입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.",
      {},
      502,
    );
  }

  if (data.user.identities?.length === 0) {
    return Response.json(
      {
        status: "confirmation",
        message:
          "입력한 이메일로 확인 안내를 보냈습니다. 안내가 보이지 않으면 스팸함도 확인해 주세요.",
      } satisfies SignupResponse,
      { status: 200 },
    );
  }

  const signupUserId = data.user.id;
  await recordSignupContext(
    signupUserId,
    parsed.data.referralCode,
    parsed.data.workroomAcknowledged,
  );

  // Fire-and-forget: after() is unavailable on vinext/Cloudflare Workers.
  // recordProductionAnalyticsEvent swallows its own errors internally, so a
  // missed analytics write never rolls back a completed signup.
  void recordProductionAnalyticsEvent({
    eventName: "signup_complete",
    userId: signupUserId,
  });

  if (data.session) {
    // Ensure auth cookies set during signUp are flushed to the response.
    try {
      const store = await cookies();
      store.getAll();
    } catch {
      // ignore
    }

    return Response.json(
      {
        status: "ok",
        message: "",
        redirectUrl: "/workroom",
      } satisfies SignupResponse,
      { status: 200 },
    );
  }

  return Response.json(
    {
      status: "confirmation",
      message:
        "입력한 이메일로 확인 안내를 보냈습니다. 확인을 마치면 내 워크룸으로 이어집니다.",
    } satisfies SignupResponse,
    { status: 200 },
  );
}
