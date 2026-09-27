import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * WS-04 Domain Command Contract — Agent D lock suite.
 * These tests encode the frozen contract as executable expectations.
 * In-memory harnesses assert behavior; migration presence probes fail
 * until Agent A lands the public commands. Do not weaken assertions.
 */

const root = resolve(import.meta.dirname, "../..");
const contractDoc = readFileSync(
  join(root, "docs/architecture/WS-04-DOMAIN-COMMAND-CONTRACT.md"),
  "utf8",
);

const FROZEN_PUBLIC_COMMANDS = [
  "normalize_signup_phone",
  "signup_phone_availability",
  "set_usdt_deposit_instructions",
  "submit_usdt_manual_deposit",
  "confirm_usdt_manual_deposit",
  "register_krw_bank_destination",
  "register_usdt_withdrawal_destination",
  "request_krw_withdrawal",
  "request_usdt_withdrawal",
  "record_krw_external_send",
  "record_usdt_external_send",
  "finalize_withdrawal_ledger",
  "release_withdrawal_hold",
] as const;

type PhoneAvailability = "AVAILABLE" | "UNAVAILABLE";

type DepositRequest = {
  id: string;
  userId: string;
  network: string;
  txHash: string;
  depositAddressSnapshot: string;
  networkSnapshot: string;
  ledgerTransactionId: string | null;
  creditedKrw: bigint | null;
};

type WithdrawalStatus =
  | "REQUESTED"
  | "HELD"
  | "ADMIN_PROCESSING"
  | "EXTERNAL_SENT_RECORDED"
  | "LEDGER_FINALIZED"
  | "COMPLETED"
  | "REJECTED"
  | "CANCELLED";

type WithdrawalMethod = "KRW_BANK" | "USDT_ADDRESS";

type KrwEvidence = {
  bankReference: string;
  actualKrwAmount: bigint;
  operator: string;
  sentAt: string;
};

type UsdtEvidence = {
  network: string;
  txHash: string;
  actualUsdtAmount: string;
  conversionEvidence: Record<string, unknown> | null;
  operator: string;
  sentAt: string;
};

type Withdrawal = {
  id: string;
  userId: string;
  method: WithdrawalMethod;
  amountKrw: bigint;
  status: WithdrawalStatus;
  holdLedgerId: string | null;
  releaseLedgerId: string | null;
  finalizeLedgerId: string | null;
  externalSendCount: number;
  krwEvidence: KrwEvidence | null;
  usdtEvidence: UsdtEvidence | null;
  welcomeConversionId: string | null;
  idempotencyKey: string;
};

function assertPhoneAvailabilityResult(
  value: unknown,
): asserts value is PhoneAvailability {
  if (value !== "AVAILABLE" && value !== "UNAVAILABLE") {
    throw new Error(`PHONE_AVAILABILITY_ENUM_VIOLATION:${String(value)}`);
  }
}

function stripIdentityLeak(payload: Record<string, unknown>) {
  const forbidden = ["user_id", "account_id", "email", "legal_name", "name"];
  for (const key of forbidden) {
    if (key in payload) {
      throw new Error(`PHONE_AVAILABILITY_IDENTITY_LEAK:${key}`);
    }
  }
  return payload;
}

function createPhoneAvailabilityService(history: Set<string>) {
  return {
    check(raw: string): { result: PhoneAvailability } {
      const normalized = raw.replace(/\D/g, "");
      const result: PhoneAvailability = history.has(normalized)
        ? "UNAVAILABLE"
        : "AVAILABLE";
      assertPhoneAvailabilityResult(result);
      return stripIdentityLeak({ result }) as { result: PhoneAvailability };
    },
    marksSmsOrOwnershipVerified: false as const,
  };
}

