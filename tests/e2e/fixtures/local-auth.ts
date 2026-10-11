import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const REMOTE_PROJECT_REF = "osrmyjgmpdspdcwqjwuv";

export type ConfirmedMember = {
  userId: string;
  email: string;
  password: string;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the local auth fixture.`);
  }
  return value;
}

export function createLocalServiceRoleClient(): SupabaseClient {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (url.includes(REMOTE_PROJECT_REF) || !url.startsWith("http://")) {
    throw new Error(
      "Service role fixtures are limited to the isolated local Supabase API.",
    );
  }
  return createClient(url, requiredEnv("SUPABASE_SECRET_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function createConfirmedMember(
  label: string,
  identity: { legalName?: string; phoneE164?: string } = {},
): Promise<ConfirmedMember> {
  const client = createLocalServiceRoleClient();
  const suffix =
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.replace(
      /[^a-z0-9]/g,
      "",
    );
  const email = `${label}.${suffix}@putduk.test`.toLowerCase();
  const password = `Putduk-test-${suffix}-Aa1`;
  const loginId = `u${suffix}`.slice(0, 20);
  // E.164 한국 휴대폰(+8210XXXXXXXX) — 빠른 연속 생성에서도 충돌을 피한다.
  const phone =
    identity.phoneE164 ??
    `+8210${String(Date.now()).slice(-7)}${Math.floor(
      Math.random() * 90 + 10,
    )}${Math.floor(Math.random() * 10)}`;
  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      signup_source: "PUBLIC_V1",
      login_id: loginId,
      legal_name: identity.legalName ?? "퍼뜩테스트",
      date_of_birth: "1990-01-15",
      phone_e164: phone,
      recovery_email: email,
      service_terms_version: "TERMS-KO-2026-09-27",
      privacy_version: "PRIVACY-KO-2026-09-27",
      marketing_version: "MARKETING-KO-2026-09-27",
      service_terms_granted: true,
      privacy_granted: true,
      marketing_granted: false,
    },
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "CONFIRMED_MEMBER_CREATE_FAILED");
  }
  // Auth 트리거가 지갑/원장을 만들지만, 누락 시 전환이 KRW_WALLET_NOT_FOUND로 실패한다.
  const { error: bootstrapError } = await client.rpc("bootstrap_user", {
    p_user_id: data.user.id,
  });
  if (bootstrapError) {
    throw new Error(`BOOTSTRAP_USER_FAILED:${bootstrapError.message}`);
  }
  return { userId: data.user.id, email, password };
}
