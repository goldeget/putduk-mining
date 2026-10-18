"use client";
import {
  classifyWithdrawalHoldResponse,
  readWithdrawalHoldId,
  WithdrawalLogicalSafetyError,
  WITHDRAWAL_RECONCILIATION_COPY,
  type LogicalRequestStore,
} from "./withdrawal-logical-request";
import {
  persistWithdrawalLogicalRecord,
  validateWithdrawalLogicalRecord,
  type WithdrawalLogicalRecord,
} from "./withdrawal-logical-record";
import {
  recoverWithdrawalLogicalRecord,
  resolveWithdrawalLogicalRecord,
  WITHDRAWAL_INTENT_URL,
  WITHDRAWAL_HOLD_SUBMIT_URL,
} from "./withdrawal-logical-recovery";
import { memberWithdrawalSubmitMessage } from "@/components/product/member-withdrawal-errors";

import {
  principalWithdrawalSnapshotSchema,
  type PrincipalWithdrawalSnapshot,
} from "./principal-withdrawal-read";
export type { PrincipalWithdrawalSnapshot } from "./principal-withdrawal-read";

/** Called only by an explicit form submit. GET/reconnect never posts finance. */
export async function submitPrincipalWithdrawal(input: {
  ownerId: string;
  store: LogicalRequestStore;
  snapshot: PrincipalWithdrawalSnapshot;
  fetcher?: typeof fetch;
  knownKey?: string | null;
  legacyPresent?: boolean;
  onRecord?: (record: WithdrawalLogicalRecord) => void;
}) {
  const { ownerId, store } = input;
  const checked = principalWithdrawalSnapshotSchema.safeParse(input.snapshot);
  if (!checked.success)
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  const snapshot = Object.freeze({
    ...checked.data,
    confirmation: Object.freeze({ ...checked.data.confirmation }),
  });
  const fetcher = input.fetcher ?? fetch;
  let record = await recoverWithdrawalLogicalRecord(
    ownerId,
    store,
    fetcher,
    input.legacyPresent ?? false,
    input.knownKey,
  );
  if (record) {
    if (
      record.v !== 3 ||
      record.method !== snapshot.method ||
      record.amountKrw !== snapshot.amountKrw ||
      record.policyId !== snapshot.policyId ||
      record.policyVersion !== snapshot.policyVersion ||
      record.destinationId !== snapshot.destinationId
    )
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
    if (record.state === "CONFIRMED") return record;
    if (["CANCELLED", "DEFINITIVELY_REJECTED"].includes(record.state))
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  } else {
    const response = await fetcher(WITHDRAWAL_INTENT_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(memberWithdrawalSubmitMessage(payload));
    const data =
      payload && typeof payload === "object" && "data" in payload
        ? payload.data
        : null;
    record = validateWithdrawalLogicalRecord(
      data && typeof data === "object" && "record" in data ? data.record : null,
      ownerId,
    );
    if (
      record.v !== 3 ||
      record.method !== snapshot.method ||
      record.amountKrw !== snapshot.amountKrw ||
      record.policyId !== snapshot.policyId ||
      record.policyVersion !== snapshot.policyVersion ||
      record.destinationId !== snapshot.destinationId
    )
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  }
  input.onRecord?.(record);
  // No destination material, consent default, or fresh key on recovery.
  persistWithdrawalLogicalRecord(store, record, ownerId);
  if (Date.parse(record.expiresAt) <= Date.now() && !record.withdrawalId)
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  const response = await fetcher(WITHDRAWAL_HOLD_SUBMIT_URL, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": record.key,
    },
    body: JSON.stringify({
      method: record.method,
      destinationId: record.destinationId,
      amountKrw: record.amountKrw,
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  const outcome = classifyWithdrawalHoldResponse({
    bodyParsed: payload !== null,
    ok: response.ok,
    payload,
    status: response.status,
  });
  if (outcome === "confirmed_success")
    return resolveWithdrawalLogicalRecord(
      ownerId,
      store,
      record,
      "CONFIRM",
      readWithdrawalHoldId(payload),
      fetcher,
    );
  if (outcome === "definitive_rejection") {
    const resolved = await resolveWithdrawalLogicalRecord(
      ownerId,
      store,
      record,
      "REJECT",
      null,
      fetcher,
    );
    input.onRecord?.(resolved);
    if (resolved.withdrawalId) throw new Error(WITHDRAWAL_RECONCILIATION_COPY);
  }
  throw new Error(memberWithdrawalSubmitMessage(payload));
}
