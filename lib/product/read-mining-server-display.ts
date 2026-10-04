import "server-only";

import type { VerifiedIdentity } from "@/lib/auth/session";
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

  return createSupabaseAdminClient().rpc("read_own_mining_server_display", {
    p_user_id: sessionUserId,
  });
}
