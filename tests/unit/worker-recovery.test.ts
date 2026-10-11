import { readFileSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  backoffSeconds,
  classifyJobFailure,
  jitteredRetryDelaySeconds,
  processJobBatch,
  processOutboxBatch,
  stopAllLeaseRenewals,
} from "../../workers/runner.mjs";

const migrationPath =
  "supabase/migrations/20261005160000_worker_permanent_failure_and_reconciliation_idempotency.sql";
const previousReconciliationPath =
  "supabase/migrations/20261002230000_krw_deposit_journal_integrity.sql";

afterEach(() => {
  stopAllLeaseRenewals();
});

function mismatchSection(sql: string) {
  const marker =
    "create or replace function public.run_financial_reconciliation";
  const start = sql.lastIndexOf(marker);
  const from = sql.indexOf(
    "insert into public.reconciliation_mismatches",
    start,
  );
  const to = sql.lastIndexOf("return v_run_id;");
  return sql.slice(from, to).replaceAll("\r\n", "\n");
}

function client(
  handlers: Record<
    string,
    (args?: Record<string, unknown>) => { data?: unknown; error: unknown }
  >,
) {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    calls.push([name, args]);
    const handle = handlers[name];
    if (handle) {
      return handle(args);
    }
    return { data: null, error: null };
  });
  return {
    calls,
    db: { rpc } as unknown as SupabaseClient,
  };
}

describe("worker retry jitter and permanent classification", () => {
  it("keeps the capped base delay and adds jitter without exceeding 3600", () => {
    expect(jitteredRetryDelaySeconds(1, 0)).toBe(backoffSeconds(1));
    expect(jitteredRetryDelaySeconds(4, 0)).toBe(8);
    expect(jitteredRetryDelaySeconds(4, 0.5)).toBe(12);
    expect(jitteredRetryDelaySeconds(20, 0.999)).toBe(3600);
    expect(() => jitteredRetryDelaySeconds(1, 1)).toThrow(
      /INVALID_RETRY_JITTER/,
    );
    expect(() => jitteredRetryDelaySeconds(1, -0.1)).toThrow(
      /INVALID_RETRY_JITTER/,
    );
  });

  it("classifies only non-retryable job failures as permanent", () => {
    expect(classifyJobFailure("UNSUPPORTED_JOB_TYPE")).toBe("PERMANENT");
    expect(classifyJobFailure("RECONCILIATION_JOB_ID_REQUIRED")).toBe(
      "PERMANENT",
    );
    expect(classifyJobFailure("TRANSIENT_DB")).toBe("RETRYABLE");
  });

  it("sends unsupported outbox failures with a delay at least the base backoff", async () => {
    const { calls, db } = client({
      claim_outbox_events: () => ({
        data: [
          {
            id: "0d460000-0000-4000-8000-00000000c101",
            event_type: "UNKNOWN_FANOUT.v1",
            attempt_count: 4,
          },
        ],
        error: null,
      }),
    });

    const summary = await processOutboxBatch(db, {
      batchSize: 1,
      workerId: "lane-c",
      randomUnit: 0,
    });

    expect(summary.unsupported).toBe(1);
    expect(summary.completed).toBe(0);
    expect(calls.map(([name]) => name)).toContain("fail_outbox_event");
    expect(calls).toContainEqual([
      "fail_outbox_event",
      {
        p_event_id: "0d460000-0000-4000-8000-00000000c101",
        p_worker_id: "lane-c",
        p_error_code: "UNSUPPORTED_EVENT_TYPE",
        p_retry_delay_seconds: backoffSeconds(4),
      },
    ]);
  });
});

describe("reconciliation orchestration idempotency", () => {
  it("reuses the job id as the reconciliation request id", async () => {
    const job = {
      id: "11111111-1111-4111-8111-111111111111",
      job_type: "FINANCIAL_RECONCILIATION",
      attempts: 1,
    };
    const { calls, db } = client({
      claim_system_jobs: () => ({ data: [job], error: null }),
    });

    await processJobBatch(db, { batchSize: 1, workerId: "lane-c-recon" });
    await processJobBatch(db, { batchSize: 1, workerId: "lane-c-recon-retry" });

    const requests = calls.filter(
      ([name]) => name === "run_financial_reconciliation",
    );
    expect(requests).toEqual([
      ["run_financial_reconciliation", { p_request_id: job.id }],
      ["run_financial_reconciliation", { p_request_id: job.id }],
    ]);
    expect(calls.map(([name]) => name)).not.toContain("fail_system_job");
  });

  it("dead-letters a reconciliation job that has no id", async () => {
    const { calls, db } = client({
      claim_system_jobs: () => ({
        data: [
          {
            id: " ",
            job_type: "FINANCIAL_RECONCILIATION",
            attempts: 1,
          },
        ],
        error: null,
      }),
    });

    const summary = await processJobBatch(db, {
      batchSize: 1,
      workerId: "lane-c-recon",
    });
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(calls).toContainEqual([
      "fail_system_job",
      expect.objectContaining({
        p_error_code: "RECONCILIATION_JOB_ID_REQUIRED",
        p_error_class: "PERMANENT",
      }),
    ]);
  });

  it("keeps ordinary handler failures retryable", async () => {
    const { calls, db } = client({
      claim_system_jobs: () => ({
        data: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            job_type: "FINANCIAL_RECONCILIATION",
            attempts: 2,
          },
        ],
        error: null,
      }),
    });

    await processJobBatch(db, {
      batchSize: 1,
      workerId: "lane-c-recon",
      randomUnit: 0,
      jobHandlers: {
        FINANCIAL_RECONCILIATION: async () => {
          throw new Error("TRANSIENT_DB");
        },
      },
    });

    expect(calls).toContainEqual([
      "fail_system_job",
      {
        p_job_id: "22222222-2222-4222-8222-222222222222",
        p_worker_id: "lane-c-recon",
        p_error_code: "TRANSIENT_DB",
        p_error_class: "RETRYABLE",
        p_retry_delay_seconds: backoffSeconds(2),
      },
    ]);
  });
});

describe("worker recovery migration contract", () => {
  const sql = readFileSync(migrationPath, "utf8");

  it("dead-letters permanent failures and reuses a succeeded reconciliation request", () => {
    expect(sql).toMatch(/UNSUPPORTED_EVENT_TYPE/);
    expect(sql).toMatch(/SAFE_MODE_EVENT_ENVELOPE_INVALID/);
    expect(sql).toMatch(/upper\(btrim\(p_error_class\)\) = 'PERMANENT'/);
    expect(sql).toMatch(/RECONCILIATION_REQUEST_NOT_TERMINAL/);
    expect(sql).toMatch(/reconciliation_runs_request_scope_uidx/);
    expect(sql).toMatch(/never auto-repairs money/i);
    expect(sql).not.toMatch(/insert into public\.ledger_entries/i);
    expect(sql).not.toMatch(/update public\.wallet_accounts/i);
    expect(sql).not.toMatch(/update public\.wallet_ledger/i);
  });

  it("keeps the existing mismatch comparisons unchanged", () => {
    const previous = readFileSync(previousReconciliationPath, "utf8");
    expect(mismatchSection(sql)).toBe(mismatchSection(previous));
  });
});
