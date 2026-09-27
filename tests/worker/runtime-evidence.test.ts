import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  backoffSeconds,
  processJobBatch,
  processOutboxBatch,
  runWorkerCycle,
  wantsOnce,
} from "../../workers/runner.mjs";

const REMOTE_PROJECT_REF = "osrmyjgmpdspdcwqjwuv";
const DB_CONTAINER = "supabase_db_putduk-mining";

/**
 * Missing from authored migrations (Agent A): service_role table DML for
 * worker claim/complete/fail paths. SECURITY INVOKER RPCs need these grants.
 * Tests apply them locally only; do not treat this as a substitute migration.
 */
const REQUIRED_SERVICE_ROLE_GRANTS_SQL = `
grant select, insert, update on table public.outbox_events to service_role;
grant select, insert, update on table public.system_jobs to service_role;
grant select, insert, update on table public.system_job_attempts to service_role;
grant select, insert, update on table public.reconciliation_runs to service_role;
grant select, insert, update on table public.reconciliation_mismatches to service_role;
grant select, insert, update on table public.ledger_transactions to service_role;
grant select, insert on table public.ledger_entries to service_role;
grant select, insert, update on table public.ledger_accounts to service_role;
grant select, insert, update on table public.wallet_accounts to service_role;
grant select, insert on table public.wallet_ledger to service_role;
grant select on table public.trial_reward_conversions to service_role;
grant select, insert, update on table public.withdrawal_policies to service_role;
grant select, insert, update on table public.withdrawal_requests to service_role;
grant select, insert, update on table public.withdrawal_destinations to service_role;
grant select, insert on table public.withdrawal_destination_history to service_role;
grant select, insert on table public.withdrawal_external_sends to service_role;
grant select, insert, update on table public.user_roles to service_role;
grant select, insert, update on table public.transaction_receipts to service_role;
grant select, insert, update on table public.safe_mode_controls to service_role;
grant select, insert on table public.security_events to service_role;
grant select, insert on table public.member_timeline_events to service_role;
grant select, insert, update on table public.member_lifecycle_states to service_role;
grant execute on function app_private.assert_not_safe_mode(text[]) to service_role;
grant execute on function app_private.touch_command_rate_limit(text, text, integer, integer, integer) to service_role;
grant execute on function app_private.ensure_withdrawal_hold_accounts(uuid) to service_role;
grant execute on function app_private.available_krw_balance(uuid) to service_role;
grant execute on function app_private.post_withdrawal_hold(uuid, uuid, bigint, text, uuid) to service_role;
grant execute on function app_private.request_withdrawal_with_hold(uuid, uuid, bigint, text, text, uuid) to service_role;
`;

function requireLocalWorkerEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) {
    throw new Error(
      "Local Supabase env missing. Run pnpm db:start, pnpm db:reset, then node scripts/capture-local-supabase-env.mjs before pnpm test:worker.",
    );
  }
  if (url.includes(REMOTE_PROJECT_REF) || !url.startsWith("http://")) {
    throw new Error(
      "Worker runtime evidence must use the isolated local Supabase API only.",
    );
  }
  return { url, secret };
}

function sql(statement: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-c",
      statement,
    ],
    { encoding: "utf8" },
  ).trim();
}

