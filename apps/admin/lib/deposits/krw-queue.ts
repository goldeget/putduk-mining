import "server-only";

import { createAdminServiceClient } from "@/lib/supabase/service";

const PENDING = ["REQUESTED", "AWAITING_TRANSFER", "REVIEWING"] as const;

const FULL_COLUMNS =
  "id, user_id, currency, amount_atomic, status, requested_at, reviewed_by, reviewed_at, rejection_reason, approved_amount_atomic, ledger_transaction_id";
const BASE_COLUMNS =
  "id, user_id, currency, amount_atomic, status, requested_at, reviewed_by, reviewed_at, rejection_reason";

export type KrwDepositRow = {
  id: string;
  user_id: string;
  currency: string;
  amount_atomic: number | string;
  status: string;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  approved_amount_atomic: number | string | null;
  ledger_transaction_id: string | null;
};

export type KrwDepositReceipt = {
  status: string | null;
  approvedAmountAtomic: string | null;
  ledgerTransactionId: string | null;
  auditRecorded: boolean | null;
};

function asRow(value: Record<string, unknown>): KrwDepositRow {
  return {
    id: String(value.id),
    user_id: String(value.user_id),
    currency: String(value.currency),
    amount_atomic: value.amount_atomic as number | string,
    status: String(value.status),
    requested_at: String(value.requested_at),
    reviewed_by:
      typeof value.reviewed_by === "string" ? value.reviewed_by : null,
    reviewed_at:
      typeof value.reviewed_at === "string" ? value.reviewed_at : null,
    rejection_reason:
      typeof value.rejection_reason === "string"
        ? value.rejection_reason
        : null,
    approved_amount_atomic:
      (value.approved_amount_atomic as number | string | null | undefined) ??
      null,
    ledger_transaction_id:
      typeof value.ledger_transaction_id === "string"
        ? value.ledger_transaction_id
        : null,
  };
}

function missingColumn(message: string | undefined): boolean {
  const text = message ?? "";
  return (
    text.includes("approved_amount_atomic") ||
    text.includes("ledger_transaction_id") ||
    text.includes("column")
  );
}

export async function loadKrwDepositQueue(): Promise<
  { ok: true; rows: KrwDepositRow[] } | { ok: false }
> {
  const db = createAdminServiceClient();
  const first = await db
    .from("deposit_requests")
    .select(FULL_COLUMNS)
    .eq("currency", "KRW")
    .in("status", [...PENDING])
    .order("requested_at", { ascending: true })
    .limit(40);
  const query = missingColumn(first.error?.message)
    ? await db
        .from("deposit_requests")
        .select(BASE_COLUMNS)
        .eq("currency", "KRW")
        .in("status", [...PENDING])
        .order("requested_at", { ascending: true })
        .limit(40)
    : first;
  if (query.error) return { ok: false };
  return {
    ok: true,
    rows: ((query.data ?? []) as Record<string, unknown>[]).map(asRow),
  };
}

export async function loadKrwDeposit(
  id: string,
): Promise<{ ok: true; row: KrwDepositRow | null } | { ok: false }> {
  const db = createAdminServiceClient();
  const first = await db
    .from("deposit_requests")
    .select(FULL_COLUMNS)
    .eq("id", id)
    .eq("currency", "KRW")
    .maybeSingle();
  const query = missingColumn(first.error?.message)
    ? await db
        .from("deposit_requests")
        .select(BASE_COLUMNS)
        .eq("id", id)
        .eq("currency", "KRW")
        .maybeSingle()
    : first;
  if (query.error) return { ok: false };
  if (!query.data) return { ok: true, row: null };
  return { ok: true, row: asRow(query.data as Record<string, unknown>) };
}

export async function loadKrwDepositReceipt(
  id: string,
): Promise<KrwDepositReceipt | null> {
  const loaded = await loadKrwDeposit(id);
  if (!loaded.ok || !loaded.row) return null;
  const audit = await createAdminServiceClient()
    .from("audit_logs")
    .select("id")
    .eq("action", "deposit.approve")
    .eq("target_id", id)
    .limit(1);
  const auditRecorded = audit.error
    ? null
    : Array.isArray(audit.data) && audit.data.length > 0;
  return {
    status: loaded.row.status,
    approvedAmountAtomic:
      loaded.row.approved_amount_atomic === null
        ? null
        : String(loaded.row.approved_amount_atomic),
    ledgerTransactionId: loaded.row.ledger_transaction_id,
    auditRecorded,
  };
}
