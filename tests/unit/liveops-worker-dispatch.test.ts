import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import {
  processJobBatch,
  stopAllLeaseRenewals,
} from "../../workers/runner.mjs";

const revision = "17300000-0000-4000-8000-000000000001";
const source = "17300000-0000-4000-8000-000000000002";
const jobId = "17300000-0000-4000-8000-000000000003";
function fixture(completionError: string | null, extra: object = {}) {
  const row = {
    id: jobId,
    job_type: "LIVEOPS_PUBLICATION_FANOUT_V1",
    attempts: 1,
    payload_version: 1,
    idempotency_key: `liveops-fanout:${revision}:1`,
    payload: {
      revision_id: revision,
      source_event_id: source,
      chunk_number: 1,
      after_user_id: null,
      ...extra,
    },
  };
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_system_jobs") return { data: [row], error: null };
    if (name === "complete_system_job" && completionError)
      return { error: { message: completionError } };
    return { error: null };
  });
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}
afterEach(() => {
  stopAllLeaseRenewals();
  vi.restoreAllMocks();
});

it("hands one leased chunk to the existing completion command without recipient or policy overrides", async () => {
  const { rpc, client } = fixture(null);
  expect(
    await processJobBatch(client, {
      workerId: "publication-worker",
      batchSize: 1,
    }),
  ).toEqual({ claimed: 1, completed: 1, failed: 0, unsupported: 0 });
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "claim_system_jobs",
    "extend_system_job_lease",
    "complete_system_job",
  ]);
  expect(rpc).toHaveBeenLastCalledWith("complete_system_job", {
    p_job_id: jobId,
    p_worker_id: "publication-worker",
  });
});

it("rejects caller recipient injection before DB completion", async () => {
  const { rpc, client } = fixture(null, { recipients: ["another-member"] });
  expect(
    (
      await processJobBatch(client, {
        workerId: "publication-worker",
        randomUnit: 0,
      })
    ).completed,
  ).toBe(0);
  expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
    "complete_system_job",
  );
  expect(rpc).toHaveBeenLastCalledWith(
    "fail_system_job",
    expect.objectContaining({
      p_error_code: "LIVEOPS_FANOUT_JOB_ENVELOPE_INVALID",
      p_error_class: "PERMANENT",
    }),
  );
});

it.each(["LIVEOPS_FANOUT_JOB_ORIGINAL_INVALID", "JOB_LEASE_NOT_OWNED"])(
  "preserves closed completion failure %s without creating a notification",
  async (error) => {
    const { rpc, client } = fixture(error);
    expect(
      await processJobBatch(client, {
        workerId: "publication-worker",
        randomUnit: 0,
      }),
    ).toEqual({ claimed: 1, completed: 0, failed: 1, unsupported: 0 });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_system_jobs",
      "extend_system_job_lease",
      "complete_system_job",
      "fail_system_job",
    ]);
    expect(rpc).toHaveBeenLastCalledWith(
      "fail_system_job",
      expect.objectContaining({ p_error_code: error }),
    );
  },
);
