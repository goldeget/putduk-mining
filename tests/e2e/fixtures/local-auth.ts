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
): Promise<ConfirmedMember> {
  const client = createLocalServiceRoleClient();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${label}.${suffix}@putduk.test`;
  const password = `Putduk-test-${suffix}-Aa1`;
  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "CONFIRMED_MEMBER_CREATE_FAILED");
  }
  return { userId: data.user.id, email, password };
}
