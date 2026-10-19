import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { planWelcomePolicySeed } from "./lib/welcome-policy-seed.mjs";

/**
 * 관리자 부트스트랩 뒤 한 번 실행하는 일회성 운영 스크립트.
 * 원격 DB를 바꾸므로 정확한 대상에 대한 별도 승인 없이 실행하지 않는다.
 *
 *   node --env-file-if-exists=.env.local scripts/seed-welcome-withdrawal-policies.mjs \
 *     --reason="환영 출금 정책 초기 설정" --confirm=SEED_WELCOME_WITHDRAWAL_POLICIES
 *
 * 이미 환영 정책이 있는 출금 방식은 건드리지 않는다. 같은 명령을 다시 실행해도 안전하다.
 */

const EXPECTED_PROJECT_REF = "osrmyjgmpdspdcwqjwuv";
const REQUIRED_CONFIRMATION = "SEED_WELCOME_WITHDRAWAL_POLICIES";

function parseArguments(values) {
  return Object.fromEntries(
    values.map((value) => {
      const separator = value.indexOf("=");
      if (!value.startsWith("--") || separator === -1) {
        throw new Error(`Invalid argument format: ${value}`);
      }
      return [value.slice(2, separator), value.slice(separator + 1)];
    }),
  );
}

function requireValue(value, label) {
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const reason = requireValue(args.reason, "--reason").trim();
  const confirmation = requireValue(args.confirm, "--confirm");
  if (reason.length < 10 || reason.length > 500) {
    throw new Error("--reason must be between 10 and 500 characters.");
  }
  if (confirmation !== REQUIRED_CONFIRMATION) {
    throw new Error(`--confirm must equal ${REQUIRED_CONFIRMATION}.`);
  }

  const projectRef = requireValue(
    process.env.SUPABASE_PROJECT_REF,
    "SUPABASE_PROJECT_REF",
  );
  const supabaseUrl = requireValue(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const secretKey = requireValue(
    process.env.SUPABASE_SECRET_KEY,
    "SUPABASE_SECRET_KEY",
  );
  const endpoint = new URL(supabaseUrl);
  if (
    projectRef !== EXPECTED_PROJECT_REF ||
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== `${EXPECTED_PROJECT_REF}.supabase.co`
  ) {
    throw new Error(
      `Target rejected. This command is locked to Supabase ref ${EXPECTED_PROJECT_REF}.`,
    );
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 기존 시드와 같은 기준: 가장 먼저 부여된 활성 SUPER_ADMIN이 승인자다.
  const approver = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "SUPER_ADMIN")
    .is("revoked_at", null)
    .order("granted_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (approver.error || !approver.data?.user_id) {
    throw new Error(
      "No active SUPER_ADMIN found. Run admin:bootstrap first. Nothing was changed.",
    );
  }

  const existing = await supabase
    .from("withdrawal_policies")
    .select("destination_type,version,allows_welcome_reward")
    .eq("currency", "KRW");
  if (existing.error) {
    throw new Error("Could not read existing policies. Nothing was changed.");
  }

  const rows = planWelcomePolicySeed(
    existing.data ?? [],
    approver.data.user_id,
    new Date(),
  );
  if (rows.length === 0) {
    process.stdout.write(
      `${JSON.stringify({ inserted: 0, projectRef, verified: true }, null, 2)}\n`,
    );
    return;
  }

  const inserted = await supabase
    .from("withdrawal_policies")
    .insert(rows)
    .select("id,destination_type,version,allows_welcome_reward,fee_atomic");
  if (
    inserted.error ||
    !inserted.data ||
    inserted.data.length !== rows.length
  ) {
    throw new Error(
      "Policy insert did not return every row. Check withdrawal_policies before retrying.",
    );
  }

  const requestId = randomUUID();
  const audit = await supabase.from("audit_logs").insert({
    actor_user_id: approver.data.user_id,
    actor_role: "SUPER_ADMIN",
    action: "withdrawal_policies.seed_welcome",
    target_type: "withdrawal_policies",
    target_id: inserted.data.map((row) => row.id).join(","),
    reason,
    request_id: requestId,
    after_state: {
      policies: inserted.data.map((row) => ({
        id: row.id,
        destination_type: row.destination_type,
        version: row.version,
      })),
    },
  });
  if (audit.error) {
    throw new Error(
      "Policies were inserted but the audit row failed. Record this by hand and do not re-run blindly.",
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        inserted: inserted.data.length,
        policies: inserted.data.map((row) => ({
          destinationType: row.destination_type,
          id: row.id,
          version: row.version,
        })),
        projectRef,
        requestId,
        verified: true,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Unknown seed failure"}\n`,
  );
  process.exitCode = 1;
});