function createUsdtDepositService() {
  let instructions = { address: "TOLD", network: "TRC20" };
  const byId = new Map<string, DepositRequest>();
  const byNetworkTx = new Map<string, string>();
  let seq = 0;

  return {
    setInstructions(address: string, network: string) {
      instructions = { address, network };
    },
    submit(input: {
      userId: string;
      network: string;
      txHash: string;
      idempotencyKey: string;
    }) {
      const key = `${input.network}|${input.txHash}`;
      if (byNetworkTx.has(key)) {
        throw new Error("USDT_DEPOSIT_TX_HASH_DUPLICATE");
      }
      const id = `dep-${++seq}`;
      const row: DepositRequest = {
        id,
        userId: input.userId,
        network: input.network,
        txHash: input.txHash,
        depositAddressSnapshot: instructions.address,
        networkSnapshot: instructions.network,
        ledgerTransactionId: null,
        creditedKrw: null,
      };
      byId.set(id, row);
      byNetworkTx.set(key, id);
      return row;
    },
    confirm(input: {
      depositId: string;
      creditedKrw: bigint;
      idempotencyKey: string;
    }) {
      const row = byId.get(input.depositId);
      if (!row) {
        throw new Error("USDT_DEPOSIT_NOT_FOUND");
      }
      if (row.ledgerTransactionId) {
        return row;
      }
      if (input.creditedKrw <= 0n) {
        throw new Error("CREDITED_KRW_MUST_BE_POSITIVE_INTEGER");
      }
      row.creditedKrw = input.creditedKrw;
      row.ledgerTransactionId = `ledger-deposit-${row.id}`;
      return row;
    },
    get(id: string) {
      return byId.get(id);
    },
  };
}

function createWithdrawalLedger() {
  const available = new Map<string, bigint>();
  const held = new Map<string, bigint>();
  const journal: Array<{
    kind: "HOLD" | "RELEASE" | "FINALIZE" | "WELCOME" | "DEPOSIT";
    userId: string;
    amount: bigint;
    ref: string;
  }> = [];

  return {
    journal,
    credit(
      userId: string,
      amount: bigint,
      kind: "WELCOME" | "DEPOSIT",
      ref: string,
    ) {
      available.set(userId, (available.get(userId) ?? 0n) + amount);
      journal.push({ kind, userId, amount, ref });
    },
    hold(userId: string, amount: bigint, ref: string) {
      const avail = available.get(userId) ?? 0n;
      if (avail < amount) {
        throw new Error("INSUFFICIENT_AVAILABLE_BALANCE");
      }
      available.set(userId, avail - amount);
      held.set(userId, (held.get(userId) ?? 0n) + amount);
      journal.push({ kind: "HOLD", userId, amount, ref });
      return `hold-${ref}`;
    },
    release(userId: string, amount: bigint, ref: string) {
      const h = held.get(userId) ?? 0n;
      if (h < amount) {
        throw new Error("HOLD_RELEASE_MISMATCH");
      }
      held.set(userId, h - amount);
      available.set(userId, (available.get(userId) ?? 0n) + amount);
      journal.push({ kind: "RELEASE", userId, amount, ref });
      return `release-${ref}`;
    },
    finalize(userId: string, amount: bigint, ref: string) {
      const h = held.get(userId) ?? 0n;
      if (h < amount) {
        throw new Error("HOLD_FINALIZE_MISMATCH");
      }
      held.set(userId, h - amount);
      journal.push({ kind: "FINALIZE", userId, amount, ref });
      return `finalize-${ref}`;
    },
    availableOf(userId: string) {
      return available.get(userId) ?? 0n;
    },
    heldOf(userId: string) {
      return held.get(userId) ?? 0n;
    },
  };
}

