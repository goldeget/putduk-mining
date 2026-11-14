import Link from "next/link";
import { requirePageUser } from "@/lib/auth/session";
import { readWorkroomCash } from "@/lib/wallet/read-workroom-cash.server";
import { readWorkroomCashActivity } from "@/lib/wallet/read-workroom-cash-activity.server";
import { CashActivity } from "@/components/workroom/cash-activity";
import {
  CashBalance,
  CashHeader,
  CashSeparation,
} from "@/components/workroom/cash-ui";
import styles from "@/components/workroom/cash.module.css";

export const dynamic = "force-dynamic";
export default async function CashRecordsPage() {
  const identity = await requirePageUser("/workroom/records");
  const [cash, history] = await Promise.all([
    readWorkroomCash(identity),
    readWorkroomCashActivity(identity, 100),
  ]);
  return (
    <div className={styles.page}>
      <CashHeader
        active="records"
        title="거래 내역"
        description="내 입출금 요청과 처리 결과를 한곳에서 확인하세요."
      />
      <CashBalance cash={cash} />
      <CashActivity full failed={history.failed} items={history.items} />
      <CashSeparation showPointsLink={false} />
      <div className={styles.legacy}>
        <span>상세한 잔액 변동 기록이 필요하신가요?</span>
        <Link href="/workroom/records/legacy">잔액 변동 상세 보기 →</Link>
      </div>
    </div>
  );
}
