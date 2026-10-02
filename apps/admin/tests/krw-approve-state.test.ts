import { describe, expect, it } from "vitest";

import {
  createKrwApproveState,
  KRW_APPROVE_COPY,
  krwApproveReceiptMatches,
  krwDepositJournalIdempotencyKey,
  reduceKrwApprove,
  type KrwApproveEvent,
} from "@/lib/deposits/krw-approve-state";
import {
  declaredClientOffline,
  parseLogicalOperationKey,
  requestDeclaredOffline,
} from "@/lib/money/logical-operation";

const key = "krw_dep_0123456789abcdef0123456789abcdef";
const otherKey = "krw_dep_fedcba9876543210fedcba9876543210";
const ledgerId = "11111111-1111-4111-8111-111111111111";
const otherLedgerId = "22222222-2222-4222-8222-222222222222";

function started(amount = "5000") {
  return reduceKrwApprove(createKrwApproveState(key), {
    type: "submit",
    online: true,
    payload: `${amount}|계좌 입금을 확인했습니다`,
  });
}

function refreshed(
  patch: Partial<Extract<KrwApproveEvent, { type: "refreshed" }>>,
): Extract<KrwApproveEvent, { type: "refreshed" }> {
  return {
    type: "refreshed",
    httpStatus: 200,
    status: "APPROVED",
    audit: true,
    failed: false,
    approvedAmountAtomic: "5000",
    ledgerTransactionId: ledgerId,
    linkedLedgerTransactionId: ledgerId,
    logicalOperationKey: key,
    ...patch,
  };
}

