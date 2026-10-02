import { getVerifiedIdentity } from "@/lib/auth/session";
import { apiError, apiSuccess } from "@/lib/api/http";
import { buildKrwWalletProjection } from "@/domain/wallet/wallet-read";

export const dynamic = "force-dynamic";

/**
 * 지갑 요약 읽기 API.
 * 스냅샷 투영만 반환하며, 잔액을 만들거나 바꾸지 않는다.
 */
export async function GET() {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  }

  // V1 사용자 표시는 KRW 투영만 허용한다. USDT 잔고를 만들지 않는다.
  const { data, error } = await identity.supabase
    .from("wallet_balance_snapshots")
    .select(
      "wallet_account_id, currency, balance_atomic, available_balance_atomic, updated_at",
    )
    .eq("user_id", identity.userId)
    .eq("currency", "KRW")
    .order("currency");

  if (error) {
    return apiError({
      code: "WALLET_UNAVAILABLE",
      message: "자산 정보를 불러오지 못했습니다.",
      status: 503,
    });
  }

  const accounts = (data ?? []).map((row) => {
    const projection = buildKrwWalletProjection({
      availableBalanceAtomic: row.available_balance_atomic,
      balanceAtomic: row.balance_atomic,
      walletAccountId: String(row.wallet_account_id),
    });

    return {
      availableBalanceAtomic: projection.availableAtomic,
      balanceAtomic: projection.balanceAtomic,
      currency: "KRW" as const,
      heldBalanceAtomic: projection.heldAtomic,
      updatedAt: row.updated_at,
      walletAccountId: projection.walletAccountId,
    };
  });

  return apiSuccess({ accounts });
}
