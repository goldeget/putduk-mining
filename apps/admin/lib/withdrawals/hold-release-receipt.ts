/**
 * Readback-only receipt verifier. No mutation, clock substitution or new approval.
 * Historical replay returns its original terminal disposition, never the new input.
 */
export type HoldReleaseDisposition = "REJECTED" | "CANCELLED";
export type HoldReleaseReadback = {
  withdrawalId: string;
  returnedLedgerId: unknown;
  requestedDisposition: HoldReleaseDisposition;
  withdrawal: unknown;
  ledger: unknown;
  entries: unknown;
};
export type HoldReleaseConfirmation =
  | { ok: false; code: "UNCONFIRMED" }
  | { ok: true; releaseLedgerTransactionId: string; disposition: HoldReleaseDisposition;
      requestedDisposition: HoldReleaseDisposition; matchesRequestedDisposition: boolean };
const uuid = (v: unknown): v is string => typeof v === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const atomic = (v: unknown): bigint | null => {
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0) return null;
    return BigInt(v);
  }
  if (typeof v !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(v)) return null;
  const result=BigInt(v);
  return result<=9223372036854775807n?result:null;
};
const disposition = (v: unknown): v is HoldReleaseDisposition => v === "REJECTED" || v === "CANCELLED";
const validTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
export function confirmWithdrawalHoldRelease(input: HoldReleaseReadback): HoldReleaseConfirmation {
  const unknown: HoldReleaseConfirmation = { ok: false, code: "UNCONFIRMED" };
  if (!input || !uuid(input.withdrawalId) || !uuid(input.returnedLedgerId) ||
    !disposition(input.requestedDisposition) || !record(input.withdrawal) ||
    !record(input.ledger) || !Array.isArray(input.entries) || input.entries.length !== 2) return unknown;
  const w=input.withdrawal, l=input.ledger;
  if (w.id!==input.withdrawalId || !uuid(w.user_id) || !uuid(w.hold_ledger_transaction_id) ||
    w.release_ledger_transaction_id!==input.returnedLedgerId || !disposition(w.status) ||
    w.currency!=="KRW" || atomic(w.fee_atomic)!==0n ||
    typeof w.rejection_reason!=="string" || !w.rejection_reason ||
    !validTime(w.hold_released_at) || l.id!==input.returnedLedgerId ||
    l.category!=="REVERSAL" || l.currency!=="KRW" || l.reference_type!=="withdrawal_request" ||
    l.reference_id!==w.id || l.member_user_id!==w.user_id ||
    l.reversal_of_transaction_id!==w.hold_ledger_transaction_id ||
    !record(l.metadata) || l.metadata.phase!=="RELEASE" || l.metadata.disposition!==w.status ||
    l.metadata.reason!==w.rejection_reason || !validTime(l.posted_at) ||
    l.posted_at!==w.hold_released_at) return unknown;
  const amount=atomic(w.amount_atomic);
  if (amount===null || amount<=0n) return unknown;
  const entries=[...input.entries].sort((a,b)=>
    record(a)&&record(b)&&typeof a.sequence==="number"&&typeof b.sequence==="number"?a.sequence-b.sequence:0);
  for (let i=0;i<2;i++) {
    const entry=entries[i];
    if(!record(entry)||entry.transaction_id!==input.returnedLedgerId || !uuid(entry.account_id) ||
      entry.sequence!==i || entry.side!==(i===0?"DEBIT":"CREDIT") || atomic(entry.amount_atomic)!==amount) return unknown;
  }
  if ((entries[0] as Record<string,unknown>).account_id===(entries[1] as Record<string,unknown>).account_id) return unknown;
  return { ok:true,releaseLedgerTransactionId:input.returnedLedgerId,disposition:w.status,
    requestedDisposition:input.requestedDisposition,matchesRequestedDisposition:w.status===input.requestedDisposition };
}