function serviceClient(): SupabaseClient {
  const { url, secret } = requireLocalWorkerEnv();
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function insertOutboxEvent(
  client: SupabaseClient,
  overrides: Record<string, unknown> = {},
) {
  const id = randomUUID();
  const aggregateId = randomUUID();
  const row = {
    id,
    event_type: "WORKER_RUNTIME_PROBE.v1",
    schema_version: 1,
    aggregate_type: "WORKER_TEST",
    aggregate_id: aggregateId,
    payload: { probe: true },
    correlation_id: randomUUID(),
    request_id: randomUUID(),
    idempotency_key: `worker-runtime:${id}`,
    status: "PENDING",
    available_at: new Date().toISOString(),
    attempt_count: 0,
    max_attempts: 12,
    occurred_at: new Date().toISOString(),
    ...overrides,
  };
  const { data, error } = await client
    .from("outbox_events")
    .insert(row)
    .select("*")
    .single();
  if (error) {
    throw new Error(`outbox insert failed: ${error.message}`);
  }
  return data;
}

async function insertSystemJob(
  client: SupabaseClient,
  overrides: Record<string, unknown> = {},
) {
  const id = randomUUID();
  const row = {
    id,
    job_type: "FINANCIAL_RECONCILIATION",
    idempotency_key: `worker-job:${id}`,
    payload: { version: 1 },
    status: "PENDING",
    available_at: new Date().toISOString(),
    attempts: 0,
    max_attempts: 12,
    priority: 50,
    ...overrides,
  };
  const { data, error } = await client
    .from("system_jobs")
    .insert(row)
    .select("*")
    .single();
  if (error) {
    throw new Error(`system_jobs insert failed: ${error.message}`);
  }
  return data;
}

async function readOutbox(client: SupabaseClient, id: string) {
  const { data, error } = await client
    .from("outbox_events")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

async function readJob(client: SupabaseClient, id: string) {
  const { data, error } = await client
    .from("system_jobs")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

describe("worker runtime evidence seam", () => {
  it("keeps claim entrypoints available for the isolated worker job", () => {
    const source = readFileSync("workers/runner.mjs", "utf8");
    expect(source).toContain("claim_outbox_events");
    expect(source).toContain("claim_system_jobs");
    expect(source).toContain("runWorkerCycle");
    expect(source).toContain("processOutboxBatch");
    expect(source).toContain("processJobBatch");
    expect(source).toContain("--once");
    expect(source).toContain("PUTDUK_WORKER_ONCE");
    expect(source).toContain("UNSUPPORTED_EVENT_TYPE");
    expect(source).toContain("Browser is not the runner");
    expect(source).toContain("stdout_only_not_lease_evidence");
    expect(source).not.toContain("queues.send");
  });

  it("parses --once and PUTDUK_WORKER_ONCE without starting the loop", () => {
    expect(wantsOnce(["--once"], {})).toBe(true);
    expect(wantsOnce([], { PUTDUK_WORKER_ONCE: "1" })).toBe(true);
    expect(wantsOnce([], { PUTDUK_WORKER_ONCE: "true" })).toBe(true);
    expect(wantsOnce([], {})).toBe(false);
    expect(backoffSeconds(1)).toBe(5);
    expect(backoffSeconds(4)).toBe(8);
  });
});

describe("worker process execution against local Supabase", () => {
  const clients: SupabaseClient[] = [];

  beforeAll(() => {
    requireLocalWorkerEnv();
    // Contract gap: migrations never granted service_role DML on worker tables.
    sql(REQUIRED_SERVICE_ROLE_GRANTS_SQL);
    const canUpdate = sql(
      "select has_table_privilege('service_role','public.outbox_events','UPDATE')::text",
    );
    expect(canUpdate).toBe("true");
  });

  afterAll(() => {
    for (const client of clients) {
      void client.removeAllChannels();
    }
  });

  function client() {
    const created = serviceClient();
    clients.push(created);
    return created;
  }

  it("claims an outbox lease, completes a supported handler, and denies the wrong worker", async () => {
    const db = client();
    const workerId = `ws05-owner-${randomUUID().slice(0, 8)}`;
    const stranger = `ws05-stranger-${randomUUID().slice(0, 8)}`;
    const event = await insertOutboxEvent(db, {
      event_type: "WORKER_RUNTIME_ACK.v1",
      max_attempts: 3,
    });

    const claimed = await processOutboxBatch(db, {
      workerId,
      batchSize: 5,
      leaseSeconds: 60,
      outboxHandlers: {
        "WORKER_RUNTIME_ACK.v1": async () => undefined,
      },
    });
    expect(claimed.claimed).toBeGreaterThanOrEqual(1);
    expect(claimed.completed).toBeGreaterThanOrEqual(1);

    const owned = await readOutbox(db, event.id);
    expect(owned.status).toBe("PROCESSED");
    expect(owned.lease_owner).toBeNull();

    const { error: denyError } = await db.rpc("complete_outbox_event", {
      p_event_id: event.id,
      p_worker_id: stranger,
    });
    expect(denyError?.message ?? "").toMatch(/OUTBOX_LEASE_NOT_OWNED/);
  });

  it("does not complete unsupported outbox events and records fail/backoff evidence", async () => {
    const db = client();
    const workerId = `ws05-unsup-${randomUUID().slice(0, 8)}`;
    const event = await insertOutboxEvent(db, {
      event_type: "UNKNOWN_FANOUT.v1",
      max_attempts: 4,
    });

    const before = Date.now();
    const summary = await processOutboxBatch(db, {
      workerId,
      batchSize: 10,
      leaseSeconds: 60,
    });
    expect(summary.unsupported).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(summary.completed).toBe(0);

    const failed = await readOutbox(db, event.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.last_error_code).toBe("UNSUPPORTED_EVENT_TYPE");
    expect(failed.attempt_count).toBeGreaterThanOrEqual(1);
    expect(new Date(failed.available_at).getTime()).toBeGreaterThanOrEqual(
      before + backoffSeconds(failed.attempt_count) * 1000 - 2_000,
    );
  });

  it("retries a throwing supported handler with backoff, then reaches terminal DLQ", async () => {
    const db = client();
    const workerId = `ws05-retry-${randomUUID().slice(0, 8)}`;
    const event = await insertOutboxEvent(db, {
      event_type: "WORKER_RUNTIME_RETRY.v1",
      max_attempts: 2,
    });

    const first = await processOutboxBatch(db, {
      workerId,
      outboxHandlers: {
        "WORKER_RUNTIME_RETRY.v1": async () => {
          throw new Error("TRANSIENT_PROBE");
        },
      },
    });
    expect(first.failed).toBeGreaterThanOrEqual(1);

    const afterFail = await readOutbox(db, event.id);
    expect(afterFail.status).toBe("FAILED");
    expect(afterFail.last_error_code).toMatch(/TRANSIENT_PROBE/);
    expect(afterFail.attempt_count).toBe(1);

    const { error: dueError } = await db
      .from("outbox_events")
      .update({ available_at: new Date().toISOString() })
      .eq("id", event.id);
    if (dueError) {
      throw new Error(dueError.message);
    }

    const second = await processOutboxBatch(db, {
      workerId: `${workerId}-b`,
      outboxHandlers: {
        "WORKER_RUNTIME_RETRY.v1": async () => {
          throw new Error("TRANSIENT_PROBE");
        },
      },
    });
    expect(second.failed).toBeGreaterThanOrEqual(1);

    const dead = await readOutbox(db, event.id);
    expect(dead.status).toBe("DEAD_LETTER");
    expect(dead.attempt_count).toBeGreaterThanOrEqual(2);
  });

  it("replays a dead-lettered event after operator reset without inventing a replay RPC", async () => {
    const db = client();
    const workerId = `ws05-replay-${randomUUID().slice(0, 8)}`;
    const event = await insertOutboxEvent(db, {
      event_type: "WORKER_RUNTIME_REPLAY.v1",
      max_attempts: 1,
    });

    await processOutboxBatch(db, {
      workerId,
      outboxHandlers: {
        "WORKER_RUNTIME_REPLAY.v1": async () => {
          throw new Error("FORCE_DLQ");
        },
      },
    });
    expect((await readOutbox(db, event.id)).status).toBe("DEAD_LETTER");

    // Missing public.replay_outbox_event — operator-style reset until Agent A adds it.
    const { error: resetError } = await db
      .from("outbox_events")
      .update({
        status: "PENDING",
        attempt_count: 0,
        last_error_code: null,
        available_at: new Date().toISOString(),
        lease_owner: null,
        lease_expires_at: null,
        processed_at: null,
      })
      .eq("id", event.id);
    if (resetError) {
      throw new Error(
        `replay reset failed (missing replay_outbox_event RPC): ${resetError.message}`,
      );
    }

    const replay = await processOutboxBatch(db, {
      workerId: `${workerId}-replay`,
      outboxHandlers: {
        "WORKER_RUNTIME_REPLAY.v1": async () => undefined,
      },
    });
    expect(replay.completed).toBeGreaterThanOrEqual(1);
    expect((await readOutbox(db, event.id)).status).toBe("PROCESSED");
  });

  it("runs FINANCIAL_RECONCILIATION, records mismatches, and never auto-repairs", async () => {
    const db = client();
    const workerId = `ws05-recon-${randomUUID().slice(0, 8)}`;
    const runnerSource = readFileSync("workers/runner.mjs", "utf8");
    expect(runnerSource).toContain("never auto-repairs");
    expect(runnerSource).not.toMatch(/repair_|auto_repair|fix_ledger/i);

    const { count: ledgerBefore, error: ledgerBeforeError } = await db
      .from("ledger_transactions")
      .select("id", { count: "exact", head: true });
    if (ledgerBeforeError) {
      throw new Error(ledgerBeforeError.message);
    }

    const job = await insertSystemJob(db, {
      job_type: "FINANCIAL_RECONCILIATION",
      max_attempts: 3,
    });

    const cycle = await runWorkerCycle(db, { workerId });
    expect(cycle.jobs.completed).toBeGreaterThanOrEqual(1);
    expect((await readJob(db, job.id)).status).toBe("SUCCEEDED");

    const { data: runs, error: runsError } = await db
      .from("reconciliation_runs")
      .select("id, status, mismatch_count, checked_count")
      .order("created_at", { ascending: false })
      .limit(1);
    if (runsError) {
      throw new Error(runsError.message);
    }
    expect(runs?.[0]?.status).toBe("SUCCEEDED");
    const runId = runs?.[0]?.id as string;

    const subjectId = randomUUID();
    const { error: mismatchInsertError } = await db
      .from("reconciliation_mismatches")
      .insert({
        run_id: runId,
        mismatch_type: "WORKER_RUNTIME_PROBE_MISMATCH",
        subject_type: "worker_probe",
        subject_id: subjectId,
        expected_value: { ok: true },
        actual_value: { ok: false },
      });
    if (mismatchInsertError) {
      throw new Error(mismatchInsertError.message);
    }

    const job2 = await insertSystemJob(db, {
      job_type: "FINANCIAL_RECONCILIATION",
      max_attempts: 3,
    });
    await processJobBatch(db, { workerId: `${workerId}-2` });
    expect((await readJob(db, job2.id)).status).toBe("SUCCEEDED");

    const { data: probeMismatch, error: probeError } = await db
      .from("reconciliation_mismatches")
      .select("id, subject_id")
      .eq("subject_id", subjectId)
      .maybeSingle();
    if (probeError) {
      throw new Error(probeError.message);
    }
    expect(probeMismatch?.subject_id).toBe(subjectId);

    const { count: ledgerAfter, error: ledgerAfterError } = await db
      .from("ledger_transactions")
      .select("id", { count: "exact", head: true });
    if (ledgerAfterError) {
      throw new Error(ledgerAfterError.message);
    }
    expect(ledgerAfter).toBe(ledgerBefore);
  });

  it("idempotent finalize retry does not add another external send", async () => {
    const db = client();
    const suffix = randomUUID().slice(0, 8);
    const userId = randomUUID();
    const operatorId = userId;
    const email = `worker.finalize.${suffix}@putduk.test`;

    sql(`
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '${userId}'::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  '${email}',
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
);
`);

    const { error: bootstrapError } = await db.rpc("bootstrap_user", {
      p_user_id: userId,
    });
    if (bootstrapError) {
      throw new Error(bootstrapError.message);
    }

    const { error: roleError } = await db.from("user_roles").insert({
      user_id: operatorId,
      role: "ADMIN",
      granted_by: operatorId,
    });
    if (roleError && !/duplicate|unique/i.test(roleError.message)) {
      throw new Error(roleError.message);
    }

    const { data: wallet, error: walletError } = await db
      .from("wallet_accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("currency", "KRW")
      .is("closed_at", null)
      .single();
    if (walletError || !wallet) {
      throw new Error(walletError?.message ?? "wallet missing");
    }

    const { error: fundError } = await db.from("wallet_ledger").insert({
      wallet_account_id: wallet.id,
      user_id: userId,
      direction: "CREDIT",
      entry_type: "DEPOSIT",
      amount_atomic: 20_000,
      idempotency_key: `worker-fund:${suffix}`,
      reference_type: "test",
      reference_id: userId,
      reason: "worker finalize fixture",
    });
    if (fundError) {
      throw new Error(fundError.message);
    }

    await db.from("ledger_accounts").upsert(
      [
        {
          code: `USER:${userId.toUpperCase()}:KRW:LIABILITY`,
          currency: "KRW",
          account_class: "LIABILITY",
          normal_side: "CREDIT",
          owner_user_id: userId,
        },
        {
          code: "PUTDUK:OPERATING_CASH:KRW",
          currency: "KRW",
          account_class: "ASSET",
          normal_side: "DEBIT",
          is_controlled_asset: true,
        },
        {
          code: "PUTDUK:WITHDRAWAL_HOLD:KRW",
          currency: "KRW",
          account_class: "CLEARING",
          normal_side: "CREDIT",
          is_controlled_asset: false,
        },
      ],
      { onConflict: "code", ignoreDuplicates: true },
    );

    const policyVersion = 920_000 + Math.floor(Math.random() * 1000);
    const { error: policyError } = await db.from("withdrawal_policies").insert({
      currency: "KRW",
      destination_type: "KRW_BANK",
      version: policyVersion,
      is_enabled: true,
      minimum_amount_atomic: 1000,
      fee_atomic: 0,
      destination_config: {},
      effective_at: new Date().toISOString(),
      approved_by: operatorId,
      allows_welcome_reward: false,
    });
    if (policyError) {
      throw new Error(policyError.message);
    }

    const { data: destinationId, error: destError } = await db.rpc(
      "register_krw_bank_destination",
      {
        p_user_id: userId,
        p_encrypted_value: "\\x00112233445566778899aabbccddeeff",
        p_value_fingerprint: `fp-worker-${suffix}`,
        p_display_hint: "국민 **9999",
        p_step_up_token: `step-up-worker-${suffix}`,
        p_request_id: randomUUID(),
        p_protection_hours: 24,
      },
    );
    if (destError) {
      throw new Error(destError.message);
    }

    const { data: withdrawalId, error: requestError } = await db.rpc(
      "request_krw_withdrawal",
      {
        p_user_id: userId,
        p_destination_id: destinationId,
        p_amount_krw: 5000,
        p_idempotency_key: `worker-wd-${suffix}`,
      },
    );
    if (requestError) {
      throw new Error(requestError.message);
    }

    const { data: sendId, error: sendError } = await db.rpc(
      "record_krw_external_send",
      {
        p_withdrawal_id: withdrawalId,
        p_bank_reference: `BANK-REF-WORKER-${suffix}`,
        p_actual_krw_amount: 5000,
        p_actor: operatorId,
        p_sent_at: new Date().toISOString(),
        p_idempotency_key: `worker-send-${suffix}`,
      },
    );
    if (sendError) {
      throw new Error(sendError.message);
    }

    const { data: sendReplay, error: sendReplayError } = await db.rpc(
      "record_krw_external_send",
      {
        p_withdrawal_id: withdrawalId,
        p_bank_reference: `BANK-REF-WORKER-${suffix}`,
        p_actual_krw_amount: 5000,
        p_actor: operatorId,
        p_sent_at: new Date().toISOString(),
        p_idempotency_key: `worker-send-${suffix}`,
      },
    );
    if (sendReplayError) {
      throw new Error(sendReplayError.message);
    }
    expect(sendReplay).toBe(sendId);

    const { count: sendCount, error: sendCountError } = await db
      .from("withdrawal_external_sends")
      .select("id", { count: "exact", head: true })
      .eq("withdrawal_id", withdrawalId);
    if (sendCountError) {
      throw new Error(sendCountError.message);
    }
    expect(sendCount).toBe(1);

    const { data: finalizeTx, error: finalizeError } = await db.rpc(
      "finalize_withdrawal_ledger",
      {
        p_withdrawal_id: withdrawalId,
        p_actor: operatorId,
        p_idempotency_key: `worker-finalize-${suffix}`,
      },
    );
    if (finalizeError) {
      throw new Error(finalizeError.message);
    }

    const { data: finalizeReplay, error: finalizeReplayError } = await db.rpc(
      "finalize_withdrawal_ledger",
      {
        p_withdrawal_id: withdrawalId,
        p_actor: operatorId,
        p_idempotency_key: `worker-finalize-${suffix}`,
      },
    );
    if (finalizeReplayError) {
      throw new Error(finalizeReplayError.message);
    }
    expect(finalizeReplay).toBe(finalizeTx);

    const { count: sendCountAfter, error: sendCountAfterError } = await db
      .from("withdrawal_external_sends")
      .select("id", { count: "exact", head: true })
      .eq("withdrawal_id", withdrawalId);
    if (sendCountAfterError) {
      throw new Error(sendCountAfterError.message);
    }
    expect(sendCountAfter).toBe(1);

    const { data: withdrawal, error: withdrawalError } = await db
      .from("withdrawal_requests")
      .select("status")
      .eq("id", withdrawalId)
      .single();
    if (withdrawalError) {
      throw new Error(withdrawalError.message);
    }
    expect(withdrawal.status).toBe("COMPLETED");
  });

  it("rejects unsupported jobs without completing them", async () => {
    const db = client();
    const workerId = `ws05-job-unsup-${randomUUID().slice(0, 8)}`;
    const job = await insertSystemJob(db, {
      job_type: "NOT_A_REAL_JOB",
      max_attempts: 2,
    });

    const summary = await processJobBatch(db, { workerId });
    expect(summary.unsupported).toBeGreaterThanOrEqual(1);
    expect(summary.completed).toBe(0);

    const failed = await readJob(db, job.id);
    expect(["FAILED", "DEAD_LETTER"]).toContain(failed.status);
    expect(failed.last_error_code).toBe("UNSUPPORTED_JOB_TYPE");
  });
});
