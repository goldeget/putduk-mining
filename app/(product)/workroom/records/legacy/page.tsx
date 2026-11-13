import Link from "next/link";
import { requirePageUser } from "@/lib/auth/session";
import styles from "./legacy-records.module.css";

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
  const identity = await requirePageUser("/workroom/records/legacy");
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
      <header className={styles.heading}>
        <span className={styles.eyebrow}>보관된 거래 기록</span>
        <h1>잔액 변동 상세</h1>
        <p>
          이전 원화 계정에 보관된 기록입니다. 현재 이용 가능한 잔액은 입출금
          화면에서 확인하세요. 워크룸 연습 포인트와는 별도입니다.
        </p>
      </header>
      <section className={styles.panel}>
        <h2>기록된 원화 잔액</h2>
        {accounts.error ? (
          <p role="alert" className={styles.error}>
            기록을 읽지 못했습니다. 표시되지 않은 잔액을 0원으로 판단하지
            마세요.
          </p>
        ) : accounts.data?.length ? (
          accounts.data.map((account) => (
            <div
              className={styles.balances}
              key={String(account.wallet_account_id)}
            >
              <div className={styles.balance}>
                <span>이전 계정 전체 금액</span>
                <strong>{krw(account.balance_atomic)}</strong>
              </div>
              <div className={styles.balance}>
                <span>이전 계정 사용 가능 금액</span>
                <strong>{krw(account.available_balance_atomic)}</strong>
              </div>
            </div>
          ))
        ) : (
          <p className={styles.empty}>아직 원화 계정 내역이 없습니다.</p>
        )}
        <Link className={styles.action} href="/workroom/cash">
          현재 잔액 확인
        </Link>
      </section>
      <section className={styles.panel}>
        <h2>최근 거래 100건</h2>
        {ledger.error ? (
          <p role="alert" className={styles.error}>
            거래 내역을 읽지 못했습니다.
          </p>
        ) : ledger.data?.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table} role="table">
              <caption>기존 원화 계정의 거래 변동 내역</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col">시각</th>
                  <th scope="col">구분</th>
                  <th scope="col">금액</th>
                  <th scope="col">기록</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {ledger.data.map((entry) => (
                  <tr key={String(entry.id)} role="row">
                    <td data-label="시각" role="cell">
                      {new Date(String(entry.created_at)).toLocaleString(
                        "ko-KR",
                        { timeZone: "Asia/Seoul" },
                      )}
                    </td>
                    <td data-label="구분" role="cell">
                      {String(entry.entry_type)}
                    </td>
                    <td data-label="금액" className={styles.amount} role="cell">
                      {entry.direction === "DEBIT" ? "−" : "+"}
                      {krw(entry.amount_atomic)}
                    </td>
                    <td data-label="기록" role="cell">
                      {String(entry.reason ?? "거래 기록")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>표시할 거래가 없습니다.</p>
        )}
      </section>
      <Link className={styles.action} href="/workroom/records">
        입출금 거래 내역으로
      </Link>
    </div>
  );
}