function createWithdrawalService(
  ledger: ReturnType<typeof createWithdrawalLedger>,
) {
  const byId = new Map<string, Withdrawal>();
  const byIdempotency = new Map<string, string>();
  let seq = 0;
  let ledgerFailOnce = false;

  return {
    forceNextFinalizeFailure() {
      ledgerFailOnce = true;
    },
    request(input: {
      userId: string;
      method: WithdrawalMethod;
      amountKrw: bigint;
      idempotencyKey: string;
      welcomeConversionId?: string;
    }) {
      const existingId = byIdempotency.get(input.idempotencyKey);
      if (existingId) {
        return byId.get(existingId)!;
      }
      const id = `wd-${++seq}`;
      const holdLedgerId = ledger.hold(input.userId, input.amountKrw, id);
      const row: Withdrawal = {
        id,
        userId: input.userId,
        method: input.method,
        amountKrw: input.amountKrw,
        status: "HELD",
        holdLedgerId,
        releaseLedgerId: null,
        finalizeLedgerId: null,
        externalSendCount: 0,
        krwEvidence: null,
        usdtEvidence: null,
        welcomeConversionId: input.welcomeConversionId ?? null,
        idempotencyKey: input.idempotencyKey,
      };
      byId.set(id, row);
      byIdempotency.set(input.idempotencyKey, id);
      return row;
    },
    recordKrwExternalSend(
      withdrawalId: string,
      evidence: KrwEvidence,
      actor: string,
    ) {
      const row = byId.get(withdrawalId);
      if (!row) {
        throw new Error("WITHDRAWAL_NOT_FOUND");
      }
      if (
        row.userId &&
        actor.startsWith("user:") &&
        actor !== `user:${row.userId}`
      ) {
        throw new Error("USER_ISOLATION_DENIED");
      }
      if (
        row.status === "EXTERNAL_SENT_RECORDED" ||
        row.status === "LEDGER_FINALIZED" ||
        row.status === "COMPLETED"
      ) {
        return row;
      }
      if (row.method !== "KRW_BANK") {
        throw new Error("KRW_EVIDENCE_METHOD_MISMATCH");
      }
      if (
        "network" in (evidence as object) ||
        "tx_hash" in (evidence as object)
      ) {
        throw new Error("KRW_EVIDENCE_MUST_NOT_REQUIRE_CHAIN_FIELDS");
      }
      row.krwEvidence = evidence;
      row.externalSendCount += 1;
      row.status = "EXTERNAL_SENT_RECORDED";
      return row;
    },
    recordUsdtExternalSend(withdrawalId: string, evidence: UsdtEvidence) {
      const row = byId.get(withdrawalId);
      if (!row) {
        throw new Error("WITHDRAWAL_NOT_FOUND");
      }
      if (
        row.status === "EXTERNAL_SENT_RECORDED" ||
        row.status === "LEDGER_FINALIZED" ||
        row.status === "COMPLETED"
      ) {
        return row;
      }
      if (row.method !== "USDT_ADDRESS") {
        throw new Error("USDT_EVIDENCE_METHOD_MISMATCH");
      }
      row.usdtEvidence = evidence;
      row.externalSendCount += 1;
      row.status = "EXTERNAL_SENT_RECORDED";
      return row;
    },
    finalize(withdrawalId: string, actor: string) {
      void actor;
      const row = byId.get(withdrawalId);
      if (!row) {
        throw new Error("WITHDRAWAL_NOT_FOUND");
      }
      if (
        row.status !== "EXTERNAL_SENT_RECORDED" &&
        row.status !== "LEDGER_FINALIZED" &&
        row.status !== "COMPLETED"
      ) {
        throw new Error("EXTERNAL_SEND_REQUIRED");
      }
      if (row.finalizeLedgerId) {
        return row;
      }
      if (ledgerFailOnce) {
        ledgerFailOnce = false;
        throw new Error("LEDGER_FINALIZE_TRANSIENT");
      }
      row.finalizeLedgerId = ledger.finalize(row.userId, row.amountKrw, row.id);
      row.status = "COMPLETED";
      return row;
    },
    release(
      withdrawalId: string,
      idempotencyKey: string,
      disposition: "REJECTED" | "CANCELLED" = "CANCELLED",
    ) {
      void idempotencyKey;
      const row = byId.get(withdrawalId);
      if (!row) {
        throw new Error("WITHDRAWAL_NOT_FOUND");
      }
      if (
        row.status === "EXTERNAL_SENT_RECORDED" ||
        row.status === "LEDGER_FINALIZED" ||
        row.status === "COMPLETED"
      ) {
        throw new Error("RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND");
      }
      if (row.releaseLedgerId) {
        return row;
      }
      row.releaseLedgerId = ledger.release(row.userId, row.amountKrw, row.id);
      row.status = disposition;
      return row;
    },
    get(id: string) {
      return byId.get(id);
    },
  };
}

