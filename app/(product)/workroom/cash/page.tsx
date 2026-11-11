import { CashActivity } from "@/components/workroom/cash-activity";
import {
  CashBalance,
  CashHeader,
  CashSeparation,
} from "@/components/workroom/cash-ui";
import { requirePageUser } from "@/lib/auth/session";
import { readWorkroomCash } from "@/lib/wallet/read-workroom-cash.server";
import { readWorkroomCashActivity } from "@/lib/wallet/read-workroom-cash-activity.server";
import styles from "@/components/workroom/cash.module.css";
export const dynamic = "force-dynamic";
export default async function CashPage() {
  const identity = await requirePageUser("/workroom/cash");
  const [cash, history] = await Promise.all([
    readWorkroomCash(identity),
    readWorkroomCashActivity(identity, 6),
  ]);
  return (
    <div className={styles.page}>
      <CashHeader
        active="overview"
        title="입출금"
        description="내 원화 잔액과 입출금 진행 상황을 확인하세요."
      />
      <CashBalance cash={cash} />
      <CashActivity failed={history.failed} items={history.items} />
      <CashSeparation />
    </div>
  );
}
