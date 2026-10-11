import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  processOutboxBatch,
  stopAllLeaseRenewals,
  type WorkerOutboxEnvelope,
} from "../../workers/runner.mjs";

const id = "10100000-0000-4000-8000-000000000001";
const sources: WorkerOutboxEnvelope[] = [
  {
    id,
    aggregate_id: id,
    attempt_count: 1,
    schema_version: 1,
    event_type: "DEPOSIT_CONFIRMED.v1",
    aggregate_type: "deposit_request",
    payload: {
      user_id: id,
      currency: "KRW",
      approved_amount_atomic: "100000",
      requested_amount_atomic: "100000",
      ledger_transaction_id: id,
      wallet_ledger_id: id,
    },
  },
  {
    id,
    aggregate_id: id,
    attempt_count: 1,
    schema_version: 1,
    event_type: "WITHDRAWAL_COMPLETED.v1",
    aggregate_type: "withdrawal_request",
    payload: { finalize_ledger_transaction_id: id, amount_atomic: "30000" },
  },
  {
    id,
    aggregate_id: id,
    attempt_count: 1,
    schema_version: 1,
    event_type: "TRIAL_REWARD_CONVERTED.v1",
    aggregate_type: "trial_reward_conversion",
    payload: {
      user_id: id,
      currency: "KRW",
      funding_required: false,
      amount_atomic: "5000",
      ledger_transaction_id: id,
    },
  },
];
for (const event_type of [
  "MINING_STARTED.v1",
  "MINING_SETTLEMENT_COMPLETED.v1",
]) {
  sources.push({
    id,
    aggregate_id: id,
    attempt_count: 1,
    schema_version: 1,
    event_type,
    aggregate_type: "funded_mining_mission",
    payload: {
      user_id: id,
      original_id: id,
      earned_receipt_id: id,
      settlement_id: id,
      digest: "a".repeat(64),
    },
  });
}
sources.push({
  id,
  aggregate_id: id,
  attempt_count: 1,
  schema_version: 1,
  event_type: "USDT_MANUAL_DEPOSIT_CONFIRMED.v1",
  aggregate_type: "usdt_manual_deposit",
  payload: { user_id: id, credited_krw: "100000", ledger_transaction_id: id },
});
const depositSource = sources[0];
sources.push({
  id,
  aggregate_id: id,
  attempt_count: 1,
  schema_version: 1,
  event_type: "TRIAL_COMPLETED.v1",
  aggregate_type: "trial_completion",
  payload: {
    user_id: id,
    original_id: id,
    completion_id: id,
    digest: "a".repeat(64),
  },
});
if (!depositSource) throw new Error("SOURCE_FIXTURE_REQUIRED");
function fixture(row: WorkerOutboxEnvelope, completionError = false) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_outbox_events") return { data: [row], error: null };
    if (name === "complete_outbox_event" && completionError)
      return { error: { message: "NONMONEY_SOURCE_CREDIT_ORIGINAL_REQUIRED" } };
    return { error: null };
  });
  return { rpc, db: { rpc } as unknown as SupabaseClient };
}
afterEach(stopAllLeaseRenewals);

describe("DB-only source-bound reward dispatch", () => {
  it.each(sources)(
    "delegates $event_type to the existing completion command",
    async (event) => {
      const { rpc, db } = fixture(event);
      expect(
        await processOutboxBatch(db, {
          workerId: "source-worker",
          batchSize: 1,
        }),
      ).toEqual({ claimed: 1, completed: 1, failed: 0, unsupported: 0 });
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        "claim_outbox_events",
        "extend_outbox_event_lease",
        "complete_outbox_event",
      ]);
      expect(rpc).toHaveBeenLastCalledWith("complete_outbox_event", {
        p_event_id: id,
        p_worker_id: "source-worker",
      });
    },
  );
  it.each(sources)(
    "rejects injected qualification in $event_type before completion",
    async (event) => {
      const { rpc, db } = fixture({
        ...event,
        payload: { ...event.payload, originalVerified: true },
      });
      expect(
        (
          await processOutboxBatch(db, {
            workerId: "source-worker",
            batchSize: 1,
            randomUnit: 0,
          })
        ).failed,
      ).toBe(1);
      expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
        "complete_outbox_event",
      );
      expect(rpc).toHaveBeenLastCalledWith(
        "fail_outbox_event",
        expect.objectContaining({
          p_error_code: "NONMONEY_SOURCE_ENVELOPE_INVALID",
        }),
      );
    },
  );
  it("never converts a valid payload into proof when the DB rejects the original", async () => {
    const { rpc, db } = fixture(depositSource, true);
    const result = await processOutboxBatch(db, {
      workerId: "source-worker",
      batchSize: 1,
      randomUnit: 0,
    });
    expect(result.completed).toBe(0);
    expect(result.failed).toBe(1);
    expect(rpc).toHaveBeenLastCalledWith(
      "fail_outbox_event",
      expect.objectContaining({
        p_error_code: "NONMONEY_SOURCE_CREDIT_ORIGINAL_REQUIRED",
      }),
    );
    expect(rpc.mock.calls).toHaveLength(4);
  });
  it("rejects a deposit envelope relabeled as a registered cash reward", async () => {
    const { rpc, db } = fixture({
      ...depositSource,
      event_type: "REFERRAL_REWARD_PAID.v1",
    });
    expect(
      await processOutboxBatch(db, {
        workerId: "source-worker",
        batchSize: 1,
        randomUnit: 0,
      }),
    ).toEqual({ claimed: 1, completed: 0, failed: 1, unsupported: 0 });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
      "complete_outbox_event",
    );
    expect(rpc).toHaveBeenLastCalledWith(
      "fail_outbox_event",
      expect.objectContaining({
        p_error_code: "LOCAL_CASH_SOURCE_ENVELOPE_INVALID",
      }),
    );
  });
  it("rejects an event with no registered canonical producer", async () => {
    const { rpc, db } = fixture({
      ...depositSource,
      event_type: "UNREGISTERED_REWARD.v1",
    });
    expect(
      await processOutboxBatch(db, {
        workerId: "source-worker",
        batchSize: 1,
        randomUnit: 0,
      }),
    ).toEqual({ claimed: 1, completed: 0, failed: 1, unsupported: 1 });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
      "complete_outbox_event",
    );
    expect(rpc).toHaveBeenLastCalledWith(
      "fail_outbox_event",
      expect.objectContaining({ p_error_code: "UNSUPPORTED_EVENT_TYPE" }),
    );
  });
});
