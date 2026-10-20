import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/principal", () => ({ requireAdminCommand: vi.fn() }));
vi.mock("@/lib/auth/step-up", () => ({ consumeAdminStepUpGrant: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: vi.fn(),
}));

import { POST } from "@/app/api/v1/admin/withdrawals/command/route";
import { requireAdminCommand } from "@/lib/auth/principal";
import { consumeAdminStepUpGrant } from "@/lib/auth/step-up";
import { createAdminServiceClient } from "@/lib/supabase/service";

const id = (n: number) =>
  "12345678-1234-4234-9234-" + String(n).padStart(12, "0");
const principal = {
  userId: id(3),
  role: "ADMIN" as const,
  sessionId: "session",
  adminSessionId: "admin-session",
  aal: "aal2" as const,
  amr: [],
  supabase: {} as never,
};
function originals(disposition: "REJECTED" | "CANCELLED" = "CANCELLED") {
  return {
    withdrawal_requests: {
      id: id(1),
      user_id: id(3),
      hold_ledger_transaction_id: id(4),
      release_ledger_transaction_id: id(2),
      status: disposition,
      currency: "KRW",
      amount_atomic: "5000",
      fee_atomic: "0",
      rejection_reason: " original reason ",
      hold_released_at: "2026-10-12T00:00:00.123456+00:00",
    },
    ledger_transactions: {
      id: id(2),
      category: "REVERSAL",
      currency: "KRW",
      reference_type: "withdrawal_request",
      reference_id: id(1),
      member_user_id: id(3),
      reversal_of_transaction_id: id(4),
      metadata: { phase: "RELEASE", disposition, reason: " original reason " },
      posted_at: "2026-10-12T00:00:00.123456+00:00",
    },
    ledger_entries: [
      {
        transaction_id: id(2),
        account_id: id(5),
        sequence: 0,
        side: "DEBIT",
        amount_atomic: "5000",
      },
      {
        transaction_id: id(2),
        account_id: id(6),
        sequence: 1,
        side: "CREDIT",
        amount_atomic: "5000",
      },
    ],
  };
}
function client(
  options: {
    rows?: ReturnType<typeof originals>;
    rpcData?: unknown;
    rpcError?: { message: string };
    rpcThrows?: boolean;
    badRead?: string;
    thrownRead?: string;
  } = {},
) {
  const rows = options.rows ?? originals();
  const rpc = vi.fn(async () => {
    if (options.rpcThrows) throw new Error("response lost");
    return {
      data: "rpcData" in options ? options.rpcData : id(2),
      error: options.rpcError ?? null,
    };
  });
  const filters: [string, string, unknown][] = [];
  const from = vi.fn((table: string) => {
    if (!(table in rows)) throw new Error("UNEXPECTED_TABLE");
    const read = async () => {
      if (options.thrownRead === table) throw new Error("read lost");
      return {
        data: rows[table as keyof typeof rows],
        error: options.badRead === table ? { message: "unavailable" } : null,
      };
    };
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => {
        filters.push([table, field, value]);
        return query;
      },
      maybeSingle: read,
      limit: read,
    };
    return query;
  });
  vi.mocked(createAdminServiceClient).mockReturnValue({ rpc, from } as never);
  return { rpc, from, filters };
}
function request(disposition = "CANCELLED", withdrawalId = id(1)) {
  return new Request(
    "https://admin.mining.putduk.com/api/v1/admin/withdrawals/command",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "RELEASE_HOLD",
        withdrawalId,
        reason: "fresh reason",
        disposition,
        stepUpToken: "fresh-single-use-step-up",
        idempotencyKey: "hold-release-binding-key",
      }),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdminCommand).mockResolvedValue({ ok: true, principal });
  vi.mocked(consumeAdminStepUpGrant).mockResolvedValue(true);
});

