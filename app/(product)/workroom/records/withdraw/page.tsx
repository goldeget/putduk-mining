import HistoricalWithdrawalPage from "@/app/(product)/wallet/withdraw/page";
import { requirePageUser } from "@/lib/auth/session";
/** Preserve existing real-balance withdrawal rights; no practice-point conversion. */
export default async function ArchivedWithdrawalPage() {
  await requirePageUser("/workroom/records/withdraw");
  return (
    <>
      <section>
        <h1>이전 서비스 잔액 출금</h1>
        <p>
          기존 실제 잔액의 출금과 처리 내역입니다. 워크룸 연습 포인트는 출금
          대상이 아닙니다.
        </p>
      </section>
      <HistoricalWithdrawalPage />
    </>
  );
}
