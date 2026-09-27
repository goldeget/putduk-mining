import { randomUUID } from "node:crypto";

import {
  createConfirmedMember,
  createLocalServiceRoleClient,
  type ConfirmedMember,
} from "../../fixtures/local-auth";

export { createLocalServiceRoleClient };

/** Launch hard ceiling from the product contract — never invent a higher value. */
export const WELCOME_CAP_KRW = 5_000;

/** Trial target from existing database fixtures; conversion still caps at 5,000. */
const TRIAL_TARGET_REWARD_KRW = 9_000;

export type OperatorActor = ConfirmedMember & { role: "SUPER_ADMIN" | "ADMIN" };

async function requireWorldId(code: string) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client
    .from("asset_worlds")
    .select("id")
    .eq("code", code)
    .maybeSingle();
  if (error || !data?.id) {
    throw new Error(`ASSET_WORLD_MISSING:${code}`);
  }
  return data.id as string;
}

/**
 * Ensures a local enabled trial program exists so START can begin.
 * Values mirror repository pgTAP fixtures; cash conversion remains capped at 5,000.
 */
export async function ensureLocalTrialProgram(): Promise<void> {
  const client = createLocalServiceRoleClient();
  const { data: existing } = await client
    .from("trial_programs")
    .select("id")
    .eq("is_enabled", true)
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    return;
  }

  const worldId = await requireWorldId("KOREA");
  const { data: program, error: programError } = await client
    .from("trial_programs")
    .insert({
      name: "WS05_E2E_TRIAL",
      version: 1,
      is_enabled: false,
      duration_seconds: 3600,
      target_reward_krw: TRIAL_TARGET_REWARD_KRW,
      first_result_target_seconds: 60,
      first_world_id: worldId,
      completion_copy: "테스트 체험 완료",
      effective_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    })
    .select("id, effective_at")
    .single();
  if (programError || !program?.id) {
    throw new Error(programError?.message ?? "TRIAL_PROGRAM_INSERT_FAILED");
  }

  const { data: curve, error: curveError } = await client
    .from("trial_reward_curves")
    .insert({
      trial_program_id: program.id,
      version: 1,
      effective_at: program.effective_at,
    })
    .select("id")
    .single();
  if (curveError || !curve?.id) {
    throw new Error(curveError?.message ?? "TRIAL_CURVE_INSERT_FAILED");
  }

  const { error: pointsError } = await client
    .from("trial_reward_curve_points")
    .insert([
      {
        trial_reward_curve_id: curve.id,
        sequence: 0,
        elapsed_seconds: 0,
        cumulative_quota_bps: 0,
        cumulative_reward_bps: 0,
      },
      {
        trial_reward_curve_id: curve.id,
        sequence: 1,
        elapsed_seconds: 1800,
        cumulative_quota_bps: 5000,
        cumulative_reward_bps: 5000,
      },
      {
        trial_reward_curve_id: curve.id,
        sequence: 2,
        elapsed_seconds: 3600,
        cumulative_quota_bps: 10000,
        cumulative_reward_bps: 10000,
      },
    ]);
  if (pointsError) {
    throw new Error(pointsError.message);
  }

  const { error: enableError } = await client
    .from("trial_programs")
    .update({ is_enabled: true })
    .eq("id", program.id);
  if (enableError) {
    throw new Error(enableError.message);
  }
}

/**
 * Bootstraps or reuses a local operator for KYC review and money RPCs.
 * Does not create admin browser sessions (Agent A ownership).
 */
