import CashWithdrawalPage from "@/app/(product)/workroom/cash/withdraw/page";
import { requirePageUser } from "@/lib/auth/session";
/** Preserve existing real-balance withdrawal rights; no practice-point conversion. */
export default async function ArchivedWithdrawalPage() {
  const identity = await requirePageUser("/workroom/records/withdraw");
  if (!identity) return null;
  return <CashWithdrawalPage />;
}
