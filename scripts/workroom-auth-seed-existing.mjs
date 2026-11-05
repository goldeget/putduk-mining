import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// Execute ONLY against the fresh historical201 disposable database, before --baseline/202.
const targets = {
  "putduk-mining-ci-r2-20261009": "http://127.0.0.1:63421",
  "putduk-mining-workroom-local-20261104": "http://127.0.0.1:64531",
};
const project = process.env.LOCAL_SUPABASE_PROJECT_ID;
console.log("PRE202_SEED_STAGE: target guard");
if (
  process.env.APP_ENV !== "test" ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== targets[project]
)
  throw new Error("WORKROOM_SEED_TARGET_REJECTED");
const applied = execFileSync(
  "docker",
  [
    "exec",
    "-i",
    `supabase_db_${project}`,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-At",
    "--set",
    "ON_ERROR_STOP=1",
  ],
  {
    input: "select to_regclass('app_private.workroom_accounts') is null;",
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 30_000,
    windowsHide: true,
  },
).trim();
if (applied !== "t") throw new Error("PRE202_DATABASE_REQUIRED");
console.log(
  "PRE202_SEED_STAGE: historical database confirmed; requesting real GoTrue identity",
);
const suffix = randomUUID().replaceAll("-", "").slice(0, 13);
const email = `existing.${suffix}@putduk.test`;
const password = `Existing-${suffix}-Aa1!`;
const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, options) =>
        fetch(input, { ...options, signal: AbortSignal.timeout(30_000) }),
    },
  },
);
const result = await client.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: {
    signup_source: "PUBLIC_V1",
    legal_name: "기존회원검증",
    login_id: `x${suffix}`,
    date_of_birth: "1990-01-15",
    phone_e164: `+8210${BigInt(`0x${suffix}`).toString().slice(-8)}`,
    recovery_email: email,
    service_terms_version: "TERMS-KO-2026-09-27",
    privacy_version: "PRIVACY-KO-2026-09-27",
    marketing_version: "MARKETING-KO-2026-09-27",
    service_terms_granted: true,
    privacy_granted: true,
    marketing_granted: false,
  },
});
if (result.error || !result.data.user)
  throw new Error("PRE202_REAL_GOTRUE_IDENTITY_FAILED");
// Trusted maintenance principal, using the existing provider-blank 201 boundary.
// It deliberately has no legal identity, birth date, phone or invented consent.
const operatorId = randomUUID();
const operatorIdentityId = randomUUID();
const operatorEmail = `operator.${suffix}@putduk.test`;
const operatorPassword = `Operator-${randomUUID().replaceAll("-", "")}-Aa1!`;
const operatorLoginId = "putdukadmin";
console.log("PRE202_SEED_STAGE: preparing trusted maintenance operator");
try {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      `supabase_db_${project}`,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "--set",
      "ON_ERROR_STOP=1",
    ],
    {
      input: `begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,phone_change,phone_change_token,reauthentication_token)
values('${operatorId}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${operatorEmail}',extensions.crypt('${operatorPassword}',extensions.gen_salt('bf',12)),clock_timestamp(),'{}'::jsonb,jsonb_build_object('operator_login_id','${operatorLoginId}'),clock_timestamp(),clock_timestamp(),'','','','','','','','');
insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at)
values('${operatorIdentityId}','${operatorId}','${operatorId}',jsonb_build_object('sub','${operatorId}','email','${operatorEmail}','email_verified',true,'phone_verified',false),'email',clock_timestamp(),clock_timestamp());
insert into public.user_roles(user_id,role,granted_by) values('${operatorId}','SUPER_ADMIN','${operatorId}');
do $$begin if exists(select 1 from public.user_identity_profiles where user_id='${operatorId}') or exists(select 1 from public.user_consent_records where user_id='${operatorId}') then raise exception 'MAINTENANCE_OPERATOR_MUST_NOT_HAVE_MEMBER_IDENTITY'; end if; end$$;
commit;`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
      windowsHide: true,
    },
  );
} catch {
  throw new Error("PRE202_MAINTENANCE_OPERATOR_SQL_FAILED");
}
const operatorAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, options) =>
        fetch(input, { ...options, signal: AbortSignal.timeout(30_000) }),
    },
  },
);
const operatorSignedIn = await operatorAuth.auth.signInWithPassword({
  email: operatorEmail,
  password: operatorPassword,
});
if (
  operatorSignedIn.error ||
  operatorSignedIn.data.user?.id !== operatorId ||
  !operatorSignedIn.data.session
)
  throw new Error("PRE202_MAINTENANCE_OPERATOR_REAL_PASSWORD_LOGIN_FAILED");
await operatorAuth.auth.signOut({ scope: "local" });
console.log(
  "PRE202_SEED_STAGE: real operator password login confirmed; no MFA claim",
);
const output = resolve(
  process.env.WORKROOM_EXISTING_ENV_FILE ??
    "test-results/workroom-auth/existing.env",
);
if (
  !output.startsWith(resolve("test-results") + "/") &&
  !output.startsWith(resolve("test-results") + "\\")
)
  throw new Error("GITIGNORED_TEST_RESULTS_OUTPUT_REQUIRED");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `WORKROOM_EXISTING_EMAIL=${email}\nWORKROOM_EXISTING_PASSWORD=${password}\nWORKROOM_EXISTING_ID=${result.data.user.id}\nWORKROOM_OPERATOR_EMAIL=${operatorEmail}\nWORKROOM_OPERATOR_PASSWORD=${operatorPassword}\nWORKROOM_OPERATOR_ID=${operatorId}\nWORKROOM_OPERATOR_LOGIN_ID=${operatorLoginId}\n`,
  { mode: 0o600 },
);
console.log(
  "PRE202_REAL_AUTH_FIXTURE_PREPARED: credentials written only to gitignored file",
);
