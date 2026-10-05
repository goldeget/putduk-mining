import "server-only";

import type { VerifiedIdentity } from "@/lib/auth/session";
import { readRankName } from "@/lib/product/member-screen-present";

export type MemberScreenFacts = {
  availableKrwAtomic: string | null;
  displayName: string;
  joinedAt: string | null;
  locale: string | null;
  rankName: string | null;
  walletUnavailable: boolean;
};

/** 홈과 더보기가 같이 쓰는 회원 표시값. 금액은 다시 계산하지 않는다. */
export async function readMemberScreenFacts(
  identity: VerifiedIdentity,
): Promise<MemberScreenFacts> {
  const [profile, settings, wallet, rank] = await Promise.all([
    identity.supabase
      .from("user_profiles")
      .select("display_name, created_at")
      .eq("user_id", identity.userId)
      .maybeSingle(),
    identity.supabase
      .from("user_settings")
      .select("locale")
      .eq("user_id", identity.userId)
      .maybeSingle(),
    identity.supabase
      .from("wallet_balance_snapshots")
      .select("available_balance_atomic")
      .eq("user_id", identity.userId)
      .eq("currency", "KRW")
      .maybeSingle(),
    identity.supabase
      .from("user_rank_progress")
      .select("rank_definitions(name_ko, is_active)")
      .eq("user_id", identity.userId)
      .maybeSingle(),
  ]);

  const displayName = profile.data?.display_name?.trim();

  return {
    availableKrwAtomic:
      wallet.error || !wallet.data
        ? null
        : String(wallet.data.available_balance_atomic),
    displayName: displayName ? displayName : "퍼뜩 회원",
    joinedAt: profile.error ? null : (profile.data?.created_at ?? null),
    locale: settings.error ? null : (settings.data?.locale ?? null),
    rankName: rank.error ? null : readRankName(rank.data?.rank_definitions),
    walletUnavailable: Boolean(wallet.error),
  };
}
