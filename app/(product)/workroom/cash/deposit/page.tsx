import { DepositForm } from "@/components/product/deposit-form";
import { UsdtManualDepositForm } from "@/components/product/usdt-manual-deposit-form";
import { CashActivity } from "@/components/workroom/cash-activity";
import {
  CashFormPanel,
  CashHeader,
  CashSeparation,
  CashSteps,
} from "@/components/workroom/cash-ui";
import styles from "@/components/workroom/cash.module.css";
import { requirePageUser } from "@/lib/auth/session";
import { readKrwDepositSettings } from "@/lib/wallet/read-krw-deposit-settings.server";
import {
  isUsdtDepositNetwork,
  type UsdtDepositInstruction,
} from "@/domain/wallet/usdt-manual-deposit";

export const dynamic = "force-dynamic";
export default async function CashDepositPage() {
  const identity = await requirePageUser("/workroom/cash/deposit");
  const krw = await readKrwDepositSettings(identity.supabase);
  const [history, instructionRead] = await Promise.all([
    identity.supabase
      .from("deposit_requests")
      .select("id,amount_atomic,currency,status,requested_at")
      .eq("user_id", identity.userId)
      .eq("currency", "KRW")
      .order("requested_at", { ascending: false })
      .limit(8),
    identity.supabase
      .from("usdt_deposit_instructions")
      .select("deposit_address,network")
      .eq("is_active", true)
      .order("network", { ascending: true }),
  ]);
  const instructions: UsdtDepositInstruction[] = (
    instructionRead.data ?? []
  ).flatMap((row) =>
    isUsdtDepositNetwork(row.network) &&
    typeof row.deposit_address === "string" &&
    row.deposit_address.trim().length >= 8
      ? [{ network: row.network, depositAddress: row.deposit_address.trim() }]
      : [],
  );
  return (
    <div className={styles.page}>
      <CashHeader
        active="deposit"
        title="입금 신청"
        description="아래 입금 안내를 확인한 뒤 실제 입금한 금액을 신청하세요."
      />
      <div className={styles.formGrid}>
        <CashFormPanel>
          <DepositForm
            instruction={krw.instruction}
            contactOperator={krw.contactOperator}
            contactMessage={krw.contactMessage}
            instructionLoadFailed={krw.loadFailed}
          />
        </CashFormPanel>
        <CashSteps />
      </div>
      <CashActivity
        failed={Boolean(history.error)}
        items={(history.data ?? []).map((row) => ({
          id: row.id,
          type: "DEPOSIT",
          amount: String(row.amount_atomic),
          currency: row.currency,
          status: row.status,
          at: row.requested_at,
        }))}
      />
      <details className={styles.alternative}>
        <summary>USDT로 입금하기</summary>
        <div>
          <UsdtManualDepositForm
            instructions={instructions}
            loadFailed={Boolean(instructionRead.error)}
          />
        </div>
      </details>
      <CashSeparation />
    </div>
  );
}
