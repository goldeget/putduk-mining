import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { scheduleFundingJobs } from "../../workers/funding-scheduler.mjs";
import { runWorkerCycle, workerCycleFailed } from "../../workers/runner.mjs";

const cursor = "10624000-0000-4000-8000-000000000002";
function receipt(changes: Record<string, unknown> = {}) {
  return {
    contract_version: 1,
    scanned: 0,
    scheduled: 0,
    blocked: 0,
    busy: 0,
    paused: false,
    next_cursor: null,
    ...changes,
  };
}
function client(result: unknown = receipt(), error: unknown = null) {
  const rpc = vi.fn(async (name: string) =>
    name === "schedule_due_funding_jobs"
      ? { data: result, error }
      : { data: [], error: null },
  );
  return { rpc, db: { rpc } as unknown as SupabaseClient };
}

describe("original-backed scheduler orchestration", () => {
  it("prepares before any claim and sends only bounded operational pagination", async () => {
    const { db, rpc } = client(receipt({ scanned: 1, scheduled: 1 }));
    const summary = await runWorkerCycle(db, { workerId: "scheduler-test" });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "schedule_due_funding_jobs",
      "claim_outbox_events",
      "claim_system_jobs",
    ]);
    expect(rpc).toHaveBeenNthCalledWith(1, "schedule_due_funding_jobs", {
      p_batch_size: 25,
      p_after_user_id: null,
    });
    expect(summary.scheduler).toEqual({
      contract_version: 1,
      scanned: 1,
      scheduled: 1,
      blocked: 0,
      busy: 0,
      paused: false,
    });
    expect(workerCycleFailed(summary)).toBe(false);
  });

  it("retains per-client pagination without logging internal member identifiers", async () => {
    const { db, rpc } = client(
      receipt({ scanned: 1, blocked: 1, next_cursor: cursor }),
    );
    const result = await scheduleFundingJobs(db, { batchSize: 1 });
    await scheduleFundingJobs(db, { batchSize: 1 });
    expect(result).not.toHaveProperty("next_cursor");
    expect(rpc).toHaveBeenNthCalledWith(2, "schedule_due_funding_jobs", {
      p_batch_size: 1,
      p_after_user_id: cursor,
    });
    const second = client();
    await scheduleFundingJobs(second.db);
    expect(second.rpc).toHaveBeenCalledWith("schedule_due_funding_jobs", {
      p_batch_size: 25,
      p_after_user_id: null,
    });
  });

  it("preserves operational claims while blocking funding on an unavailable scheduler", async () => {
    const { db, rpc } = client(null, { message: "RPC_NOT_INSTALLED" });
    const summary = await runWorkerCycle(db);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(summary.jobs.claimed).toBe(0);
    expect(summary.outbox.claimed).toBe(0);
    expect(workerCycleFailed(summary)).toBe(true);
    expect(summary.scheduler).toEqual({ error: "RPC_NOT_INSTALLED" });
  });

  it("keeps operational jobs and outbox available while funding is stopped", async () => {
    const { db, rpc } = client(receipt({ paused: true }));
    const summary = await runWorkerCycle(db);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "schedule_due_funding_jobs",
      "claim_outbox_events",
      "claim_system_jobs",
    ]);
    expect(rpc).toHaveBeenCalledWith(
      "claim_system_jobs",
      expect.objectContaining({ p_allow_funding: false }),
    );
    expect(summary.jobs.claimed).toBe(0);
    expect(workerCycleFailed(summary)).toBe(false);
  });

  it.each([
    null,
    [],
    receipt({ contract_version: 2 }),
    receipt({ scanned: -1 }),
    receipt({ scanned: 26 }),
    receipt({ scheduled: 1 }),
    receipt({ busy: 0.5 }),
    receipt({ next_cursor: "bad" }),
    receipt({ scanned: 1, next_cursor: cursor }),
    receipt({ paused: true, scanned: 1 }),
    receipt({ amount_atomic: "1000000" }),
  ])(
    "blocks funding but preserves operational work on malformed scheduler response (%j)",
    async (response) => {
      const { db, rpc } = client(response);
      const summary = await runWorkerCycle(db);
      expect(rpc).toHaveBeenCalledTimes(3);
      expect(summary.scheduler).toEqual({
        error: "FUNDING_SCHEDULER_RESPONSE_INVALID",
      });
      expect(workerCycleFailed(summary)).toBe(true);
    },
  );

  it.each([0, 101, 1.5, Number.NaN])(
    "rejects invalid operational batch %s",
    async (batchSize) => {
      const { db, rpc } = client();
      await expect(scheduleFundingJobs(db, { batchSize })).rejects.toThrow(
        "FUNDING_SCHEDULER_BATCH_INVALID",
      );
      expect(rpc).not.toHaveBeenCalled();
    },
  );
});

