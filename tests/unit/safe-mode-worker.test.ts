import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { processOutboxBatch } from "../../workers/runner.mjs";

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "0d460000-0000-4000-8000-00000000f101",
    event_type: "SAFE_MODE_CHANGED.v1",
    schema_version: 1,
    aggregate_type: "safe_mode_control",
    payload: {
      audit_id: "0d460000-0000-4000-8000-00000000f102",
      is_paused: true,
    },
    attempt_count: 1,
    ...overrides,
  };
}
function client(event: ReturnType<typeof fixture>, completeError?: string) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_outbox_events") return { data: [event], error: null };
    if (name === "complete_outbox_event" && completeError)
      return { error: { message: completeError } };
    return { error: null };
  });
  return { rpc };
}

describe("registered internal safe-mode consumer", () => {
  it("runs envelope preflight and uses the existing owned completion command", async () => {
    const db = client(fixture());
    const result = await processOutboxBatch(db as unknown as SupabaseClient, {
      batchSize: 1,
      workerId: "safe-worker-unit",
    });
    expect(result).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      unsupported: 0,
    });
    expect(db.rpc).toHaveBeenCalledWith("complete_outbox_event", {
      p_event_id: fixture().id,
      p_worker_id: "safe-worker-unit",
    });
    expect(db.rpc.mock.calls.map(([name]) => name)).not.toContain(
      "fail_outbox_event",
    );
  });
  it.each([
    { schema_version: 2 },
    { aggregate_type: "another" },
    { payload: {} },
    { payload: { audit_id: "id", is_paused: "true" } },
  ])(
    "rejects an incompatible envelope before completing it",
    async (change) => {
      const db = client(fixture(change));
      const result = await processOutboxBatch(db as unknown as SupabaseClient, {
        batchSize: 1,
      });
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(1);
      expect(db.rpc.mock.calls.map(([name]) => name)).not.toContain(
        "complete_outbox_event",
      );
      expect(db.rpc).toHaveBeenCalledWith(
        "fail_outbox_event",
        expect.objectContaining({
          p_error_code: "SAFE_MODE_EVENT_ENVELOPE_INVALID",
        }),
      );
    },
  );
  it.each(["SAFE_MODE_EVENT_RECEIPT_MISMATCH", "OUTBOX_LEASE_NOT_OWNED"])(
    "never reports completion when the actual command rejects %s",
    async (error) => {
      const db = client(fixture(), error);
      const result = await processOutboxBatch(db as unknown as SupabaseClient, {
        batchSize: 1,
      });
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(1);
      expect(db.rpc).toHaveBeenCalledWith(
        "fail_outbox_event",
        expect.objectContaining({
          p_error_code: error,
        }),
      );
    },
  );
});
