import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  activeLeaseRenewalCount,
  backoffSeconds,
  processJobBatch,
  processOutboxBatch,
  resolveLeaseRenewIntervalMs,
  runWorkerCycle,
  startPeriodicLeaseRenewal,
  stopAllLeaseRenewals,
  wantsOnce,
} from "../../workers/runner.mjs";

const REMOTE_PROJECT_REF = "osrmyjgmpdspdcwqjwuv";
const localProjectId = process.env.LOCAL_SUPABASE_PROJECT_ID ?? "putduk-mining";
if (!/^putduk-mining(?:-[a-z0-9-]+)?$/.test(localProjectId)) {
  throw new Error("LOCAL_DB_PROJECT_SCOPE_REJECTED");
}
const DB_CONTAINER = `supabase_db_${localProjectId}`;

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

/** GoTrue는 이 컬럼의 NULL을 문자열로 읽지 못해 회원 조회가 실패한다. */
async function expectLoadableAuthUser(client: SupabaseClient, userId: string) {
  const tokens = sql(`
    select (
      confirmation_token is not null
      and recovery_token is not null
      and email_change is not null
      and email_change_token_new is not null
    )::text
    from auth.users
    where id = '${userId}'::uuid
  `);
  expect(tokens).toBe("true");
  const { data, error } = await client.auth.admin.getUserById(userId);
  expect(error).toBeNull();
  expect(data.user?.id).toBe(userId);
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
    // 앱 시계가 DB보다 빠르면 available_at이 아직 도래하지 않아 claim이 0이 된다.
    available_at: new Date(Date.now() - 5_000).toISOString(),
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
    available_at: new Date(Date.now() - 5_000).toISOString(),
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
    expect(source).toContain("extend_outbox_event_lease");
    expect(source).toContain("extend_system_job_lease");
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
    const canUpdate = sql(
      "select has_table_privilege('service_role','public.outbox_events','UPDATE')::text",
    );
    expect(canUpdate).toBe("true");
    const canReplay = sql(
      "select has_function_privilege('service_role','public.replay_outbox_event(uuid,uuid,text,uuid)','EXECUTE')::text",
    );
    expect(canReplay).toBe("true");
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
    expect(failed.status).toBe("DEAD_LETTER");
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
      retryDelaySeconds: 0,
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

    const second = await processOutboxBatch(db, {
      workerId: `${workerId}-b`,
      retryDelaySeconds: 0,
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

  it("extends an owned outbox lease without resetting the attempt", async () => {
    const db = client();
    const workerId = `ws05-lease-${randomUUID().slice(0, 8)}`;
    const event = await insertOutboxEvent(db, {
      event_type: "WORKER_RUNTIME_ACK.v1",
    });
    const { data: claimed, error: claimError } = await db.rpc(
      "claim_outbox_events",
      {
        p_worker_id: workerId,
        p_batch_size: 20,
        p_lease_seconds: 30,
      },
    );
    if (claimError) {
      throw new Error(claimError.message);
    }
    const owned = (
      (claimed ?? []) as Array<{
        id: string;
        status: string;
        attempt_count: number;
        lease_expires_at: string;
      }>
    ).find((row) => row.id === event.id);
    if (!owned) {
      throw new Error("expected outbox event was not claimed");
    }
    expect(owned.status).toBe("PROCESSING");

    const { error: extendError } = await db.rpc("extend_outbox_event_lease", {
      p_event_id: event.id,
      p_worker_id: workerId,
      p_lease_seconds: 600,
    });
    expect(extendError).toBeNull();

    const after = await readOutbox(db, event.id);
    expect(new Date(after.lease_expires_at).getTime()).toBeGreaterThan(
      new Date(owned.lease_expires_at).getTime(),
    );
    expect(after.attempt_count).toBe(owned.attempt_count);
    expect(after.status).toBe("PROCESSING");

    const { error: strangerError } = await db.rpc("extend_outbox_event_lease", {
      p_event_id: event.id,
      p_worker_id: `stranger-${randomUUID().slice(0, 8)}`,
      p_lease_seconds: 600,
    });
    expect(strangerError?.message ?? "").toMatch(/OUTBOX_LEASE_NOT_OWNED/);

    const { error: completeError } = await db.rpc("complete_outbox_event", {
      p_event_id: event.id,
      p_worker_id: workerId,
    });
    expect(completeError).toBeNull();
  });

  it("replays a dead-lettered event through replay_outbox_event", async () => {
    const db = client();
    const workerId = `ws05-replay-${randomUUID().slice(0, 8)}`;
    const actorId = randomUUID();
    const email = `worker.replay.${actorId.slice(0, 8)}@putduk.test`;
    sql(`
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new) values (
  '${actorId}'::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  '${email}',
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(), statement_timestamp(), '', '', '', ''
);
`);
    await expectLoadableAuthUser(db, actorId);
    const { error: roleError } = await db.from("user_roles").insert({
      user_id: actorId,
      role: "ADMIN",
      granted_by: actorId,
    });
    if (roleError) {
      throw new Error(roleError.message);
    }

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

    const requestId = randomUUID();
    const { error: replayError } = await db.rpc("replay_outbox_event", {
      p_event_id: event.id,
      p_actor_id: actorId,
      p_reason: "WS-05 operator replay",
      p_request_id: requestId,
    });
    if (replayError) {
      throw new Error(replayError.message);
    }
    const { error: replayAgainError } = await db.rpc("replay_outbox_event", {
      p_event_id: event.id,
      p_actor_id: actorId,
      p_reason: "WS-05 operator replay",
      p_request_id: requestId,
    });
    expect(replayAgainError).toBeNull();

    const { count: auditCount, error: auditError } = await db
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "outbox.replay")
      .eq("request_id", requestId);
    if (auditError) {
      throw new Error(auditError.message);
    }
    expect(auditCount).toBe(1);
    expect((await readOutbox(db, event.id)).status).toBe("PENDING");

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

  it("closes fresh general withdrawal and finalizes a historical original without another send", async () => {
    const db = client();
    const suffix = randomUUID().slice(0, 8);
    const userId = randomUUID();
    const operatorId = userId;
    const email = `worker.finalize.${suffix}@putduk.test`;

    sql(`
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new) values (
  '${userId}'::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  '${email}',
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(), statement_timestamp(), '', '', '', ''
);
`);
    await expectLoadableAuthUser(db, userId);

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

    const { data: freshWithdrawalId, error: requestError } = await db.rpc(
      "request_krw_withdrawal",
      {
        p_user_id: userId,
        p_destination_id: destinationId,
        p_amount_krw: 5000,
        p_idempotency_key: `worker-wd-${suffix}`,
      },
    );
    expect(freshWithdrawalId).toBeNull();
    expect(requestError?.code).toBe("55000");
    expect(requestError?.message).toBe(
      "WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE",
    );
    const { count: rejectedRequestCount, error: rejectedCountError } = await db
      .from("withdrawal_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("idempotency_key", `worker-wd-${suffix}`);
    expect(rejectedCountError).toBeNull();
    expect(rejectedRequestCount).toBe(0);

    // A postgres-only, connection-local test fixture simulates an original
    // source-less historical receipt. It is not a verified mining producer.
    const historicalReceipt = sql(`
      begin;
      ${readFileSync("supabase/test-fixtures/historical-held-withdrawal.sql", "utf8")}
      select pg_temp.seed_historical_held_withdrawal(
        '${userId}'::uuid, '${destinationId}'::uuid, 5000, 'worker-wd-${suffix}'
      );
      commit;
    `);
    const withdrawalId = historicalReceipt
      .split(/\r?\n/)
      .find((line) => /^[a-f0-9-]{36}$/.test(line));
    if (!withdrawalId) throw new Error("HISTORICAL_WITHDRAWAL_FIXTURE_MISSING");
    const recovered = await db.rpc("request_krw_withdrawal", {
      p_user_id: userId,
      p_destination_id: destinationId,
      p_amount_krw: 5000,
      p_idempotency_key: `worker-wd-${suffix}`,
    });
    expect(recovered.error).toBeNull();
    expect(recovered.data).toBe(withdrawalId);
    const provenance = await db
      .from("money_source_summaries")
      .select("coverage")
      .eq("user_id", userId)
      .single();
    expect(provenance.error).toBeNull();
    expect(provenance.data?.coverage).toBe("UNRESOLVED");

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
    expect(failed.status).toBe("DEAD_LETTER");
    expect(failed.last_error_code).toBe("UNSUPPORTED_JOB_TYPE");
  });

  it("renews an outbox lease while the handler outlives the original lease", async () => {
    const db = client();
    const workerId = `ws06-long-${randomUUID().slice(0, 8)}`;
    const stranger = `ws06-stranger-${randomUUID().slice(0, 8)}`;
    const event = await insertOutboxEvent(db, {
      event_type: "WORKER_RUNTIME_LONG.v1",
      max_attempts: 3,
    });
    let periodicExtends = 0;
    let handlerStarted = false;
    let completes = 0;
    const originalRpc = db.rpc.bind(db);
    db.rpc = (async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "extend_outbox_event_lease" && handlerStarted) {
        periodicExtends += 1;
      }
      if (fn === "complete_outbox_event" && args?.p_event_id === event.id) {
        completes += 1;
      }
      return originalRpc(fn, args);
    }) as unknown as typeof db.rpc;

    const summary = await processOutboxBatch(db, {
      workerId,
      batchSize: 20,
      leaseSeconds: 10,
      leaseRenewIntervalMs: 1_000,
      outboxHandlers: {
        "WORKER_RUNTIME_LONG.v1": async () => {
          handlerStarted = true;
          const started = Date.now();
          await delay(11_000);
          expect(Date.now() - started).toBeGreaterThan(10_000);
          expect(periodicExtends).toBeGreaterThanOrEqual(1);

          const { data: claimedByStranger, error: strangerError } =
            await originalRpc("claim_outbox_events", {
              p_worker_id: stranger,
              p_batch_size: 20,
              p_lease_seconds: 10,
            });
          expect(strangerError).toBeNull();
          const stolen = (
            (claimedByStranger ?? []) as Array<{ id: string }>
          ).some((row) => row.id === event.id);
          expect(stolen).toBe(false);

          const mid = await readOutbox(db, event.id);
          expect(mid.status).toBe("PROCESSING");
          expect(mid.lease_owner).toBe(workerId);
          expect(new Date(mid.lease_expires_at).getTime()).toBeGreaterThan(
            Date.now() + 3_000,
          );
        },
      },
    });

    expect(summary.completed).toBeGreaterThanOrEqual(1);
    expect(completes).toBe(1);
    const done = await readOutbox(db, event.id);
    expect(done.status).toBe("PROCESSED");
    expect(done.lease_owner).toBeNull();

    const { error: secondComplete } = await originalRpc(
      "complete_outbox_event",
      {
        p_event_id: event.id,
        p_worker_id: workerId,
      },
    );
    expect(secondComplete?.message ?? "").toMatch(/OUTBOX_LEASE_NOT_OWNED/);
    expect(activeLeaseRenewalCount()).toBe(0);
  }, 30_000);

  it("fails a throwing long handler exactly once and does not complete it", async () => {
    const db = client();
    const workerId = `ws06-throw-${randomUUID().slice(0, 8)}`;
    const event = await insertOutboxEvent(db, {
      event_type: "WORKER_RUNTIME_LONG_FAIL.v1",
      max_attempts: 3,
    });
    let fails = 0;
    let completes = 0;
    let periodicExtends = 0;
    let handlerStarted = false;
    const originalRpc = db.rpc.bind(db);
    db.rpc = (async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "extend_outbox_event_lease" && handlerStarted) {
        periodicExtends += 1;
      }
      if (fn === "fail_outbox_event" && args?.p_event_id === event.id) {
        fails += 1;
      }
      if (fn === "complete_outbox_event" && args?.p_event_id === event.id) {
        completes += 1;
      }
      return originalRpc(fn, args);
    }) as unknown as typeof db.rpc;

    const summary = await processOutboxBatch(db, {
      workerId,
      batchSize: 20,
      leaseSeconds: 10,
      leaseRenewIntervalMs: 400,
      outboxHandlers: {
        "WORKER_RUNTIME_LONG_FAIL.v1": async () => {
          handlerStarted = true;
          await delay(1_200);
          throw new Error("LONG_HANDLER_FAILED");
        },
      },
    });

    expect(periodicExtends).toBeGreaterThanOrEqual(1);
    expect(fails).toBe(1);
    expect(completes).toBe(0);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(summary.completed).toBe(0);
    const failed = await readOutbox(db, event.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.last_error_code).toMatch(/LONG_HANDLER_FAILED/);
    expect(failed.attempt_count).toBe(1);
    expect(activeLeaseRenewalCount()).toBe(0);
  }, 20_000);

  it("renews a system job lease and rejects another worker during the handler", async () => {
    const db = client();
    const workerId = `ws06-job-long-${randomUUID().slice(0, 8)}`;
    const stranger = `ws06-job-stranger-${randomUUID().slice(0, 8)}`;
    const job = await insertSystemJob(db, {
      job_type: "WORKER_RUNTIME_LONG_JOB",
      max_attempts: 3,
    });
    let periodicExtends = 0;
    let handlerStarted = false;
    let completes = 0;
    const originalRpc = db.rpc.bind(db);
    db.rpc = (async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "extend_system_job_lease" && handlerStarted) {
        periodicExtends += 1;
      }
      if (fn === "complete_system_job" && args?.p_job_id === job.id) {
        completes += 1;
      }
      return originalRpc(fn, args);
    }) as unknown as typeof db.rpc;

    const summary = await processJobBatch(db, {
      workerId,
      batchSize: 20,
      leaseSeconds: 10,
      leaseRenewIntervalMs: 1_000,
      jobHandlers: {
        WORKER_RUNTIME_LONG_JOB: async () => {
          handlerStarted = true;
          const started = Date.now();
          await delay(11_000);
          expect(Date.now() - started).toBeGreaterThan(10_000);
          expect(periodicExtends).toBeGreaterThanOrEqual(1);
          const { data: claimedByStranger, error: strangerError } =
            await originalRpc("claim_system_jobs", {
              p_worker_id: stranger,
              p_batch_size: 20,
              p_lease_seconds: 10,
            });
          expect(strangerError).toBeNull();
          const stolen = (
            (claimedByStranger ?? []) as Array<{ id: string }>
          ).some((row) => row.id === job.id);
          expect(stolen).toBe(false);
          const mid = await readJob(db, job.id);
          expect(mid.lease_owner).toBe(workerId);
          expect(new Date(mid.lease_expires_at).getTime()).toBeGreaterThan(
            Date.now() + 3_000,
          );
        },
      },
    });

    expect(summary.completed).toBeGreaterThanOrEqual(1);
    expect(completes).toBe(1);
    const done = await readJob(db, job.id);
    expect(done.status).toBe("SUCCEEDED");
    expect(activeLeaseRenewalCount()).toBe(0);
  }, 30_000);
});