describe("independent operational work during a funding stop", () => {
  const jobId = "10624000-0000-4000-8000-000000000010";
  const revision = "10624000-0000-4000-8000-000000000011";
  const sourceEvent = "10624000-0000-4000-8000-000000000012";
  it.each(["pause", "rpc-error", "malformed"])(
    "executes reconciliation despite scheduler %s",
    async (mode) => {
      let claimed = false;
      const rpc = vi.fn(async (name: string) => {
        if (name === "schedule_due_funding_jobs")
          return mode === "rpc-error"
            ? { data: null, error: { message: "SCHEDULER_OUTAGE" } }
            : {
                data:
                  mode === "malformed"
                    ? { madeUp: true }
                    : receipt({ paused: true }),
                error: null,
              };
        if (name === "claim_system_jobs" && !claimed) {
          claimed = true;
          return {
            data: [
              { id: jobId, job_type: "FINANCIAL_RECONCILIATION", attempts: 1 },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      });
      const summary = await runWorkerCycle(
        { rpc } as unknown as SupabaseClient,
        { batchSize: 1, workerId: "operational-recon" },
      );
      expect(summary.jobs).toEqual({
        claimed: 1,
        completed: 1,
        failed: 0,
        unsupported: 0,
      });
      expect(rpc).toHaveBeenCalledWith("claim_system_jobs", {
        p_worker_id: "operational-recon",
        p_batch_size: 1,
        p_lease_seconds: 120,
        p_allow_funding: false,
      });
      expect(rpc).toHaveBeenCalledWith("run_financial_reconciliation", {
        p_request_id: jobId,
      });
      expect(rpc).toHaveBeenCalledWith("complete_system_job", {
        p_job_id: jobId,
        p_worker_id: "operational-recon",
      });
    },
  );
  it("executes approved CMS fanout through its existing completion command during pause", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "schedule_due_funding_jobs")
        return { data: receipt({ paused: true }), error: null };
      if (name === "claim_system_jobs")
        return {
          data: [
            {
              id: jobId,
              job_type: "LIVEOPS_PUBLICATION_FANOUT_V1",
              attempts: 1,
              payload_version: 1,
              idempotency_key: `liveops-fanout:${revision}:1`,
              payload: {
                revision_id: revision,
                source_event_id: sourceEvent,
                chunk_number: 1,
                after_user_id: null,
              },
            },
          ],
          error: null,
        };
      return { data: [], error: null };
    });
    const summary = await runWorkerCycle({ rpc } as unknown as SupabaseClient, {
      batchSize: 1,
      workerId: "operational-cms",
    });
    expect(summary.jobs).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      unsupported: 0,
    });
    expect(rpc).toHaveBeenCalledWith("complete_system_job", {
      p_job_id: jobId,
      p_worker_id: "operational-cms",
    });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
      "run_financial_reconciliation",
    );
  });
  it("consumes the canonical safe-mode audit outbox despite scheduler outage", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "schedule_due_funding_jobs")
        return { data: null, error: { message: "SCHEDULER_OUTAGE" } };
      if (name === "claim_outbox_events")
        return {
          data: [
            {
              id: jobId,
              event_type: "SAFE_MODE_CHANGED.v1",
              schema_version: 1,
              aggregate_type: "safe_mode_control",
              payload: { audit_id: sourceEvent, is_paused: true },
              attempt_count: 1,
            },
          ],
          error: null,
        };
      return { data: [], error: null };
    });
    const summary = await runWorkerCycle({ rpc } as unknown as SupabaseClient, {
      batchSize: 1,
      workerId: "operational-audit",
    });
    expect(summary.outbox).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      unsupported: 0,
    });
    expect(rpc).toHaveBeenCalledWith("complete_outbox_event", {
      p_event_id: jobId,
      p_worker_id: "operational-audit",
    });
    expect(workerCycleFailed(summary)).toBe(true);
  });
});
