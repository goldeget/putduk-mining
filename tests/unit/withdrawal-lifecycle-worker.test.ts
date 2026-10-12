import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  processOutboxBatch,
  stopAllLeaseRenewals,
} from "../../workers/runner.mjs";

// RPC simulation only. Source-backed DB ACK, real leases, manual payment and
// current candidate source pins require separately authorized actual validation.
const uuid = (n: number) =>
  `19400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = uuid(3);
const operator = uuid(4);
const types = {
  requested: "WITHDRAWAL_REQUESTED.v1",
  external: "WITHDRAWAL_EXTERNAL_SENT.v1",
  released: "WITHDRAWAL_HOLD_RELEASED.v1",
};
const requested = {
  user_id: owner,
  amount_atomic: "100000",
  fee_atomic: "0",
  currency: "KRW",
  destination_type: "KRW_BANK",
  hold_ledger_transaction_id: uuid(5),
  welcome_reward: false,
};
const krwSent = {
  method: "KRW_BANK", bank_reference: "qa-bank-reference", actual_krw_amount: "100000",
};
const usdtSent = {
  method: "USDT_ADDRESS", network: "TRC20", tx_hash: "qa-tx-reference",
  actual_usdt_amount: "4.25", conversion_evidence_present: true,
};
const released = {
  release_ledger_transaction_id: uuid(6), reason: "QA cancellation", disposition: "CANCELLED",
};
function event(type: string, payload: Record<string, unknown>, changes: Record<string, unknown> = {}) {
  return {
    id: uuid(1), event_type: type, schema_version: 1,
    aggregate_type: "withdrawal_request", aggregate_id: uuid(2),
    actor_user_id: type === types.requested ? owner : operator,
    correlation_id: uuid(7), request_id: uuid(8), attempt_count: 1,
    idempotency_key: "qa-withdrawal-command-original:event", payload, ...changes,
  };
}
function fixture(row = event(types.requested, requested), completeError: string | null = null, leaseError: string | null = null) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_outbox_events") return { data: [row], error: null };
    const error = name === "complete_outbox_event"
      ? completeError : name === "extend_outbox_event_lease" ? leaseError : null;
    return { data: null, error: error ? { message: error } : null };
  });
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}
const options = { workerId: "withdrawal-lifecycle-unit", batchSize: 1 };
afterEach(() => {
  stopAllLeaseRenewals();
  vi.restoreAllMocks();
});
const accepted: [string, string, Record<string, unknown>][] = [
  ["ordinary request", types.requested, requested],
  ["USDT destination request", types.requested, { ...requested, destination_type: "USDT_ADDRESS" }],
  ["welcome-source request", types.requested, { ...requested, welcome_reward: true }],
  ["historical nonzero fee fact without creating a fee", types.requested, { ...requested, fee_atomic: "1" }],
  ["manual KRW record", types.external, krwSent],
  ["manual USDT record", types.external, usdtSent],
  ["USDT six-digit fraction", types.external, { ...usdtSent, actual_usdt_amount: "4.250000" }],
  ["USDT minimum positive scale", types.external, { ...usdtSent, actual_usdt_amount: "0.000001" }],
  ["USDT absent conversion evidence fact", types.external, { ...usdtSent, conversion_evidence_present: false }],
  ["owner/operator cancellation fact", types.released, released],
  ["operator rejection fact", types.released, { ...released, disposition: "REJECTED" }],
  ["unaltered raw release reason", types.released, { ...released, reason: "  QA reason  " }],
];

describe("withdrawal lifecycle Worker source acknowledgement", () => {
  it.each(accepted)("preflights %s and delegates only to fenced completion", async (_label, type, payload) => {
    const { rpc, client } = fixture(event(type, payload));
    expect(await processOutboxBatch(client, options)).toEqual({
      claimed: 1, completed: 1, failed: 0, unsupported: 0,
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_outbox_events", "extend_outbox_event_lease", "complete_outbox_event",
    ]);
    expect(rpc).toHaveBeenLastCalledWith("complete_outbox_event", {
      p_event_id: uuid(1), p_worker_id: options.workerId,
    });
  });

  for (const [type, payload, code] of [
    [types.requested, requested, "WITHDRAWAL_REQUESTED_ENVELOPE_INVALID"],
    [types.external, krwSent, "WITHDRAWAL_EXTERNAL_SEND_ENVELOPE_INVALID"],
    [types.external, usdtSent, "WITHDRAWAL_EXTERNAL_SEND_ENVELOPE_INVALID"],
    [types.released, released, "WITHDRAWAL_HOLD_RELEASE_ENVELOPE_INVALID"],
  ] as const) {
    const invalidEnvelope: [string, Record<string, unknown>][] = [
      ["schema2", { schema_version: 2 }],
      ["aggregate", { aggregate_type: "wallet_account" }],
      ...["id", "aggregate_id", "actor_user_id", "correlation_id", "request_id"].map(
        (field): [string, Record<string, unknown>] => [field, { [field]: "invalid" }],
      ),
      ["missing canonical suffix", { idempotency_key: "qa-withdrawal-command" }],
      ["short command key", { idempotency_key: "short:event" }],
      ["oversized command key", { idempotency_key: `${"x".repeat(201)}:event` }],
      ["array payload", { payload: [] }],
      ["null payload", { payload: null }],
      ["additional instruction", { payload: { ...payload, execute_payment: true } }],
      ...Object.keys(payload).map((field): [string, Record<string, unknown>] => [
        `missing ${field}`, { payload: Object.fromEntries(Object.entries(payload).filter(([k]) => k !== field)) },
      ]),
    ];
    it.each(invalidEnvelope)(`${type}/${Object.keys(payload).length} rejects %s before ACK`, async (_label, changes) => {
      const invalidEvent = event(type, payload, changes);
      const { rpc, client } = fixture(invalidEvent);
      expect(await processOutboxBatch(client, options)).toEqual({
        claimed: 1, completed: 0, failed: 1, unsupported: 0,
      });
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        "claim_outbox_events", "extend_outbox_event_lease", "fail_outbox_event",
      ]);
      expect(rpc).toHaveBeenLastCalledWith("fail_outbox_event", expect.objectContaining({
        p_event_id: invalidEvent.id, p_worker_id: options.workerId, p_error_code: code,
      }));
    });
  }

  const invalidPayloads: [string, string, Record<string, unknown>][] = [
    ["request owner mismatch", types.requested, { ...requested, user_id: operator }],
    ["request hold UUID", types.requested, { ...requested, hold_ledger_transaction_id: "invalid" }],
    ["request currency", types.requested, { ...requested, currency: "USDT" }],
    ["request destination", types.requested, { ...requested, destination_type: "AUTO_BANK" }],
    ["request welcome type", types.requested, { ...requested, welcome_reward: "false" }],
    ...[0, "0", "-1", "1.5", "01", "1e4", "9223372036854775808"].map(
      (value): [string, string, Record<string, unknown>] => [`request amount ${value}`, types.requested, { ...requested, amount_atomic: value }],
    ),
    ...[-1, "-1", "0.5", "00", "9223372036854775808"].map(
      (value): [string, string, Record<string, unknown>] => [`request fee ${value}`, types.requested, { ...requested, fee_atomic: value }],
    ),
    ["request combined bigint overflow", types.requested, { ...requested, amount_atomic: "9223372036854775807", fee_atomic: "1" }],
    ["bank reference too short", types.external, { ...krwSent, bank_reference: "abc" }],
    ["bank reference not producer-normalized", types.external, { ...krwSent, bank_reference: " reference " }],
    ["KRW amount is numeric", types.external, { ...krwSent, actual_krw_amount: 100000 }],
    ["KRW amount overflow", types.external, { ...krwSent, actual_krw_amount: "9223372036854775808" }],
    ["unknown transfer method", types.external, { ...usdtSent, method: "AUTO_USDT" }],
    ["wrong method schema", types.external, { ...usdtSent, method: "KRW_BANK" }],
    ["network not allowlisted", types.external, { ...usdtSent, network: "SOLANA" }],
    ["network not normalized", types.external, { ...usdtSent, network: "trc20" }],
    ["tx hash not normalized", types.external, { ...usdtSent, tx_hash: "QA-TX-REFERENCE" }],
    ["tx hash too short", types.external, { ...usdtSent, tx_hash: "short" }],
    ["tx hash too long", types.external, { ...usdtSent, tx_hash: "x".repeat(129) }],
    ["conversion evidence flag not boolean", types.external, { ...usdtSent, conversion_evidence_present: "true" }],
    ...[0, "0", "0.000000", "-1", "NaN", "Infinity", "1e2", ".5", "01.5", "1.0000001", "1".repeat(33)].map(
      (value): [string, string, Record<string, unknown>] => [`USDT amount ${value}`, types.external, { ...usdtSent, actual_usdt_amount: value }],
    ),
    ["release UUID", types.released, { ...released, release_ledger_transaction_id: "invalid" }],
    ["release disposition", types.released, { ...released, disposition: "COMPLETED" }],
    ["release reason too short", types.released, { ...released, reason: " abc " }],
    ["release reason wrong type", types.released, { ...released, reason: 1000 }],
  ];
  it.each(invalidPayloads)("rejects %s without source completion", async (_label, type, payload) => {
    const { rpc, client } = fixture(event(type, payload));
    const result = await processOutboxBatch(client, options);
    expect(result).toMatchObject({ completed: 0, failed: 1, unsupported: 0 });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("complete_outbox_event");
  });

  it.each([types.requested, types.external, types.released])("retains DB original rejection for %s", async (type) => {
    const payload = type === types.requested ? requested : type === types.external ? krwSent : released;
    const { rpc, client } = fixture(event(type, payload), "WITHDRAWAL_ORIGINAL_MISMATCH");
    expect(await processOutboxBatch(client, options)).toEqual({
      claimed: 1, completed: 0, failed: 1, unsupported: 0,
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_outbox_events", "extend_outbox_event_lease", "complete_outbox_event", "fail_outbox_event",
    ]);
    expect(rpc).toHaveBeenLastCalledWith("fail_outbox_event", expect.objectContaining({
      p_error_code: "WITHDRAWAL_ORIGINAL_MISMATCH",
    }));
  });
  it("cannot claim an underpaid record as completed when the DB rejects its original", async () => {
    const { client } = fixture(event(types.external, { ...krwSent, actual_krw_amount: "99999" }), "KRW_SEND_AMOUNT_MUST_EQUAL_REQUEST");
    expect(await processOutboxBatch(client, options)).toMatchObject({ completed: 0, failed: 1 });
  });
  it("preserves the event ID across lost-response retry instead of sending or releasing again", async () => {
    const row = event(types.released, released);
    const failed = fixture(row, "RPC_RESPONSE_LOST");
    expect(await processOutboxBatch(failed.client, options)).toMatchObject({ completed: 0, failed: 1 });
    const retry = fixture(row);
    expect(await processOutboxBatch(retry.client, options)).toMatchObject({ completed: 1, failed: 0 });
    for (const rpc of [failed.rpc, retry.rpc]) {
      expect(rpc).toHaveBeenCalledWith("complete_outbox_event", { p_event_id: row.id, p_worker_id: options.workerId });
      expect(rpc.mock.calls.every(([name]) => [
        "claim_outbox_events", "extend_outbox_event_lease", "complete_outbox_event", "fail_outbox_event",
      ].includes(name))).toBe(true);
    }
  });
  it("does not acknowledge a row without the owned lease", async () => {
    const { rpc, client } = fixture(event(types.requested, requested), null, "OUTBOX_LEASE_NOT_OWNED");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await processOutboxBatch(client, options)).toMatchObject({ completed: 0, failed: 1 });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("complete_outbox_event");
  });
  it("does not generically acknowledge an unregistered withdrawal-like event", async () => {
    const { rpc, client } = fixture(event("WITHDRAWAL_AUTOMATIC_PAYMENT.v1", krwSent));
    expect(await processOutboxBatch(client, options)).toMatchObject({ completed: 0, failed: 1, unsupported: 1 });
    expect(rpc).toHaveBeenLastCalledWith("fail_outbox_event", expect.objectContaining({ p_error_code: "UNSUPPORTED_EVENT_TYPE" }));
  });
});
