import Link from "next/link";

import { PageHeading } from "@/components/product/page-heading";
import { Surface } from "@/components/ui/surface";
import {
  formatAtomicAmount,
  type DisplayCurrency,
} from "@/domain/wallet/format-amount";
import { requirePageUser } from "@/lib/auth/session";

export default async function WalletPage() {
  const identity = await requirePageUser();
  const { data: accounts } = await identity.supabase
    .from("wallet_balance_snapshots")
    .select("*")
    .eq("user_id", identity.userId)
    .order("currency");
  const accountIds = (accounts ?? []).map(
    (account) => account.wallet_account_id,
  );
  const { data: ledgerEntries } = accountIds.length
    ? await identity.supabase
        .from("wallet_ledger")
        .select(
          "id, wallet_account_id, direction, entry_type, amount_atomic, created_at",
        )
        .eq("user_id", identity.userId)
        .in("wallet_account_id", accountIds)
        .order("created_at", { ascending: false })
        .limit(12)
    : { data: [] };
  const currencyByAccount = new Map(
    (accounts ?? []).map((account) => [
      account.wallet_account_id,
      account.currency as DisplayCurrency,
    ]),
  );

  return (
    <>
      <PageHeading
        eyebrow="ASSET LEDGER"
        title="잔액보다 먼저, 변화의 이유를 기록합니다."
        lead="표시 잔액은 원장 항목을 합산한 결과이며 임의로 덮어쓰지 않습니다."
        action={
          <div className="wallet-actions">
            <Link className="button button--primary" href="/wallet/deposit">
              입금 시작
            </Link>
            <Link className="button button--secondary" href="/wallet/withdraw">
              출금
            </Link>
          </div>
        }
      />
      <section className="balance-grid" aria-label="자산 계정">
        {accounts?.map((account) => (
          <Surface
            as="article"
            className="balance-card"
            key={account.wallet_account_id}
          >
            <div>
              <span>{account.currency}</span>
              <small>
                {account.currency === "KRW" ? "기본 자산" : "선택형 자산"}
              </small>
            </div>
            <strong>
              {formatAtomicAmount(
                account.balance_atomic,
                account.currency as DisplayCurrency,
              )}
            </strong>
            <p>
              사용 가능{" "}
              {formatAtomicAmount(
                account.available_balance_atomic,
                account.currency as DisplayCurrency,
              )}
            </p>
          </Surface>
        ))}
      </section>
      <Surface as="section" className="ledger-principle">
        <p className="eyebrow">IMMUTABLE HISTORY</p>
        <h2>입금·채굴·출금은 각각 독립된 원장 이벤트로 남습니다.</h2>
        <p>
          출금 대기 금액은 사용 가능 금액에서 분리되며, 관리자 조정은 사유와
          감사 기록 없이는 처리되지 않습니다.
        </p>
      </Surface>
      <section
        className="ledger-history"
        aria-labelledby="ledger-history-title"
      >
        <header>
          <p className="eyebrow">LEDGER HISTORY</p>
          <h2 id="ledger-history-title">최근 원장 기록</h2>
        </header>
        {ledgerEntries?.length ? (
          <div>
            {ledgerEntries.map((entry) => {
              const currency =
                currencyByAccount.get(entry.wallet_account_id) ?? "KRW";
              return (
                <article key={entry.id}>
                  <span
                    className={`ledger-direction ledger-direction--${entry.direction.toLowerCase()}`}
                  >
                    {entry.direction === "CREDIT" ? "+" : "−"}
                  </span>
                  <span>
                    <strong>{entry.entry_type}</strong>
                    <time dateTime={entry.created_at}>
                      {new Intl.DateTimeFormat("ko-KR", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Asia/Seoul",
                      }).format(new Date(entry.created_at))}
                    </time>
                  </span>
                  <strong>
                    {entry.direction === "CREDIT" ? "+" : "−"}
                    {formatAtomicAmount(String(entry.amount_atomic), currency)}
                  </strong>
                </article>
              );
            })}
          </div>
        ) : (
          <p>아직 생성된 원장 기록이 없습니다.</p>
        )}
      </section>
    </>
  );
}
