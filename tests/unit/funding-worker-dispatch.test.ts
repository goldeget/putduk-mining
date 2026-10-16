import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activeLeaseRenewalCount,
  classifyJobFailure,
  processJobBatch,
  stopAllLeaseRenewals,
  type WorkerJobEnvelope,
} from "../../workers/runner.mjs";

const ids = {
  job: "10624000-0000-4000-8000-000000000001",
  user: "10624000-0000-4000-8000-000000000002",
  activation: "10624000-0000-4000-8000-000000000003",
  state: "10624000-0000-4000-8000-000000000004",
};

function job(): WorkerJobEnvelope {
  return {
    id: ids.job,
    job_type: "FUNDING_MINING_TICK_V1",
    attempts: 1,
    payload_version: 1,
    idempotency_key: `funding:state:${ids.state}`,
    payload: {
      user_id: ids.user,
      activation_id: ids.activation,
      expected_state_id: ids.state,
    },
  };
}

function client(row: WorkerJobEnvelope, completionError: string | null = null) {
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (!args) throw new Error("RPC_ARGUMENTS_REQUIRED");
    if (name === "claim_system_jobs") return { data: [row], error: null };
    if (name === "complete_system_job" && completionError)
      return { error: { message: completionError } };
    return { error: null };
  });
  return { rpc, db: { rpc } as unknown as SupabaseClient };
}

afterEach(() => {
  stopAllLeaseRenewals();
  vi.restoreAllMocks();
});

describe("sealed funding worker dispatch", () => {
  it("delegates valid envelope through the existing completion command without economic arguments", async () => {
    const { rpc, db } = client(job());
    expect(
      await processJobBatch(db, { batchSize: 1, workerId: "funding-worker" }),
    ).toEqual({ claimed: 1, completed: 1, failed: 0, unsupported: 0 });
    expect(rpc.mock.calls).toEqual([
      [
        "claim_system_jobs",
        {
          p_worker_id: "funding-worker",
          p_batch_size: 1,
          p_lease_seconds: 120,
        },
      ],
      [
        "extend_system_job_lease",
        {
          p_job_id: ids.job,
          p_worker_id: "funding-worker",
          p_lease_seconds: 120,
        },
      ],
      [
        "complete_system_job",
        { p_job_id: ids.job, p_worker_id: "funding-worker" },
      ],
    ]);
    expect(activeLeaseRenewalCount()).toBe(0);
  });

  it.each([
    ["unsupported envelope version", { payload_version: 2 }],
    ["invalid job identity", { id: "not-a-job" }],
    ["absent attempt", { attempts: 0 }],
    ["fractional attempt", { attempts: 1.5 }],
    ["missing payload", { payload: undefined }],
    ["array payload", { payload: [] }],
    [
      "foreign key contract",
      { idempotency_key: "funding:state:another-state" },
    ],
    [
      "caller reward amount",
      { payload: { ...(job().payload as object), amount_atomic: "999999" } },
    ],
    [
      "caller interval",
      {
        payload: {
          ...(job().payload as object),
          settled_to: "2099-01-01T00:00:00Z",
        },
      },
    ],
    [
      "missing immutable state",
      { payload: { user_id: ids.user, activation_id: ids.activation } },
    ],
    [
      "invalid immutable activation",
      { payload: { ...(job().payload as object), activation_id: "foreign" } },
    ],
  ] as const)(
    "rejects %s without attempting completion",
    async (_name, changed) => {
      const row = { ...job(), ...changed };
      const { rpc, db } = client(row);
      const summary = await processJobBatch(db, {
        batchSize: 1,
        workerId: "funding-worker",
        randomUnit: 0,
      });
      expect(summary).toEqual({
        claimed: 1,
        completed: 0,
        failed: 1,
        unsupported: 0,
      });
      expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
        "complete_system_job",
      );
      expect(rpc).toHaveBeenLastCalledWith("fail_system_job", {
        p_job_id: row.id,
        p_worker_id: "funding-worker",
        p_error_code: "FUNDING_JOB_ENVELOPE_INVALID",
        p_error_class: "PERMANENT",
        p_retry_delay_seconds: 5,
      });
      expect(activeLeaseRenewalCount()).toBe(0);
    },
  );

  it("does not treat a valid envelope as proof of a DB original", async () => {
    const { rpc, db } = client(job(), "FUNDING_JOB_ORIGINAL_REQUIRED");
    expect(
      await processJobBatch(db, {
        batchSize: 1,
        workerId: "funding-worker",
        randomUnit: 0,
      }),
    ).toEqual({ claimed: 1, completed: 0, failed: 1, unsupported: 0 });
    expect(rpc).toHaveBeenLastCalledWith(
      "fail_system_job",
      expect.objectContaining({
        p_job_id: ids.job,
        p_error_code: "FUNDING_JOB_ORIGINAL_REQUIRED",
      }),
    );
  });

  it("preserves canonical fence failure and never sends a fallback monetary command", async () => {
    const { rpc, db } = client(job(), "FUNDING_JOB_FENCE_NOT_OWNED");
    const summary = await processJobBatch(db, {
      batchSize: 1,
      workerId: "stale-worker",
      randomUnit: 0,
    });
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_system_jobs",
      "extend_system_job_lease",
      "complete_system_job",
      "fail_system_job",
    ]);
    expect(classifyJobFailure("FUNDING_JOB_FENCE_NOT_OWNED")).toBe("RETRYABLE");
  });
});
