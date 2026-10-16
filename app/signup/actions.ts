"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { recordProductionAnalyticsEvent } from "@/lib/analytics/record-event.server";
import { getPublicEnv } from "@/lib/env/public";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SERVICE_TERMS_VERSION = "TERMS-KO-2026-09-27";
const PRIVACY_VERSION = "PRIVACY-KO-2026-09-27";
const MARKETING_VERSION = "MARKETING-KO-2026-09-27";

const signupSchema = z
  .object({
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

export type SignupActionState = {
  fieldErrors: Record<string, string>;
  message: string;
  status: "idle" | "error" | "confirmation";
};

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function normalizePhone(value: FormDataEntryValue | null) {
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

export async function signupAction(
  _previous: SignupActionState,
  formData: FormData,
): Promise<SignupActionState> {
  const parsed = signupSchema.safeParse({
    dateOfBirth: formData.get("dateOfBirth"),
    legalName: formData.get("legalName"),
    loginId: formData.get("loginId"),
    marketingConsent: checked(formData, "marketingConsent"),
    password: formData.get("password"),
    passwordConfirmation: formData.get("passwordConfirmation"),
    phoneE164: normalizePhone(formData.get("phone")),
    privacyConsent: checked(formData, "privacyConsent"),
    recoveryEmail: formData.get("recoveryEmail"),
    serviceTermsConsent: checked(formData, "serviceTermsConsent"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      message: "입력한 정보를 다시 확인해 주세요.",
      status: "error",
    };
  }

  let env: ReturnType<typeof getPublicEnv>;
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    env = getPublicEnv();
    supabase = await createSupabaseServerClient();
  } catch {
    return {
      fieldErrors: {},
      message: "계정 서비스를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      status: "error",
    };
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
    return {
      fieldErrors: {},
      message: "아이디를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      status: "error",
    };
  }
  if (!loginIdAvailable) {
    return {
      fieldErrors: { loginId: "다른 아이디를 선택해 주세요." },
      message: "입력한 정보를 다시 확인해 주세요.",
      status: "error",
    };
  }

  const phoneAvailability = await checkSignupPhoneAvailability(
    parsed.data.phoneE164,
  );
  if (phoneAvailability === "ERROR") {
    return {
      fieldErrors: {},
      message: "휴대전화 번호를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      status: "error",
    };
  }
  if (phoneAvailability === "INVALID" || phoneAvailability === "UNAVAILABLE") {
    return {
      fieldErrors: {
        phoneE164:
          phoneAvailability === "INVALID"
            ? "휴대전화 번호를 확인해 주세요."
            : "이미 사용된 번호예요. 다른 번호를 입력해 주세요.",
      },
      message: "입력한 정보를 다시 확인해 주세요.",
      status: "error",
    };
  }

  let signupResult: Awaited<ReturnType<typeof supabase.auth.signUp>>;
  try {
    signupResult = await supabase.auth.signUp({
      email: parsed.data.recoveryEmail,
      password: parsed.data.password,
      options: {
        data: {
          date_of_birth: parsed.data.dateOfBirth,
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
        },
        emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent("/start")}`,
      },
    });
  } catch {
    return {
      fieldErrors: {},
      message:
        "가입을 완료하지 못했어요. 입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.",
      status: "error",
    };
  }

  const { data, error } = signupResult;

  if (error || !data.user) {
    return {
      fieldErrors: {},
      message:
        "가입을 완료하지 못했어요. 입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.",
      status: "error",
    };
  }

  if (data.user.identities?.length === 0) {
    return {
      fieldErrors: {},
      message:
        "입력한 이메일로 확인 안내를 보냈습니다. 안내가 보이지 않으면 스팸함도 확인해 주세요.",
      status: "confirmation",
    };
  }

  const signupUserId = data.user.id;
  try {
    after(() =>
      recordProductionAnalyticsEvent({
        eventName: "signup_complete",
        userId: signupUserId,
      }),
    );
  } catch {
    // 분석 예약을 못 해도 가입 완료는 유지한다.
  }

  if (data.session) {
    redirect("/start");
  }

  return {
    fieldErrors: {},
    message:
      "입력한 이메일로 확인 안내를 보냈습니다. 확인을 마치면 PUTDUK START로 이어집니다.",
    status: "confirmation",
  };
}