describe("KRW approve UX state", () => {
  it("does not confirm from a receipt alone", () => {
    const confirming = reduceKrwApprove(started(), { type: "receipt" });
    expect(confirming.phase).toBe("confirming");
    expect(confirming.message).not.toContain("반영되었습니다");
    expect(confirming.logicalKey).toBe(key);
  });

  it("does not confirm from APPROVED status alone", () => {
    const pending = reduceKrwApprove(
      started(),
      refreshed({
        approvedAmountAtomic: null,
        ledgerTransactionId: null,
        linkedLedgerTransactionId: null,
        logicalOperationKey: null,
      }),
    );
    expect(pending.phase).not.toBe("confirmed");
    expect(pending.message).toBe(KRW_APPROVE_COPY.indeterminate);
    expect(pending.message).not.toContain("반영되었습니다");
    expect(
      krwApproveReceiptMatches(
        started(),
        refreshed({
          approvedAmountAtomic: null,
          ledgerTransactionId: null,
          linkedLedgerTransactionId: null,
          logicalOperationKey: null,
        }),
      ),
    ).toBe(false);
  });

  it("confirms only when the sent amount and linked ledger transaction match", () => {
    const attempt = started();
    const event = refreshed({});
    expect(krwApproveReceiptMatches(attempt, event)).toBe(true);
    const confirmed = reduceKrwApprove(attempt, event);
    expect(confirmed.phase).toBe("confirmed");
    expect(confirmed.message).toBe(KRW_APPROVE_COPY.confirmedAudit);
    expect(confirmed.logicalKey).toBe(key);
    expect(confirmed.auditRecorded).toBe(true);
    expect(confirmed.attemptRejected).toBe(false);
  });

  it("does not confirm when the ledger transaction is not tied to this logical key", () => {
    const pending = reduceKrwApprove(
      started(),
      refreshed({
        linkedLedgerTransactionId: null,
        logicalOperationKey: key,
      }),
    );
    expect(pending.phase).not.toBe("confirmed");
    expect(pending.message).not.toContain("반영되었습니다");
  });

  it("fails when another operator already approved a different amount", () => {
    const attempt = started("5000");
    const rejected = reduceKrwApprove(
      attempt,
      refreshed({
        httpStatus: 409,
        approvedAmountAtomic: "9000",
        ledgerTransactionId: otherLedgerId,
        linkedLedgerTransactionId: null,
        logicalOperationKey: key,
      }),
    );
    expect(rejected.phase).toBe("error");
    expect(rejected.attemptRejected).toBe(true);
    expect(rejected.message).toBe(KRW_APPROVE_COPY.amountRejected);
    expect(rejected.message).not.toContain("9000");
    expect(rejected.message).not.toContain("409");
    expect(rejected.message.toLowerCase()).not.toContain("idempotency");
    const stillRejected = reduceKrwApprove(
      rejected,
      refreshed({
        status: "APPROVED",
        approvedAmountAtomic: "5000",
        ledgerTransactionId: ledgerId,
        linkedLedgerTransactionId: ledgerId,
        logicalOperationKey: key,
      }),
    );
    expect(stillRejected).toBe(rejected);
    expect(
      reduceKrwApprove(rejected, {
        type: "submit",
        online: true,
        payload: "5000|계좌 입금을 확인했습니다",
      }),
    ).toBe(rejected);
  });

  it("keeps a payload mismatch terminal even if a later read is APPROVED", () => {
    const rejected = reduceKrwApprove(started(), { type: "payload_mismatch" });
    expect(rejected.phase).toBe("error");
    expect(rejected.message).toBe(KRW_APPROVE_COPY.amountRejected);
    const later = reduceKrwApprove(rejected, refreshed({}));
    expect(later).toBe(rejected);
    expect(later.message).not.toContain("반영되었습니다");
  });

  it("does not confirm a different logical key or a different ledger id", () => {
    expect(
      reduceKrwApprove(started(), refreshed({ logicalOperationKey: otherKey }))
        .phase,
    ).not.toBe("confirmed");
    expect(
      reduceKrwApprove(
        started(),
        refreshed({ linkedLedgerTransactionId: otherLedgerId }),
      ).phase,
    ).not.toBe("confirmed");
    expect(krwDepositJournalIdempotencyKey(key)).toBe(`${key}:ledger`);
  });

  it("does not claim an audit row that was not reread", () => {
    const confirmed = reduceKrwApprove(started(), refreshed({ audit: null }));
    expect(confirmed.phase).toBe("confirmed");
    expect(confirmed.message).toBe(KRW_APPROVE_COPY.confirmedAuditUnknown);
  });

  it("blocks offline before send and does not start the request", () => {
    const blocked = reduceKrwApprove(createKrwApproveState(key), {
      type: "submit",
      online: false,
      payload: "5000|계좌 입금을 확인했습니다",
    });
    expect(blocked.phase).toBe("editing");
    expect(blocked.requestStarted).toBe(false);
    expect(blocked.message).toBe(KRW_APPROVE_COPY.offline);
    expect(blocked.logicalKey).toBe(key);
  });

  it("keeps the same key when the response is lost or cancelled", () => {
    const started = reduceKrwApprove(createKrwApproveState(key), {
      type: "submit",
      online: true,
      payload: "5000|계좌 입금을 확인했습니다",
    });
    expect(
      reduceKrwApprove(started, { type: "transport_lost" }).logicalKey,
    ).toBe(key);
    expect(reduceKrwApprove(started, { type: "cancel" }).phase).toBe(
      "indeterminate",
    );
    const afterLost = reduceKrwApprove(started, { type: "transport_lost" });
    expect(
      reduceKrwApprove(afterLost, {
        type: "submit",
        online: true,
        payload: "1|다름",
      }).message,
    ).toBe(KRW_APPROVE_COPY.payloadLocked);
  });

  it("ignores a second click while the first request is in flight", () => {
    const started = reduceKrwApprove(createKrwApproveState(key), {
      type: "submit",
      online: true,
      payload: "5000|계좌 입금을 확인했습니다",
    });
    expect(
      reduceKrwApprove(started, {
        type: "submit",
        online: true,
        payload: "5000|계좌 입금을 확인했습니다",
      }),
    ).toBe(started);
  });
});

describe("money offline and logical keys", () => {
  it("treats only an explicit offline flag as a money block", () => {
    expect(declaredClientOffline("0")).toBe(true);
    expect(declaredClientOffline("1")).toBe(false);
    expect(declaredClientOffline(null)).toBe(false);
    expect(
      requestDeclaredOffline(
        new Request("https://admin.example/approve", {
          headers: { "x-putduk-client-online": "0" },
        }),
      ),
    ).toBe(true);
    expect(parseLogicalOperationKey(key)).toBe(key);
    expect(parseLogicalOperationKey("short")).toBeNull();
  });
});