export async function ensureOperatorActor(): Promise<OperatorActor> {
  const client = createLocalServiceRoleClient();
  const { count } = await client
    .from("user_roles")
    .select("id", { count: "exact", head: true });

  if ((count ?? 0) === 0) {
    const member = await createConfirmedMember("ws05-operator");
    const { error } = await client.rpc("bootstrap_first_super_admin", {
      p_user_id: member.userId,
      p_reason: "WS-05 local authenticated e2e operator bootstrap",
      p_confirmation: "BOOTSTRAP_FIRST_SUPER_ADMIN",
      p_request_id: randomUUID(),
    });
    if (error) {
      throw new Error(error.message);
    }
    return { ...member, role: "SUPER_ADMIN" };
  }

  const granter = await client
    .from("user_roles")
    .select("user_id")
    .in("role", ["SUPER_ADMIN", "ADMIN"])
    .is("revoked_at", null)
    .order("granted_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const member = await createConfirmedMember("ws05-operator");
  const { error: grantError } = await client.from("user_roles").insert({
    user_id: member.userId,
    role: "ADMIN",
    granted_by: granter.data?.user_id ?? member.userId,
  });
  if (grantError) {
    throw new Error(grantError.message);
  }
  return { ...member, role: "ADMIN" };
}

/**
 * Seeds welcome-compatible policies and form destination catalogs.
 * Caps stay at the product hard ceiling of 5,000 KRW atomic.
 *
 * DB unique contracts (must both be obeyed):
 * - (currency, destination_type, version)
 * - (currency, destination_type, effective_at)
 * Welcome/form rows share currency+destination_type, so effective_at must differ.
 */
export async function ensureWithdrawalPolicies(
  approvedBy: string,
): Promise<void> {
  const client = createLocalServiceRoleClient();
  // 버전마다 고정된 effective_at → 동일 시각 충돌 방지, 재시도·다중 스펙에도 결정적
  const effectiveAtForVersion = (version: number) =>
    new Date(Date.UTC(2026, 0, 1, 0, 0, version % 86_400)).toISOString();

  const rows = [
    {
      currency: "KRW",
      destination_type: "KRW_BANK",
      version: 91001,
      is_enabled: true,
      minimum_amount_atomic: 1,
      fee_atomic: 0,
      destination_config: {
        welcome_cap_atomic: WELCOME_CAP_KRW,
        funding_required: false,
      },
      effective_at: effectiveAtForVersion(91001),
      approved_by: approvedBy,
      allows_welcome_reward: true,
    },
    {
      currency: "KRW",
      destination_type: "USDT_ADDRESS",
      version: 91002,
      is_enabled: true,
      minimum_amount_atomic: 1,
      fee_atomic: 0,
      destination_config: {
        welcome_cap_atomic: WELCOME_CAP_KRW,
        funding_required: false,
      },
      effective_at: effectiveAtForVersion(91002),
      approved_by: approvedBy,
      allows_welcome_reward: true,
    },
    {
      currency: "KRW",
      destination_type: "KRW_BANK",
      version: 91011,
      is_enabled: true,
      minimum_amount_atomic: 1,
      fee_atomic: 0,
      destination_config: {
        allowed_bank_codes: ["KB", "SHINHAN", "WOORI", "KAKAO", "TOSS"],
      },
      effective_at: effectiveAtForVersion(91011),
      approved_by: approvedBy,
      allows_welcome_reward: false,
    },
    {
      currency: "KRW",
      destination_type: "USDT_ADDRESS",
      version: 91012,
      is_enabled: true,
      minimum_amount_atomic: 1,
      fee_atomic: 0,
      destination_config: {
        allowed_networks: ["TRC20", "ERC20", "BEP20"],
      },
      effective_at: effectiveAtForVersion(91012),
      approved_by: approvedBy,
      allows_welcome_reward: false,
    },
  ] as const;

  for (const row of rows) {
    const { data: found } = await client
      .from("withdrawal_policies")
      .select("id")
      .eq("currency", row.currency)
      .eq("destination_type", row.destination_type)
      .eq("version", row.version)
      .maybeSingle();
    if (found?.id) {
      continue;
    }
    const { error } = await client.from("withdrawal_policies").insert({
      ...row,
      destination_config: row.destination_config as Record<string, unknown>,
    });
    if (!error) {
      continue;
    }
    // 동시 스펙/재시도: version 또는 effective_at 유니크 충돌이면 재조회로 멱등 완료
    const raced =
      error.message.includes(
        "withdrawal_policies_currency_destination_version_unique",
      ) ||
      error.message.includes(
        "withdrawal_policies_currency_destination_effective_unique",
      ) ||
      error.code === "23505";
    if (!raced) {
      throw new Error(error.message);
    }
    const { data: again } = await client
      .from("withdrawal_policies")
      .select("id")
      .eq("currency", row.currency)
      .eq("destination_type", row.destination_type)
      .eq("version", row.version)
      .maybeSingle();
    if (!again?.id) {
      throw new Error(error.message);
    }
  }
}

async function withTimeoutRetry<T>(
  label: string,
  operation: () => Promise<{ error: { message: string } | null } & T>,
): Promise<T> {
  let lastMessage = "unknown";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await operation();
    if (!result.error) {
      return result;
    }
    lastMessage = result.error.message;
    if (
      !lastMessage.toLowerCase().includes("timeout") &&
      !lastMessage.toLowerCase().includes("upstream")
    ) {
      throw new Error(`${label}:${lastMessage}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  throw new Error(`${label}:${lastMessage}`);
}

/** Advances server-side trial clocks and settles to COMPLETED via production RPC. */
export async function advanceTrialToCompleted(userId: string): Promise<void> {
  const client = createLocalServiceRoleClient();
  const started = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const expired = new Date().toISOString();

  await withTimeoutRetry("TRIAL_ACCOUNT_CLOCK", async () =>
    client
      .from("trial_accounts")
      .update({
        started_at: started,
        expires_at: expired,
        last_settled_at: started,
      })
      .eq("user_id", userId)
      .eq("status", "ACTIVE"),
  );

  await withTimeoutRetry("TRIAL_SESSION_CLOCK", async () =>
    client
      .from("trial_sessions")
      .update({
        started_at: started,
        last_settled_at: started,
      })
      .eq("user_id", userId)
      .is("ended_at", null),
  );

  await withTimeoutRetry("TRIAL_SETTLE", async () => {
    const { error } = await client.rpc("settle_trial", {
      p_user_id: userId,
      p_idempotency_key: `ws05-settle-${userId}-${Date.now()}`,
    });
    return { error };
  });

  const { data: account } = await client
    .from("trial_accounts")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (account?.status !== "COMPLETED" && account?.status !== "EXPIRED") {
    throw new Error(`TRIAL_NOT_TERMINAL:${account?.status ?? "missing"}`);
  }
}

/** Opens and approves KYC through production commands (eligibility only). */
export async function approveKycEligibility(
  userId: string,
  operatorId: string,
): Promise<void> {
  const client = createLocalServiceRoleClient();
  const { data: caseId, error: openError } = await client.rpc("open_kyc_case", {
    p_user_id: userId,
    p_request_id: randomUUID(),
  });
  if (openError) {
    throw new Error(openError.message);
  }

  const { error: reviewError } = await client.rpc("review_kyc_case", {
    p_case_id: caseId,
    p_actor: operatorId,
    p_to_status: "APPROVED",
    p_reason: "WS-05 e2e eligibility approval",
    p_request_id: randomUUID(),
  });
  if (reviewError) {
    throw new Error(reviewError.message);
  }
}

export async function assertNoDepositRows(userId: string): Promise<void> {
  const client = createLocalServiceRoleClient();
  const { count, error } = await client
    .from("deposit_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) {
    throw new Error(error.message);
  }
  if ((count ?? 0) > 0) {
    throw new Error("UNEXPECTED_DEPOSIT_ROWS");
  }
}

export async function readLatestWithdrawal(userId: string) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client
    .from("withdrawal_requests")
    .select(
      "id, status, amount_atomic, fee_atomic, destination_type, welcome_reward_conversion_id, hold_ledger_transaction_id",
    )
    .eq("user_id", userId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function countExternalSends(withdrawalId: string) {
  const client = createLocalServiceRoleClient();
  const { count, error } = await client
    .from("withdrawal_external_sends")
    .select("id", { count: "exact", head: true })
    .eq("withdrawal_id", withdrawalId);
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

export async function readWalletAvailableKrw(userId: string) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client
    .from("wallet_balance_snapshots")
    .select("available_balance_atomic, balance_atomic")
    .eq("user_id", userId)
    .eq("currency", "KRW")
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}
