import Link from "next/link";
import { requirePageUser } from "@/lib/auth/session";
import styles from "@/components/workroom/workroom.module.css";

export const dynamic = "force-dynamic";
function krw(value: unknown) {
  try {
    if (!/^-?\d+$/.test(String(value))) return "확인 필요";
    return BigInt(String(value)).toLocaleString("ko-KR") + "원";
  } catch {
    return "확인 필요";
  }
}
/** Existing money is read from its original KRW projection, never converted to practice points. */
export default async function HistoricalRecordsPage() {
  const identity = await requirePageUser("/workroom/records");
  const accounts = await identity.supabase
    .from("wallet_balance_snapshots")
    .select("wallet_account_id,balance_atomic,available_balance_atomic")
    .eq("user_id", identity.userId)
    .eq("currency", "KRW");
  const ids = (accounts.data ?? []).map((row) => String(row.wallet_account_id));
  const ledger = ids.length
    ? await identity.supabase
        .from("wallet_ledger")
        .select("id,direction,entry_type,amount_atomic,reason,created_at")
        .eq("user_id", identity.userId)
        .in("wallet_account_id", ids)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [], error: null };
  return (
    <div className={styles.page}>
      <h1>이전 서비스 이용 기록</h1>
      <p>
        기존 계정의 실제 잔액과 거래 기록입니다. 워크룸 연습 포인트와 별도로
        보관됩니다.
      </p>
      <section className={styles.panel}>
        <h2>기존 원화 잔액</h2>
        {accounts.error ? (
          <p role="alert">
            기록을 읽지 못했습니다. 표시되지 않은 잔액을 0원으로 판단하지
            마세요.
          </p>
        ) : accounts.data?.length ? (
          accounts.data.map((account) => (
            <div key={String(account.wallet_account_id)}>
              <p>전체 {krw(account.balance_atomic)}</p>
              <p>사용 가능 {krw(account.available_balance_atomic)}</p>
            </div>
          ))
        ) : (
          <p>이전 원화 계정이 없습니다.</p>
        )}
        <Link href="/workroom/records/withdraw">
          기존 잔액 출금·처리 내역 확인 →
        </Link>
      </section>
      <section className={styles.panel}>
        <h2>최근 기존 거래 100건</h2>
        {ledger.error ? (
          <p role="alert">거래 내역을 읽지 못했습니다.</p>
        ) : ledger.data?.length ? (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>구분</th>
                  <th>금액</th>
                  <th>기록</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.map((entry) => (
                  <tr key={String(entry.id)}>
                    <td>
                      {new Date(String(entry.created_at)).toLocaleString(
                        "ko-KR",
                        { timeZone: "Asia/Seoul" },
                      )}
                    </td>
                    <td>{String(entry.entry_type)}</td>
                    <td>
                      {entry.direction === "DEBIT" ? "−" : "+"}
                      {krw(entry.amount_atomic)}
                    </td>
                    <td>{String(entry.reason ?? "기존 거래")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>표시할 이전 거래가 없습니다.</p>
        )}
      </section>
      <Link href="/workroom">내 워크룸으로 돌아가기 →</Link>
    </div>
  );
}
