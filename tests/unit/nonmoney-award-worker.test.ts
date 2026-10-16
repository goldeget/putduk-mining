import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  processOutboxBatch,
  stopAllLeaseRenewals,
} from "../../workers/runner.mjs";

// RPC simulation only. Native source/notification seals and real leases are
// separately exercised by nonmoney_award_outbox_ack.sql in an isolated DB.
const uuid = (value: number) =>
  `19300000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const payload = {
  award_id: uuid(2),
  event_id: uuid(3),
  user_id: uuid(4),
  rule_id: uuid(5),
  policy_id: uuid(6),
  scope: "LOCAL_QA",
  reward_kind: "BADGE",
  reward_code: "FIRST_LOCAL_REWARD",
  audit_id: uuid(7),
  source_event_id: uuid(8),
  source_digest: "a".repeat(64),
  qualification_digest: "b".repeat(64),
};
function event(change: Record<string, unknown> = {}) {
  return {
    id: uuid(1),
    event_type: "EVENT_REWARD_GRANTED.v1",
    schema_version: 1,
    aggregate_type: "event_reward",
    aggregate_id: payload.award_id,
    actor_user_id: payload.user_id,
    attempt_count: 1,
    payload,
    idempotency_key: `event-reward:${payload.event_id}:${payload.user_id}:${payload.rule_id}`,
    ...change,
  };
}
function fixture(
  row = event(),
  completionErrors: (string | null)[] = [],
  extensionError: string | null = null,
) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_outbox_events") return { data: [row], error: null };
    const error =
      name === "extend_outbox_event_lease"
        ? extensionError
        : name === "complete_outbox_event"
          ? completionErrors.shift()
          : null;
    return { data: null, error: error ? { message: error } : null };
  });
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}
const options = { workerId: "nonmoney-award-test", batchSize: 1 };
afterEach(() => {
  stopAllLeaseRenewals();
  vi.restoreAllMocks();
});

describe("nonmoney award Worker acknowledgement", () => {
  it("delegates only to the existing fenced completion RPC", async () => {
    const { rpc, client } = fixture();
    expect(await processOutboxBatch(client, options)).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      unsupported: 0,
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_outbox_events",
      "extend_outbox_event_lease",
      "complete_outbox_event",
    ]);
    expect(rpc).toHaveBeenLastCalledWith("complete_outbox_event", {
      p_event_id: uuid(1),
      p_worker_id: options.workerId,
    });
  });

  const invalids: [string, Record<string, unknown>][] = [
    ["invalid event ID", { id: "invalid" }],
    ["wrong schema", { schema_version: 2 }],
    ["wrong aggregate", { aggregate_type: "event_reward_claim" }],
    ["award mismatch", { aggregate_id: uuid(9) }],
    ["owner mismatch", { actor_user_id: uuid(9) }],
    ["idempotency mismatch", { idempotency_key: "wrong" }],
    ["extra payout instruction", { payload: { ...payload, pay: true } }],
    ["production scope", { payload: { ...payload, scope: "PRODUCTION" } }],
    ["cash reward", { payload: { ...payload, reward_kind: "CASH" } }],
    ["malformed reward code", { payload: { ...payload, reward_code: "bad" } }],
    [
      "uppercase digest",
      { payload: { ...payload, source_digest: "A".repeat(64) } },
    ],
    ["nonstring UUID", { payload: { ...payload, award_id: [uuid(2)] } }],
    ...Object.keys(payload).map((field): [string, Record<string, unknown>] => [
      `missing ${field}`,
      {
        payload: Object.fromEntries(
          Object.entries(payload).filter(([key]) => key !== field),
        ),
      },
    ]),
  ];
  it.each(invalids)(
    "rejects %s before acknowledgement",
    async (_label, change) => {
      const { rpc, client } = fixture(event(change));
      const result = await processOutboxBatch(client, options);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.unsupported).toBe(0);
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        "claim_outbox_events",
        "extend_outbox_event_lease",
        "fail_outbox_event",
      ]);
      expect(rpc).toHaveBeenLastCalledWith(
        "fail_outbox_event",
        expect.objectContaining({
          p_error_code: "NONMONEY_AWARD_EVENT_ENVELOPE_INVALID",
        }),
      );
    },
  );

  it.each(["OUTBOX_LEASE_NOT_OWNED", "NONMONEY_AWARD_ORIGINAL_REQUIRED"])(
    "keeps DB refusal %s visible and allows a later valid retry",
    async (error) => {
      const { rpc, client } = fixture(event(), [error, null]);
      expect((await processOutboxBatch(client, options)).completed).toBe(0);
      expect(rpc).toHaveBeenLastCalledWith(
        "fail_outbox_event",
        expect.objectContaining({ p_error_code: error }),
      );
      expect((await processOutboxBatch(client, options)).completed).toBe(1);
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        "claim_outbox_events",
        "extend_outbox_event_lease",
        "complete_outbox_event",
        "fail_outbox_event",
        "claim_outbox_events",
        "extend_outbox_event_lease",
        "complete_outbox_event",
      ]);
    },
  );

  it("does not acknowledge a lease it cannot renew", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rpc, client } = fixture(event(), [], "OUTBOX_LEASE_NOT_OWNED");
    expect((await processOutboxBatch(client, options)).failed).toBe(1);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_outbox_events",
      "extend_outbox_event_lease",
    ]);
  });

  it("preserves unsupported handling for an unrelated event type", async () => {
    const { rpc, client } = fixture(event({ event_type: "UNKNOWN_AWARD.v1" }));
    expect(await processOutboxBatch(client, options)).toEqual({
      claimed: 1,
      completed: 0,
      failed: 1,
      unsupported: 1,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "fail_outbox_event",
      expect.objectContaining({ p_error_code: "UNSUPPORTED_EVENT_TYPE" }),
    );
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_outbox_events",
      "extend_outbox_event_lease",
      "fail_outbox_event",
    ]);
  });
});