describe("safe-mode actual command and registered worker delivery", () => {
  it("acknowledges the actual command once and never reapplies an old pause on replay", async () => {
    const db = serviceClient();
    const actorId = randomUUID();
    const firstRequest = randomUUID();
    const secondRequest = randomUUID();
    const firstKey = `safe-worker-${randomUUID()}`;
    const secondKey = `safe-worker-${randomUUID()}`;
    sql(`
      insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new)
      values ('${actorId}', 'authenticated', 'authenticated', 'safe-worker-${actorId}@putduk.test', '',
        statement_timestamp(), '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', '');
      insert into public.user_roles (user_id, role, granted_by) values ('${actorId}', 'ADMIN', '${actorId}');
    `);
    async function command(
      paused: boolean,
      requestId: string,
      operationKey: string,
    ) {
      const prior = await db
        .from("safe_mode_controls")
        .select("request_id")
        .eq("component", "AI")
        .maybeSingle();
      expect(prior.error).toBeNull();
      const written = await db.from("audit_logs").insert({
        actor_user_id: actorId,
        actor_role: "ADMIN",
        action: paused ? "SAFE_MODE_ENABLED" : "SAFE_MODE_DISABLED",
        target_type: "SAFE_MODE",
        target_id: "AI",
        reason: "Actual worker safe mode integration",
        request_id: requestId,
        metadata: {
          command_version: 1,
          idempotency_key: operationKey,
          component: "AI",
          is_paused: paused,
          review_at: null,
          expected_request_id: prior.data?.request_id ?? null,
        },
      });
      expect(written.error).toBeNull();
      const created = await db
        .from("outbox_events")
        .select("id,payload")
        .eq("request_id", requestId)
        .single();
      expect(created.error).toBeNull();
      expect(created.data?.payload.audit_id).toMatch(/^[a-f0-9-]{36}$/);
      return created.data!;
    }
    const first = await command(true, firstRequest, firstKey);
    const firstCycle = await processOutboxBatch(db, {
      workerId: `safe-worker-${randomUUID()}`,
      batchSize: 100,
    });
    expect(firstCycle.completed).toBeGreaterThanOrEqual(1);
    expect((await readOutbox(db, first.id)).status).toBe("PROCESSED");
    const readDelivery = () =>
      db
        .from("event_consumer_deliveries")
        .select("id,status,attempt_count,processed_at")
        .eq("event_id", first.id)
        .eq("consumer_name", "operator_safe_mode_audit.v1")
        .single();
    const delivered = await readDelivery();
    expect(delivered.error).toBeNull();
    expect(delivered.data).toMatchObject({
      status: "SUCCEEDED",
      attempt_count: 1,
    });
    expect(delivered.data?.processed_at).toBeTruthy();

    const second = await command(false, secondRequest, secondKey);
    // Only this newly-created CI fixture is forced to its recovery state.
    sql(
      `update public.outbox_events set status='DEAD_LETTER', lease_owner=null, lease_expires_at=null where id='${first.id}';`,
    );
    const replayed = await db.rpc("replay_outbox_event", {
      p_event_id: first.id,
      p_actor_id: actorId,
      p_reason: "Replay verified historical audit event",
      p_request_id: randomUUID(),
    });
    expect(replayed.error).toBeNull();
    expect(replayed.data).toBe(first.id);
    await processOutboxBatch(db, {
      workerId: `safe-replay-${randomUUID()}`,
      batchSize: 100,
    });
    expect((await readOutbox(db, first.id)).status).toBe("PROCESSED");
    expect((await readOutbox(db, second.id)).status).toBe("PROCESSED");
    const duplicate = await readDelivery();
    expect(duplicate.error).toBeNull();
    expect(duplicate.data).toEqual(delivered.data);
    const current = await db
      .from("safe_mode_controls")
      .select("is_paused,request_id")
      .eq("component", "AI")
      .single();
    expect(current.error).toBeNull();
    expect(current.data).toEqual({
      is_paused: false,
      request_id: secondRequest,
    });
    const auditCount = await db
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("target_type", "SAFE_MODE")
      .eq("actor_user_id", actorId);
    expect(auditCount.error).toBeNull();
    expect(auditCount.count).toBe(2);
    expect(activeLeaseRenewalCount()).toBe(0);
  });
});

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("periodic lease renewal without a database", () => {
  it("uses a shorter interval than the lease by default", () => {
    expect(resolveLeaseRenewIntervalMs(60)).toBe(20_000);
    expect(resolveLeaseRenewIntervalMs(10)).toBe(3_333);
    expect(resolveLeaseRenewIntervalMs(60, 1_000)).toBe(1_000);
    expect(() => resolveLeaseRenewIntervalMs(60, 10)).toThrow(
      /INVALID_LEASE_RENEW_INTERVAL/,
    );
  });

  it("fails the outbox item once when renewal fails and does not complete it", async () => {
    let extendCalls = 0;
    let completes = 0;
    let fails = 0;
    const client = {
      rpc: async (name: string) => {
        if (name === "claim_outbox_events") {
          return {
            data: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                event_type: "LEASE_EXTEND_FAIL.v1",
                attempt_count: 1,
              },
            ],
            error: null,
          };
        }
        if (name === "extend_outbox_event_lease") {
          extendCalls += 1;
          if (extendCalls === 1) {
            return { data: new Date().toISOString(), error: null };
          }
          return { error: { message: "OUTBOX_LEASE_NOT_OWNED" } };
        }
        if (name === "complete_outbox_event") {
          completes += 1;
          return { error: null };
        }
        if (name === "fail_outbox_event") {
          fails += 1;
          return { error: null };
        }
        return { error: { message: `UNEXPECTED_${name}` } };
      },
    };

    const summary = await processOutboxBatch(
      client as unknown as SupabaseClient,
      {
        workerId: "ws06-extend-fail",
        leaseSeconds: 10,
        leaseRenewIntervalMs: 50,
        outboxHandlers: {
          "LEASE_EXTEND_FAIL.v1": async () => {
            await delay(300);
          },
        },
      },
    );

    expect(extendCalls).toBeGreaterThanOrEqual(2);
    expect(completes).toBe(0);
    expect(fails).toBe(1);
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(activeLeaseRenewalCount()).toBe(0);
  });

  it("fails the job once when renewal fails and does not complete it", async () => {
    let extendCalls = 0;
    let completes = 0;
    let fails = 0;
    const client = {
      rpc: async (name: string) => {
        if (name === "claim_system_jobs") {
          return {
            data: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                job_type: "LEASE_EXTEND_FAIL_JOB",
                attempts: 1,
              },
            ],
            error: null,
          };
        }
        if (name === "extend_system_job_lease") {
          extendCalls += 1;
          if (extendCalls === 1) {
            return { data: new Date().toISOString(), error: null };
          }
          return { error: { message: "JOB_LEASE_NOT_OWNED" } };
        }
        if (name === "complete_system_job") {
          completes += 1;
          return { error: null };
        }
        if (name === "fail_system_job") {
          fails += 1;
          return { error: null };
        }
        return { error: { message: `UNEXPECTED_${name}` } };
      },
    };

    const summary = await processJobBatch(client as unknown as SupabaseClient, {
      workerId: "ws06-job-extend-fail",
      leaseSeconds: 10,
      leaseRenewIntervalMs: 50,
      jobHandlers: {
        LEASE_EXTEND_FAIL_JOB: async () => {
          await delay(300);
        },
      },
    });

    expect(extendCalls).toBeGreaterThanOrEqual(2);
    expect(completes).toBe(0);
    expect(fails).toBe(1);
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(activeLeaseRenewalCount()).toBe(0);
  });

  it("clears timers after settle and worker shutdown", async () => {
    let calls = 0;
    const renewal = startPeriodicLeaseRenewal({
      intervalMs: 60,
      extend: async () => {
        calls += 1;
      },
    });
    await delay(200);
    expect(calls).toBeGreaterThan(0);
    expect(renewal.stats.extensions).toBe(calls);
    const seen = renewal.stats.extensions;
    await renewal.settle();
    await delay(120);
    expect(renewal.stats.extensions).toBe(seen);
    expect(activeLeaseRenewalCount()).toBe(0);

    const first = startPeriodicLeaseRenewal({
      intervalMs: 50,
      extend: async () => undefined,
    });
    const second = startPeriodicLeaseRenewal({
      intervalMs: 50,
      extend: async () => undefined,
    });
    expect(activeLeaseRenewalCount()).toBe(2);
    expect(first.stats.aborted).toBe(false);
    expect(second.stats.aborted).toBe(false);
    stopAllLeaseRenewals();
    expect(activeLeaseRenewalCount()).toBe(0);
    await delay(120);
    expect(activeLeaseRenewalCount()).toBe(0);
  });
});
