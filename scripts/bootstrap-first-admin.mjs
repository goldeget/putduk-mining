import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const EXPECTED_PROJECT_REF = "osrmyjgmpdspdcwqjwuv";
const REQUIRED_CONFIRMATION = "BOOTSTRAP_FIRST_SUPER_ADMIN";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (!value) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const userId = requireValue(args["user-id"], "--user-id");
  const reason = requireValue(args.reason, "--reason").trim();
  const confirmation = requireValue(args.confirm, "--confirm");

  if (!UUID_PATTERN.test(userId)) {
    throw new Error("--user-id must be an exact auth.users UUID.");
  }
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

  const { data: authUser, error: authError } =
    await supabase.auth.admin.getUserById(userId);
  if (authError || !authUser.user) {
    throw new Error(
      "The exact auth user was not found in the approved project.",
    );
  }

  const { count, error: roleCountError } = await supabase
    .from("user_roles")
    .select("id", { count: "exact", head: true });
  if (roleCountError) {
    throw new Error("Could not complete the role preflight read.");
  }
  if (count !== 0) {
    throw new Error(
      "Bootstrap refused because at least one role record already exists.",
    );
  }

  const requestId = randomUUID();
  const { data: roleId, error: bootstrapError } = await supabase.rpc(
    "bootstrap_first_super_admin",
    {
      p_confirmation: confirmation,
      p_reason: reason,
      p_request_id: requestId,
      p_user_id: userId,
    },
  );
  if (bootstrapError || typeof roleId !== "string") {
    throw new Error(
      `Bootstrap failed: ${bootstrapError?.message ?? "missing role id"}`,
    );
  }

  const [{ data: role, error: roleError }, { data: audit, error: auditError }] =
    await Promise.all([
      supabase
        .from("user_roles")
        .select("id, user_id, role, granted_at, revoked_at")
        .eq("id", roleId)
        .single(),
      supabase
        .from("audit_logs")
        .select("id, action, target_id, request_id, created_at")
        .eq("request_id", requestId)
        .single(),
    ]);

  if (
    roleError ||
    auditError ||
    role?.user_id !== userId ||
    role?.role !== "SUPER_ADMIN" ||
    role?.revoked_at !== null ||
    audit?.action !== "role.bootstrap_first_super_admin" ||
    audit?.target_id !== roleId
  ) {
    throw new Error(
      "Mutation returned but read-back verification failed. Stop and investigate.",
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        auditId: audit.id,
        projectRef,
        requestId,
        role: role.role,
        roleId: role.id,
        userId: role.user_id,
        verified: true,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Unknown bootstrap failure"}\n`,
  );
  process.exitCode = 1;
});
