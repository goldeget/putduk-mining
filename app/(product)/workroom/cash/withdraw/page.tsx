import {
  CashFormPanel,
  CashHeader,
  CashSeparation,
  CashSteps,
} from "@/components/workroom/cash-ui";
import { requirePageUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readWorkroomCash } from "@/lib/wallet/read-workroom-cash.server";
import {
  WithdrawalForm,
  type WithdrawalPolicy,
  type RegisteredWithdrawalDestination,
} from "@/components/product/withdrawal-form";
import { normalizeDestinationMethod } from "@/components/product/destination-type";
import styles from "@/components/workroom/cash.module.css";

export const dynamic = "force-dynamic";
export default async function CashWithdrawalPage() {
  const identity = await requirePageUser("/workroom/cash/withdraw");
  const at = new Date().toISOString();
  const admin = createSupabaseAdminClient();
  const [cash, wallet, policyRows, destinationRows] = await Promise.all([
    readWorkroomCash(identity),
    identity.supabase
      .from("wallet_balance_snapshots")
      .select("wallet_account_id")
      .eq("user_id", identity.userId)
      .eq("currency", "KRW")
      .maybeSingle(),
    admin
      .from("withdrawal_policies")
      .select(
        "id,version,destination_type,minimum_amount_atomic,fee_atomic,destination_config",
      )
      .eq("is_enabled", true)
      .eq("currency", "KRW")
      .lte("effective_at", at)
      .or(`expires_at.is.null,expires_at.gt.${at}`)
      .order("version", { ascending: false }),
    identity.supabase
      .from("withdrawal_destinations")
      .select(
        "id,destination_type,display_hint,verification_status,protection_until",
      )
      .in("destination_type", ["KRW_BANK", "USDT_ADDRESS"])
      .is("replaced_at", null)
      .order("created_at", { ascending: false }),
  ]);
  const policies: WithdrawalPolicy[] = [];
  for (const row of policyRows.data ?? []) {
    const method = normalizeDestinationMethod(row.destination_type);
    if (
      !method ||
      policies.some((p) => p.method === method) ||
      String(row.fee_atomic) !== "0"
    )
      continue;
    const key =
      method === "KRW_BANK" ? "allowed_bank_codes" : "allowed_networks";
    const config: unknown = row.destination_config;
    const allowed =
      config && typeof config === "object" && key in config
        ? (config as Record<string, unknown>)[key]
        : null;
    if (
      !Array.isArray(allowed) ||
      !allowed.length ||
      allowed.some((v) => typeof v !== "string")
    )
      continue;
    policies.push({
      method,
      id: row.id,
      version: row.version,
      minimumAmountAtomic: String(row.minimum_amount_atomic),
      feeAtomic: "0",
      allowedDestinations: allowed,
    });
  }
  const destinations: RegisteredWithdrawalDestination[] = (
    destinationRows.data ?? []
  ).flatMap((row) => {
    const method = normalizeDestinationMethod(row.destination_type);
    if (
      !method ||
      row.verification_status !== "VERIFIED" ||
      !Number.isFinite(Date.parse(row.protection_until))
    )
      return [];
    return [
      {
        id: row.id,
        method,
        displayHint: row.display_hint,
        protectionActive: Date.parse(row.protection_until) > Date.parse(at),
      },
    ];
  });
  const ready =
    cash?.ready &&
    wallet.data &&
    !wallet.error &&
    !policyRows.error &&
    !destinationRows.error &&
    policies.length &&
    process.env.WITHDRAWAL_DATA_KEY;
  return (
    <div className={styles.page}>
      <CashHeader
        active="withdraw"
        title="출금 신청"
        description="확인된 원화 잔액으로 출금을 요청하세요. 운영자가 송금 후 완료 처리합니다."
      />
      <div className={styles.formGrid}>
        <CashFormPanel>
          {ready && cash && wallet.data ? (
            <>
              <div className={styles.compactBalance}>
                <div>
                  <span>출금 가능한 잔액</span>
                  <strong>
                    {BigInt(cash.availableKrw).toLocaleString("ko-KR")}원
                  </strong>
                </div>
                <small>
                  처리 중 {BigInt(cash.heldKrw).toLocaleString("ko-KR")}원
                </small>
              </div>
              <WithdrawalForm
                directDepositOnly
                ownerId={identity.userId}
                policies={policies}
                destinations={destinations}
                account={{
                  id: wallet.data.wallet_account_id,
                  availableBalanceAtomic: cash.availableKrw,
                  heldBalanceAtomic: cash.heldKrw,
                }}
              />
            </>
          ) : (
            <p role="status" className={styles.warning}>
              출금 정보를 확인하지 못했습니다. 잠시 후 다시 열어 주세요. 계속
              표시되면 담당자에게 문의해 주세요.
            </p>
          )}
        </CashFormPanel>
        <CashSteps withdrawal />
      </div>
      <CashSeparation />
    </div>
  );
}
