import "server-only";
import type { VerifiedIdentity } from "@/lib/auth/session";
import type { CashActivityItem } from "@/components/workroom/cash-activity";

/** Deposits do not create receipts. Read their original request records, never infer from the ledger. */
export async function readWorkroomCashActivity(
  identity: VerifiedIdentity,
  limit: 6 | 100,
) {
  const [deposits, withdrawals, usdt] = await Promise.all([
    identity.supabase
      .from("deposit_requests")
      .select("id,amount_atomic,currency,status,requested_at")
      .eq("user_id", identity.userId)
      .eq("currency", "KRW")
      .order("requested_at", { ascending: false })
      .limit(limit),
    identity.supabase
      .from("transaction_receipts")
      .select("id,amount_atomic,currency,status,requested_at")
      .eq("user_id", identity.userId)
      .eq("currency", "KRW")
      .eq("transaction_type", "WITHDRAWAL")
      .order("requested_at", { ascending: false })
      .limit(limit),
    identity.supabase
      .from("usdt_manual_deposits")
      .select("id,sent_usdt_amount,status,created_at")
      .eq("user_id", identity.userId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);
  const items: CashActivityItem[] = [
    ...(deposits.data ?? []).map((row) => ({
      id: `deposit:${row.id}`,
      type: "DEPOSIT",
      amount: String(row.amount_atomic),
      currency: "KRW",
      status: row.status,
      at: row.requested_at,
    })),
    ...(withdrawals.data ?? []).map((row) => ({
      id: `withdrawal:${row.id}`,
      type: "WITHDRAWAL",
      amount: String(row.amount_atomic),
      currency: "KRW",
      status: row.status,
      at: row.requested_at,
    })),
    ...(usdt.data ?? []).map((row) => ({
      id: `usdt:${row.id}`,
      type: "DEPOSIT",
      amount: String(row.sent_usdt_amount),
      currency: "USDT",
      status: row.status,
      at: row.created_at,
    })),
  ];
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return {
    failed: Boolean(deposits.error || withdrawals.error || usdt.error),
    items: items.slice(0, limit),
  };
}
