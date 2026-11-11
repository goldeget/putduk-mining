import DepositPage from "@/app/(product)/wallet/deposit/page";
import { requirePageUser } from "@/lib/auth/session";
export const dynamic = "force-dynamic";
export default async function CashDepositPage() {
  await requirePageUser("/workroom/cash/deposit");
  return <DepositPage />;
}
