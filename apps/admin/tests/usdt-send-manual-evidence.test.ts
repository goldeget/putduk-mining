import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  service: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("@/app/(control)/_lib/command-gate", () => ({
  prepareMoneyAttempt: mocks.prepare,
  requireHighImpactPrincipal: mocks.authorize,
  mapRpcFailure: (code: string, message: string) => ({
    ok: false,
    code,
    message,
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: mocks.service,
}));
import { recordUsdtExternalSendAction } from "@/app/(control)/withdrawals/usdt/actions";

const withdrawalId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const destinationId = "33333333-3333-4333-8333-333333333333";
const sendId = "44444444-4444-4444-8444-444444444444";
const original = {
  id: withdrawalId,
  user_id: userId,
  amount_atomic: "5000",
  fee_atomic: "0",
  currency: "KRW",
  destination_type: "USDT_ADDRESS",
  withdrawal_destination_id: destinationId,
};
const registered = {
  user_id: userId,
  destination_type: "USDT_ADDRESS",
  metadata: { network: "TRC20" },
};
function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    withdrawalId,
    network: "TRC20",
    txHash: "manual-transfer-hash-01",
    actualUsdt: "004.250000",
    sentAt: "2026-10-03T00:15",
    confirmation: "RECORD_USDT_SEND",
    fullPayoutConfirmed: "true",
  }))
    data.set(key, value);
  return data;
}
function client(
  options: {
    request?: unknown;
    history?: unknown[];
    requestError?: unknown;
    historyError?: unknown;
    receipt?: unknown[];
    receiptError?: unknown;
    rpcError?: { message: string };
  } = {},
) {
  const calls: { table: string; filters: [string, unknown][] }[] = [];
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: sendId, error: options.rpcError ?? null });
  const from = vi.fn((table: string) => {
    const call = { table, filters: [] as [string, unknown][] };
    calls.push(call);
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => {
        call.filters.push([field, value]);
        return query;
      },
      maybeSingle: () =>
        Promise.resolve({
          data: options.request ?? original,
          error: options.requestError ?? null,
        }),
      limit: () =>
        Promise.resolve(
          table === "withdrawal_destination_history"
            ? {
                data: options.history ?? [registered],
                error: options.historyError ?? null,
              }
            : {
                data: options.receipt ?? [
                  {
                    id: sendId,
                    withdrawal_id: withdrawalId,
                    method: "USDT_ADDRESS",
                  },
                ],
                error: options.receiptError ?? null,
              },
        ),
    };
    return query;
  });
  mocks.service.mockReturnValue({ from, rpc });
  return { from, rpc, calls };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.prepare.mockReturnValue({
    ok: true,
    idempotencyKey: "manual-full-payout-key",
  });
  mocks.authorize.mockResolvedValue({
    ok: true,
    principal: { userId, aal: "aal2" },
  });
});
describe("admin USDT manual full-payout server originals", () => {
  it("binds exactly eight evidence fields to the server KRW request and registered network", async () => {
    const db = client();
    const input = form();
    input.set("requestedKrwAmount", "999999");
    input.set("feeKrw", "800");
    input.set("conversionEvidence", "untrusted free-form note");
    expect(await recordUsdtExternalSendAction(null, input)).toMatchObject({
      ok: true,
    });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
      "record_usdt_external_send",
      {
        p_withdrawal_id: withdrawalId,
        p_network: "TRC20",
        p_tx_hash: "manual-transfer-hash-01",
        p_actual_usdt_amount: "4.25",
        p_actor: userId,
        p_sent_at: "2026-10-02T15:15:00.000Z",
        p_idempotency_key: "manual-full-payout-key",
        p_conversion_evidence: {
          version: 1,
          basis: "OPERATOR_MANUAL_FULL_PAYOUT",
          withdrawalId,
          requestedKrwAmount: "5000",
          actualUsdtAmount: "4.25",
          network: "TRC20",
          feeKrw: "0",
          fullPayoutConfirmed: true,
        },
      },
    );
    expect(db.calls[0]).toEqual({
      table: "withdrawal_requests",
      filters: [["id", withdrawalId]],
    });
    expect(db.calls[1]).toEqual({
      table: "withdrawal_destination_history",
      filters: [
        ["destination_id", destinationId],
        ["action", "REGISTERED"],
      ],
    });
    expect(mocks.authorize.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.service.mock.invocationCallOrder[0]!,
    );
    expect(db.calls[2]?.filters).toEqual([
      ["id", sendId],
      ["withdrawal_id", withdrawalId],
      ["method", "USDT_ADDRESS"],
    ]);
  });
  it.each([undefined, "false", "on"])(
    "requires explicit full payout confirmation (%s) before step-up",
    async (confirmation) => {
      const input = form();
      input.delete("fullPayoutConfirmed");
      if (confirmation !== undefined)
        input.set("fullPayoutConfirmed", confirmation);
      expect(await recordUsdtExternalSendAction(null, input)).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(mocks.authorize).not.toHaveBeenCalled();
      expect(mocks.service).not.toHaveBeenCalled();
    },
  );
  it("does not read privileged originals or send a command after authorization denial", async () => {
    mocks.authorize.mockResolvedValue({
      ok: false,
      result: { ok: false, code: "AAL2_REQUIRED", message: "required" },
    });
    expect(await recordUsdtExternalSendAction(null, form())).toMatchObject({
      ok: false,
      code: "AAL2_REQUIRED",
    });
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each([
    { id: sendId },
    { currency: "USDT" },
    { destination_type: "KRW_BANK" },
    { fee_atomic: "1" },
    { amount_atomic: "0" },
    { amount_atomic: 9007199254740992 },
  ])(
    "rejects a noncanonical original request %j without a financial command",
    async (change) => {
      const db = client({ request: { ...original, ...change } });
      expect(await recordUsdtExternalSendAction(null, form())).toMatchObject({
        ok: false,
        code: "USDT_MANUAL_FULL_PAYOUT_REQUEST_MISMATCH",
      });
      expect(db.rpc).not.toHaveBeenCalled();
    },
  );
  it("does not construct evidence when the request read failed", async () => {
    const db = client({ requestError: { message: "unavailable" } });
    expect(await recordUsdtExternalSendAction(null, form())).toMatchObject({
      ok: false,
      code: "USDT_MANUAL_FULL_PAYOUT_REQUEST_MISMATCH",
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { history: [] },
    { history: [registered, registered] },
    { history: [{ ...registered, user_id: sendId }] },
    { history: [{ ...registered, destination_type: "KRW_BANK" }] },
    { history: [{ ...registered, metadata: { network: "TRON" } }] },
  ])(
    "rejects absent, ambiguous, foreign or malformed REGISTERED originals %j",
    async ({ history }) => {
      const db = client({ history });
      expect(await recordUsdtExternalSendAction(null, form())).toMatchObject({
        ok: false,
        code: "USDT_DESTINATION_NETWORK_ORIGINAL_REQUIRED",
      });
      expect(db.rpc).not.toHaveBeenCalled();
    },
  );
  it("rejects a registered network mismatch without substituting another network", async () => {
    const db = client({
      history: [{ ...registered, metadata: { network: "ERC20" } }],
    });
    expect(await recordUsdtExternalSendAction(null, form())).toMatchObject({
      ok: false,
      code: "USDT_SEND_NETWORK_MISMATCH",
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("keeps an unknown receipt unresolved after a successful command", async () => {
    const db = client({ receipt: [] });
    expect(await recordUsdtExternalSendAction(null, form())).toMatchObject({
      ok: false,
      code: "UNCONFIRMED",
    });
    expect(db.rpc).toHaveBeenCalledOnce();
  });
  it("returns the existing manual contract rejection without claiming success", async () => {
    const db = client({
      rpcError: { message: "USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID" },
    });
    expect(await recordUsdtExternalSendAction(null, form())).toMatchObject({
      ok: false,
      code: "USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID",
    });
    expect(db.calls).toHaveLength(2);
  });
});
