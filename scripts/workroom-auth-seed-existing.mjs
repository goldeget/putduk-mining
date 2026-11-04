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
  },
).trim();
if (applied !== "t") throw new Error("PRE202_DATABASE_REQUIRED");
const suffix = randomUUID().replaceAll("-", "").slice(0, 13);
const email = `existing.${suffix}@putduk.test`;
const password = `Existing-${suffix}-Aa1!`;
const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
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
  `WORKROOM_EXISTING_EMAIL=${email}\nWORKROOM_EXISTING_PASSWORD=${password}\nWORKROOM_EXISTING_ID=${result.data.user.id}\n`,
  { mode: 0o600 },
);
console.log(
  "PRE202_REAL_AUTH_FIXTURE_PREPARED: credentials written only to gitignored file",
);
