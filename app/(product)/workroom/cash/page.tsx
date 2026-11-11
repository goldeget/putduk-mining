import Link from "next/link";
import { requirePageUser } from "@/lib/auth/session";
import { readWorkroomCash } from "@/lib/wallet/read-workroom-cash.server";
import styles from "@/components/workroom/workroom.module.css";
export const dynamic = "force-dynamic";
export default async function CashPage() {
  const identity = await requirePageUser("/workroom/cash");
  const cash = await readWorkroomCash(identity);
  const krw = (v: string) => BigInt(v).toLocaleString("ko-KR") + "원";
  return (
    <div className={styles.page}>
      <h1>실제 잔액</h1>
      <p>
        운영자가 확인한 입금과 출금 내역입니다. 연습 포인트와 별도로 관리됩니다.
      </p>
      <section className={styles.panel}>
        {!cash || !cash.ready ? (
          <p role="status">
            실제 잔액을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.
          </p>
        ) : (
          <dl>
            <dt>출금 가능</dt>
            <dd>{krw(cash.availableKrw)}</dd>
            <dt>출금 처리 중</dt>
            <dd>{krw(cash.heldKrw)}</dd>
            <dt>확인된 입금</dt>
            <dd>{krw(cash.depositedKrw)}</dd>
            <dt>완료된 출금</dt>
            <dd>{krw(cash.withdrawnKrw)}</dd>
          </dl>
        )}
        <nav aria-label="실제 잔액 메뉴">
          <Link href="/workroom/cash/deposit">입금 신청 →</Link>
          {" · "}
          <Link href="/workroom/cash/withdraw">출금 신청 →</Link>
          {" · "}
          <Link href="/workroom/records">거래 내역 →</Link>
        </nav>
      </section>
      <Link href="/workroom">내 워크룸으로 →</Link>
    </div>
  );
}