function loadMigrationSources() {
  const dir = join(root, "supabase/migrations");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

function assertKrwEvidenceShape(evidence: Record<string, unknown>) {
  expect(evidence).toHaveProperty("bankReference");
  expect(evidence).toHaveProperty("actualKrwAmount");
  expect(evidence).toHaveProperty("operator");
  expect(evidence).toHaveProperty("sentAt");
  expect(evidence).not.toHaveProperty("network");
  expect(evidence).not.toHaveProperty("tx_hash");
  expect(evidence).not.toHaveProperty("txHash");
}

function assertUsdtEvidenceShape(evidence: Record<string, unknown>) {
  expect(evidence).toHaveProperty("network");
  expect(evidence).toHaveProperty("txHash");
  expect(evidence).toHaveProperty("actualUsdtAmount");
  expect(evidence).toHaveProperty("operator");
  expect(evidence).toHaveProperty("sentAt");
  expect("conversionEvidence" in evidence).toBe(true);
}

describe("WS-04 phone availability contract", () => {
  it("returns only AVAILABLE or UNAVAILABLE and never identity fields", () => {
    const phone = createPhoneAvailabilityService(new Set(["821012345678"]));
    const open = phone.check("+82 10-9999-0000");
    const taken = phone.check("+82-10-1234-5678");
    assertPhoneAvailabilityResult(open.result);
    assertPhoneAvailabilityResult(taken.result);
    expect(open).toEqual({ result: "AVAILABLE" });
    expect(taken).toEqual({ result: "UNAVAILABLE" });
    expect(Object.keys(open)).toEqual(["result"]);
    expect(Object.keys(taken)).toEqual(["result"]);
  });

  it("does not mark SMS or phone ownership as verified", () => {
    const phone = createPhoneAvailabilityService(new Set());
    expect(phone.marksSmsOrOwnershipVerified).toBe(false);
    expect(contractDoc).toMatch(/signup availability/);
    expect(contractDoc).toMatch(/Never\s*`휴대폰 인증`/);

    const signupSources = [
      "app/signup/signup-form.tsx",
      "app/signup/page.tsx",
      "app/signup/actions.ts",
    ]
      .map((relative) => readFileSync(join(root, relative), "utf8"))
      .join("\n");
    expect(signupSources).not.toMatch(/휴대폰 인증/);
    expect(signupSources).not.toMatch(
      /SMS\s*verified|phone ownership verified/i,
    );
    expect(signupSources).toMatch(/휴대전화/);
  });
});

describe("WS-04 USDT manual deposit contract", () => {
  it("keeps request snapshots after instruction changes", () => {
    const deposits = createUsdtDepositService();
    deposits.setInstructions("TADDR_OLD", "TRC20");
    const first = deposits.submit({
      userId: "u1",
      network: "TRC20",
      txHash: "0xabc",
      idempotencyKey: "dep-1",
    });
    deposits.setInstructions("TADDR_NEW", "TRC20");
    expect(deposits.get(first.id)?.depositAddressSnapshot).toBe("TADDR_OLD");
    expect(deposits.get(first.id)?.networkSnapshot).toBe("TRC20");
  });

  it("rejects duplicate network + tx_hash", () => {
    const deposits = createUsdtDepositService();
    deposits.submit({
      userId: "u1",
      network: "TRC20",
      txHash: "0xduplicate",
      idempotencyKey: "a",
    });
    expect(() =>
      deposits.submit({
        userId: "u2",
        network: "TRC20",
        txHash: "0xduplicate",
        idempotencyKey: "b",
      }),
    ).toThrow("USDT_DEPOSIT_TX_HASH_DUPLICATE");
  });

  it("confirm credits KRW DEPOSIT exactly once under retry", () => {
    const deposits = createUsdtDepositService();
    const row = deposits.submit({
      userId: "u1",
      network: "TRC20",
      txHash: "0xonce",
      idempotencyKey: "c1",
    });
    const first = deposits.confirm({
      depositId: row.id,
      creditedKrw: 50_000n,
      idempotencyKey: "confirm-1",
    });
    const second = deposits.confirm({
      depositId: row.id,
      creditedKrw: 50_000n,
      idempotencyKey: "confirm-1-retry",
    });
    expect(first.ledgerTransactionId).toBe("ledger-deposit-dep-1");
    expect(second.ledgerTransactionId).toBe(first.ledgerTransactionId);
    expect(second.creditedKrw).toBe(50_000n);
  });
});

describe("WS-04 withdrawal hold and release idempotency", () => {
  it("holds once under duplicate/concurrent idempotent retries and blocks double-spend", () => {
    const ledger = createWithdrawalLedger();
    ledger.credit("u1", 10_000n, "WELCOME", "welcome-1");
    const wd = createWithdrawalService(ledger);
    const a = wd.request({
      userId: "u1",
      method: "KRW_BANK",
      amountKrw: 5_000n,
      idempotencyKey: "wd-dup",
    });
    const b = wd.request({
      userId: "u1",
      method: "KRW_BANK",
      amountKrw: 5_000n,
      idempotencyKey: "wd-dup",
    });
    expect(a.id).toBe(b.id);
    expect(ledger.journal.filter((j) => j.kind === "HOLD")).toHaveLength(1);
    expect(ledger.availableOf("u1")).toBe(5_000n);
    expect(ledger.heldOf("u1")).toBe(5_000n);
    expect(() =>
      wd.request({
        userId: "u1",
        method: "KRW_BANK",
        amountKrw: 5_001n,
        idempotencyKey: "wd-over",
      }),
    ).toThrow("INSUFFICIENT_AVAILABLE_BALANCE");
  });

  it("releases hold exactly once and restores available KRW", () => {
    const ledger = createWithdrawalLedger();
    ledger.credit("u1", 5_000n, "WELCOME", "welcome-1");
    const wd = createWithdrawalService(ledger);
    const row = wd.request({
      userId: "u1",
      method: "KRW_BANK",
      amountKrw: 5_000n,
      idempotencyKey: "wd-release",
    });
    const first = wd.release(row.id, "rel-1");
    const second = wd.release(row.id, "rel-1-retry");
    expect(first.releaseLedgerId).toBe(second.releaseLedgerId);
    expect(ledger.journal.filter((j) => j.kind === "RELEASE")).toHaveLength(1);
    expect(ledger.availableOf("u1")).toBe(5_000n);
    expect(ledger.heldOf("u1")).toBe(0n);
  });
});

describe("WS-04 EXTERNAL_SENT_RECORDED then ledger retry", () => {
  it("does not send externally a second time when ledger finalize fails then retries", () => {
    const ledger = createWithdrawalLedger();
    ledger.credit("u1", 5_000n, "WELCOME", "welcome-1");
    const wd = createWithdrawalService(ledger);
    const row = wd.request({
      userId: "u1",
      method: "USDT_ADDRESS",
      amountKrw: 5_000n,
      idempotencyKey: "wd-ext",
    });
    wd.recordUsdtExternalSend(row.id, {
      network: "TRC20",
      txHash: "0xsent1",
      actualUsdtAmount: "3.50",
      conversionEvidence: { note: "operator desk rate sheet" },
      operator: "admin-1",
      sentAt: "2026-09-27T00:00:00.000Z",
    });
    expect(wd.get(row.id)?.externalSendCount).toBe(1);
    expect(wd.get(row.id)?.status).toBe("EXTERNAL_SENT_RECORDED");

    wd.forceNextFinalizeFailure();
    expect(() => wd.finalize(row.id, "admin-1")).toThrow(
      "LEDGER_FINALIZE_TRANSIENT",
    );
    expect(wd.get(row.id)?.externalSendCount).toBe(1);

    // Retry after EXTERNAL_SENT must not instruct another send.
    const again = wd.recordUsdtExternalSend(row.id, {
      network: "TRC20",
      txHash: "0xsent2-should-not-apply",
      actualUsdtAmount: "9.99",
      conversionEvidence: null,
      operator: "admin-1",
      sentAt: "2026-09-27T01:00:00.000Z",
    });
    expect(again.externalSendCount).toBe(1);
    expect(again.usdtEvidence?.txHash).toBe("0xsent1");

    const done = wd.finalize(row.id, "admin-1");
    expect(done.status).toBe("COMPLETED");
    expect(ledger.journal.filter((j) => j.kind === "FINALIZE")).toHaveLength(1);
    expect(() => wd.release(row.id, "rel-after-send")).toThrow(
      "RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND",
    );
  });
});

describe("WS-04 method-specific evidence shapes", () => {
  it("requires KRW bank reference and actual_krw_amount without network/tx_hash", () => {
    const evidence: KrwEvidence = {
      bankReference: "KB-20260927-001",
      actualKrwAmount: 5_000n,
      operator: "admin-1",
      sentAt: "2026-09-27T02:00:00.000Z",
    };
    assertKrwEvidenceShape(evidence as unknown as Record<string, unknown>);
  });

  it("requires USDT network, tx_hash, actual_usdt_amount, optional conversion, operator, sent_at", () => {
    const withConversion: UsdtEvidence = {
      network: "TRC20",
      txHash: "0xusdt1",
      actualUsdtAmount: "3.50",
      conversionEvidence: { deskNote: "manual" },
      operator: "admin-1",
      sentAt: "2026-09-27T02:00:00.000Z",
    };
    const withoutConversion: UsdtEvidence = {
      ...withConversion,
      conversionEvidence: null,
    };
    assertUsdtEvidenceShape(
      withConversion as unknown as Record<string, unknown>,
    );
    assertUsdtEvidenceShape(
      withoutConversion as unknown as Record<string, unknown>,
    );
  });
});

describe("WS-04 START welcome conversion then no-funding first withdrawal", () => {
  it("allows KRW_BANK first withdrawal capped at 5000 without prior funding", () => {
    const ledger = createWithdrawalLedger();
    ledger.credit("u1", 5_000n, "WELCOME", "start-convert");
    expect(
      ledger.journal.some((j) => j.kind === "DEPOSIT" && j.userId === "u1"),
    ).toBe(false);
    const wd = createWithdrawalService(ledger);
    const row = wd.request({
      userId: "u1",
      method: "KRW_BANK",
      amountKrw: 5_000n,
      idempotencyKey: "welcome-krw",
      welcomeConversionId: "conv-1",
    });
    expect(row.amountKrw).toBe(5_000n);
    expect(() =>
      wd.request({
        userId: "u1",
        method: "KRW_BANK",
        amountKrw: 5_001n,
        idempotencyKey: "welcome-over-cap-spend",
      }),
    ).toThrow("INSUFFICIENT_AVAILABLE_BALANCE");
    wd.recordKrwExternalSend(
      row.id,
      {
        bankReference: "BANK-REF-1",
        actualKrwAmount: 5_000n,
        operator: "admin-1",
        sentAt: "2026-09-27T03:00:00.000Z",
      },
      "admin-1",
    );
    expect(wd.finalize(row.id, "admin-1").status).toBe("COMPLETED");
  });

  it("allows USDT_ADDRESS first withdrawal with manual send then KRW ledger finalize", () => {
    const ledger = createWithdrawalLedger();
    ledger.credit("u1", 5_000n, "WELCOME", "start-convert");
    const wd = createWithdrawalService(ledger);
    const row = wd.request({
      userId: "u1",
      method: "USDT_ADDRESS",
      amountKrw: 5_000n,
      idempotencyKey: "welcome-usdt",
      welcomeConversionId: "conv-2",
    });
    expect(row.amountKrw).toBe(5_000n);
    wd.recordUsdtExternalSend(row.id, {
      network: "TRC20",
      txHash: "0xwelcome",
      actualUsdtAmount: "3.40",
      conversionEvidence: null,
      operator: "admin-1",
      sentAt: "2026-09-27T04:00:00.000Z",
    });
    const done = wd.finalize(row.id, "admin-1");
    expect(done.status).toBe("COMPLETED");
    expect(ledger.heldOf("u1")).toBe(0n);
    expect(ledger.availableOf("u1")).toBe(0n);
    expect(ledger.journal.filter((j) => j.kind === "FINALIZE")).toHaveLength(1);
  });
});

describe("WS-04 user isolation and admin command denial", () => {
  it("denies cross-user withdrawal evidence mutation", () => {
    const ledger = createWithdrawalLedger();
    ledger.credit("owner", 5_000n, "WELCOME", "w");
    const wd = createWithdrawalService(ledger);
    const row = wd.request({
      userId: "owner",
      method: "KRW_BANK",
      amountKrw: 5_000n,
      idempotencyKey: "iso-1",
    });
    expect(() =>
      wd.recordKrwExternalSend(
        row.id,
        {
          bankReference: "X",
          actualKrwAmount: 5_000n,
          operator: "attacker",
          sentAt: "2026-09-27T05:00:00.000Z",
        },
        "user:attacker",
      ),
    ).toThrow("USER_ISOLATION_DENIED");
  });

  it("documents that public app must not accept admin money commands", () => {
    expect(contractDoc).toMatch(
      /Admin sessions are separate from public user sessions/,
    );
    expect(contractDoc).toMatch(/Never authorize from\s*`user_metadata`/);
  });
});

describe("WS-04 worker / reconciliation contract (no auto-repair)", () => {
  it("keeps run_financial_reconciliation as mismatch recorder without balance mutation verbs", () => {
    const migrations = loadMigrationSources();
    expect(migrations).toMatch(
      /create function public\.run_financial_reconciliation/,
    );
    expect(migrations).toMatch(/never auto-repairs money/i);

    const fnMatch = migrations.match(
      /create function public\.run_financial_reconciliation[\s\S]*?\$\$;/,
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];
    expect(body).not.toMatch(/update public\.wallet_accounts/i);
    expect(body).not.toMatch(/update public\.wallet_ledger/i);
    expect(body).not.toMatch(/insert into public\.ledger_entries/i);
    expect(body).toMatch(/reconciliation_mismatches/);
  });

  it("treats worker claim helpers as lease/idempotency seams, not money mutators in this contract layer", () => {
    expect(contractDoc).toMatch(/claim_outbox_events/);
    expect(contractDoc).toMatch(/claim_system_jobs/);
    expect(contractDoc).toMatch(/does not auto-repair/);
  });
});

describe("WS-04 frozen public command presence (Agent A gate)", () => {
  it("requires every frozen WS-04 public command in migrations", () => {
    const migrations = loadMigrationSources();
    const missing = FROZEN_PUBLIC_COMMANDS.filter(
      (name) =>
        !new RegExp(`create\\s+function\\s+public\\.${name}\\s*\\(`, "i").test(
          migrations,
        ),
    );
    // Strict: expected FAIL until Agent A lands WS-04 migration.
    expect(missing).toEqual([]);
  });

  it("freezes the public command list in the canonical contract document", () => {
    for (const name of FROZEN_PUBLIC_COMMANDS) {
      expect(contractDoc).toContain(`public.${name}`);
    }
  });
});
