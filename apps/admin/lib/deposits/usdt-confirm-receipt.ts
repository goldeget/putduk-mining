import { z } from "zod";

const amount = z
  .union([
    z.string().regex(/^[1-9][0-9]*$/),
    z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ])
  .transform(String);
const depositSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  status: z.literal("CONFIRMED"),
  credited_krw: amount,
  ledger_transaction_id: z.uuid(),
  wallet_ledger_id: z.uuid(),
});
const journalSchema = z.object({
  id: z.uuid(),
  category: z.literal("DEPOSIT"),
  currency: z.literal("KRW"),
  reference_type: z.literal("usdt_manual_deposit"),
  reference_id: z.uuid(),
  member_user_id: z.uuid(),
});
const walletSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  direction: z.literal("CREDIT"),
  entry_type: z.literal("DEPOSIT"),
  amount_atomic: amount,
  reference_type: z.literal("usdt_manual_deposit"),
  reference_id: z.uuid(),
});

/** RPC 응답만으로 성공을 표시하지 않는다. 실제 연결된 반영 결과를 확인한다. */
export function verifyUsdtDepositReceipt(input: {
  depositId: string;
  requestedKrw: string;
  rpcTransactionId: unknown;
  deposit: unknown;
  journal: unknown;
  wallet: unknown;
}):
  | { ok: true; creditedKrw: string }
  | { ok: false; code: "UNCONFIRMED" | "AMOUNT_MISMATCH" } {
  const deposit = depositSchema.safeParse(input.deposit);
  const journal = journalSchema.safeParse(input.journal);
  const wallet = walletSchema.safeParse(input.wallet);
  if (!deposit.success || !journal.success || !wallet.success) {
    return { ok: false, code: "UNCONFIRMED" };
  }
  const row = deposit.data;
  const tx = journal.data;
  const credit = wallet.data;
  if (
    row.id !== input.depositId ||
    row.ledger_transaction_id !== input.rpcTransactionId ||
    tx.id !== row.ledger_transaction_id ||
    tx.reference_id !== row.id ||
    tx.member_user_id !== row.user_id ||
    credit.id !== row.wallet_ledger_id ||
    credit.reference_id !== row.id ||
    credit.user_id !== row.user_id ||
    credit.amount_atomic !== row.credited_krw
  ) {
    return { ok: false, code: "UNCONFIRMED" };
  }
  if (row.credited_krw !== input.requestedKrw) {
    return { ok: false, code: "AMOUNT_MISMATCH" };
  }
  return { ok: true, creditedKrw: row.credited_krw };
}
