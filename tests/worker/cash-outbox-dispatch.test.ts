import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  processOutboxBatch,
  stopAllLeaseRenewals,
} from "../../workers/runner.mjs";
const id = "18400000-0000-4000-8000-000000000001",
  claim = "18400000-0000-4000-8000-000000000002";
const user = "18400000-0000-4000-8000-000000000003";
function event(kind: string) {
  return {
    id,
    event_type: kind,
    schema_version: 1,
    aggregate_type:
      kind === "LOCAL_CASH_REVIEW.v1"
        ? "local_cash_pending"
        : kind === "REFERRAL_REWARD_PAID.v1"
          ? "referral_reward_claim"
          : "event_reward_claim",
    aggregate_id: claim,
    attempt_count: 1,
    actor_user_id: user,
    payload:
      kind === "LOCAL_CASH_REVIEW.v1"
        ? { review_original_id: id, digest: "a".repeat(64) }
        : {
            cash_original_id: id,
            digest: "a".repeat(64),
            user_id: user,
            claim_id: claim,
            amount_atomic: "5000",
            currency: "KRW",
            ledger_transaction_id: id,
            wallet_ledger_id: id,
          },
  };
}
function fixture(
  row: ReturnType<typeof event>,
  errorAt: string | null = null,
  errorCode = "OUTBOX_LEASE_NOT_OWNED",
) {
  const rpc = vi.fn(async (name: string) =>
    name === "claim_outbox_events"
      ? { data: [row], error: null }
      : name === errorAt
        ? { data: null, error: { message: errorCode } }
        : { data: null, error: null },
  );
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}
afterEach(() => {
  stopAllLeaseRenewals();
  vi.restoreAllMocks();
});
const kinds = [
  "LOCAL_CASH_REVIEW.v1",
  "REFERRAL_REWARD_PAID.v1",
  "EVENT_REWARD_PAID.v1",
] as const;
describe("closed cash source outbox worker dispatch", () => {
  it.each(kinds)(
    "delegates %s only to existing fenced completion",
    async (kind) => {
      const { rpc, client } = fixture(event(kind));
      expect(
        await processOutboxBatch(client, {
          workerId: "cash-source",
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
        p_worker_id: "cash-source",
      });
    },
  );
  const invalids = [
    [
      "review extra payout instruction",
      kinds[0],
      { payload: { ...event(kinds[0]).payload, pay: true } },
    ],
    [
      "review missing digest",
      kinds[0],
      { payload: { review_original_id: id } },
    ],
    [
      "review original mismatch",
      kinds[0],
      { payload: { review_original_id: claim, digest: "a".repeat(64) } },
    ],
    [
      "review non-UUID",
      kinds[0],
      { payload: { review_original_id: "bad", digest: "a".repeat(64) } },
    ],
    ["wrong schema", kinds[0], { schema_version: 2 }],
    ["wrong paid actor", kinds[1], { actor_user_id: id }],
    ["wrong aggregate", kinds[1], { aggregate_type: "event_reward_claim" }],
    ["claim mismatch", kinds[1], { aggregate_id: id }],
    [
      "nonstring UUID",
      kinds[1],
      { payload: { ...event(kinds[1]).payload, user_id: [user] } },
    ],
    [
      "injected role",
      kinds[1],
      { payload: { ...event(kinds[1]).payload, role: "service_role" } },
    ],
    [
      "invalid digest",
      kinds[2],
      { payload: { ...event(kinds[2]).payload, digest: "A".repeat(64) } },
    ],
    ...[
      0,
      "0",
      "-1",
      "1.5",
      "05",
      "1e3",
      "9223372036854775808",
      "12345678901234567890",
    ].map(
      (amount) =>
        [
          "invalid amount " + amount,
          kinds[2],
          { payload: { ...event(kinds[2]).payload, amount_atomic: amount } },
        ] as const,
    ),
    [
      "wrong currency",
      kinds[2],
      { payload: { ...event(kinds[2]).payload, currency: "USD" } },
    ],
    ["invalid event UUID", kinds[2], { id: "bad" }],
  ] as const;
  it.each(invalids)(
    "rejects %s before database completion",
    async (_label, kind, change) => {
      const { rpc, client } = fixture({
        ...event(kind),
        ...change,
      } as ReturnType<typeof event>);
      expect(
        (
          await processOutboxBatch(client, {
            workerId: "cash-source",
            batchSize: 1,
          })
        ).completed,
      ).toBe(0);
      expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
        "complete_outbox_event",
      );
      expect(rpc).toHaveBeenLastCalledWith(
        "fail_outbox_event",
        expect.objectContaining({
          p_error_code: "LOCAL_CASH_SOURCE_ENVELOPE_INVALID",
        }),
      );
    },
  );
  it.each([
    "OUTBOX_LEASE_NOT_OWNED",
    "LOCAL_CASH_CLOSED_SERVICE_REQUIRED",
    "LOCAL_CASH_REVIEW_ORIGINAL_INVALID",
  ])(
    "keeps DB rejection %s visible without acknowledging success",
    async (error) => {
      const { rpc, client } = fixture(
        event(kinds[0]),
        "complete_outbox_event",
        error,
      );
      expect(
        await processOutboxBatch(client, {
          workerId: "cash-source",
          batchSize: 1,
        }),
      ).toEqual({ claimed: 1, completed: 0, failed: 1, unsupported: 0 });
      expect(rpc).toHaveBeenLastCalledWith(
        "fail_outbox_event",
        expect.objectContaining({ p_error_code: error }),
      );
    },
  );
  it("does not reach completion without a renewed owned lease", async () => {
    const { rpc, client } = fixture(
      event(kinds[1]),
      "extend_outbox_event_lease",
    );
    expect(
      (
        await processOutboxBatch(client, {
          workerId: "cash-source",
          batchSize: 1,
        })
      ).completed,
    ).toBe(0);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_outbox_events",
      "extend_outbox_event_lease",
    ]);
  });
  it("retains unsupported version handling", async () => {
    const row = { ...event(kinds[1]), event_type: "REFERRAL_REWARD_PAID.v2" };
    const { rpc, client } = fixture(row);
    expect(
      await processOutboxBatch(client, {
        workerId: "cash-source",
        batchSize: 1,
      }),
    ).toEqual({ claimed: 1, completed: 0, failed: 1, unsupported: 1 });
    expect(rpc).toHaveBeenLastCalledWith(
      "fail_outbox_event",
      expect.objectContaining({ p_error_code: "UNSUPPORTED_EVENT_TYPE" }),
    );
  });
});