describe("HOLD release API confirms the stored financial result", () => {
  it("confirms a validated uppercase request UUID against canonical DB originals", async () => {
    const withdrawalId = "abcdefab-1234-4234-9234-000000000001";
    const rows = originals();
    rows.withdrawal_requests.id = withdrawalId;
    rows.ledger_transactions.reference_id = withdrawalId;
    const db = client({ rows });
    const response = await POST(
      request("CANCELLED", withdrawalId.toUpperCase()),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      releaseLedgerTransactionId: id(2),
      disposition: "CANCELLED",
    });
    expect(db.rpc).toHaveBeenCalledWith(
      "release_withdrawal_hold",
      expect.objectContaining({ p_withdrawal_id: withdrawalId }),
    );
    expect(db.filters).toContainEqual([
      "withdrawal_requests",
      "id",
      withdrawalId,
    ]);
  });
  it("normalizes a valid returned ledger UUID before original readback", async () => {
    const releaseId = "abcdefab-1234-4234-9234-000000000002";
    const rows = originals();
    rows.withdrawal_requests.release_ledger_transaction_id = releaseId;
    rows.ledger_transactions.id = releaseId;
    rows.ledger_entries.forEach((entry) => {
      entry.transaction_id = releaseId;
    });
    const db = client({ rows, rpcData: releaseId.toUpperCase() });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      releaseLedgerTransactionId: releaseId,
      disposition: "CANCELLED",
    });
    expect(db.filters).toEqual(
      expect.arrayContaining([
        ["ledger_transactions", "id", releaseId],
        ["ledger_entries", "transaction_id", releaseId],
      ]),
    );
  });
  it("reports a replay's actual rejection instead of falsely confirming cancellation", async () => {
    const db = client({ rows: originals("REJECTED") });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      code: "HOLD_RELEASE_DISPOSITION_MISMATCH",
      actualDisposition: "REJECTED",
      releaseLedgerTransactionId: id(2),
    });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("release_withdrawal_hold", {
      p_withdrawal_id: id(1),
      p_actor: id(3),
      p_reason: "fresh reason",
      p_idempotency_key: "hold-release-binding-key",
      p_disposition: "CANCELLED",
    });
  });
  it.each(["CANCELLED", "REJECTED"] as const)(
    "confirms the bound original %s reversal without another monetary command",
    async (disposition) => {
      const db = client({ rows: originals(disposition) });
      const response = await POST(request(disposition));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        releaseLedgerTransactionId: id(2),
        disposition,
      });
      expect(db.rpc).toHaveBeenCalledTimes(1);
      expect(db.filters).toEqual(
        expect.arrayContaining([
          ["withdrawal_requests", "id", id(1)],
          ["ledger_transactions", "id", id(2)],
          ["ledger_entries", "transaction_id", id(2)],
        ]),
      );
    },
  );
  it.each([null, "not-a-uuid"])(
    "keeps an invalid RPC result %s unconfirmed",
    async (rpcData) => {
      const db = client({ rpcData });
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, code: "UNCONFIRMED" });
      expect(db.from).not.toHaveBeenCalled();
    },
  );
  for (const table of [
    "withdrawal_requests",
    "ledger_transactions",
    "ledger_entries",
  ]) {
    it(`keeps a missing ${table} result unconfirmed`, async () => {
      const rows = originals();
      Object.assign(rows, { [table]: null });
      client({ rows });
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, code: "UNCONFIRMED" });
    });
    it(`fails closed on ${table} error despite plausible data`, async () => {
      client({ badRead: table });
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, code: "UNCONFIRMED" });
    });
    it(`fails closed on thrown ${table} read`, async () => {
      client({ thrownRead: table });
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, code: "UNCONFIRMED" });
    });
  }
  it("cannot confirm another withdrawal's reversal", async () => {
    const rows = originals();
    rows.ledger_transactions.reference_id = id(9);
    client({ rows });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "UNCONFIRMED" });
  });
  it("cannot confirm unbalanced original entries", async () => {
    const rows = originals();
    rows.ledger_entries[1]!.amount_atomic = "4999";
    client({ rows });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "UNCONFIRMED" });
  });
  it("cannot confirm a reversal with extra original entries", async () => {
    const rows = originals();
    rows.ledger_entries.push({ ...rows.ledger_entries[0]! });
    client({ rows });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "UNCONFIRMED" });
  });
  it("preserves a rejected financial command without attempting readback", async () => {
    const db = client({
      rpcError: { message: "WITHDRAWAL_RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND" },
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: "COMMAND_FAILED",
    });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("preserves an uncertain RPC exception without retrying a financial command", async () => {
    const db = client({ rpcThrows: true });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "UNCONFIRMED" });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("rejects a missing one-use step-up before service access", async () => {
    vi.mocked(consumeAdminStepUpGrant).mockResolvedValue(false);
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(createAdminServiceClient).not.toHaveBeenCalled();
  });
  it("preserves denied role or AAL2 admission before consuming step-up", async () => {
    vi.mocked(requireAdminCommand).mockResolvedValue({
      ok: false,
      code: "MFA_REQUIRED",
      status: 403,
    });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(consumeAdminStepUpGrant).not.toHaveBeenCalled();
    expect(createAdminServiceClient).not.toHaveBeenCalled();
  });
});
