import { WalletReadView } from "@/components/product/wallet-read-view";
import {
  buildKrwWalletProjection,
  classifyLedgerHistoryRead,
  classifyReceiptHistoryRead,
  classifyWalletBalanceRead,
  type WalletLedgerEvidence,
  type WalletReceiptEvidence,
} from "@/domain/wallet/wallet-read";
import { requirePageUser } from "@/lib/auth/session";
import { parseMiningServerDisplay } from "@/lib/product/mining-server-display";
import { readOwnMiningServerDisplay } from "@/lib/product/read-mining-server-display";
import { presentWalletServerDisplay } from "@/lib/product/wallet-server-display";

export default async function WalletPage() {
  const identity = await requirePageUser();
  const [
    { data: krwAccount, error: accountsError },
    { data: trial, error: trialError },
    displayResponse,
  ] = await Promise.all([
    identity.supabase
      .from("wallet_balance_snapshots")
      .select(
        "wallet_account_id, balance_atomic, available_balance_atomic, currency",
      )
      .eq("user_id", identity.userId)
      .eq("currency", "KRW")
      .maybeSingle(),
    identity.supabase
      .from("trial_account_snapshots")
      .select("status, reward_atomic")
      .eq("user_id", identity.userId)
      .maybeSingle(),
    readOwnMiningServerDisplay(identity),
  ]);
  const parsedDisplay = displayResponse.error
    ? null
    : parseMiningServerDisplay(displayResponse.data);
  const funding = parsedDisplay
    ? presentWalletServerDisplay(parsedDisplay)
    : { state: "error" as const };

  const krw =
    krwAccount && !accountsError
      ? buildKrwWalletProjection({
          availableBalanceAtomic: krwAccount.available_balance_atomic,
          balanceAtomic: krwAccount.balance_atomic,
          walletAccountId: String(krwAccount.wallet_account_id),
        })
      : null;

  const accountIds = krw ? [krw.walletAccountId] : [];
  const [
    { data: ledgerRows, error: ledgerError },
    { data: receiptRows, error: receiptError },
  ] = await Promise.all([
    accountIds.length
      ? identity.supabase
          .from("wallet_ledger")
          .select(
            "id, wallet_account_id, direction, entry_type, amount_atomic, created_at",
          )
          .eq("user_id", identity.userId)
          .in("wallet_account_id", accountIds)
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] as const, error: null }),
    identity.supabase
      .from("transaction_receipts")
      .select(
        "id, receipt_number, transaction_type, amount_atomic, currency, status, requested_at, completed_at",
      )
      .eq("user_id", identity.userId)
      .order("requested_at", { ascending: false })
      .limit(6),
  ]);

  const ledgerEntries: WalletLedgerEvidence[] = (ledgerRows ?? []).map(
    (entry) => ({
      amountAtomic: String(entry.amount_atomic),
      createdAt: entry.created_at,
      direction: entry.direction as "CREDIT" | "DEBIT",
      entryType: entry.entry_type,
      id: entry.id,
    }),
  );

  const receipts: WalletReceiptEvidence[] = (receiptRows ?? []).map(
    (receipt) => ({
      amountAtomic: String(receipt.amount_atomic),
      completedAt: receipt.completed_at,
      currency: receipt.currency,
      id: receipt.id,
      receiptNumber: receipt.receipt_number,
      requestedAt: receipt.requested_at,
      status: receipt.status,
      transactionType: receipt.transaction_type,
    }),
  );

  const balanceState = classifyWalletBalanceRead({
    error: Boolean(accountsError),
    hasAccount: Boolean(krw),
    ...(krw
      ? {
          availableAtomic: krw.availableAtomic,
          balanceAtomic: krw.balanceAtomic,
        }
      : {}),
  });

  const trialState = trialError ? "error" : trial ? "ready" : "empty";

  return (
    <div
      data-ui-ready="/wallet"
      data-ui-state={
        accountsError ||
        trialError ||
        ledgerError ||
        receiptError ||
        parsedDisplay === null
          ? "partial"
          : "loaded"
      }
    >
      <WalletReadView
        balanceState={balanceState}
        funding={funding}
        krw={krw}
        ledgerEntries={ledgerEntries}
        ledgerState={classifyLedgerHistoryRead({
          count: ledgerEntries.length,
          error: Boolean(ledgerError),
        })}
        receiptState={classifyReceiptHistoryRead({
          count: receipts.length,
          error: Boolean(receiptError),
        })}
        receipts={receipts}
        trialRewardAtomic={
          trial?.reward_atomic == null ? null : String(trial.reward_atomic)
        }
        trialState={trialState}
      />
    </div>
  );
}
