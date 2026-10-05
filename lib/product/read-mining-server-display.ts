import "server-only";

import type { VerifiedIdentity } from "@/lib/auth/session";
import {
  isAbsentPrincipalFailure,
  resolveMiningServerDisplayRead,
} from "@/lib/product/mining-server-display";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 채굴 표시값은 서버 전용 service_role로만 읽는다.
 * 다른 회원 id는 받지 않고, 확인된 세션 주체만 조회한다.
 */
export async function readOwnMiningServerDisplay(identity: VerifiedIdentity) {
  const sessionUserId = identity.userId;
  if (!sessionUserId) {
    return {
      data: null,
      error: { message: "MINING_DISPLAY_SIGN_IN_REQUIRED" },
    };
  }

  const client = createSupabaseAdminClient();
  const display = await client.rpc("read_own_mining_server_display", {
    p_user_id: sessionUserId,
  });
  if (!display.error && display.data != null) {
    return display;
  }
  if (!display.error || isAbsentPrincipalFailure(display.error)) {
    return resolveMiningServerDisplayRead(display, null);
  }

  const principalLots = await client
    .from("funding_principal_lots")
    .select("id")
    .eq("user_id", sessionUserId)
    .limit(1);
  return resolveMiningServerDisplayRead(display, principalLots);
}
