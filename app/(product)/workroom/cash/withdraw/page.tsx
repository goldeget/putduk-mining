import Link from "next/link";
import { requirePageUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readWorkroomCash } from "@/lib/wallet/read-workroom-cash.server";
import {
  WithdrawalForm,
  type WithdrawalPolicy,
  type RegisteredWithdrawalDestination,
} from "@/components/product/withdrawal-form";
import { normalizeDestinationMethod } from "@/components/product/destination-type";
import styles from "@/components/workroom/workroom.module.css";

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
      .eq("user_id", identity.userId)
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
      <h1>실제 잔액 출금</h1>
      <p>
        입금 확인된 잔액을 본인 명의 계좌 또는 등록한 USDT 주소로 요청하세요.
        운영자가 수동으로 송금하고 처리합니다.
      </p>
      <p>연습 포인트와 모의거래 결과는 출금 금액에 포함되지 않습니다.</p>
      <section className={styles.panel}>
        {ready && cash && wallet.data ? (
          <>
            <p>
              출금 가능 {BigInt(cash.availableKrw).toLocaleString("ko-KR")}원 ·
              처리 중 {BigInt(cash.heldKrw).toLocaleString("ko-KR")}원
            </p>
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
          <p role="status">
            출금 정보를 확인하지 못했습니다. 잠시 후 다시 열어 주세요.
          </p>
        )}
      </section>
      <Link href="/workroom/cash">실제 잔액으로 →</Link>
      {" · "}
      <Link href="/workroom/records">출금·거래 내역 →</Link>
    </div>
  );
}
